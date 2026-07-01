package proxy

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/elazarl/goproxy"
	"github.com/gorilla/websocket"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/harness-proxy/harness/internal/cert"
	"github.com/harness-proxy/harness/internal/history"
	"github.com/harness-proxy/harness/internal/intruder"
	nucleiPkg "github.com/harness-proxy/harness/internal/nuclei"
	"github.com/harness-proxy/harness/internal/repeater"
	sqlmapPkg "github.com/harness-proxy/harness/internal/sqlmap"
	"github.com/harness-proxy/harness/internal/tokens"
	"github.com/harness-proxy/harness/internal/fingerprint"
)

type requestMeta struct {
	start       time.Time
	requestBody []byte
}

// InterceptedRequest is a request waiting for user action.
type InterceptedRequest struct {
	ID      string `json:"id"`
	Raw     string `json:"raw"`
	Host    string `json:"host"`
	HTTPS   bool   `json:"https"`
	resolve chan string
}

// InterceptedResponse is a response waiting for user action.
type InterceptedResponse struct {
	ID      string `json:"id"`
	Raw     string `json:"raw"` // full HTTP response text
	Host    string `json:"host"`
	resolve chan string
}

// App is the Wails application backend.
type App struct {
	startupErr string // non-empty if a port was already in use at startup

	ctx     context.Context
	proxy   *goproxy.ProxyHttpServer
	certMgr *cert.Manager
	history *history.Store

	proxyServer *http.Server
	wsServer    *http.Server

	interceptMu sync.Mutex
	interceptOn bool
	intercepted map[string]*InterceptedRequest

	interceptRespMu sync.Mutex
	interceptRespOn bool
	interceptedResps map[string]*InterceptedResponse

	scopeMu sync.RWMutex
	scope   []string

	wsMu       sync.Mutex
	wsClients  map[*websocket.Conn]bool
	wsUpgrader websocket.Upgrader

	rules *RuleEngine

	intruderStop chan struct{}
	tokenMgr     *tokens.Manager

	sqlmapMu   sync.Mutex
	sqlmapStop chan struct{}

	nucleiMu   sync.Mutex
	nucleiStop chan struct{}

	browserMu  sync.Mutex
	browserCmd *exec.Cmd
}

func NewApp() *App {
	a := &App{
		intercepted:      make(map[string]*InterceptedRequest),
		interceptedResps: make(map[string]*InterceptedResponse),
		wsClients:        make(map[*websocket.Conn]bool),
		wsUpgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		rules: NewRuleEngine(),
	}
	a.tokenMgr = tokens.New(func(tok string) {
		a.broadcast(map[string]interface{}{"type": "token_update", "token": tok})
	})
	return a
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	dataDir, _ := os.UserConfigDir()
	harnessDir := filepath.Join(dataDir, "harness")
	os.MkdirAll(harnessDir, 0700)

	logFile, err := os.OpenFile(filepath.Join(harnessDir, "harness.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		log.SetOutput(logFile)
	}
	log.Println("=== Harness starting ===")

	certMgr, err := cert.NewManager(harnessDir)
	if err != nil {
		log.Fatalf("cert manager: %v", err)
	}
	a.certMgr = certMgr

	store, err := history.New(filepath.Join(harnessDir, "history.db"))
	if err != nil {
		log.Fatalf("history store: %v", err)
	}
	store.Clear()
	store.ClearCrawlNodes()
	a.history = store

	a.setupProxy()
}

// Domains with HSTS preloading or browser-level cert pinning.
// These cannot be MITMed regardless of trust store — tunnel them transparently.
var hstsBypassed = []string{
	"addons.mozilla.org",
	"accounts.google.com", "accounts.youtube.com",
	"myaccount.google.com", "security.google.com",
	"login.live.com", "login.microsoftonline.com", "account.microsoft.com",
	"appleid.apple.com",
	"github.com", "api.github.com",
	"gitlab.com", "bitbucket.org",
	"twitter.com", "x.com",
	"facebook.com", "instagram.com", "linkedin.com",
	"netflix.com", "api.stripe.com", "paypal.com",
}

// noisyHostSuffixes covers entire infrastructure domains and specific background services.
// Any host matching a suffix here is tunneled without MITM and never recorded,
// UNLESS the user has explicitly added a matching pattern to scope.
var noisyHostSuffixes = []string{
	// ---- Google background infrastructure ----
	"googleapis.com",
	"gstatic.com",
	"gvt1.com",
	"gvt2.com",
	"ggpht.com",
	"googleusercontent.com",
	"google-analytics.com",
	"googletagmanager.com",
	"googletagservices.com",
	"googlesyndication.com",
	"doubleclick.net",
	"2mdn.net",
	// google.com subdomains that are always Chrome background traffic
	"clients.google.com",    // android.clients, ios.clients, etc.
	"newtab.google.com",     // Chrome new tab page background requests
	"play.google.com",
	"chrome.google.com",
	"clients1.google.com",
	"clients2.google.com",
	"clients3.google.com",
	"clients4.google.com",
	"update.google.com",
	"safebrowsing.google.com",
	"csp.withgoogle.com",
	"ogs.google.com",
	"dl.google.com",
	"beacons.gcp.gvt2.com",
	"notifications.google.com",
	"fcm.googleapis.com",    // Firebase Cloud Messaging
	"mtalk.google.com",      // push notifications
	"alt1-mtalk.google.com",
	"alt2-mtalk.google.com",
	"alt3-mtalk.google.com",
	"alt4-mtalk.google.com",
	"alt5-mtalk.google.com",
	"alt6-mtalk.google.com",
	"alt7-mtalk.google.com",
	"alt8-mtalk.google.com",
	// ---- OCSP / certificate revocation ----
	"ocsp.pki.goog",
	"pki.goog",
	"ocsp.digicert.com",
	"ocsp.sectigo.com",
	"o.lencr.org",
	"crl.microsoft.com",
	"oneocsp.microsoft.com",
	"ocsp.comodoca.com",
	"ocsp.usertrust.com",
	// ---- Windows / Edge background services ----
	"settings-win.data.microsoft.com",
	"edge.microsoft.com",
	"nav.smartscreen.microsoft.com",
	"checkappexec.microsoft.com",
	"config.edge.skype.com",
	"fp.msedge.net",
	"self.events.data.microsoft.com",
	"wdcp.microsoft.com",
	"wdcpalt.microsoft.com",
	"bingapis.com",
	// ---- Common analytics / telemetry ----
	"newrelic.com",
	"nr-data.net",
	"scorecardresearch.com",
	"quantserve.com",
	"demdex.net",
	"omtrdc.net",
	// ---- Push / CDN / misc background ----
	"push.services.mozilla.com",
	"detectportal.firefox.com",
}

func isStaticAsset(path string) bool {
	lower := strings.ToLower(path)
	// Strip query string for extension check
	if i := strings.IndexByte(lower, '?'); i != -1 {
		lower = lower[:i]
	}
	for _, ext := range []string{
		".css", ".js", ".mjs", ".cjs",
		".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".avif",
		".woff", ".woff2", ".ttf", ".eot", ".otf",
		".map", ".json.map",
	} {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

func matchHost(host string, suffixes []string) bool {
	h := host
	if i := strings.LastIndex(host, ":"); i != -1 {
		h = host[:i]
	}
	for _, s := range suffixes {
		if h == s || strings.HasSuffix(h, "."+s) {
			return true
		}
	}
	return false
}

func isBypassed(host string) bool  { return matchHost(host, hstsBypassed) }
func isNoisyHost(host string) bool { return matchHost(host, noisyHostSuffixes) }

// isNoisyRequest catches background XHR/fetch calls that originate from pages
// on large hosts (e.g. www.google.com) but are clearly not user-initiated.
func isNoisyRequest(host, path string) bool {
	h := host
	if i := strings.LastIndex(host, ":"); i != -1 {
		h = host[:i]
	}
	if h == "www.google.com" || strings.HasSuffix(h, ".google.com") {
		for _, prefix := range []string{
			"/async/", "/gen_204", "/log?", "/complete/", "/s?",
			"/url?", "/client_204", "/xjs/", "/_/VisualFrontendUi/",
		} {
			if strings.HasPrefix(path, prefix) {
				return true
			}
		}
	}
	return false
}

// shouldMITM: HSTS-pinned and noisy infra hosts tunnel transparently;
// everything else is MITMed regardless of scope or intercept state.
func (a *App) shouldMITM(host string) bool {
	if isBypassed(host) {
		return false
	}
	if isNoisyHost(host) && !a.isInExplicitScope(host) {
		return false
	}
	return true
}

// isInExplicitScope returns true when the user has set scope and this host matches.
func (a *App) isInExplicitScope(host string) bool {
	a.scopeMu.RLock()
	defer a.scopeMu.RUnlock()
	if len(a.scope) == 0 {
		return false
	}
	return matchHost(host, a.scope)
}

func checkPort(addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	ln.Close()
	return nil
}

func (a *App) setupProxy() {
	for _, addr := range []string{"127.0.0.1:8080", "127.0.0.1:8081"} {
		if err := checkPort(addr); err != nil {
			a.startupErr = fmt.Sprintf(
				"Port %s is already in use.\n\nAnother Harness instance may still be running — close it and restart.\n\nError: %v",
				addr, err,
			)
			log.Printf("startup port conflict on %s: %v", addr, err)
			return
		}
	}

	p := goproxy.NewProxyHttpServer()
	p.Verbose = false

	caCert, err := a.certMgr.CATLSCertificate()
	if err != nil {
		log.Fatalf("failed to get CA TLS cert: %v", err)
	}
	goproxy.GoproxyCa = caCert

	tlsCfg := goproxy.TLSConfigFromCA(&goproxy.GoproxyCa)
	mitmAction := &goproxy.ConnectAction{Action: goproxy.ConnectMitm, TLSConfig: tlsCfg}
	passthroughAction := &goproxy.ConnectAction{Action: goproxy.ConnectAccept, TLSConfig: tlsCfg}

	p.OnRequest().HandleConnect(goproxy.FuncHttpsHandler(func(host string, ctx *goproxy.ProxyCtx) (*goproxy.ConnectAction, string) {
		if a.shouldMITM(host) {
			return mitmAction, host
		}
		return passthroughAction, host
	}))

	p.OnRequest().DoFunc(func(req *http.Request, ctx *goproxy.ProxyCtx) (outReq *http.Request, outResp *http.Response) {
		outReq = req
		defer func() {
			if r := recover(); r != nil {
				log.Printf("panic in request handler: %v", r)
			}
		}()
		outReq, outResp = a.handleRequest(req, ctx)
		return
	})

	p.OnResponse().DoFunc(func(resp *http.Response, ctx *goproxy.ProxyCtx) (outResp *http.Response) {
		outResp = resp
		defer func() {
			if r := recover(); r != nil {
				log.Printf("panic in response handler: %v", r)
			}
		}()
		outResp = a.handleResponse(resp, ctx)
		return
	})

	a.proxy = p

	// Landing page HTML served at http://harness.proxy or http://127.0.0.1:8080
	landingHTML := fmt.Sprintf(`<!DOCTYPE html>
<html><head><title>Harness Proxy</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d0d0f;color:#e8e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#131318;border:1px solid #2a2a35;border-radius:12px;padding:36px;max-width:500px;width:90%%}
h1{color:#7c6af7;font-size:20px;font-weight:700;margin-bottom:6px}
.sub{color:#55556a;font-size:13px;margin-bottom:24px}
.btn{display:block;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-bottom:10px;text-align:center}
.primary{background:#7c6af7;color:#fff}.secondary{background:#1a1a22;color:#e8e8f0;border:1px solid #2a2a35}
hr{border:none;border-top:1px solid #1e1e28;margin:24px 0}
h2{font-size:12px;font-weight:700;color:#8888a0;margin-bottom:10px;text-transform:uppercase;letter-spacing:.8px}
ol{color:#8888a0;font-size:12px;line-height:2.2;padding-left:18px}
strong{color:#e8e8f0}</style></head>
<body><div class="card">
<h1>Harness</h1>
<div class="sub">Proxy running · 127.0.0.1:8080</div>
<a class="btn primary" href="/cert">⬇ Download CA cert (.crt) — Chrome / Edge</a>
<a class="btn secondary" href="/cert.pem">⬇ Download CA cert (.pem) — Firefox</a>
<hr>
<h2>Chrome / Edge</h2>
<ol>
<li>Double-click <strong>harness-ca.crt</strong></li>
<li>Install Certificate → <strong>Current User</strong> → Next</li>
<li>Place in: <strong>Trusted Root Certification Authorities</strong> → OK → Finish → Yes</li>
<li><strong>Fully restart</strong> Chrome or Edge</li>
</ol>
<hr>
<h2>Firefox</h2>
<ol>
<li>Settings → Privacy &amp; Security → <strong>View Certificates</strong></li>
<li>Authorities → <strong>Import</strong> → select <strong>harness-ca.pem</strong></li>
<li>Check <strong>"Trust this CA to identify websites"</strong> → OK</li>
</ol>
</div></body></html>`)

	// Internal mux for the cert download page
	certMux := http.NewServeMux()

	certMux.HandleFunc("/cert", func(w http.ResponseWriter, r *http.Request) {
		der := a.certMgr.CACertDER()
		w.Header().Set("Content-Type", "application/x-x509-ca-cert")
		w.Header().Set("Content-Disposition", `attachment; filename="harness-ca.crt"`)
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(der)))
		w.Write(der)
		log.Printf("Served DER cert to %s", r.RemoteAddr)
	})

	certMux.HandleFunc("/cert.pem", func(w http.ResponseWriter, r *http.Request) {
		pem := a.certMgr.CACertPEM()
		w.Header().Set("Content-Type", "application/x-pem-file")
		w.Header().Set("Content-Disposition", `attachment; filename="harness-ca.pem"`)
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(pem)))
		w.Write(pem)
		log.Printf("Served PEM cert to %s", r.RemoteAddr)
	})

	certMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(landingHTML))
	})

	// Root handler:
	// CONNECT → goproxy (HTTPS tunnels)
	// request to harness.proxy or 127.0.0.1:8080 → cert download page
	// everything else → goproxy (regular HTTP proxy)
	a.proxyServer = &http.Server{
		Addr:        "127.0.0.1:8080",
		IdleTimeout: 90 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodConnect {
				p.ServeHTTP(w, r)
				return
			}
			host := r.Host
			if host == "harness.proxy" ||
				host == "127.0.0.1:8080" ||
				host == "localhost:8080" ||
				host == "" {
				certMux.ServeHTTP(w, r)
				return
			}
			p.ServeHTTP(w, r)
		}),
	}

	// WebSocket on 8081
	wsMux := http.NewServeMux()
	wsMux.HandleFunc("/ws", a.wsHandler)
	a.wsServer = &http.Server{
		Addr:    "127.0.0.1:8081",
		Handler: wsMux,
	}

	go func() {
		log.Println("Proxy on 127.0.0.1:8080")
		if err := a.proxyServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("proxy error: %v", err)
		}
	}()

	go func() {
		log.Println("WebSocket on 127.0.0.1:8081")
		if err := a.wsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("ws error: %v", err)
		}
	}()
}

func (a *App) handleRequest(req *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
	if !a.inScope(req.Host) {
		return req, nil
	}
	if req2 := a.applyRequestRules(req); req2 != nil {
		req = req2
	}

	shouldIntercept := a.IsIntercepting() &&
		!(isNoisyHost(req.Host) && !a.isInExplicitScope(req.Host)) &&
		!isStaticAsset(req.URL.Path) &&
		!isNoisyRequest(req.Host, req.URL.Path)

	if shouldIntercept {
		raw, _ := httputil.DumpRequest(req, true)
		ir := &InterceptedRequest{
			ID:      fmt.Sprintf("%d", time.Now().UnixNano()),
			Raw:     string(raw),
			Host:    req.Host,
			HTTPS:   req.URL.Scheme == "https",
			resolve: make(chan string, 1),
		}
		a.interceptMu.Lock()
		a.intercepted[ir.ID] = ir
		a.interceptMu.Unlock()
		a.broadcast(map[string]interface{}{"type": "intercepted", "request": ir})
		action := <-ir.resolve
		a.interceptMu.Lock()
		delete(a.intercepted, ir.ID)
		a.interceptMu.Unlock()
		if action == "drop" {
			return req, goproxy.NewResponse(req, "text/plain", http.StatusForbidden, "Dropped by Harness")
		}
		if action != "forward" {
			newReq, err := http.ReadRequest(bufio.NewReader(strings.NewReader(action)))
			if err == nil {
				newReq.URL.Scheme = req.URL.Scheme
				newReq.URL.Host = req.URL.Host
				newReq.RequestURI = ""
				req = newReq
			}
		}
	}
	var reqBodyBuf []byte
	if req.Body != nil && req.Body != http.NoBody {
		const maxReqBody = 256 << 10 // 256 KB cap
		reqBodyBuf, _ = io.ReadAll(io.LimitReader(req.Body, maxReqBody))
		req.Body = io.NopCloser(bytes.NewReader(reqBodyBuf))
		if req.ContentLength > 0 {
			req.ContentLength = int64(len(reqBodyBuf))
		}
	}

	ctx.UserData = requestMeta{start: time.Now(), requestBody: reqBodyBuf}
	return req, nil
}

func (a *App) macroRetry(origReq *http.Request, _ []byte) *http.Response {
	newToken := a.tokenMgr.RunMacro()
	if newToken == "" {
		return nil
	}
	raw, err := httputil.DumpRequest(origReq, true)
	if err != nil {
		return nil
	}
	injected := a.tokenMgr.InjectToken(string(raw))
	newReq, err := http.ReadRequest(bufio.NewReader(strings.NewReader(injected)))
	if err != nil {
		return nil
	}
	newReq.RequestURI = ""
	newReq.URL.Scheme = origReq.URL.Scheme
	newReq.URL.Host = origReq.URL.Host
	newReq.Host = origReq.Host

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(newReq)
	if err != nil {
		return nil
	}
	return resp
}

func (a *App) handleResponse(resp *http.Response, ctx *goproxy.ProxyCtx) *http.Response {
	if resp == nil || ctx.Req == nil {
		return resp
	}

	host := ctx.Req.Host

	// Drop browser noise that slipped through as plain HTTP.
	if isNoisyHost(host) && !a.isInExplicitScope(host) {
		return resp
	}
	if !a.inScope(host) {
		return resp
	}

	meta, _ := ctx.UserData.(requestMeta)
	duration := time.Since(meta.start).Milliseconds()

	mimeType := resp.Header.Get("Content-Type")
	if idx := strings.Index(mimeType, ";"); idx != -1 {
		mimeType = mimeType[:idx]
	}
	mimeType = strings.TrimSpace(mimeType)

	isTextType := strings.HasPrefix(mimeType, "text/") ||
		mimeType == "application/json" ||
		mimeType == "application/xml" ||
		mimeType == "application/javascript" ||
		strings.HasSuffix(mimeType, "+json") ||
		strings.HasSuffix(mimeType, "+xml")

	intercepting := a.IsIntercepting()
	interceptingResp := a.IsInterceptingResponse() &&
		!isStaticAsset(ctx.Req.URL.Path) &&
		!isNoisyRequest(host, ctx.Req.URL.Path)
	needBody := intercepting || interceptingResp ||
		a.rules.hasRulesFor("response_body") ||
		a.tokenMgr.HasExtractionRules()

	var body []byte
	responseLength := int(resp.ContentLength) // from headers; may be -1 if unknown
	if responseLength < 0 {
		responseLength = 0
	}

	if a.rules.hasRulesFor("response_header") {
		var hdrBuf bytes.Buffer
		resp.Header.Write(&hdrBuf)
		modified := a.rules.apply("response_header", hdrBuf.String(), ctx.Req.URL.String())
		newHdr := make(http.Header)
		for _, line := range strings.Split(modified, "\r\n") {
			if line == "" {
				continue
			}
			if idx := strings.IndexByte(line, ':'); idx > 0 {
				key := strings.TrimSpace(line[:idx])
				val := strings.TrimSpace(line[idx+1:])
				newHdr.Add(key, val)
			}
		}
		resp.Header = newHdr
	}

	if needBody {
		const maxBody = 1 << 20 // 1 MB cap
		body, _ = io.ReadAll(io.LimitReader(resp.Body, maxBody))
		responseLength = len(body)

		if a.rules.hasRulesFor("response_body") {
			modified := a.rules.apply("response_body", string(body), ctx.Req.URL.String())
			body = []byte(modified)
			responseLength = len(body)
			resp.ContentLength = int64(responseLength)
			resp.Header.Set("Content-Length", fmt.Sprintf("%d", responseLength))
		}
		resp.Body = io.NopCloser(bytes.NewReader(body))

		a.tokenMgr.TryExtract(resp, body)

		// 401 auto-retry with macro.
		if resp.StatusCode == http.StatusUnauthorized && a.tokenMgr.HasMacro() {
			if newResp := a.macroRetry(ctx.Req, body); newResp != nil {
				newBody, _ := io.ReadAll(newResp.Body)
				newResp.Body.Close()
				newResp.Body = io.NopCloser(bytes.NewReader(newBody))
				resp = newResp
				body = newBody
				responseLength = len(body)
			}
		}
	} else if isTextType {
		// Peek 32 KB for secrets scanning; stitch remainder back so browser gets full body.
		const secretsCap = 32 << 10
		body, _ = io.ReadAll(io.LimitReader(resp.Body, secretsCap))
		resp.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), resp.Body))
	}

	rawReq, _ := httputil.DumpRequest(ctx.Req, false)
	var fullRawReq []byte
	if len(meta.requestBody) > 0 {
		fullRawReq = append(rawReq, meta.requestBody...)
	} else {
		fullRawReq = rawReq
	}

	var headerBuf bytes.Buffer
	resp.Header.Write(&headerBuf)

	if responseLength == 0 && resp.ContentLength > 0 {
		responseLength = int(resp.ContentLength)
	}

	entry := &history.Entry{
		Method:          ctx.Req.Method,
		Host:            host,
		URL:             ctx.Req.URL.String(),
		RequestHeaders:  string(fullRawReq),
		RequestBody:     string(meta.requestBody),
		StatusCode:      resp.StatusCode,
		ResponseHeaders: headerBuf.String(),
		ResponseBody:    string(body),
		ResponseLength:  responseLength,
		DurationMs:      duration,
		MimeType:        mimeType,
		InScope:         true,
	}

	id, err := a.history.Add(entry)
	if err != nil {
		log.Printf("history add: %v", err)
	}
	entry.ID = id

	secretsSnippet := ""
	if len(body) > 0 {
		const wsCap = 32 << 10
		if len(body) > wsCap {
			secretsSnippet = string(body[:wsCap])
		} else {
			secretsSnippet = string(body)
		}
	}
	a.broadcast(map[string]interface{}{
		"type": "history",
		"entry": map[string]interface{}{
			"id":             entry.ID,
			"method":         entry.Method,
			"host":           entry.Host,
			"url":            entry.URL,
			"requestHeaders": entry.RequestHeaders,
			"statusCode":     entry.StatusCode,
			"responseLength": entry.ResponseLength,
			"durationMs":     entry.DurationMs,
			"mimeType":       entry.MimeType,
			"inScope":        entry.InScope,
			"responseBody":   secretsSnippet,
		},
	})

	// Response intercept — block until user forwards/drops/edits.
	if interceptingResp {
		var rawBuf bytes.Buffer
		fmt.Fprintf(&rawBuf, "HTTP/%d.%d %d %s\r\n",
			resp.ProtoMajor, resp.ProtoMinor,
			resp.StatusCode, http.StatusText(resp.StatusCode))
		resp.Header.Write(&rawBuf)
		rawBuf.WriteString("\r\n")
		rawBuf.Write(body)

		ir := &InterceptedResponse{
			ID:      fmt.Sprintf("resp_%d", time.Now().UnixNano()),
			Raw:     rawBuf.String(),
			Host:    host,
			resolve: make(chan string, 1),
		}
		a.interceptRespMu.Lock()
		a.interceptedResps[ir.ID] = ir
		a.interceptRespMu.Unlock()
		a.broadcast(map[string]interface{}{"type": "intercepted_response", "response": ir})

		action := <-ir.resolve
		a.interceptRespMu.Lock()
		delete(a.interceptedResps, ir.ID)
		a.interceptRespMu.Unlock()

		if action == "drop" {
			return goproxy.NewResponse(ctx.Req, "text/plain", http.StatusForbidden, "Response dropped by Harness")
		}
		if action != "forward" {
			newResp, err := http.ReadResponse(bufio.NewReader(strings.NewReader(action)), ctx.Req)
			if err == nil {
				return newResp
			}
		}
		// "forward" — send original body (already buffered)
		resp.Body = io.NopCloser(bytes.NewReader(body))
	}
	return resp
}

func (a *App) inScope(host string) bool {
	a.scopeMu.RLock()
	defer a.scopeMu.RUnlock()
	if len(a.scope) == 0 {
		return true
	}
	for _, pattern := range a.scope {
		if strings.Contains(host, pattern) {
			return true
		}
	}
	return false
}

func (a *App) DomReady(ctx context.Context) {
	wailsRuntime.WindowMaximise(ctx)
	if a.startupErr != "" {
		wailsRuntime.MessageDialog(ctx, wailsRuntime.MessageDialogOptions{
			Type:    wailsRuntime.ErrorDialog,
			Title:   "Harness — Port Conflict",
			Message: a.startupErr,
		})
		wailsRuntime.Quit(ctx)
	}
}

func (a *App) Shutdown(_ context.Context) {
	// Release blocked intercept goroutines first — otherwise proxyServer.Shutdown
	// hangs waiting for active connections to drain.
	a.SetIntercept(false)
	a.SetInterceptResponse(false)
	a.StopIntruder()
	a.StopNuclei()
	a.StopSQLMap()

	shutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if a.proxyServer != nil {
		a.proxyServer.Shutdown(shutCtx)
	}
	if a.wsServer != nil {
		a.wsServer.Shutdown(shutCtx)
	}

	if a.history != nil {
		a.history.Clear()
		a.history.ClearCrawlNodes()
		a.history.Close()
	}

	os.Exit(0)
}

func (a *App) IsIntercepting() bool {
	a.interceptMu.Lock()
	defer a.interceptMu.Unlock()
	return a.interceptOn
}

func (a *App) SetIntercept(on bool) {
	a.interceptMu.Lock()
	a.interceptOn = on
	if !on {
		for id, ir := range a.intercepted {
			select { case ir.resolve <- "forward": default: }
			delete(a.intercepted, id)
		}
	}
	a.interceptMu.Unlock()
	if !on {
		a.SetInterceptResponse(false)
	}
}

func (a *App) ForwardAllRequests() {
	a.interceptMu.Lock()
	defer a.interceptMu.Unlock()
	for id, ir := range a.intercepted {
		select { case ir.resolve <- "forward": default: }
		delete(a.intercepted, id)
	}
}

func (a *App) SetInterceptResponse(on bool) {
	a.interceptRespMu.Lock()
	defer a.interceptRespMu.Unlock()
	a.interceptRespOn = on
	if !on {
		for id, ir := range a.interceptedResps {
			select { case ir.resolve <- "forward": default: }
			delete(a.interceptedResps, id)
		}
	}
}

func (a *App) IsInterceptingResponse() bool {
	a.interceptRespMu.Lock()
	defer a.interceptRespMu.Unlock()
	return a.interceptRespOn
}

func (a *App) ForwardResponse(id string) {
	a.interceptRespMu.Lock()
	ir, ok := a.interceptedResps[id]
	a.interceptRespMu.Unlock()
	if ok {
		ir.resolve <- "forward"
	}
}

func (a *App) DropResponse(id string) {
	a.interceptRespMu.Lock()
	ir, ok := a.interceptedResps[id]
	a.interceptRespMu.Unlock()
	if ok {
		ir.resolve <- "drop"
	}
}

func (a *App) ModifyAndForwardResponse(id, rawResponse string) {
	a.interceptRespMu.Lock()
	ir, ok := a.interceptedResps[id]
	a.interceptRespMu.Unlock()
	if ok {
		ir.resolve <- rawResponse
	}
}

func (a *App) ForwardAllResponses() {
	a.interceptRespMu.Lock()
	defer a.interceptRespMu.Unlock()
	for id, ir := range a.interceptedResps {
		select { case ir.resolve <- "forward": default: }
		delete(a.interceptedResps, id)
	}
}

func (a *App) ForwardRequest(id string) {
	a.interceptMu.Lock()
	ir, ok := a.intercepted[id]
	a.interceptMu.Unlock()
	if ok {
		ir.resolve <- "forward"
	}
}

func (a *App) DropRequest(id string) {
	a.interceptMu.Lock()
	ir, ok := a.intercepted[id]
	a.interceptMu.Unlock()
	if ok {
		ir.resolve <- "drop"
	}
}

func (a *App) ModifyAndForward(id, rawRequest string) {
	a.interceptMu.Lock()
	ir, ok := a.intercepted[id]
	a.interceptMu.Unlock()
	if ok {
		ir.resolve <- rawRequest
	}
}

func (a *App) GetHistory(search string, limit, offset int) ([]*history.Entry, error) {
	return a.history.List(search, limit, offset)
}

func (a *App) GetEntry(id int64) (*history.Entry, error) {
	return a.history.Get(id)
}

func (a *App) ClearHistory() error {
	return a.history.Clear()
}

func (a *App) SaveToFile(content string) error {
	path, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Save File",
		DefaultFilename: "request.txt",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Text files (*.txt)", Pattern: "*.txt"},
			{DisplayName: "All files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return nil
	}
	return os.WriteFile(path, []byte(content), 0644)
}

func (a *App) SetScope(patterns []string) {
	a.scopeMu.Lock()
	defer a.scopeMu.Unlock()
	a.scope = patterns
}

func (a *App) GetCACert() string {
	return string(a.certMgr.CACertPEM())
}

func (a *App) InstallCACert() (string, error) {
	return a.certMgr.InstallToSystem()
}

func (a *App) OpenCertForInstall() (string, error) {
	home, _ := os.UserHomeDir()
	desktop := filepath.Join(home, "Desktop")
	if _, err := os.Stat(desktop); err != nil {
		desktop = os.TempDir()
	}
	derPath := filepath.Join(desktop, "harness-ca.crt")
	pemPath := filepath.Join(desktop, "harness-ca.pem")
	if err := a.certMgr.ExportDER(derPath); err != nil {
		return "", fmt.Errorf("could not write cert: %v", err)
	}
	if err := os.WriteFile(pemPath, a.certMgr.CACertPEM(), 0644); err != nil {
		return "", fmt.Errorf("could not write PEM cert: %v", err)
	}
	switch runtime.GOOS {
	case "windows":
		exec.Command("explorer.exe", desktop).Start()
	case "darwin":
		exec.Command("open", desktop).Start()
	default:
		exec.Command("xdg-open", desktop).Start()
	}
	return fmt.Sprintf("Saved to Desktop:\n  harness-ca.crt  (Chrome/Edge)\n  harness-ca.pem  (Firefox)\n\nFile manager opened."), nil
}

func (a *App) GetRules() []*MatchReplaceRule {
	return a.rules.GetRules()
}

func (a *App) SetRules(rules []*MatchReplaceRule) {
	a.rules.SetRules(rules)
}

func (a *App) applyRequestRules(req *http.Request) *http.Request {
	if !a.rules.hasRulesFor("request_header") && !a.rules.hasRulesFor("request_body") {
		return nil
	}
	raw, err := httputil.DumpRequest(req, true)
	if err != nil {
		return nil
	}
	text := string(raw)
	parts := strings.SplitN(text, "\r\n\r\n", 2)
	headers := parts[0]
	bodyPart := ""
	if len(parts) > 1 {
		bodyPart = parts[1]
	}
	reqURL := req.URL.String()
	if a.rules.hasRulesFor("request_header") {
		headers = a.rules.apply("request_header", headers, reqURL)
	}
	if a.rules.hasRulesFor("request_body") {
		bodyPart = a.rules.apply("request_body", bodyPart, reqURL)
	}
	rebuilt := headers + "\r\n\r\n" + bodyPart
	newReq, err := http.ReadRequest(bufio.NewReader(strings.NewReader(rebuilt)))
	if err != nil {
		return nil
	}
	newReq.URL.Scheme = req.URL.Scheme
	newReq.URL.Host = req.URL.Host
	newReq.RequestURI = ""
	return newReq
}

func (a *App) SendRepeaterRequest(req repeater.Request) repeater.Response {
	return repeater.Send(req)
}

func (a *App) StartIntruder(attack intruder.Attack) {
	if a.intruderStop != nil {
		close(a.intruderStop)
	}
	a.intruderStop = make(chan struct{})
	stop := a.intruderStop
	go intruder.Run(&attack, func(r intruder.Result) {
		a.broadcast(map[string]interface{}{"type": "intruder_result", "result": r})
	}, stop)
}

func (a *App) StopIntruder() {
	if a.intruderStop != nil {
		close(a.intruderStop)
		a.intruderStop = nil
	}
}

func (a *App) GetProxyPort() string {
	return "8080"
}

func (a *App) GetNucleiInstalled() bool {
	return nucleiPkg.IsInstalled()
}

func (a *App) RunNuclei(opts nucleiPkg.Options) {
	a.nucleiMu.Lock()
	if a.nucleiStop != nil {
		close(a.nucleiStop)
	}
	stop := make(chan struct{})
	a.nucleiStop = stop
	a.nucleiMu.Unlock()

	a.interceptMu.Lock()
	wasIntercepting := a.interceptOn
	if wasIntercepting {
		a.interceptOn = false
		for id, ir := range a.intercepted {
			select { case ir.resolve <- "forward": default: }
			delete(a.intercepted, id)
		}
	}
	a.interceptMu.Unlock()
	wasInterceptingResp := a.interceptRespOn
	if wasInterceptingResp {
		a.SetInterceptResponse(false)
	}

	go func() {
		defer func() {
			if wasIntercepting {
				a.interceptMu.Lock()
				a.interceptOn = true
				a.interceptMu.Unlock()
			}
			if wasInterceptingResp {
				a.interceptRespMu.Lock()
				a.interceptRespOn = true
				a.interceptRespMu.Unlock()
			}
		}()

		err := nucleiPkg.Run(opts, "127.0.0.1:8080", func(line string) {
			a.broadcast(map[string]interface{}{"type": "nuclei_output", "line": line})
		}, stop)
		msg := "Nuclei scan complete."
		if err != nil {
			msg = err.Error()
		}
		a.broadcast(map[string]interface{}{"type": "nuclei_done", "msg": msg})
	}()
}

func (a *App) StopNuclei() {
	a.nucleiMu.Lock()
	defer a.nucleiMu.Unlock()
	if a.nucleiStop != nil {
		close(a.nucleiStop)
		a.nucleiStop = nil
	}
}

func (a *App) GetBrowserRunning() bool {
	a.browserMu.Lock()
	defer a.browserMu.Unlock()
	return a.browserCmd != nil && a.browserCmd.ProcessState == nil
}

func (a *App) LaunchHarnessBrowser() (string, error) {
	return a.LaunchBrowser()
}

func (a *App) RunSQLMap(rawRequest string, opts sqlmapPkg.Options) {
	a.sqlmapMu.Lock()
	if a.sqlmapStop != nil {
		close(a.sqlmapStop)
	}
	stop := make(chan struct{})
	a.sqlmapStop = stop
	a.sqlmapMu.Unlock()

	a.interceptMu.Lock()
	wasIntercepting := a.interceptOn
	if wasIntercepting {
		a.interceptOn = false
		for id, ir := range a.intercepted {
			select { case ir.resolve <- "forward": default: }
			delete(a.intercepted, id)
		}
	}
	a.interceptMu.Unlock()
	wasInterceptingResp := a.interceptRespOn
	if wasInterceptingResp {
		a.SetInterceptResponse(false)
	}

	go func() {
		defer func() {
			if wasIntercepting {
				a.interceptMu.Lock()
				a.interceptOn = true
				a.interceptMu.Unlock()
			}
			if wasInterceptingResp {
				a.interceptRespMu.Lock()
				a.interceptRespOn = true
				a.interceptRespMu.Unlock()
			}
		}()

		err := sqlmapPkg.Run(rawRequest, "127.0.0.1:8080", opts, func(line string) {
			a.broadcast(map[string]interface{}{"type": "sqlmap_output", "line": line})
		}, stop)
		msg := "sqlmap finished."
		if err != nil {
			msg = "error: " + err.Error()
		}
		a.broadcast(map[string]interface{}{"type": "sqlmap_done", "msg": msg})
	}()
}

func (a *App) StopSQLMap() {
	a.sqlmapMu.Lock()
	defer a.sqlmapMu.Unlock()
	if a.sqlmapStop != nil {
		close(a.sqlmapStop)
		a.sqlmapStop = nil
	}
}

type PayloadFileResult struct {
	Path  string   `json:"path"`
	Name  string   `json:"name"`
	Count int64    `json:"count"`
	Lines []string `json:"lines"`
}

const smallFileLineLimit = 50_000

func (a *App) OpenPayloadFile() (*PayloadFileResult, error) {
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Load Payload Wordlist",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Text files (*.txt;*.lst;*.csv)", Pattern: "*.txt;*.lst;*.csv"},
			{DisplayName: "All files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return nil, nil
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 512*1024), 512*1024) // handle very long lines

	var lines []string
	var count int64
	small := true
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" {
			continue
		}
		count++
		if small {
			lines = append(lines, line)
			if count > smallFileLineLimit {
				small = false
				lines = nil // free memory; we'll just report path+count
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	res := &PayloadFileResult{
		Path:  path,
		Name:  filepath.Base(path),
		Count: count,
	}
	if small {
		res.Lines = lines
	}
	return res, nil
}

func (a *App) LoadPayloadFile() ([]string, error) {
	res, err := a.OpenPayloadFile()
	if err != nil || res == nil {
		return nil, err
	}
	return res.Lines, nil
}

// FingerprintTarget performs active tech-stack fingerprinting against the given URL.
func (a *App) FingerprintTarget(targetURL string) (*fingerprint.Profile, error) {
	profile := fingerprint.Run(targetURL)
	return profile, nil
}

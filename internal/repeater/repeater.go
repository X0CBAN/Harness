package repeater

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Request is the input for a repeater send.
type Request struct {
	Raw             string `json:"raw"`             // full raw HTTP request text
	Host            string `json:"host"`            // target host:port
	UseHTTPS        bool   `json:"useHttps"`        // whether to use TLS
	FollowRedirects bool   `json:"followRedirects"` // follow 3xx automatically
}

// Response is the result of a repeater send.
type Response struct {
	Raw        string `json:"raw"`
	StatusCode int    `json:"statusCode"`
	Headers    string `json:"headers"`
	Body       string `json:"body"`
	DurationMs int64  `json:"durationMs"`
	Error      string `json:"error,omitempty"`
}

// Send fires a raw HTTP request and returns the response.
func Send(req Request) Response {
	start := time.Now()

	httpReq, err := http.ReadRequest(bufio.NewReader(strings.NewReader(req.Raw)))
	if err != nil {
		return Response{Error: fmt.Sprintf("failed to parse request: %v", err)}
	}

	httpReq.RequestURI = ""

	scheme := "http"
	if req.UseHTTPS {
		scheme = "https"
	}

	// Ensure host has an explicit port for the transport connection.
	connectHost := req.Host
	if !strings.Contains(connectHost, ":") {
		if req.UseHTTPS {
			connectHost += ":443"
		} else {
			connectHost += ":80"
		}
	}

	// Reconstruct a clean URL — avoids Opaque weirdness from proxy-style
	// absolute request lines ("GET http://example.com/ HTTP/1.1").
	cleanPath := httpReq.URL.Path
	if cleanPath == "" {
		cleanPath = "/"
	}
	httpReq.URL = &url.URL{
		Scheme:   scheme,
		Host:     connectHost,
		Path:     cleanPath,
		RawQuery: httpReq.URL.RawQuery,
		Fragment: httpReq.URL.Fragment,
	}

	// Host header must NOT include the default port — many servers return 301
	// or 400 when they see "Host: example.com:443".
	hostHeader := connectHost
	if req.UseHTTPS {
		hostHeader = strings.TrimSuffix(hostHeader, ":443")
	} else {
		hostHeader = strings.TrimSuffix(hostHeader, ":80")
	}
	httpReq.Host = hostHeader

	// Remove Accept-Encoding so Go's transport adds its own and auto-decompresses.
	httpReq.Header.Del("Accept-Encoding")
	// Remove proxy-specific headers that have no meaning in a direct request.
	httpReq.Header.Del("Proxy-Connection")
	httpReq.Header.Del("Proxy-Authorization")

	redirectPolicy := func(r *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}
	if req.FollowRedirects {
		redirectPolicy = nil // Go default: follow up to 10 redirects
	}

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout:       30 * time.Second,
		CheckRedirect: redirectPolicy,
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return Response{Error: fmt.Sprintf("request failed: %v", err), DurationMs: time.Since(start).Milliseconds()}
	}
	defer resp.Body.Close()

	const maxBody = 2 << 20 // 2 MB
	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	dur := time.Since(start).Milliseconds()

	var rawBuf bytes.Buffer
	fmt.Fprintf(&rawBuf, "HTTP/%d.%d %s\r\n", resp.ProtoMajor, resp.ProtoMinor, resp.Status)

	var headerBuf bytes.Buffer
	resp.Header.Write(&headerBuf)
	rawBuf.Write(headerBuf.Bytes())
	rawBuf.WriteString("\r\n")
	rawBuf.Write(body)

	return Response{
		Raw:        rawBuf.String(),
		StatusCode: resp.StatusCode,
		Headers:    headerBuf.String(),
		Body:       string(body),
		DurationMs: dur,
	}
}

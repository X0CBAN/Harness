package crawler

import (
	"context"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"
)

// Node represents a discovered URL during a crawl.
type Node struct {
	ID         int64     `json:"id"`
	URL        string    `json:"url"`
	Method     string    `json:"method"`
	ParentID   *int64    `json:"parentId"`
	Depth      int       `json:"depth"`
	StatusCode int       `json:"statusCode"`
	FoundAt    time.Time `json:"foundAt"`
	Title      string    `json:"title,omitempty"`
	Forms      int       `json:"forms,omitempty"`
	Tech       []string  `json:"tech,omitempty"`
}

const (
	maxURLs       = 500 // hard cap on total URLs crawled per session
	maxConcurrent = 8   // max parallel HTTP requests
)

// Crawler is a concurrent link-following spider.
type Crawler struct {
	SeedURL    string
	MaxDepth   int
	ExtraPaths []string // additional paths to probe against the seed host (wordlist fuzzing)
	OnNode     func(*Node)
	OnComplete func()

	client  *http.Client
	visited map[string]bool
	total   int
	mu      sync.Mutex
	sem     chan struct{}
	ctx     context.Context
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

// New creates a new Crawler.
func New(seedURL string, maxDepth int, onNode func(*Node)) *Crawler {
	ctx, cancel := context.WithCancel(context.Background())
	jar, _ := cookiejar.New(nil)
	return &Crawler{
		SeedURL:  seedURL,
		MaxDepth: maxDepth,
		OnNode:   onNode,
		client: &http.Client{
			Timeout: 15 * time.Second,
			Jar:     jar,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return http.ErrUseLastResponse
				}
				return nil
			},
		},
		visited: make(map[string]bool),
		sem:     make(chan struct{}, maxConcurrent),
		ctx:     ctx,
		cancel:  cancel,
	}
}

// Start begins crawling in a background goroutine.
func (c *Crawler) Start() {
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		c.crawl(c.SeedURL, nil, 0)
	}()

	// Auto-discover well-known paths on the seed host
	base, err := url.Parse(c.SeedURL)
	if err == nil {
		autoDiscover := []string{
			"/robots.txt", "/sitemap.xml", "/.well-known/security.txt",
			"/swagger.json", "/openapi.json", "/openapi.yaml",
			"/api-docs", "/api/docs", "/graphql", "/graphiql",
			"/.git/HEAD", "/.env",
		}
		for _, p := range autoDiscover {
			target := &url.URL{Scheme: base.Scheme, Host: base.Host, Path: p}
			full := target.String()
			c.wg.Add(1)
			go func(u string) {
				defer c.wg.Done()
				c.crawl(u, nil, 0)
			}(full)
		}
	}

	// Probe extra wordlist paths, starting from depth 0 so their links get followed
	if len(c.ExtraPaths) > 0 && err == nil {
		for _, p := range c.ExtraPaths {
			p = strings.TrimSpace(p)
			if p == "" || strings.HasPrefix(p, "#") {
				continue
			}
			if !strings.HasPrefix(p, "/") {
				p = "/" + p
			}
			target := &url.URL{Scheme: base.Scheme, Host: base.Host, Path: p}
			full := target.String()
			c.wg.Add(1)
			go func(u string) {
				defer c.wg.Done()
				c.crawl(u, nil, 0)
			}(full)
		}
	}

	if c.OnComplete != nil {
		go func() {
			c.wg.Wait()
			c.OnComplete()
		}()
	}
}

// Stop cancels the crawl.
func (c *Crawler) Stop() {
	c.cancel()
	c.wg.Wait()
}

// canonicalURL returns a deduplicated form of a URL for the visited map.
// Numeric/UUID query param values are replaced with {n} so that
// /product?id=1 and /product?id=2 count as the same URL.
func canonicalURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	q := u.Query()
	if len(q) == 0 {
		return rawURL
	}
	intRe := regexp.MustCompile(`^\d+$`)
	uuidRe := regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	cq := make(url.Values)
	for k, vs := range q {
		for _, v := range vs {
			if intRe.MatchString(v) || uuidRe.MatchString(v) {
				cq.Add(k, "{n}")
			} else {
				cq.Add(k, v)
			}
		}
	}
	u.RawQuery = cq.Encode()
	return u.String()
}

func (c *Crawler) crawl(rawURL string, parentID *int64, depth int) {
	if depth > c.MaxDepth {
		return
	}

	normalized := normalizeURL(rawURL)
	if normalized == "" {
		return // invalid scheme or host
	}
	canonical := canonicalURL(normalized)
	c.mu.Lock()
	if c.visited[canonical] || c.total >= maxURLs {
		c.mu.Unlock()
		return
	}
	c.visited[canonical] = true
	c.total++
	c.mu.Unlock()

	// Acquire semaphore slot
	select {
	case c.sem <- struct{}{}:
	case <-c.ctx.Done():
		return
	}
	defer func() { <-c.sem }()

	req, err := http.NewRequestWithContext(c.ctx, "GET", rawURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Harness/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")

	resp, err := c.client.Do(req)
	if err != nil {
		select {
		case <-c.ctx.Done():
		default:
			log.Printf("crawler: %s: %v", rawURL, err)
		}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 512<<10))
		return
	}

	ct := resp.Header.Get("Content-Type")
	isHTML := strings.Contains(ct, "text/html")
	isJSON := strings.Contains(ct, "application/json") || strings.Contains(ct, "text/json")
	isXML := strings.Contains(ct, "text/xml") || strings.Contains(ct, "application/xml") || strings.Contains(ct, "application/rss") || strings.Contains(ct, "application/atom")
	isPlain := strings.Contains(ct, "text/plain")
	isCSS := strings.Contains(ct, "text/css")
	isJS := strings.Contains(ct, "javascript") || strings.Contains(ct, "ecmascript")

	var body []byte
	if isHTML || isJSON || isXML || isPlain || isCSS || isJS {
		body, err = io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		if err != nil {
			return
		}
	} else {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 512<<10))
	}

	node := &Node{
		URL:        rawURL,
		Method:     "GET",
		ParentID:   parentID,
		Depth:      depth,
		StatusCode: resp.StatusCode,
		FoundAt:    time.Now(),
		Tech:       detectTech(resp, body),
	}

	if isHTML && len(body) > 0 {
		node.Title = extractTitle(body)
		node.Forms = countForms(body)
	}

	if c.OnNode != nil {
		c.OnNode(node)
	}

	if len(body) == 0 {
		return
	}

	base, err := url.Parse(rawURL)
	if err != nil {
		return
	}

	var discovered []string
	if isHTML {
		discovered = extractLinks(body, base)
		for _, u := range extractGetForms(body, base) {
			discovered = append(discovered, u)
		}
	} else if isJSON {
		discovered = extractJSONLinks(body, base)
	} else if isXML {
		discovered = extractSitemapLinks(body, base)
	} else if isPlain {
		discovered = extractRobotsLinks(body, base)
	} else if isCSS {
		discovered = extractCSSLinks(body, base)
	} else if isJS {
		discovered = extractJSRoutes(body, base)
	}

	var parents []string
	for _, link := range discovered {
		parents = append(parents, inferParentPaths(link, base)...)
	}
	parentSeen := make(map[string]bool)
	for _, l := range discovered {
		parentSeen[l] = true
	}
	for _, p := range parents {
		if !parentSeen[p] {
			parentSeen[p] = true
			discovered = append(discovered, p)
		}
	}

	for _, link := range discovered {
		if !isSameOrigin(link, base) {
			continue
		}
		select {
		case <-c.ctx.Done():
			return
		default:
		}

		id := node.ID
		c.wg.Add(1)
		go func(u string, pid int64) {
			defer c.wg.Done()
			c.crawl(u, &pid, depth+1)
		}(link, id)
	}
}

func normalizeURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	// Only crawl HTTP/HTTPS — drop data:, blob:, ftp:, javascript:, etc.
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	if u.Host == "" {
		return ""
	}
	u.Fragment = ""
	if u.Path == "" {
		u.Path = "/"
	}
	return u.String()
}

func looksLikeWebPath(path string) bool {
	if len(path) < 2 {
		return false
	}
	lower := strings.ToLower(path)
	for _, prefix := range []string{
		"/etc/", "/usr/", "/var/", "/tmp/", "/proc/",
		"/sys/", "/dev/", "/home/", "/root/", "/boot/", "/opt/",
	} {
		if strings.HasPrefix(lower, prefix) {
			return false
		}
	}
	if strings.ContainsAny(path, "{}$") {
		return false
	}
	return true
}

func extractTitle(body []byte) string {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return ""
	}
	var title string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if title != "" {
			return
		}
		if n.Type == html.ElementNode && n.Data == "title" && n.FirstChild != nil {
			title = strings.TrimSpace(n.FirstChild.Data)
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return title
}

func countForms(body []byte) int {
	count := 0
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return 0
	}
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "form" {
			count++
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return count
}

func extractLinks(body []byte, base *url.URL) []string {
	seen := make(map[string]bool)
	var links []string

	add := func(href string) {
		href = strings.TrimSpace(href)
		if href == "" ||
			strings.HasPrefix(href, "javascript:") ||
			strings.HasPrefix(href, "mailto:") ||
			strings.HasPrefix(href, "tel:") ||
			strings.HasPrefix(href, "#") {
			return
		}
		ref, err := url.Parse(href)
		if err != nil {
			return
		}
		resolved := base.ResolveReference(ref)
		resolved.Fragment = ""
		s := resolved.String()
		if !seen[s] {
			seen[s] = true
			links = append(links, s)
		}
	}

	doc, err := html.Parse(strings.NewReader(string(body)))
	if err == nil {
		var walk func(*html.Node)
		walk = func(n *html.Node) {
			if n.Type == html.ElementNode {
				switch n.Data {
				case "a", "link", "area":
					for _, attr := range n.Attr {
						if attr.Key == "href" {
							add(attr.Val)
						}
					}
				case "form":
					for _, attr := range n.Attr {
						if attr.Key == "action" {
							add(attr.Val)
						}
					}
				case "script", "img", "iframe", "source", "track", "embed":
					for _, attr := range n.Attr {
						if attr.Key == "src" {
							add(attr.Val)
						}
					}
				case "input", "button":
					for _, attr := range n.Attr {
						if attr.Key == "formaction" {
							add(attr.Val)
						}
					}
				case "meta":
					// Handle meta refresh: <meta http-equiv="refresh" content="0; url=...">
					isRefresh := false
					var content string
					for _, attr := range n.Attr {
						if attr.Key == "http-equiv" && strings.ToLower(attr.Val) == "refresh" {
							isRefresh = true
						}
						if attr.Key == "content" {
							content = attr.Val
						}
					}
					if isRefresh && content != "" {
						if idx := strings.Index(strings.ToLower(content), "url="); idx != -1 {
							add(content[idx+4:])
						}
					}
				}
				// Also pick up data-href / data-url / data-src on any element
				for _, attr := range n.Attr {
					if attr.Key == "data-href" || attr.Key == "data-url" || attr.Key == "data-src" || attr.Key == "data-action" {
						add(attr.Val)
					}
				}
			}
			for child := n.FirstChild; child != nil; child = child.NextSibling {
				walk(child)
			}
		}
		walk(doc)
	}

	jsPathRe := regexp.MustCompile(`["'` + "`" + `]((?:/[a-zA-Z0-9_\-./]+(?:\?[^"'` + "`" + `<>\s]*)?)["'` + "`" + `])`)
	for _, m := range jsPathRe.FindAllStringSubmatch(string(body), -1) {
		if len(m) > 1 && looksLikeWebPath(m[1]) {
			add(m[1])
		}
	}

	// Find URLs in fetch/XHR calls: fetch("https://...") or axios.get("...")
	fullURLRe := regexp.MustCompile(`(?:fetch|axios\.(?:get|post|put|delete|patch)|http\.(?:get|post))\s*\(\s*["'` + "`" + `](https?://[^"'` + "`" + `\s]+)`)
	for _, m := range fullURLRe.FindAllStringSubmatch(string(body), -1) {
		if len(m) > 1 {
			add(m[1])
		}
	}

	return links
}

func isSameOrigin(link string, base *url.URL) bool {
	u, err := url.Parse(link)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return u.Host == base.Host
}

// inferParentPaths returns ancestor directory paths for a URL.
// e.g. /api/v1/users/123 → [/api/v1/users/, /api/v1/]
func inferParentPaths(rawURL string, base *url.URL) []string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host != base.Host {
		return nil
	}
	parts := strings.Split(strings.TrimRight(u.Path, "/"), "/")
	var paths []string
	for i := len(parts) - 1; i > 1; i-- {
		parentPath := strings.Join(parts[:i], "/") + "/"
		if parentPath == "/" {
			continue
		}
		parent := &url.URL{Scheme: base.Scheme, Host: base.Host, Path: parentPath}
		paths = append(paths, parent.String())
	}
	return paths
}

// detectTech identifies server-side technologies from response headers and body.
func detectTech(resp *http.Response, body []byte) []string {
	seen := make(map[string]bool)
	var tech []string
	add := func(t string) {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] {
			seen[t] = true
			tech = append(tech, t)
		}
	}

	if s := resp.Header.Get("Server"); s != "" {
		add(s)
	}
	if xpb := resp.Header.Get("X-Powered-By"); xpb != "" {
		add(xpb)
	}
	if resp.Header.Get("X-Drupal-Cache") != "" || resp.Header.Get("X-Drupal-Dynamic-Cache") != "" {
		add("Drupal")
	}
	if resp.Header.Get("X-Joomla-Token") != "" {
		add("Joomla")
	}
	if resp.Header.Get("X-Generator") != "" {
		add(resp.Header.Get("X-Generator"))
	}
	for _, cookie := range resp.Cookies() {
		switch cookie.Name {
		case "PHPSESSID":
			add("PHP")
		case "JSESSIONID":
			add("Java")
		case "ASP.NET_SessionId", "ASPSESSIONID":
			add("ASP.NET")
		case "laravel_session":
			add("Laravel")
		case "django_session":
			add("Django")
		}
		if strings.HasPrefix(cookie.Name, "wp-") || strings.HasPrefix(cookie.Name, "wordpress_") {
			add("WordPress")
		}
	}

	if len(body) > 0 {
		genRe := regexp.MustCompile(`(?i)<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator["']`)
		if m := genRe.FindSubmatch(body); m != nil {
			for _, sub := range m[1:] {
				if len(sub) > 0 {
					add(string(sub))
					break
				}
			}
		}
	}

	return tech
}

// extractRobotsLinks extracts paths from robots.txt Disallow/Allow/Sitemap directives.
func extractRobotsLinks(body []byte, base *url.URL) []string {
	seen := make(map[string]bool)
	var links []string
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(parts[0]))
		val := strings.TrimSpace(parts[1])
		// Strip inline comments
		if idx := strings.Index(val, " #"); idx != -1 {
			val = strings.TrimSpace(val[:idx])
		}
		if key == "sitemap" {
			if strings.HasPrefix(val, "http") && !seen[val] {
				seen[val] = true
				links = append(links, val)
			}
			continue
		}
		if key != "disallow" && key != "allow" {
			continue
		}
		if val == "" || strings.Contains(val, "*") {
			continue
		}
		if !strings.HasPrefix(val, "/") {
			continue
		}
		target := &url.URL{Scheme: base.Scheme, Host: base.Host, Path: val}
		s := target.String()
		if !seen[s] {
			seen[s] = true
			links = append(links, s)
		}
	}
	return links
}

// extractSitemapLinks extracts URLs from XML sitemaps (<loc> tags).
func extractSitemapLinks(body []byte, base *url.URL) []string {
	locRe := regexp.MustCompile(`<loc>\s*(https?://[^<\s]+)\s*</loc>`)
	seen := make(map[string]bool)
	var links []string
	for _, m := range locRe.FindAllSubmatch(body, -1) {
		if len(m) < 2 {
			continue
		}
		href := strings.TrimSpace(string(m[1]))
		if !seen[href] {
			seen[href] = true
			links = append(links, href)
		}
	}
	return links
}

// extractCSSLinks finds URL references in CSS stylesheets.
func extractCSSLinks(body []byte, base *url.URL) []string {
	cssURLRe := regexp.MustCompile(`url\(\s*['"]?(https?://[^'")\s]+|/[^'")\s]+)['"]?\s*\)`)
	importRe := regexp.MustCompile(`@import\s+['"]([^'"]+)['"]`)
	seen := make(map[string]bool)
	var links []string
	add := func(href string) {
		href = strings.TrimSpace(href)
		if href == "" {
			return
		}
		ref, err := url.Parse(href)
		if err != nil {
			return
		}
		resolved := base.ResolveReference(ref)
		resolved.Fragment = ""
		s := resolved.String()
		if !seen[s] {
			seen[s] = true
			links = append(links, s)
		}
	}
	for _, m := range cssURLRe.FindAllSubmatch(body, -1) {
		if len(m) > 1 {
			add(string(m[1]))
		}
	}
	for _, m := range importRe.FindAllSubmatch(body, -1) {
		if len(m) > 1 {
			add(string(m[1]))
		}
	}
	return links
}

// extractJSRoutes finds route paths inside JavaScript files (React, Vue, Express, etc.)
func extractJSRoutes(body []byte, base *url.URL) []string {
	seen := make(map[string]bool)
	var links []string
	add := func(href string) {
		href = strings.TrimSpace(href)
		if href == "" || !looksLikeWebPath(href) {
			return
		}
		ref, err := url.Parse(href)
		if err != nil {
			return
		}
		resolved := base.ResolveReference(ref)
		resolved.Fragment = ""
		s := resolved.String()
		if !seen[s] {
			seen[s] = true
			links = append(links, s)
		}
	}
	// path: "/some/route" — quoted path strings
	pathRe := regexp.MustCompile(`["` + "`" + `]((?:/[a-zA-Z0-9_\-./]+)(?:\?[^"` + "`" + `<>\s]*)?)["` + "`" + `]`)
	for _, m := range pathRe.FindAllStringSubmatch(string(body), -1) {
		if len(m) > 1 {
			add(m[1])
		}
	}
	// fetch/axios full URLs
	fullURLRe := regexp.MustCompile(`(?:fetch|axios\.(?:get|post|put|delete|patch))\s*\(\s*["` + "`" + `](https?://[^"` + "`" + `\s]+)`)
	for _, m := range fullURLRe.FindAllStringSubmatch(string(body), -1) {
		if len(m) > 1 {
			add(m[1])
		}
	}
	return links
}

// extractGetForms finds HTML GET forms and constructs their submission URLs with test values.
func extractGetForms(body []byte, base *url.URL) []string {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return nil
	}
	seen := make(map[string]bool)
	var links []string

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "form" {
			method := ""
			action := ""
			for _, a := range n.Attr {
				switch strings.ToLower(a.Key) {
				case "method":
					method = strings.ToLower(strings.TrimSpace(a.Val))
				case "action":
					action = strings.TrimSpace(a.Val)
				}
			}
			if method == "" || method == "get" {
				if action == "" {
					action = base.Path
				}
				params := url.Values{}
				var collectInputs func(*html.Node)
				collectInputs = func(c *html.Node) {
					if c.Type == html.ElementNode {
						switch c.Data {
						case "input", "select", "textarea":
							name := ""
							typ := "text"
							for _, a := range c.Attr {
								switch a.Key {
								case "name":
									name = a.Val
								case "type":
									typ = strings.ToLower(a.Val)
								}
							}
							if name != "" && typ != "submit" && typ != "button" && typ != "reset" && typ != "hidden" && typ != "file" {
								params.Set(name, "test")
							}
						}
					}
					for child := c.FirstChild; child != nil; child = child.NextSibling {
						collectInputs(child)
					}
				}
				collectInputs(n)

				ref, err := url.Parse(action)
				if err == nil {
					resolved := base.ResolveReference(ref)
					resolved.Fragment = ""
					if len(params) > 0 {
						resolved.RawQuery = params.Encode()
					}
					s := resolved.String()
					if !seen[s] {
						seen[s] = true
						links = append(links, s)
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return links
}

// extractJSONLinks finds path/URL strings inside a JSON response body.
func extractJSONLinks(body []byte, base *url.URL) []string {
	pathRe := regexp.MustCompile(`"((?:/[a-zA-Z0-9_\-./]+)(?:\?[^"<>\s]*)?)"`)
	seen := make(map[string]bool)
	var links []string
	for _, m := range pathRe.FindAllSubmatch(body, -1) {
		if len(m) < 2 {
			continue
		}
		href := string(m[1])
		ref, err := url.Parse(href)
		if err != nil {
			continue
		}
		resolved := base.ResolveReference(ref)
		resolved.Fragment = ""
		s := resolved.String()
		if !seen[s] {
			seen[s] = true
			links = append(links, s)
		}
	}
	return links
}

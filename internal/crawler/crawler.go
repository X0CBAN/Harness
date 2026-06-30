package crawler

import (
	"context"
	"io"
	"log"
	"net/http"
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
	return &Crawler{
		SeedURL:  seedURL,
		MaxDepth: maxDepth,
		OnNode:   onNode,
		client: &http.Client{
			Timeout: 15 * time.Second,
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

	// Probe extra wordlist paths against the seed host (no recursion — just the path itself)
	if len(c.ExtraPaths) > 0 {
		base, err := url.Parse(c.SeedURL)
		if err == nil {
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
					c.crawl(u, nil, c.MaxDepth) // MaxDepth prevents recursion
				}(full)
			}
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

func (c *Crawler) crawl(rawURL string, parentID *int64, depth int) {
	if depth > c.MaxDepth {
		return
	}

	normalized := normalizeURL(rawURL)
	if normalized == "" {
		return // invalid scheme or host
	}
	c.mu.Lock()
	if c.visited[normalized] || c.total >= maxURLs {
		c.mu.Unlock()
		return
	}
	c.visited[normalized] = true
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

	var body []byte
	if isHTML || isJSON {
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
	} else if isJSON {
		discovered = extractJSONLinks(body, base)
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

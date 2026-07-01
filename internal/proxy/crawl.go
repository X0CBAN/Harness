package proxy

import (
	"sync"

	"github.com/harness-proxy/harness/internal/crawler"
	"github.com/harness-proxy/harness/internal/history"
)

var crawlerMu sync.Mutex
var crawlerInstance *crawler.Crawler

func (a *App) newCrawlerWith(seedURL string, maxDepth int, extraPaths []string) *crawler.Crawler {
	c := crawler.New(seedURL, maxDepth, func(n *crawler.Node) {
		id, err := a.history.AddCrawlNode(n.URL, n.Method, n.ParentID, n.Depth, n.StatusCode)
		if err != nil {
			return
		}
		n.ID = id
		a.broadcast(map[string]interface{}{
			"type": "crawl_node",
			"node": map[string]interface{}{
				"id":         id,
				"url":        n.URL,
				"method":     n.Method,
				"parentId":   n.ParentID,
				"depth":      n.Depth,
				"statusCode": n.StatusCode,
				"foundAt":    n.FoundAt,
				"tech":       n.Tech,
			},
		})
	})
	c.ExtraPaths = extraPaths
	c.OnComplete = func() {
		a.broadcast(map[string]interface{}{"type": "crawl_done"})
	}
	return c
}

// StartCrawl begins a new crawl from seedURL with the given max depth.
func (a *App) StartCrawl(seedURL string, maxDepth int) error {
	return a.StartCrawlWithPaths(seedURL, maxDepth, nil)
}

// StartCrawlWithPaths begins a crawl and also probes extra wordlist paths against the seed host.
func (a *App) StartCrawlWithPaths(seedURL string, maxDepth int, extraPaths []string) error {
	crawlerMu.Lock()
	defer crawlerMu.Unlock()

	if crawlerInstance != nil {
		crawlerInstance.Stop()
		crawlerInstance = nil
	}
	if err := a.history.ClearCrawlNodes(); err != nil {
		return err
	}

	c := a.newCrawlerWith(seedURL, maxDepth, extraPaths)
	crawlerInstance = c
	c.Start()
	return nil
}

// StopCrawl stops the running crawler.
func (a *App) StopCrawl() {
	crawlerMu.Lock()
	defer crawlerMu.Unlock()
	if crawlerInstance != nil {
		crawlerInstance.Stop()
		crawlerInstance = nil
	}
}

// GetCrawlNodes returns all persisted crawl nodes.
func (a *App) GetCrawlNodes() ([]*history.CrawlNode, error) {
	return a.history.GetCrawlNodes()
}

// ClearCrawlNodes deletes all crawl nodes.
func (a *App) ClearCrawlNodes() error {
	crawlerMu.Lock()
	if crawlerInstance != nil {
		crawlerInstance.Stop()
		crawlerInstance = nil
	}
	crawlerMu.Unlock()
	return a.history.ClearCrawlNodes()
}

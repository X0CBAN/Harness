package tokens

import (
	"bufio"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httputil"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ExtractionRule defines how to pull a token from a response.
type ExtractionRule struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	Source  string `json:"source"`  // response_header, response_body
	Type    string `json:"type"`    // regex, jsonpath
	Pattern string `json:"pattern"` // regex or $.field path
	Group   int    `json:"group"`   // regex capture group (0 = whole match)
	Header  string `json:"header"`  // which response header to search (blank = all)
}

// InjectionConfig describes where to inject the active token.
type InjectionConfig struct {
	Enabled bool   `json:"enabled"`
	Target  string `json:"target"` // header, query
	Key     string `json:"key"`    // e.g. "Authorization"
	Format  string `json:"format"` // e.g. "Bearer {{token}}"
}

// MacroRequest is a single request in the re-auth macro sequence.
type MacroRequest struct {
	Raw   string `json:"raw"`
	Host  string `json:"host"`
	HTTPS bool   `json:"https"`
}

// Manager holds token state and rules.
type Manager struct {
	mu          sync.RWMutex
	rules       []*ExtractionRule
	injection   InjectionConfig
	activeToken string
	macro       []*MacroRequest
	onToken     func(string) // called when active token changes
}

// New creates a Manager. onToken is called whenever the active token is updated.
func New(onToken func(string)) *Manager {
	return &Manager{onToken: onToken}
}

func (m *Manager) SetRules(rules []*ExtractionRule) {
	m.mu.Lock()
	m.rules = rules
	m.mu.Unlock()
}

func (m *Manager) GetRules() []*ExtractionRule {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.rules
}

func (m *Manager) SetInjection(cfg InjectionConfig) {
	m.mu.Lock()
	m.injection = cfg
	m.mu.Unlock()
}

func (m *Manager) GetInjection() InjectionConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.injection
}

func (m *Manager) GetActiveToken() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.activeToken
}

func (m *Manager) SetActiveToken(token string) {
	m.mu.Lock()
	m.activeToken = token
	cb := m.onToken
	m.mu.Unlock()
	if cb != nil {
		cb(token)
	}
}

func (m *Manager) SetMacro(reqs []*MacroRequest) {
	m.mu.Lock()
	m.macro = reqs
	m.mu.Unlock()
}

func (m *Manager) GetMacro() []*MacroRequest {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.macro
}

func (m *Manager) HasMacro() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.macro) > 0
}

// HasExtractionRules returns true if any enabled extraction rule exists.
func (m *Manager) HasExtractionRules() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, r := range m.rules {
		if r.Enabled && r.Pattern != "" {
			return true
		}
	}
	return false
}

// TryExtract attempts to extract a token from a response body/headers.
func (m *Manager) TryExtract(resp *http.Response, body []byte) {
	m.mu.RLock()
	rules := m.rules
	m.mu.RUnlock()

	for _, rule := range rules {
		if !rule.Enabled || rule.Pattern == "" {
			continue
		}
		var text string
		switch rule.Source {
		case "response_header":
			if rule.Header != "" {
				text = resp.Header.Get(rule.Header)
			} else {
				var sb strings.Builder
				for k, vals := range resp.Header {
					for _, v := range vals {
						sb.WriteString(k + ": " + v + "\r\n")
					}
				}
				text = sb.String()
			}
		case "response_body":
			text = string(body)
		default:
			continue
		}

		if token := extractToken(text, rule); token != "" {
			m.SetActiveToken(token)
			return
		}
	}
}

func extractToken(text string, rule *ExtractionRule) string {
	switch rule.Type {
	case "regex":
		re, err := regexp.Compile(rule.Pattern)
		if err != nil {
			return ""
		}
		matches := re.FindStringSubmatch(text)
		if len(matches) == 0 {
			return ""
		}
		g := rule.Group
		if g >= len(matches) {
			g = len(matches) - 1
		}
		return matches[g]
	case "jsonpath":
		return jsonPathExtract(text, rule.Pattern)
	}
	return ""
}

func jsonPathExtract(jsonStr, path string) string {
	path = strings.TrimPrefix(path, "$.")
	parts := strings.Split(path, ".")

	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(jsonStr)), &obj); err != nil {
		return ""
	}
	return jsonGet(obj, parts)
}

func jsonGet(obj map[string]interface{}, parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	val, ok := obj[parts[0]]
	if !ok {
		return ""
	}
	if len(parts) == 1 {
		return fmt.Sprintf("%v", val)
	}
	sub, ok := val.(map[string]interface{})
	if !ok {
		return ""
	}
	return jsonGet(sub, parts[1:])
}

// InjectToken replaces or inserts the active token into a raw HTTP request string.
func (m *Manager) InjectToken(rawRequest string) string {
	m.mu.RLock()
	token := m.activeToken
	cfg := m.injection
	m.mu.RUnlock()

	if !cfg.Enabled || token == "" || cfg.Key == "" {
		return rawRequest
	}

	value := strings.ReplaceAll(cfg.Format, "{{token}}", token)
	if value == "" {
		value = token
	}

	if cfg.Target != "header" {
		return rawRequest
	}

	headerLine := cfg.Key + ": " + value
	re := regexp.MustCompile(`(?im)^` + regexp.QuoteMeta(cfg.Key) + `:.*$`)
	if re.MatchString(rawRequest) {
		return re.ReplaceAllString(rawRequest, headerLine)
	}
	idx := strings.Index(rawRequest, "\r\n\r\n")
	if idx != -1 {
		return rawRequest[:idx] + "\r\n" + headerLine + rawRequest[idx:]
	}
	idx = strings.Index(rawRequest, "\n\n")
	if idx != -1 {
		return rawRequest[:idx] + "\n" + headerLine + rawRequest[idx:]
	}
	return rawRequest
}

// RunMacro executes the macro sequence, returns the new active token (empty if none extracted).
func (m *Manager) RunMacro() string {
	m.mu.RLock()
	macro := m.macro
	rules := m.rules
	m.mu.RUnlock()

	if len(macro) == 0 {
		return ""
	}

	client := &http.Client{
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
		Timeout:   30 * time.Second,
	}

	var lastToken string
	for _, mr := range macro {
		req, err := http.ReadRequest(bufio.NewReader(strings.NewReader(mr.Raw)))
		if err != nil {
			continue
		}
		req.RequestURI = ""
		scheme := "http"
		if mr.HTTPS {
			scheme = "https"
		}
		host := mr.Host
		if !strings.Contains(host, ":") {
			if mr.HTTPS {
				host += ":443"
			} else {
				host += ":80"
			}
		}
		req.URL.Scheme = scheme
		req.URL.Host = host
		req.Host = host

		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		body, _ := httputil.DumpResponse(resp, true)
		resp.Body.Close()

		// Try each extraction rule against this response.
		for _, rule := range rules {
			if !rule.Enabled || rule.Pattern == "" {
				continue
			}
			var text string
			switch rule.Source {
			case "response_header":
				if rule.Header != "" {
					text = resp.Header.Get(rule.Header)
				} else {
					text = string(body)
				}
			case "response_body":
				text = string(body)
			}
			if t := extractToken(text, rule); t != "" {
				lastToken = t
			}
		}
	}

	if lastToken != "" {
		m.SetActiveToken(lastToken)
	}
	return lastToken
}

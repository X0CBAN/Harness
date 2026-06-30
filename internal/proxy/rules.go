package proxy

import (
	"regexp"
	"strings"
	"sync"
)

// MatchReplaceRule rewrites part of a request or response.
type MatchReplaceRule struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
	Name    string `json:"name"`
	Comment string `json:"comment"` // human-readable note
	// Target: "request_header", "request_body", "response_header", "response_body"
	Target string `json:"target"`
	// Action: "replace" (default), "remove" (delete matched text)
	Action        string `json:"action"`
	Match         string `json:"match"`         // text or regex pattern
	Replace       string `json:"replace"`       // replacement (ignored for "remove")
	IsRegex       bool   `json:"isRegex"`
	CaseSensitive bool   `json:"caseSensitive"` // false = case-insensitive for literal matches
	URLScope      string `json:"urlScope"`      // host/path substring filter; empty = all URLs

	compiled         *regexp.Regexp
	compiledURLScope *regexp.Regexp
}

// RuleEngine holds and applies match/replace rules.
type RuleEngine struct {
	mu    sync.RWMutex
	rules []*MatchReplaceRule
}

func NewRuleEngine() *RuleEngine {
	return &RuleEngine{}
}

// SetRules replaces all rules, compiling regexes up front.
func (e *RuleEngine) SetRules(rules []*MatchReplaceRule) {
	e.mu.Lock()
	defer e.mu.Unlock()

	for _, r := range rules {
		r.compiled = nil
		r.compiledURLScope = nil
		if r.IsRegex && r.Match != "" {
			flag := "(?i)"
			if r.CaseSensitive {
				flag = ""
			}
			if c, err := regexp.Compile(flag + r.Match); err == nil {
				r.compiled = c
			}
		}
		if r.URLScope != "" {
			if c, err := regexp.Compile("(?i)" + r.URLScope); err == nil {
				r.compiledURLScope = c
			}
		}
	}
	e.rules = rules
}

func (e *RuleEngine) GetRules() []*MatchReplaceRule {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.rules
}

// apply runs all enabled rules for a given target against the input text.
// reqURL is the full request URL for scope filtering (empty = bypass scope check).
func (e *RuleEngine) apply(target, input, reqURL string) string {
	e.mu.RLock()
	defer e.mu.RUnlock()

	result := input
	for _, r := range e.rules {
		if !r.Enabled || r.Target != target || r.Match == "" {
			continue
		}
		// URL scope filter
		if reqURL != "" && r.URLScope != "" {
			if r.compiledURLScope != nil {
				if !r.compiledURLScope.MatchString(reqURL) {
					continue
				}
			} else if !strings.Contains(strings.ToLower(reqURL), strings.ToLower(r.URLScope)) {
				continue
			}
		}
		replacement := r.Replace
		if r.Action == "remove" {
			replacement = ""
		}
		if r.IsRegex && r.compiled != nil {
			result = r.compiled.ReplaceAllString(result, replacement)
		} else if !r.IsRegex {
			if r.CaseSensitive {
				result = replaceAll(result, r.Match, replacement)
			} else {
				result = replaceAllFold(result, r.Match, replacement)
			}
		}
	}
	return result
}

// hasRulesFor reports whether any enabled rule targets the given target.
func (e *RuleEngine) hasRulesFor(target string) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, r := range e.rules {
		if r.Enabled && r.Target == target && r.Match != "" {
			return true
		}
	}
	return false
}

func replaceAll(s, old, new string) string {
	if old == "" {
		return s
	}
	out := ""
	for {
		i := indexOf(s, old)
		if i < 0 {
			out += s
			break
		}
		out += s[:i] + new
		s = s[i+len(old):]
	}
	return out
}

func replaceAllFold(s, old, new string) string {
	if old == "" {
		return s
	}
	lower := strings.ToLower(s)
	lold := strings.ToLower(old)
	out := ""
	for {
		i := strings.Index(lower, lold)
		if i < 0 {
			out += s
			break
		}
		out += s[:i] + new
		s = s[i+len(old):]
		lower = lower[i+len(lold):]
	}
	return out
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

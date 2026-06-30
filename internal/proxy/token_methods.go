package proxy

import (
	"github.com/harness-proxy/harness/internal/tokens"
)

// GetTokenRules returns the current extraction rules.
func (a *App) GetTokenRules() []*tokens.ExtractionRule {
	return a.tokenMgr.GetRules()
}

// SetTokenRules replaces all extraction rules.
func (a *App) SetTokenRules(rules []*tokens.ExtractionRule) {
	a.tokenMgr.SetRules(rules)
}

// GetTokenInjection returns the current injection config.
func (a *App) GetTokenInjection() tokens.InjectionConfig {
	return a.tokenMgr.GetInjection()
}

// SetTokenInjection updates the injection config.
func (a *App) SetTokenInjection(cfg tokens.InjectionConfig) {
	a.tokenMgr.SetInjection(cfg)
}

// GetActiveToken returns the currently active token value.
func (a *App) GetActiveToken() string {
	return a.tokenMgr.GetActiveToken()
}

// SetActiveToken manually sets the active token value.
func (a *App) SetActiveToken(token string) {
	a.tokenMgr.SetActiveToken(token)
}

// GetMacro returns the stored macro request sequence.
func (a *App) GetMacro() []*tokens.MacroRequest {
	return a.tokenMgr.GetMacro()
}

// SetMacro stores the macro request sequence.
func (a *App) SetMacro(reqs []*tokens.MacroRequest) {
	a.tokenMgr.SetMacro(reqs)
}

// RunMacro executes the macro sequence and returns the extracted token.
func (a *App) RunMacro() string {
	return a.tokenMgr.RunMacro()
}

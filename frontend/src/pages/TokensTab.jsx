import { useEffect, useState } from 'react'
import { Key, Plus, X, Copy, Check, Play, Save } from 'lucide-react'
import { backend } from '../bridge'
import { useStore } from '../stores/store'

function uuid() {
  return Math.random().toString(36).slice(2, 10)
}

const defaultRule = () => ({
  id: uuid(),
  name: 'Token rule',
  enabled: true,
  source: 'response_body',
  type: 'regex',
  pattern: '"access_token"\\s*:\\s*"([^"]+)"',
  group: 1,
  header: '',
})

const defaultInjection = {
  enabled: false,
  target: 'header',
  key: 'Authorization',
  format: 'Bearer {{token}}',
}

export default function TokensTab() {
  const { activeToken, setActiveToken } = useStore()
  const [rules, setRules] = useState([])
  const [injection, setInjection] = useState(defaultInjection)
  const [macro, setMacro] = useState([{ raw: '', host: '', https: true }])
  const [copied, setCopied] = useState(false)
  const [macroStatus, setMacroStatus] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([
      backend.getTokenRules(),
      backend.getTokenInjection(),
      backend.getActiveToken(),
      backend.getMacro(),
    ]).then(([r, inj, tok, mac]) => {
      if (r) setRules(r)
      if (inj) setInjection(inj)
      if (tok) setActiveToken(tok)
      if (mac && mac.length) setMacro(mac)
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    await backend.setTokenRules(rules)
    await backend.setTokenInjection(injection)
    await backend.setMacro(macro)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleCopy = () => {
    if (!activeToken) return
    navigator.clipboard.writeText(activeToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleClearToken = async () => {
    await backend.setActiveToken('')
    setActiveToken('')
  }

  const handleRunMacro = async () => {
    setMacroStatus('Running macro…')
    try {
      const tok = await backend.runMacro()
      setMacroStatus(tok ? `Token extracted: ${tok.slice(0, 40)}${tok.length > 40 ? '…' : ''}` : 'Macro ran — no token extracted')
    } catch (e) {
      setMacroStatus('Macro error: ' + e)
    }
    setTimeout(() => setMacroStatus(''), 5000)
  }

  const addRule = () => setRules(r => [...r, defaultRule()])
  const removeRule = (id) => setRules(r => r.filter(x => x.id !== id))
  const updateRule = (id, patch) => setRules(r => r.map(x => x.id === id ? { ...x, ...patch } : x))

  const addMacroStep = () => setMacro(m => [...m, { raw: '', host: '', https: true }])
  const removeMacroStep = (idx) => setMacro(m => m.filter((_, i) => i !== idx))
  const updateMacroStep = (idx, patch) => setMacro(m => m.map((s, i) => i === idx ? { ...s, ...patch } : s))

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: extraction rules + active token */}
      <div style={{ width: '50%', borderRight: '1px solid var(--border-dim)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Active token */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="panel-header-title">Active Token</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={handleCopy} disabled={!activeToken}>
                {copied ? <Check size={11} /> : <Copy size={11} />} Copy
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleClearToken}>Clear</button>
            </div>
          </div>
          <div style={{
            background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: activeToken ? 'var(--green)' : 'var(--text-dim)',
            wordBreak: 'break-all', minHeight: 36, lineHeight: 1.6,
          }}>
            {activeToken || 'No token yet — configure extraction rules below or set manually'}
          </div>
          {!activeToken && (
            <input
              placeholder="Or paste token manually…"
              style={{ marginTop: 6, width: '100%', fontSize: 11 }}
              onKeyDown={e => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  backend.setActiveToken(e.target.value.trim())
                  setActiveToken(e.target.value.trim())
                  e.target.value = ''
                }
              }}
            />
          )}
        </div>

        {/* Extraction rules */}
        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="panel-header-title">Extraction Rules</span>
            <button className="btn btn-ghost btn-sm" onClick={addRule}><Plus size={11} /> Add rule</button>
          </div>

          {rules.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, paddingTop: 20 }}>
              <Key size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
              <p>No extraction rules. Add one to auto-capture tokens from responses.</p>
            </div>
          )}

          {rules.map(rule => (
            <div key={rule.id} style={{
              background: 'var(--bg-raised)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: 12, marginBottom: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <label className="toggle" style={{ flexShrink: 0 }}>
                  <input type="checkbox" checked={rule.enabled} onChange={e => updateRule(rule.id, { enabled: e.target.checked })} />
                  <span className="toggle-track" />
                </label>
                <input
                  value={rule.name}
                  onChange={e => updateRule(rule.id, { name: e.target.value })}
                  style={{ flex: 1, fontSize: 12 }}
                />
                <button onClick={() => removeRule(rule.id)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                  <X size={12} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Source</label>
                  <select value={rule.source} onChange={e => updateRule(rule.id, { source: e.target.value })} style={{ width: '100%', fontSize: 11 }}>
                    <option value="response_body">Response Body</option>
                    <option value="response_header">Response Header</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Type</label>
                  <select value={rule.type} onChange={e => updateRule(rule.id, { type: e.target.value })} style={{ width: '100%', fontSize: 11 }}>
                    <option value="regex">Regex</option>
                    <option value="jsonpath">JSONPath</option>
                  </select>
                </div>
              </div>
              {rule.source === 'response_header' && (
                <div style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Header name (blank = search all)</label>
                  <input value={rule.header} onChange={e => updateRule(rule.id, { header: e.target.value })} placeholder="e.g. X-Auth-Token" style={{ width: '100%', fontSize: 11 }} />
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                  {rule.type === 'regex' ? 'Pattern' : 'JSONPath (e.g. $.access_token)'}
                </label>
                <input value={rule.pattern} onChange={e => updateRule(rule.id, { pattern: e.target.value })} style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              </div>
              {rule.type === 'regex' && (
                <div style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Capture group (0 = whole match)</label>
                  <input type="number" min={0} value={rule.group} onChange={e => updateRule(rule.id, { group: Number(e.target.value) })} style={{ width: 80, fontSize: 11 }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: injection + macro */}
      <div style={{ width: '50%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Injection config */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="panel-header-title">Auto-Inject into Requests</span>
            <label className="toggle">
              <input type="checkbox" checked={injection.enabled} onChange={e => setInjection(x => ({ ...x, enabled: e.target.checked }))} />
              <span className="toggle-track" />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Target</label>
              <select value={injection.target} onChange={e => setInjection(x => ({ ...x, target: e.target.value }))} style={{ width: '100%', fontSize: 11 }}>
                <option value="header">Request Header</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Header name</label>
              <input value={injection.key} onChange={e => setInjection(x => ({ ...x, key: e.target.value }))} style={{ width: '100%', fontSize: 11 }} />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Format (use <code style={{ fontSize: 10 }}>{'{{token}}'}</code> as placeholder)</label>
            <input value={injection.format} onChange={e => setInjection(x => ({ ...x, format: e.target.value }))} style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
          </div>
          <p style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            When enabled, the proxy injects this header into every in-scope request and auto-retries 401s.
          </p>
        </div>

        {/* Macro */}
        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="panel-header-title">Re-auth Macro</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={addMacroStep}><Plus size={11} /> Step</button>
              <button className="btn btn-success btn-sm" onClick={handleRunMacro}><Play size={11} /> Run</button>
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.6 }}>
            On a 401, Harness replays these requests in order, extracts a fresh token via your rules, then retries the original request.
          </p>

          {macroStatus && (
            <div style={{
              background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.25)',
              borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 11, color: 'var(--green)',
              marginBottom: 10, wordBreak: 'break-all',
            }}>
              {macroStatus}
            </div>
          )}

          {macro.map((step, idx) => (
            <div key={idx} style={{
              background: 'var(--bg-raised)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: 10, marginBottom: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Step {idx + 1}</span>
                {macro.length > 1 && (
                  <button onClick={() => removeMacroStep(idx)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                    <X size={11} />
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input
                  value={step.host}
                  onChange={e => updateMacroStep(idx, { host: e.target.value })}
                  placeholder="host (e.g. api.example.com)"
                  style={{ flex: 1, fontSize: 11 }}
                />
                <label className="toggle" title="HTTPS">
                  <input type="checkbox" checked={step.https} onChange={e => updateMacroStep(idx, { https: e.target.checked })} />
                  <span className="toggle-track" />
                </label>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', alignSelf: 'center' }}>HTTPS</span>
              </div>
              <textarea
                value={step.raw}
                onChange={e => updateMacroStep(idx, { raw: e.target.value })}
                placeholder={`POST /auth/token HTTP/1.1\r\nHost: api.example.com\r\nContent-Type: application/json\r\n\r\n{"username":"admin","password":"secret"}`}
                spellCheck={false}
                style={{
                  width: '100%', minHeight: 90,
                  background: 'var(--bg-base)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: '6px 8px',
                  fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6,
                  resize: 'vertical', outline: 'none',
                }}
              />
            </div>
          ))}
        </div>

        {/* Save button */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-dim)', flexShrink: 0 }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ width: '100%' }}>
            {saved ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save All Token Settings</>}
          </button>
        </div>
      </div>
    </div>
  )
}

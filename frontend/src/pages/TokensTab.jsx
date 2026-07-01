import { useEffect, useState } from 'react'
import { Key, Copy, Check, Play, Save, ChevronDown, ChevronRight, X, Plus } from 'lucide-react'
import { backend } from '../bridge'
import { useStore } from '../stores/store'

function uuid() { return Math.random().toString(36).slice(2, 10) }

// Quick-start extraction presets
const EXTRACT_PRESETS = [
  { label: 'JWT Bearer', pattern: '"access_token"\\s*:\\s*"([^"]+)"', group: 1, source: 'response_body', type: 'regex' },
  { label: 'token field', pattern: '"token"\\s*:\\s*"([^"]+)"',        group: 1, source: 'response_body', type: 'regex' },
  { label: 'Set-Cookie',  pattern: 'session=([^;\\s]+)',               group: 1, source: 'response_header', type: 'regex', header: 'Set-Cookie' },
  { label: 'X-Auth-Token', pattern: '^(.+)$',                          group: 1, source: 'response_header', type: 'regex', header: 'X-Auth-Token' },
]

const defaultRule = () => ({
  id: uuid(), name: 'Token rule', enabled: true,
  source: 'response_body', type: 'regex',
  pattern: '"access_token"\\s*:\\s*"([^"]+)"',
  group: 1, header: '',
})

const defaultInjection = { enabled: false, target: 'header', key: 'Authorization', format: 'Bearer {{token}}' }

export default function TokensTab() {
  const { activeToken, setActiveToken } = useStore()
  const [injection, setInjection] = useState(defaultInjection)
  const [rules, setRules] = useState([])
  const [macro, setMacro] = useState([{ raw: '', host: '', https: true }])
  const [manualInput, setManualInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [macroStatus, setMacroStatus] = useState('')
  const [showCapture, setShowCapture] = useState(false)
  const [showMacro, setShowMacro] = useState(false)

  useEffect(() => {
    Promise.all([
      backend.getTokenRules(),
      backend.getTokenInjection(),
      backend.getActiveToken(),
      backend.getMacro(),
    ]).then(([r, inj, tok, mac]) => {
      if (r?.length) setRules(r)
      if (inj) setInjection(inj)
      if (tok) setActiveToken(tok)
      if (mac?.length) setMacro(mac)
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    await backend.setTokenRules(rules)
    await backend.setTokenInjection(injection)
    await backend.setMacro(macro)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSetManual = () => {
    const t = manualInput.trim()
    if (!t) return
    backend.setActiveToken(t)
    setActiveToken(t)
    setManualInput('')
  }

  const handleCopy = () => {
    if (!activeToken) return
    navigator.clipboard.writeText(activeToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleClear = async () => {
    await backend.setActiveToken('')
    setActiveToken('')
  }

  const handleRunMacro = async () => {
    setMacroStatus('running…')
    try {
      const tok = await backend.runMacro()
      setMacroStatus(tok ? `Captured: ${tok.slice(0, 60)}${tok.length > 60 ? '…' : ''}` : 'Ran — no token matched')
    } catch (e) {
      setMacroStatus('Error: ' + e)
    }
    setTimeout(() => setMacroStatus(''), 6000)
  }

  const addRule = (preset) => setRules(r => [...r, preset ? { ...defaultRule(), ...preset, id: uuid(), name: preset.label } : defaultRule()])
  const removeRule = (id) => setRules(r => r.filter(x => x.id !== id))
  const updateRule = (id, patch) => setRules(r => r.map(x => x.id === id ? { ...x, ...patch } : x))

  const addMacroStep = () => setMacro(m => [...m, { raw: '', host: '', https: true }])
  const removeMacroStep = (idx) => setMacro(m => m.filter((_, i) => i !== idx))
  const updateMacroStep = (idx, patch) => setMacro(m => m.map((s, i) => i === idx ? { ...s, ...patch } : s))

  const hasToken = !!activeToken

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', maxWidth: 760, margin: '0 auto', padding: '0 0 40px' }}>

      <div style={{
        margin: '16px 16px 0', padding: '10px 14px',
        background: 'var(--bg-raised)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border-dim)',
        fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7,
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>How it works:</strong>
        {' '}Paste your session token (or let auto-capture grab it from a login response).
        Enable injection and every request the proxy forwards will carry that token automatically.
        When the token expires, run the Re-auth Macro to fetch a fresh one.
      </div>

      <div style={{ margin: '12px 16px 0', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px',
            color: 'var(--text-dim)',
          }}>Step 1 — Token</span>
          {hasToken && (
            <span style={{
              fontSize: 10, padding: '1px 8px', borderRadius: 10,
              background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
              color: 'var(--green)', fontWeight: 600,
            }}>ACTIVE</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleCopy} disabled={!hasToken}>
              {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
            {hasToken && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={handleClear}><X size={11} /> Clear</button>}
          </div>
        </div>
        <div style={{ padding: '10px 14px' }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6,
            padding: '8px 10px', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-base)', border: '1px solid var(--border)',
            color: hasToken ? 'var(--green)' : 'var(--text-dim)',
            wordBreak: 'break-all', minHeight: 40,
          }}>
            {hasToken ? activeToken : 'No token set'}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSetManual()}
              placeholder="Paste token here and press Enter or Set…"
              style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
            <button className="btn btn-primary" onClick={handleSetManual} disabled={!manualInput.trim()}>Set</button>
          </div>
        </div>
      </div>

      <div style={{ margin: '10px 16px 0', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)' }}>
            Step 2 — Inject into requests
          </span>
          <label className="toggle" style={{ marginLeft: 'auto' }}>
            <input type="checkbox" checked={injection.enabled} onChange={e => setInjection(x => ({ ...x, enabled: e.target.checked }))} />
            <span className="toggle-track" />
          </label>
          <span style={{ fontSize: 11, color: injection.enabled ? 'var(--green)' : 'var(--text-dim)' }}>
            {injection.enabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <div style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 160px' }}>
            <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Header name</label>
            <input value={injection.key} onChange={e => setInjection(x => ({ ...x, key: e.target.value }))}
              style={{ width: '100%', fontSize: 11 }} placeholder="Authorization" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
              Value — use <code style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{'{{token}}'}</code> as placeholder
            </label>
            <input value={injection.format} onChange={e => setInjection(x => ({ ...x, format: e.target.value }))}
              style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-mono)' }} placeholder="Bearer {{token}}" />
          </div>
        </div>
        <div style={{ padding: '0 14px 10px', fontSize: 10, color: 'var(--text-dim)' }}>
          Result header sent: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
            {injection.key}: {injection.format.replace('{{token}}', hasToken ? activeToken.slice(0, 20) + '…' : '<token>')}
          </code>
        </div>
      </div>

      <div style={{ margin: '10px 16px 0', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <button
          onClick={() => setShowCapture(v => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          {showCapture ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)' }}>
            Step 3 — Auto-capture from responses
          </span>
          {rules.length > 0 && (
            <span style={{
              fontSize: 10, padding: '1px 8px', borderRadius: 10, marginLeft: 4,
              background: 'var(--accent-glow)', border: '1px solid var(--accent-dim)',
              color: 'var(--accent)',
            }}>{rules.filter(r => r.enabled).length} rule{rules.filter(r=>r.enabled).length !== 1 ? 's' : ''} active</span>
          )}
        </button>
        {showCapture && (
          <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border-dim)' }}>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '10px 0 10px', lineHeight: 1.6 }}>
              When the proxy receives a response matching a rule, it captures the token automatically — useful for login flows.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', alignSelf: 'center', marginRight: 2 }}>Quick-start:</span>
              {EXTRACT_PRESETS.map(p => (
                <button key={p.label} className="btn btn-ghost btn-sm"
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => addRule(p)}>
                  + {p.label}
                </button>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px', marginLeft: 4 }} onClick={() => addRule(null)}>
                <Plus size={10} /> Custom
              </button>
            </div>

            {rules.length === 0 && (
              <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: '8px 0' }}>
                <Key size={20} style={{ opacity: 0.4, display: 'block', marginBottom: 6 }} />
                No extraction rules — use a quick-start above or add a custom rule.
              </div>
            )}

            {rules.map(rule => (
              <div key={rule.id} style={{
                background: 'var(--bg-raised)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: 10, marginBottom: 8,
                opacity: rule.enabled ? 1 : 0.5,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <label className="toggle" style={{ flexShrink: 0 }}>
                    <input type="checkbox" checked={rule.enabled} onChange={e => updateRule(rule.id, { enabled: e.target.checked })} />
                    <span className="toggle-track" />
                  </label>
                  <input value={rule.name} onChange={e => updateRule(rule.id, { name: e.target.value })}
                    style={{ flex: 1, fontSize: 11 }} />
                  <button onClick={() => removeRule(rule.id)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                    <X size={12} />
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Capture from</label>
                    <select value={rule.source} onChange={e => updateRule(rule.id, { source: e.target.value })} style={{ width: '100%', fontSize: 11 }}>
                      <option value="response_body">Response body</option>
                      <option value="response_header">Response header</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Match method</label>
                    <select value={rule.type} onChange={e => updateRule(rule.id, { type: e.target.value })} style={{ width: '100%', fontSize: 11 }}>
                      <option value="regex">Regex</option>
                      <option value="jsonpath">JSONPath</option>
                    </select>
                  </div>
                </div>
                {rule.source === 'response_header' && (
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Header name (blank = search all headers)</label>
                    <input value={rule.header} onChange={e => updateRule(rule.id, { header: e.target.value })}
                      placeholder="e.g. Set-Cookie" style={{ width: '100%', fontSize: 11 }} />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                    {rule.type === 'regex' ? 'Regex pattern — first capture group is extracted' : 'JSONPath (e.g. $.access_token)'}
                  </label>
                  <input value={rule.pattern} onChange={e => updateRule(rule.id, { pattern: e.target.value })}
                    style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                </div>
                {rule.type === 'regex' && (
                  <div style={{ marginTop: 6 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Capture group (0 = whole match)</label>
                    <input type="number" min={0} value={rule.group} onChange={e => updateRule(rule.id, { group: Number(e.target.value) })}
                      style={{ width: 70, fontSize: 11 }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ margin: '10px 16px 0', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <button
          onClick={() => setShowMacro(v => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          {showMacro ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)' }}>
            Advanced — Re-auth Macro
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 4 }}>replay a login flow to get a fresh token</span>
          {macroStatus && <span style={{ fontSize: 10, color: 'var(--green)', marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{macroStatus}</span>}
        </button>
        {showMacro && (
          <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border-dim)' }}>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '10px 0 12px', lineHeight: 1.6 }}>
              On a 401, Harness replays these requests in order, extracts a fresh token using your extraction rules, then retries the original request automatically.
            </p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={addMacroStep}><Plus size={11} /> Add step</button>
              <button className="btn btn-success btn-sm" onClick={handleRunMacro}><Play size={11} /> Run now</button>
            </div>
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
                <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                  <input value={step.host} onChange={e => updateMacroStep(idx, { host: e.target.value })}
                    placeholder="host (e.g. api.example.com)" style={{ flex: 1, fontSize: 11 }} />
                  <label className="toggle">
                    <input type="checkbox" checked={step.https} onChange={e => updateMacroStep(idx, { https: e.target.checked })} />
                    <span className="toggle-track" />
                  </label>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>HTTPS</span>
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
        )}
      </div>

      <div style={{ margin: '12px 16px 0' }}>
        <button className="btn btn-primary" onClick={handleSave} style={{ width: '100%' }}>
          {saved ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save settings</>}
        </button>
      </div>

    </div>
  )
}

import { useRef, useState } from 'react'
import { Play, Copy, Send, Target, Terminal, Trash2, ChevronDown } from 'lucide-react'
import { useStore } from '../stores/store'

function useDragH(initPx, min = 200, max = 900) {
  const [px, setPx] = useState(initPx)
  const ref = useRef(px)
  ref.current = px
  const onMouseDown = (e) => {
    const startX = e.clientX; const startPx = ref.current; e.preventDefault()
    const onMove = (mv) => setPx(Math.max(min, Math.min(max, startPx + mv.clientX - startX)))
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }
  return [px, onMouseDown]
}

// ── Built-in script templates ──────────────────────────────────────────────
const TEMPLATES = [
  {
    name: 'Find SQL Injection Points',
    script: `// Flag requests with query parameters that could be SQL injectable
return requests
  .filter(r => {
    if (!r.url) return false;
    const params = [...new URLSearchParams(new URL(r.url, 'http://x').search).keys()];
    return params.some(p => /id|user|name|search|query|cat|item|product|order|sort/i.test(p));
  })
  .map(r => ({ entry: r, note: 'Has SQL-injectable parameter names' }));`,
  },
  {
    name: 'Find Open Redirects',
    script: `// Flag requests containing redirect-like parameters
return requests
  .filter(r => {
    if (!r.url) return false;
    const url = new URL(r.url, 'http://x');
    for (const key of url.searchParams.keys()) {
      if (/redirect|next|url|return|goto|dest|forward|target/i.test(key)) return true;
    }
    return false;
  })
  .map(r => ({ entry: r, note: 'Potential open redirect parameter' }));`,
  },
  {
    name: 'Find JWT Tokens in Responses',
    script: `// Flag responses that contain JWT tokens
const jwtRe = /eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/;
return requests
  .filter(r => {
    const body = (r.responseBody || '') + (r.responseHeaders || '');
    return jwtRe.test(body);
  })
  .map(r => {
    const m = ((r.responseBody || '') + (r.responseHeaders || '')).match(jwtRe);
    return { entry: r, note: 'JWT: ' + (m ? m[0].slice(0, 30) + '...' : '') };
  });`,
  },
  {
    name: 'Find Admin / Sensitive Paths',
    script: `// Flag requests to sensitive-looking paths
const sensitiveRe = /\\/?(admin|dashboard|config|setup|install|debug|console|panel|api\\/internal|wp-admin|phpmyadmin|.git|.env|backup)/i;
return requests
  .filter(r => sensitiveRe.test(r.url || ''))
  .map(r => ({ entry: r, note: 'Sensitive path: ' + (r.url || '').match(sensitiveRe)[0] }));`,
  },
  {
    name: 'Find Error Responses',
    script: `// Flag 4xx/5xx responses
return requests
  .filter(r => r.statusCode >= 400)
  .map(r => ({ entry: r, note: 'HTTP ' + r.statusCode }));`,
  },
  {
    name: 'Find Large Responses (>100KB)',
    script: `return requests
  .filter(r => (r.responseLength || 0) > 100 * 1024)
  .map(r => ({ entry: r, note: (r.responseLength / 1024).toFixed(1) + ' KB' }));`,
  },
  {
    name: 'Find API Endpoints (JSON)',
    script: `return requests
  .filter(r => {
    const ct = (r.mimeType || '').toLowerCase();
    return ct.includes('json') || ct.includes('api');
  })
  .map(r => ({ entry: r, note: 'JSON/API: ' + r.mimeType }));`,
  },
  {
    name: 'Find POST Requests with Credentials',
    script: `// Flag POST bodies containing password/token/secret fields
const credsRe = /password|passwd|pwd|secret|token|auth|apikey|api_key/i;
return requests
  .filter(r => {
    if ((r.method || '').toUpperCase() !== 'POST') return false;
    return credsRe.test(r.requestHeaders || '');
  })
  .map(r => ({ entry: r, note: 'POST with credential field' }));`,
  },
  {
    name: 'Custom Script',
    script: `// Write your own analyzer.
// 'requests' is an array of all proxy history entries.
// Return an array of { entry, note } objects to show in results.
// Available entry fields:
//   id, url, method, statusCode, host, mimeType,
//   requestHeaders, responseHeaders, responseBody,
//   durationMs, responseLength

return requests
  .filter(r => r.statusCode === 200)
  .slice(0, 20)
  .map(r => ({ entry: r, note: 'OK' }));`,
  },
]

function statusClass(code) {
  if (!code) return 'status-0'
  if (code < 300) return 'status-2xx'
  if (code < 400) return 'status-3xx'
  if (code < 500) return 'status-4xx'
  return 'status-5xx'
}

export default function ScriptsTab() {
  const { history, crawlNodes, sendToRepeater, sendToIntruder, sendToSQLMap } = useStore()
  const [leftPx, onLeftResize] = useDragH(Math.round(window.innerWidth * 0.42), 200, 900)
  const [script, setScript]         = useState(TEMPLATES[8].script) // custom template
  const [results, setResults]       = useState(null)
  const [error, setError]           = useState('')
  const [running, setRunning]       = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(8)
  const [showTemplates, setShowTemplates]       = useState(false)
  const [ctxMenu, setCtxMenu]       = useState(null)

  const runScript = () => {
    setRunning(true)
    setError('')
    setResults(null)
    try {
      // Provide a full copy of history + crawl nodes so the script can't mutate the store
      const requests = history.map(e => ({ ...e }))
      const nodes = crawlNodes.map(n => ({ ...n }))
      // eslint-disable-next-line no-new-func
      const fn = new Function('requests', 'crawlNodes', script)
      let raw = fn(requests, nodes)
      // Normalize: allow returning plain entries or { entry, note } objects
      if (!Array.isArray(raw)) raw = []
      const normalized = raw.map(r => {
        if (r && r.entry) return r
        return { entry: r, note: '' }
      }).filter(r => r.entry && r.entry.id)
      setResults(normalized)
    } catch (e) {
      setError(e.message)
    }
    setRunning(false)
  }

  const loadTemplate = (idx) => {
    setSelectedTemplate(idx)
    setScript(TEMPLATES[idx].script)
    setShowTemplates(false)
    setResults(null)
    setError('')
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* LEFT: Editor */}
      <div style={{ width: leftPx, flexShrink: 0, borderRight: 'none', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div className="panel-header" style={{ gap: 8 }}>
          <span className="panel-header-title">Script Analyzer</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{history.length} entries in scope</span>

            {/* Template picker */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowTemplates(v => !v)}
                className="btn btn-ghost btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                Templates <ChevronDown size={10} />
              </button>
              {showTemplates && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, zIndex: 200,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: 4, minWidth: 240,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}>
                  {TEMPLATES.map((t, i) => (
                    <button key={i} onClick={() => loadTemplate(i)} style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 10px', background: i === selectedTemplate ? 'var(--bg-active)' : 'none',
                      color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)',
                      fontSize: 12, cursor: 'pointer',
                    }}
                      onMouseEnter={e => { if (i !== selectedTemplate) e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { if (i !== selectedTemplate) e.currentTarget.style.background = 'none' }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button className="btn btn-primary btn-sm" onClick={runScript} disabled={running || !history.length}>
              <Play size={11} /> Run
            </button>
          </div>
        </div>

        {/* Script editor */}
        <textarea
          value={script}
          onChange={e => setScript(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1, resize: 'none', border: 'none', outline: 'none',
            fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7,
            padding: '14px 16px', background: 'var(--bg-base)', color: 'var(--text-primary)',
          }}
        />

        {/* Status bar */}
        <div style={{
          padding: '5px 14px', fontSize: 10, background: 'var(--bg-raised)',
          borderTop: '1px solid var(--border-dim)', color: 'var(--text-dim)',
          display: 'flex', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span>JS · <b style={{color:'var(--text-secondary)'}}>{history.length}</b> requests · <b style={{color:'var(--text-secondary)'}}>{crawlNodes.length}</b> crawl nodes</span>
          {results !== null && (
            <span style={{ color: results.length > 0 ? 'var(--accent)' : 'var(--text-dim)' }}>
              {results.length} match{results.length !== 1 ? 'es' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div className="resize-handle-h" onMouseDown={onLeftResize} />

      {/* RIGHT: Results */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="panel-header">
          <span className="panel-header-title">Results</span>
          {results !== null && results.length > 0 && (
            <button
              onClick={() => navigator.clipboard.writeText(results.map(r => r.entry.url).join('\n'))}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
              title="Copy all matched URLs"
            >
              <Copy size={11} />
            </button>
          )}
        </div>

        {error && (
          <div style={{ padding: '10px 14px', color: 'var(--red)', background: 'rgba(248,113,113,0.08)', borderBottom: '1px solid rgba(248,113,113,0.2)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <b>Script error:</b> {error}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {results === null ? (
            <div className="empty-state" style={{ paddingTop: 60 }}>
              <Play size={32} style={{ color: 'var(--text-dim)' }} />
              <p>Write a script and click Run to analyze proxy history</p>
              <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Use the Templates dropdown for pre-built examples</p>
              {history.length === 0 && <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>No history yet — browse through the proxy first</p>}
            </div>
          ) : results.length === 0 ? (
            <div className="empty-state" style={{ paddingTop: 60 }}>
              <Trash2 size={28} style={{ color: 'var(--text-dim)' }} />
              <p style={{ color: 'var(--text-dim)' }}>No matches</p>
            </div>
          ) : (
            <table className="results-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Status</th>
                  <th style={{ width: '100%' }}>URL</th>
                  <th>Note</th>
                  <th>ms</th>
                </tr>
              </thead>
              <tbody>
                {results.map(({ entry: e, note }, i) => (
                  <tr
                    key={i}
                    onContextMenu={ev => { ev.preventDefault(); setCtxMenu({ x: ev.clientX, y: ev.clientY, entry: e }) }}
                    style={{ cursor: 'context-menu' }}
                    onMouseEnter={ev => ev.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={ev => ev.currentTarget.style.background = ''}
                  >
                    <td><span className={`method method-${(e.method||'GET').toUpperCase()}`}>{e.method || 'GET'}</span></td>
                    <td><span className={`status ${statusClass(e.statusCode)}`}>{e.statusCode || '—'}</span></td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.url}>{e.url}</td>
                    <td style={{ color: 'var(--accent)', fontSize: 10, whiteSpace: 'nowrap' }}>{note}</td>
                    <td style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{e.durationMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (() => {
        const MENU_W = 200
        const items = [
          { label: 'Send to Repeater', icon: <Send size={11} />,   action: () => sendToRepeater(ctxMenu.entry) },
          { label: 'Send to Intruder', icon: <Target size={11} />, action: () => sendToIntruder(ctxMenu.entry) },
          { label: 'Send to SQLMap',   icon: <Terminal size={11} />,action: () => sendToSQLMap(ctxMenu.entry) },
          'sep',
          { label: 'Copy URL', action: () => navigator.clipboard.writeText(ctxMenu.entry.url || '') },
        ]
        const estH = items.filter(i => i !== 'sep').length * 30 + 9 + 8
        const left = ctxMenu.x + MENU_W > window.innerWidth  ? Math.max(4, window.innerWidth  - MENU_W - 4) : ctxMenu.x
        const top  = ctxMenu.y + estH  > window.innerHeight  ? Math.max(4, window.innerHeight - estH  - 4) : ctxMenu.y
        return (
          <div style={{ position: 'fixed', top, left, zIndex: 300, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 4, minWidth: MENU_W, boxShadow: '0 8px 24px rgba(0,0,0,0.55)' }}
            onClick={e => e.stopPropagation()}>
            {items.map((item, i) => item === 'sep'
              ? <div key={i} style={{ height: 1, background: 'var(--border-dim)', margin: '3px 4px' }} />
              : <button key={i} onClick={() => { item.action(); setCtxMenu(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', background: 'none', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  {item.icon}{item.label}
                </button>
            )}
          </div>
        )
      })()}

      {showTemplates && <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setShowTemplates(false)} />}
      {ctxMenu && <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setCtxMenu(null)} />}
    </div>
  )
}

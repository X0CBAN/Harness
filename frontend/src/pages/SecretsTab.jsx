import { useState, useEffect, useRef } from 'react'
import { Eye, Play, Download, RefreshCw, ChevronDown, ChevronRight, Send } from 'lucide-react'
import { useStore } from '../stores/store'

const PATTERNS = [
  { id: 'jwt',        name: 'JWT Token',            regex: () => /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,                                                                                  severity: 'high',     targets: ['responseBody', 'requestHeaders'] },
  { id: 'aws_key',    name: 'AWS Access Key',        regex: () => /\bAKIA[0-9A-Z]{16}\b/g,                                                                                                                               severity: 'critical', targets: ['responseBody', 'requestHeaders', 'requestBody'] },
  { id: 'github',     name: 'GitHub Token',          regex: () => /gh[pousr]_[A-Za-z0-9]{36,}/g,                                                                                                                         severity: 'critical', targets: ['responseBody', 'requestHeaders', 'requestBody'] },
  { id: 'privkey',    name: 'Private Key',           regex: () => /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY/g,                                                                                                  severity: 'critical', targets: ['responseBody'] },
  { id: 'bearer',     name: 'Bearer Token',          regex: () => /[Bb]earer\s+([A-Za-z0-9_\-.~+/]+=*){20,}/g,                                                                                                          severity: 'medium',   targets: ['responseBody', 'requestHeaders'] },
  { id: 'api_key',    name: 'API Key (generic)',      regex: () => /(?:api[_-]?key|apikey)["\s:=]+([A-Za-z0-9_\-]{20,64})/gi,                                                                                           severity: 'high',     targets: ['responseBody', 'requestBody'] },
  { id: 'password',   name: 'Password in Request',   regex: () => /["&]?(?:password|passwd|pwd)["\s=:]+([^"&\s\r\n]{4,64})/gi,                                                                                          severity: 'high',     targets: ['requestHeaders', 'requestBody'] },
  { id: 'sql',        name: 'SQL Query Exposed',      regex: () => /(?:SELECT\s+[\w*,\s]+FROM\s+\w+|INSERT\s+INTO\s+\w+|UPDATE\s+\w+\s+SET)/gi,                                                                        severity: 'medium',   targets: ['responseBody'] },
  { id: 'stack',      name: 'Stack Trace',            regex: () => /(?:Exception in thread|Traceback \(most recent|at \w+\.\w+\.\w+\(|\.php on line \d)/g,                                                             severity: 'medium',   targets: ['responseBody'] },
  { id: 'credit',     name: 'Credit Card',            regex: () => /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g,                                                                                  severity: 'critical', targets: ['responseBody', 'requestBody'] },
  { id: 'email',      name: 'Email Address',          regex: () => /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}\b/g,                                                                                           severity: 'info',     targets: ['responseBody'] },
  { id: 'internalip', name: 'Internal IP',            regex: () => /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,                                  severity: 'low',      targets: ['responseBody'] },
  { id: 'slack',      name: 'Slack Token',            regex: () => /xox[baprs]-[0-9A-Za-z\-]{10,}/g,                                                                                                                     severity: 'critical', targets: ['responseBody', 'requestHeaders'] },
  { id: 'debug',      name: 'Debug / Framework Info', regex: () => /(?:SQLSTATE\[|ORA-\d{4,}|mysql_num_rows|mysqli_|pg_query|Symfony\\|Laravel\\|ActiveRecord|traceback\.format_exc)/gi,                               severity: 'medium',   targets: ['responseBody'] },
]

const SKIP_STATUS = new Set([301, 302, 303, 304, 307, 308, 404])

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info']
const SEV_COLOR = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e', info: '#60a5fa' }
const SEV_BG    = { critical: 'rgba(239,68,68,0.13)', high: 'rgba(249,115,22,0.13)', medium: 'rgba(234,179,8,0.13)', low: 'rgba(34,197,94,0.11)', info: 'rgba(96,165,250,0.11)' }

function scanEntry(entry, enabledPatterns) {
  if (SKIP_STATUS.has(entry.statusCode)) return []
  const hasAnyText = (entry.responseBody || '') + (entry.requestHeaders || '') + (entry.requestBody || '')
  if (!hasAnyText) return []

  const findings = []
  for (const p of PATTERNS) {
    if (!enabledPatterns.has(p.id)) continue
    for (const target of p.targets) {
      const text = entry[target] || ''
      if (!text) continue
      let matches
      try { matches = [...text.matchAll(p.regex())] } catch { continue }
      for (const m of matches.slice(0, 5)) {
        const start    = Math.max(0, m.index - 20)
        const end      = Math.min(text.length, m.index + m[0].length + 40)
        const fullStart = Math.max(0, m.index - 100)
        const fullEnd   = Math.min(text.length, m.index + m[0].length + 400)
        findings.push({
          id:          `${entry.id}_${p.id}_${target}_${m.index}`,
          patternId:   p.id,
          patternName: p.name,
          severity:    p.severity,
          method:      entry.method || 'GET',
          url:         entry.url    || '',
          host:        entry.host   || '',
          source:      target === 'requestHeaders' ? 'Request Headers'
                     : target === 'requestBody'    ? 'Request Body'
                     :                              'Response Body',
          snippet:     text.slice(start, end),
          fullSnippet: text.slice(fullStart, fullEnd),
          entryId:     entry.id,
          reqHeaders:  entry.requestHeaders || '',
        })
      }
    }
  }
  return findings
}

export default function SecretsTab() {
  const { history: proxyHistory, addRepeaterTab, setActiveTab } = useStore()

  const [findings,        setFindings]        = useState([])
  const [scanning,        setScanning]        = useState(false)
  const [liveOn,          setLiveOn]          = useState(true)
  const [enabledPatterns, setEnabledPatterns] = useState(new Set(PATTERNS.map(p => p.id)))
  const [severityFilter,  setSeverityFilter]  = useState('all')
  const [expandedId,      setExpandedId]      = useState(null)
  const [showPatterns,    setShowPatterns]    = useState(false)
  const [ctxMenu,         setCtxMenu]         = useState(null)

  const scannedIds = useRef(new Set())

  useEffect(() => {
    if (!liveOn) return
    const newEntries = proxyHistory.filter(e => !scannedIds.current.has(e.id))
    if (newEntries.length === 0) return
    const newFindings = newEntries.flatMap(e => {
      scannedIds.current.add(e.id)
      return scanEntry(e, enabledPatterns)
    })
    if (newFindings.length > 0) setFindings(f => [...f, ...newFindings])
  }, [proxyHistory, liveOn, enabledPatterns])

  useEffect(() => {
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const handleScanAll = () => {
    setScanning(true)
    setTimeout(() => {
      scannedIds.current = new Set()
      const all = proxyHistory.flatMap(e => {
        scannedIds.current.add(e.id)
        return scanEntry(e, enabledPatterns)
      })
      // deduplicate by id
      const seen = new Set()
      setFindings(all.filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true }))
      setScanning(false)
    }, 0)
  }

  const handleClear = () => {
    setFindings([])
    scannedIds.current = new Set()
  }

  const togglePattern = (id) => {
    setEnabledPatterns(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const sendToRepeater = (f) => {
    addRepeaterTab({ request: f.reqHeaders, host: f.host })
    setActiveTab('repeater')
    setCtxMenu(null)
  }

  const exportCSV = () => {
    const rows = [['Severity', 'Pattern', 'Method', 'URL', 'Source', 'Snippet']]
    filteredFindings.forEach(f =>
      rows.push([f.severity, f.patternName, f.method, f.url, f.source, f.snippet.replace(/"/g, "'")])
    )
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'harness-secrets.csv'
    a.click()
  }

  // Sort and filter
  const filteredFindings = findings
    .filter(f => severityFilter === 'all' || f.severity === severityFilter)
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))

  // Counts
  const counts = {}
  findings.forEach(f => { counts[f.severity] = (counts[f.severity] || 0) + 1 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div className="panel-header" style={{ flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
        <Eye size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="panel-header-title">Secrets Scanner</span>

        <button className="btn btn-primary btn-sm" onClick={handleScanAll} disabled={scanning} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {scanning ? <RefreshCw size={11} className="spin" /> : <Play size={11} />}
          {scanning ? 'Scanning…' : 'Scan All'}
        </button>

        {/* Live toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
          <span className="toggle" style={{ transform: 'scale(0.82)' }}>
            <input type="checkbox" checked={liveOn} onChange={e => setLiveOn(e.target.checked)} />
            <span className="toggle-track" />
          </span>
          Live
          {liveOn && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', flexShrink: 0 }} />
          )}
        </label>

        {/* Severity chips */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
          {['all', ...SEV_ORDER].map(s => (
            <button key={s} onClick={() => setSeverityFilter(s)}
              style={{
                padding: '2px 9px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
                background: severityFilter === s
                  ? (s === 'all' ? 'var(--accent)' : SEV_BG[s])
                  : 'var(--bg-hover)',
                color: severityFilter === s
                  ? (s === 'all' ? '#fff' : SEV_COLOR[s])
                  : 'var(--text-dim)',
                border: `1px solid ${severityFilter === s
                  ? (s === 'all' ? 'var(--accent)' : SEV_COLOR[s])
                  : 'var(--border-dim)'}`,
              }}>
              {s}{s !== 'all' && counts[s] ? ` ${counts[s]}` : ''}
            </button>
          ))}
        </div>

        <button className="btn btn-ghost btn-sm" onClick={() => setShowPatterns(p => !p)} style={{ marginLeft: 'auto' }}>
          Patterns {showPatterns ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV} disabled={findings.length === 0} title="Export findings as CSV">
          <Download size={11} /> Export
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleClear} disabled={findings.length === 0} title="Clear all findings">
          Clear
        </button>

        <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 4, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {filteredFindings.length} finding{filteredFindings.length !== 1 ? 's' : ''}
          {severityFilter !== 'all' ? ` (${findings.length} total)` : ''}
          {' · '}{proxyHistory.length} entries
        </span>
      </div>

      {/* Pattern toggles panel */}
      {showPatterns && (
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid var(--border-dim)',
          background: 'var(--bg-raised)', flexShrink: 0,
          display: 'flex', flexWrap: 'wrap', gap: 6,
        }}>
          {PATTERNS.map(p => (
            <label key={p.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, cursor: 'pointer', userSelect: 'none',
                padding: '3px 8px', borderRadius: 4,
                background: enabledPatterns.has(p.id) ? SEV_BG[p.severity] : 'var(--bg-hover)',
                border: `1px solid ${enabledPatterns.has(p.id) ? SEV_COLOR[p.severity] + '55' : 'var(--border-dim)'}`,
                color: enabledPatterns.has(p.id) ? SEV_COLOR[p.severity] : 'var(--text-dim)',
              }}>
              <input type="checkbox" checked={enabledPatterns.has(p.id)}
                onChange={() => togglePattern(p.id)}
                style={{ width: 12, height: 12, accentColor: SEV_COLOR[p.severity] }} />
              {p.name}
            </label>
          ))}
        </div>
      )}

      {/* Findings table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filteredFindings.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: 80 }}>
            <Eye size={36} style={{ opacity: 0.3 }} />
            <p style={{ marginTop: 12, fontSize: 14, fontWeight: 600 }}>No secrets detected</p>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              {proxyHistory.length === 0
                ? 'Start proxying traffic — Harness will scan every response automatically.'
                : liveOn
                  ? 'Live scan is active. New traffic will be checked automatically.'
                  : 'Click "Scan All" to scan captured traffic, or enable Live scanning.'}
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-raised)' }}>
                {['Severity', 'Pattern', 'Method · URL', 'Source', 'Snippet', ''].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '7px 10px',
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px',
                    color: 'var(--text-dim)', borderBottom: '1px solid var(--border-dim)',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredFindings.map(f => {
                const isExpanded = expandedId === f.id
                return (
                  <>
                    <tr
                      key={f.id}
                      onClick={() => setExpandedId(isExpanded ? null : f.id)}
                      onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, f }) }}
                      style={{
                        cursor: 'pointer',
                        background: isExpanded ? 'var(--bg-raised)' : undefined,
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border-dim)',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = isExpanded ? 'var(--bg-raised)' : ''}
                    >
                      {/* Severity */}
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 7px', borderRadius: 10,
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                          background: SEV_BG[f.severity], color: SEV_COLOR[f.severity],
                          border: `1px solid ${SEV_COLOR[f.severity]}44`,
                        }}>
                          {f.severity}
                        </span>
                      </td>
                      {/* Pattern name */}
                      <td style={{ padding: '7px 10px', color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {f.patternName}
                      </td>
                      {/* Method + URL */}
                      <td style={{ padding: '7px 10px', maxWidth: 320, overflow: 'hidden' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          <span style={{
                            color: f.method === 'POST' ? '#f97316' : f.method === 'PUT' ? '#eab308' : f.method === 'DELETE' ? '#ef4444' : 'var(--accent)',
                            fontWeight: 700, marginRight: 6,
                          }}>{f.method}</span>
                          <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.url}>
                            {f.url.length > 60 ? f.url.slice(0, 60) + '…' : f.url}
                          </span>
                        </span>
                      </td>
                      {/* Source */}
                      <td style={{ padding: '7px 10px', color: 'var(--text-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {f.source}
                      </td>
                      {/* Snippet */}
                      <td style={{ padding: '7px 10px', maxWidth: 340, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--text-dim)' }}>
                          {f.snippet.slice(0, 80)}{f.snippet.length > 80 ? '…' : ''}
                        </span>
                      </td>
                      {/* Action */}
                      <td style={{ padding: '7px 6px', textAlign: 'right' }}>
                        <button
                          onClick={e => { e.stopPropagation(); sendToRepeater(f) }}
                          title="Send to Repeater"
                          style={{ background: 'none', border: '1px solid var(--border-dim)', borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer', padding: '2px 6px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}
                          onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'var(--border-dim)' }}
                        >
                          <Send size={10} /> Repeater
                        </button>
                      </td>
                    </tr>
                    {/* Expanded row */}
                    {isExpanded && (
                      <tr key={`${f.id}-exp`} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                        <td colSpan={6} style={{ padding: '0 10px 12px 10px', background: 'var(--bg-raised)' }}>
                          <pre style={{
                            fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7,
                            color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            background: 'var(--bg-base)', padding: '10px 14px', borderRadius: 'var(--radius)',
                            border: '1px solid var(--border-dim)', maxHeight: 240, overflow: 'auto',
                            margin: 0,
                          }}>
                            {f.fullSnippet}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 400,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 4, minWidth: 160,
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
          }}>
          {[
            { label: 'Send to Repeater', action: () => sendToRepeater(ctxMenu.f) },
            { label: 'Copy URL',         action: () => { navigator.clipboard.writeText(ctxMenu.f.url); setCtxMenu(null) } },
            { label: 'Copy Snippet',     action: () => { navigator.clipboard.writeText(ctxMenu.f.fullSnippet); setCtxMenu(null) } },
          ].map(item => (
            <button key={item.label} onClick={item.action}
              style={{ display: 'flex', width: '100%', padding: '7px 10px', background: 'none', border: 'none', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

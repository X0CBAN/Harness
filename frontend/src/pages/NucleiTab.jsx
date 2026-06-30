import { useEffect, useRef, useState } from 'react'
import { Play, Square, Trash2, Copy, ExternalLink, AlertCircle } from 'lucide-react'
import { useStore } from '../stores/store'
import { backend } from '../bridge'

function useDragH(initPx, min = 200, max = 700) {
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

const SEVERITY_COLORS = {
  critical: '#f87171',
  high:     '#fb923c',
  medium:   '#fbbf24',
  low:      '#4ade80',
  info:     '#60a5fa',
}

const PRESET_TAGS = [
  { label: 'CVEs',          value: 'cve' },
  { label: 'XSS',           value: 'xss' },
  { label: 'SQLi',          value: 'sqli' },
  { label: 'LFI',           value: 'lfi' },
  { label: 'RCE',           value: 'rce' },
  { label: 'SSRF',          value: 'ssrf' },
  { label: 'Open Redirect', value: 'redirect' },
  { label: 'Exposed Files', value: 'exposure' },
  { label: 'Misconfigs',    value: 'misconfiguration' },
  { label: 'Tech Detect',   value: 'tech' },
  { label: 'Default Login', value: 'default-login' },
]

function parseSeverity(line) {
  const m = line.match(/\[(critical|high|medium|low|info)\]/i)
  return m ? m[1].toLowerCase() : null
}

export default function NucleiTab() {
  const { nucleiRunning, nucleiOutput, setNucleiRunning, addNucleiOutput, clearNucleiOutput } = useStore()

  const [leftPx, onLeftResize] = useDragH(340, 220, 700)
  const [installed, setInstalled] = useState(null) // null = checking
  const [target, setTarget]       = useState('')
  const [tags, setTags]           = useState('')
  const [severity, setSeverity]   = useState('medium,high,critical')
  const [templates, setTemplates] = useState('')
  const [useProxy, setUseProxy]   = useState(true)
  const [rateLimit, setRateLimit] = useState(150)
  const [extra, setExtra]         = useState('')
  const [filter, setFilter]       = useState('')
  const [copyFlash, setCopyFlash] = useState(false)

  const outputRef = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    backend.getNucleiInstalled().then(setInstalled).catch(() => setInstalled(false))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [nucleiOutput.length])

  const handleStart = async () => {
    if (!target.trim()) return
    clearNucleiOutput()
    setNucleiRunning(true)
    addNucleiOutput(`─── Starting nuclei against ${target} ───`)
    await backend.runNuclei({ target, tags, severity, templates, useProxy, rateLimit: Number(rateLimit), extra })
  }

  const handleStop = () => {
    backend.stopNuclei()
    setNucleiRunning(false)
  }

  const handleTagToggle = (val) => {
    const current = tags.split(',').map(t => t.trim()).filter(Boolean)
    const idx = current.indexOf(val)
    if (idx === -1) {
      setTags([...current, val].join(','))
    } else {
      setTags(current.filter(t => t !== val).join(','))
    }
  }

  const activeTags = new Set(tags.split(',').map(t => t.trim()).filter(Boolean))

  const filteredOutput = filter
    ? nucleiOutput.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : nucleiOutput

  const findings = nucleiOutput.filter(l => parseSeverity(l))

  const allText = nucleiOutput.join('\n')

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* LEFT: Config */}
      <div style={{ width: leftPx, flexShrink: 0, borderRight: 'none', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="panel-header">
          <span className="panel-header-title">Nuclei Scanner</span>
          {installed === false && (
            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <AlertCircle size={10} /> not installed
            </span>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {installed === false && (
            <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: 11, color: 'var(--red)', lineHeight: 1.6 }}>
              <b>Nuclei not found.</b><br />
              Install with:<br />
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest</code>
              <br />
              <a href="https://nuclei.projectdiscovery.io" target="_blank" rel="noreferrer"
                style={{ color: 'var(--accent)', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3, marginTop: 4 }}>
                <ExternalLink size={9} /> nuclei.projectdiscovery.io
              </a>
            </div>
          )}

          {/* Target */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>Target</label>
            <input
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="https://example.com"
              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>

          {/* Tags */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>Template Tags</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
              {PRESET_TAGS.map(pt => (
                <button
                  key={pt.value}
                  onClick={() => handleTagToggle(pt.value)}
                  style={{
                    padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: activeTags.has(pt.value) ? 'var(--accent-dim)' : 'var(--bg-raised)',
                    border: `1px solid ${activeTags.has(pt.value) ? 'var(--accent)' : 'var(--border)'}`,
                    color: activeTags.has(pt.value) ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {pt.label}
                </button>
              ))}
            </div>
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="cve,xss,sqli or leave empty for all"
              style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
          </div>

          {/* Severity */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>Minimum Severity</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {['info','low','medium','high','critical'].map(sev => {
                const active = severity.split(',').includes(sev)
                return (
                  <button key={sev} onClick={() => {
                    const sevs = ['info','low','medium','high','critical']
                    const idx = sevs.indexOf(sev)
                    setSeverity(sevs.slice(idx).join(','))
                  }} style={{
                    flex: 1, padding: '4px 0', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: active ? SEVERITY_COLORS[sev] + '22' : 'var(--bg-raised)',
                    border: `1px solid ${active ? SEVERITY_COLORS[sev] : 'var(--border)'}`,
                    color: active ? SEVERITY_COLORS[sev] : 'var(--text-dim)',
                    textTransform: 'capitalize',
                  }}>
                    {sev}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Templates path */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>Templates (optional)</label>
            <input
              value={templates}
              onChange={e => setTemplates(e.target.value)}
              placeholder="path/to/templates or leave empty"
              style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
            <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>Leave empty to use nuclei's default template library.</p>
          </div>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Options</label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={useProxy} onChange={e => setUseProxy(e.target.checked)} />
              Route through Harness proxy (port 8080)
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>Rate limit</span>
              <input type="number" min={1} max={500} value={rateLimit}
                onChange={e => setRateLimit(e.target.value)}
                style={{ width: 70, fontSize: 11 }} />
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>req/sec</span>
            </div>
          </div>

          {/* Extra args */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>Extra Args</label>
            <input
              value={extra}
              onChange={e => setExtra(e.target.value)}
              placeholder="-timeout 10 -retries 1"
              style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
          </div>

          {/* Run / Stop */}
          <div style={{ display: 'flex', gap: 8 }}>
            {nucleiRunning ? (
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleStop}>
                <Square size={12} /> Stop
              </button>
            ) : (
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleStart} disabled={!target.trim() || installed === false}>
                <Play size={12} /> Run Nuclei
              </button>
            )}
          </div>

          {/* Findings summary */}
          {findings.length > 0 && (
            <div style={{ background: 'var(--bg-raised)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>FINDINGS ({findings.length})</div>
              {['critical','high','medium','low','info'].map(sev => {
                const count = findings.filter(l => parseSeverity(l) === sev).length
                if (!count) return null
                return (
                  <div key={sev} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: SEVERITY_COLORS[sev], fontWeight: 600, textTransform: 'capitalize' }}>{sev}</span>
                    <span style={{ color: SEVERITY_COLORS[sev], fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{count}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div className="resize-handle-h" onMouseDown={onLeftResize} />

      {/* RIGHT: Output */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="panel-header">
          <span className="panel-header-title" style={{ color: 'var(--text-dim)' }}>
            Output
            {nucleiRunning && <span style={{ marginLeft: 8, color: 'var(--accent)', fontSize: 10 }}>● running</span>}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter output…"
              style={{ width: 160, fontSize: 11, padding: '3px 8px' }}
            />
            {filter && (
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                {filteredOutput.length}/{nucleiOutput.length}
              </span>
            )}
            <button
              onClick={() => { navigator.clipboard.writeText(allText); setCopyFlash(true); setTimeout(() => setCopyFlash(false), 1500) }}
              style={{ background: 'none', border: 'none', color: copyFlash ? 'var(--green)' : 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
              title="Copy all output"
            >
              <Copy size={11} />
            </button>
            <button
              onClick={() => { clearNucleiOutput(); setNucleiRunning(false) }}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
              title="Clear output"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        <div ref={outputRef} style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '10px 14px', background: 'var(--bg-base)', lineHeight: 1.7 }}>
          {filteredOutput.length === 0 ? (
            <div className="empty-state" style={{ paddingTop: 60 }}>
              <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Configure a target and click Run Nuclei</p>
              {installed === false && (
                <p style={{ color: 'var(--red)', fontSize: 11, marginTop: 8 }}>nuclei is not installed — install it first</p>
              )}
            </div>
          ) : (
            filteredOutput.map((line, i) => {
              const sev = parseSeverity(line)
              const color = sev ? SEVERITY_COLORS[sev] : (line.startsWith('───') ? 'var(--text-dim)' : 'var(--text-secondary)')
              return (
                <div key={i} style={{ color, padding: '1px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {line}
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}

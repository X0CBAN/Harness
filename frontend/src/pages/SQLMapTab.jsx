import { useEffect, useRef, useState } from 'react'
import { Play, Square, Terminal, Trash2, Search, Copy } from 'lucide-react'
import { useStore } from '../stores/store'
import { backend } from '../bridge'

// Horizontal drag-resize
function useDragH(initPx, min = 220, max = 800) {
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

function useEncoderMenu(getValueFn, setValueFn) {
  const [menu, setMenu] = useState(null)
  const selRef = useRef({ start: 0, end: 0, text: '' })
  const taRef = useRef(null)

  const encB64 = (s) => { try { return btoa(unescape(encodeURIComponent(s))) } catch { return s } }
  const decB64 = (s) => { try { return decodeURIComponent(escape(atob(s))) } catch { return s } }
  const encURL = (s) => encodeURIComponent(s)
  const decURL = (s) => { try { return decodeURIComponent(s) } catch { return s } }
  const encHex = (s) => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2,'0')).join('')
  const decHex = (s) => { try { return new TextDecoder().decode(new Uint8Array((s.match(/.{1,2}/g)||[]).map(h=>parseInt(h,16)))) } catch { return s } }

  const capture = (ta) => {
    const start = ta.selectionStart || 0
    const end = ta.selectionEnd || 0
    selRef.current = { start, end, text: ta.value.slice(start, end) }
  }

  const applyTransform = (fn) => {
    const { start, end, text } = selRef.current
    if (!text) return
    const result = fn(text)
    const ta = taRef.current
    const base = ta ? ta.value : (getValueFn ? getValueFn() : '')
    setValueFn(base.slice(0, start) + result + base.slice(end))
    selRef.current = { start, end: start + result.length, text: result }
  }

  const onContextMenu = (e) => {
    e.preventDefault()
    capture(e.target)
    setMenu({ x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const MENU_W = 200
  const items = [
    { label: 'Cut',        action: () => { const {start,end,text}=selRef.current; if(!text)return; navigator.clipboard.writeText(text); const ta=taRef.current; const base=ta?ta.value:(getValueFn?getValueFn():''); setValueFn(base.slice(0,start)+base.slice(end)) } },
    { label: 'Copy',       action: () => navigator.clipboard.writeText(selRef.current.text || (taRef.current?.value ?? '')) },
    { label: 'Paste',      action: async () => { const clip=await navigator.clipboard.readText().catch(()=>''); if(!clip)return; const {start,end}=selRef.current; const ta=taRef.current; const base=ta?ta.value:(getValueFn?getValueFn():''); setValueFn(base.slice(0,start)+clip+base.slice(end)) } },
    { label: 'Select All', action: () => { const ta=taRef.current; if(ta){ta.select()} } },
    'sep',
    { label: 'Base64 Encode', action: () => applyTransform(encB64) },
    { label: 'Base64 Decode', action: () => applyTransform(decB64) },
    { label: 'URL Encode',    action: () => applyTransform(encURL) },
    { label: 'URL Decode',    action: () => applyTransform(decURL) },
    { label: 'Hex Encode',    action: () => applyTransform(encHex) },
    { label: 'Hex Decode',    action: () => applyTransform(decHex) },
  ]

  const MenuEl = menu ? (() => {
    const ITEM_H = 30
    const estH = items.filter(i => i !== 'sep').length * ITEM_H + 2 * 9 + 8
    const left = menu.x + MENU_W > window.innerWidth ? Math.max(4, window.innerWidth - MENU_W - 4) : menu.x
    const top  = menu.y + estH > window.innerHeight ? Math.max(4, window.innerHeight - estH - 4) : menu.y
    return (
      <div style={{
        position: 'fixed', top, left, zIndex: 300,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 4, minWidth: MENU_W,
        boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
      }} onClick={e => e.stopPropagation()}>
        {items.map((item, i) => item === 'sep'
          ? <div key={i} style={{ height: 1, background: 'var(--border-dim)', margin: '3px 4px' }} />
          : <button key={i} onClick={() => { item.action(); setMenu(null) }} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '7px 10px', background: 'none', color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer', textAlign: 'left',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >{item.label}</button>
        )}
      </div>
    )
  })() : null

  return { taRef, onContextMenu, MenuEl }
}

export default function SQLMapTab() {
  const {
    sqlmapRequest, setSQLMapRequest,
    sqlmapRunning, setSQLMapRunning,
    sqlmapOutput, addSQLMapOutput, clearSQLMapOutput,
  } = useStore()

  const [level, setLevel]   = useState(1)
  const [risk, setRisk]     = useState(1)
  const [dbs, setDbs]       = useState(true)
  const [tables, setTables] = useState(false)
  const [dump, setDump]     = useState(false)
  const [extra, setExtra]   = useState('')
  const [outputFilter, setOutputFilter] = useState('')

  const outputRef = useRef(null)
  const [leftPx, onLeftResize] = useDragH(420, 220, 800)

  const { taRef: reqTaRef, onContextMenu: reqCtxMenu, MenuEl: ReqMenuEl } =
    useEncoderMenu(null, setSQLMapRequest)

  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sqlmapOutput.length])

  const handleRun = async () => {
    if (!sqlmapRequest.trim()) return
    clearSQLMapOutput()
    setSQLMapRunning(true)
    try {
      await backend.runSQLMap(sqlmapRequest, { level, risk, dbs, tables, dump, extra })
    } catch (err) {
      addSQLMapOutput('Error: ' + String(err))
      setSQLMapRunning(false)
    }
  }

  const handleStop = async () => {
    await backend.stopSQLMap()
    setSQLMapRunning(false)
  }

  const lineColor = (line) => {
    if (!line) return 'var(--text-dim)'
    if (line.includes('[CRITICAL]') || line.includes('[ERROR]')) return 'var(--red)'
    if (line.includes('[WARNING]')) return 'var(--yellow)'
    if (line.includes('[INFO]')) return 'var(--text-secondary)'
    if (line.includes('[SUCCESS]') || line.startsWith('[+]')) return 'var(--green)'
    if (line.startsWith('───')) return 'var(--accent)'
    return 'var(--text-secondary)'
  }

  const filteredOutput = outputFilter.trim()
    ? sqlmapOutput.filter(l => l.toLowerCase().includes(outputFilter.toLowerCase()))
    : sqlmapOutput

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <Terminal size={13} style={{ color: 'var(--accent)' }} />
        <span className="panel-header-title">SQLMap</span>
        {sqlmapRunning && (
          <span style={{ fontSize: 11, color: 'var(--yellow)', marginLeft: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--yellow)', display: 'inline-block', animation: 'pulse 1s ease-in-out infinite' }} />
            Running… (intercept paused)
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>
          Routes through 127.0.0.1:8080 · intercept suspended during run
        </span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT: request + options — resizable */}
        <div style={{
          width: leftPx, flexShrink: 0, display: 'flex', flexDirection: 'column',
          borderRight: 'none', overflow: 'hidden',
        }}>
          <div style={{ padding: '7px 14px 5px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.8px' }}>
              HTTP Request
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto' }}>right-click to encode/decode</span>
          </div>

          <textarea
            ref={reqTaRef}
            value={sqlmapRequest}
            onChange={e => setSQLMapRequest(e.target.value)}
            onContextMenu={reqCtxMenu}
            placeholder={
              'POST /login HTTP/1.1\r\n' +
              'Host: localhost:9090\r\n' +
              'Content-Type: application/x-www-form-urlencoded\r\n\r\n' +
              'username=admin&password=test'
            }
            spellCheck={false}
            style={{
              flex: 1, background: 'var(--bg-base)', border: 'none',
              padding: '12px 14px', fontFamily: 'var(--font-mono)',
              fontSize: 12, color: 'var(--text-primary)',
              resize: 'none', outline: 'none', lineHeight: 1.7,
            }}
          />

          {/* Options */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-dim)', flexShrink: 0, background: 'var(--bg-surface)' }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 10, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                Level
                <select value={level} onChange={e => setLevel(+e.target.value)}
                  style={{ fontSize: 11, padding: '2px 6px', width: 50 }}>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                Risk
                <select value={risk} onChange={e => setRisk(+e.target.value)}
                  style={{ fontSize: 11, padding: '2px 6px', width: 50 }}>
                  {[1,2,3].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
              {[
                { label: '--dbs',    state: dbs,    set: setDbs },
                { label: '--tables', state: tables, set: setTables },
                { label: '--dump',   state: dump,   set: setDump },
              ].map(opt => (
                <label key={opt.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={opt.state} onChange={e => opt.set(e.target.checked)} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{opt.label}</span>
                </label>
              ))}
            </div>

            <input
              value={extra}
              onChange={e => setExtra(e.target.value)}
              placeholder="Extra flags (e.g. --forms --crawl=2 --dbms=mysql)"
              style={{ width: '100%', fontSize: 11, marginBottom: 10 }}
            />

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleRun}
                disabled={sqlmapRunning || !sqlmapRequest.trim()}
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <Play size={11} /> Run SQLMap
              </button>
              <button onClick={handleStop} disabled={!sqlmapRunning} className="btn btn-danger">
                <Square size={11} /> Stop
              </button>
              <button onClick={clearSQLMapOutput} className="btn btn-ghost btn-sm" title="Clear output">
                <Trash2 size={11} />
              </button>
            </div>

            <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6 }}>
              Place <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>*</span> anywhere to
              mark the injection point — e.g. <span style={{ fontFamily: 'var(--font-mono)' }}>id=1*</span>.
              Without it, sqlmap tests all params automatically.
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
              Not installed? <span style={{ fontFamily: 'var(--font-mono)' }}>pip install sqlmap</span>
            </p>
          </div>
        </div>

        {/* Resize handle */}
        <div className="resize-handle-h" onMouseDown={onLeftResize} />

        {/* RIGHT: output */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '7px 14px 5px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.8px' }}>
              Output
            </span>
            {/* Output grep/filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
              <Search size={10} style={{ color: 'var(--text-dim)' }} />
              <input
                value={outputFilter}
                onChange={e => setOutputFilter(e.target.value)}
                placeholder="Filter lines…"
                style={{ width: 130, padding: '2px 6px', fontSize: 11 }}
              />
              {outputFilter && (
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{filteredOutput.length} / {sqlmapOutput.length}</span>
              )}
              {outputFilter && (
                <button onClick={() => setOutputFilter('')} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12 }}>✕</button>
              )}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(sqlmapOutput.join('\n')).catch(() => {})}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
              title="Copy all output"
            >
              <Copy size={11} />
            </button>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {sqlmapOutput.length} lines
            </span>
          </div>

          {sqlmapOutput.length === 0 ? (
            <div className="empty-state" style={{ flex: 1 }}>
              <Terminal size={32} />
              <p style={{ marginTop: 12 }}>No output yet</p>
              <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, maxWidth: 320, textAlign: 'center', lineHeight: 1.7 }}>
                Paste a raw HTTP request on the left, then click Run SQLMap.
                <br />
                Right-click any history entry → Send to SQLMap to auto-fill.
              </p>
            </div>
          ) : (
            <div
              ref={outputRef}
              style={{
                flex: 1, overflow: 'auto',
                padding: '12px 16px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5, lineHeight: 1.7,
                background: 'var(--bg-base)',
              }}
            >
              {filteredOutput.map((line, i) => (
                <div key={i} style={{ color: lineColor(line), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {line || ' '}
                </div>
              ))}
              {sqlmapRunning && (
                <span style={{ color: 'var(--accent)', animation: 'pulse 1s ease-in-out infinite' }}>▋</span>
              )}
            </div>
          )}
        </div>
      </div>

      {ReqMenuEl}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
    </div>
  )
}

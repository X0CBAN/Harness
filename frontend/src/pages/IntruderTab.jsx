import { useEffect, useRef, useState } from 'react'
import { Target, Play, Square, Trash2, Plus, X, Upload, Search, Copy, Check } from 'lucide-react'
import { useStore } from '../stores/store'
import { backend } from '../bridge'
import { toHexDump, extractBody, isJsonLike, formatJson } from '../components/viewUtils'

// ── Encode/Decode helpers ─────────────────────────────────────────────────────
const encB64 = (s) => { try { return btoa(unescape(encodeURIComponent(s))) } catch { return s } }
const decB64 = (s) => { try { return decodeURIComponent(escape(atob(s))) } catch { return s } }
const encURL = (s) => encodeURIComponent(s)
const decURL = (s) => { try { return decodeURIComponent(s) } catch { return s } }
const encHex = (s) => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2,'0')).join('')
const decHex = (s) => { try { return new TextDecoder().decode(new Uint8Array((s.match(/.{1,2}/g)||[]).map(h=>parseInt(h,16)))) } catch { return s } }
const decHTML = (s) => { const el = document.createElement('textarea'); el.innerHTML = s; return el.value }

// ── Request editor context menu ───────────────────────────────────────────────
function useEncoderMenu(getVal, setVal) {
  const [menu, setMenu] = useState(null)
  const selRef = useRef({ start: 0, end: 0, text: '' })
  const taRef = useRef(null)

  const capture = (ta) => {
    const start = ta.selectionStart || 0; const end = ta.selectionEnd || 0
    selRef.current = { start, end, text: ta.value.slice(start, end) }
  }
  const applyTransform = (fn) => {
    const { start, end, text } = selRef.current; if (!text) return
    const result = fn(text)
    const ta = taRef.current
    const base = ta ? ta.value : (getVal ? getVal() : '')
    setVal(base.slice(0, start) + result + base.slice(end))
    selRef.current = { start, end: start + result.length, text: result }
  }
  const onContextMenu = (e) => { e.preventDefault(); capture(e.target); setMenu({ x: e.clientX, y: e.clientY }) }

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const MENU_W = 200
  const items = [
    { label: 'Cut',        action: () => { const {start,end,text}=selRef.current; if(!text)return; navigator.clipboard.writeText(text); const ta=taRef.current; const base=ta?ta.value:(getVal?getVal():''); setVal(base.slice(0,start)+base.slice(end)) } },
    { label: 'Copy',       action: () => navigator.clipboard.writeText(selRef.current.text || (taRef.current?.value ?? '')) },
    { label: 'Paste',      action: async () => { const clip=await navigator.clipboard.readText().catch(()=>''); if(!clip)return; const {start,end}=selRef.current; const ta=taRef.current; const base=ta?ta.value:(getVal?getVal():''); setVal(base.slice(0,start)+clip+base.slice(end)) } },
    { label: 'Select All', action: () => { const ta=taRef.current; if(ta){ta.select();capture(ta)} } },
    'sep',
    { label: 'Base64 Encode', action: () => applyTransform(encB64) },
    { label: 'Base64 Decode', action: () => applyTransform(decB64) },
    { label: 'URL Encode',    action: () => applyTransform(encURL) },
    { label: 'URL Decode',    action: () => applyTransform(decURL) },
    { label: 'Hex Encode',    action: () => applyTransform(encHex) },
    { label: 'Hex Decode',    action: () => applyTransform(decHex) },
  ]

  const MenuEl = menu ? (() => {
    const ITEM_H = 30; const estH = items.filter(i=>i!=='sep').length*ITEM_H + 2*9 + 8
    const left = menu.x+MENU_W>window.innerWidth ? Math.max(4,window.innerWidth-MENU_W-4) : menu.x
    const top  = menu.y+estH>window.innerHeight  ? Math.max(4,window.innerHeight-estH-4)  : menu.y
    return (
      <div style={{ position:'fixed', top, left, zIndex:300, background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:4, minWidth:MENU_W, boxShadow:'0 8px 24px rgba(0,0,0,0.55)' }} onClick={e=>e.stopPropagation()}>
        {items.map((item,i) => item==='sep'
          ? <div key={i} style={{height:1,background:'var(--border-dim)',margin:'3px 4px'}} />
          : <button key={i} onClick={()=>{item.action();setMenu(null)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'7px 10px',background:'none',color:'var(--text-secondary)',borderRadius:'var(--radius-sm)',fontSize:12,cursor:'pointer',textAlign:'left'}} onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>{item.label}</button>
        )}
      </div>
    )
  })() : null

  return { taRef, onContextMenu, MenuEl }
}

// ── Response popup modal ──────────────────────────────────────────────────────
function ResponseModal({ result, onClose }) {
  const [viewTab, setViewTab] = useState('raw')
  const [search, setSearch] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const [matches, setMatches] = useState([])
  const [copied, setCopied] = useState(false)
  const taRef = useRef(null)
  const searchRef = useRef(null)

  const raw = result.responseRaw || result.error || '(no response captured)'

  // Split headers and body
  const splitIdx = raw.indexOf('\r\n\r\n') !== -1 ? raw.indexOf('\r\n\r\n') + 4 : raw.indexOf('\n\n') !== -1 ? raw.indexOf('\n\n') + 2 : -1
  const headersText = splitIdx !== -1 ? raw.slice(0, splitIdx).trimEnd() : raw
  const bodyText = splitIdx !== -1 ? raw.slice(splitIdx) : ''

  const requestText = result.requestRaw || '(no request captured)'
  const { contentType: respCT } = extractBody(raw)
  const displayText = (() => {
    if (viewTab === 'request') return requestText
    if (viewTab === 'hex') return toHexDump(raw)
    if (viewTab === 'render') return isJsonLike(respCT, bodyText) ? formatJson(bodyText) : bodyText
    if (viewTab === 'raw') return raw
    if (viewTab === 'headers') return headersText
    return bodyText
  })()

  // Search/grep within displayed text
  useEffect(() => {
    if (!search || !displayText) { setMatches([]); setMatchIdx(0); return }
    const results = []
    const lower = displayText.toLowerCase()
    const lq = search.toLowerCase()
    let i = 0
    while ((i = lower.indexOf(lq, i)) !== -1) { results.push(i); i += lq.length }
    setMatches(results)
    setMatchIdx(0)
  }, [search, displayText])

  const goTo = (idx) => {
    if (!matches.length || !taRef.current) return
    const i = ((idx % matches.length) + matches.length) % matches.length
    setMatchIdx(i)
    taRef.current.focus()
    taRef.current.setSelectionRange(matches[i], matches[i] + search.length)
  }

  // Keyboard: ESC closes, Ctrl+F focuses search
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Inline decode — modifies the textarea content
  const [decoded, setDecoded] = useState(null)
  const shownText = decoded ?? displayText
  const applyDecode = (fn) => {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart; const end = ta.selectionEnd
    if (start !== end) {
      const sel = shownText.slice(start, end)
      const result2 = fn(sel)
      setDecoded((shownText.slice(0, start) + result2 + shownText.slice(end)))
    } else {
      setDecoded(fn(shownText))
    }
  }

  const statusClass = result.statusCode
    ? (result.statusCode < 300 ? 'status-2xx' : result.statusCode < 400 ? 'status-3xx' : result.statusCode < 500 ? 'status-4xx' : 'status-5xx')
    : 'status-0'

  const cur = matches.length ? matchIdx % matches.length : 0

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.65)' }} />
      {/* Modal */}
      <div style={{
        position: 'fixed', zIndex: 501,
        top: '5%', left: '5%', right: '5%', bottom: '5%',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', borderBottom: '1px solid var(--border-dim)',
          background: 'var(--bg-raised)', flexShrink: 0, flexWrap: 'wrap',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {result.payload || '—'}
          </span>
          {result.statusCode ? <span className={`status ${statusClass}`}>{result.statusCode}</span> : null}
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {result.length > 0 ? `${result.length}b` : ''} {result.durationMs ? `· ${result.durationMs}ms` : ''}
          </span>
          {result.matched?.length ? (
            <span style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '2px 6px', borderRadius: 4 }}>
              matched: {result.matched.join(', ')}
            </span>
          ) : null}

          {/* View tabs */}
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            {['request', 'raw', 'headers', 'body', 'hex', 'render'].map(t => (
              <button key={t} onClick={() => { setViewTab(t); setDecoded(null) }}
                style={{
                  padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: viewTab === t ? 'var(--accent)' : 'var(--bg-hover)',
                  color: viewTab === t ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${viewTab === t ? 'var(--accent)' : 'var(--border)'}`,
                  textTransform: 'capitalize',
                }}
              >{t}</button>
            ))}
          </div>

          {/* Decode toolbar */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              ['B64↓', decB64, 'Base64 decode selection or all'],
              ['URL↓', decURL, 'URL decode selection or all'],
              ['HTML↓', decHTML, 'HTML entity decode'],
              ['HEX↓', decHex, 'Hex decode'],
            ].map(([label, fn, title]) => (
              <button key={label} onClick={() => applyDecode(fn)} title={title}
                style={{ padding: '3px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                {label}
              </button>
            ))}
            {decoded && (
              <button onClick={() => setDecoded(null)} title="Restore original"
                style={{ padding: '3px 7px', borderRadius: 4, fontSize: 10, cursor: 'pointer', background: 'rgba(248,113,113,0.12)', border: '1px solid var(--red)', color: 'var(--red)' }}>
                Reset
              </button>
            )}
          </div>

          {/* Copy */}
          <button onClick={() => { navigator.clipboard.writeText(shownText); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
            style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: copied ? 'var(--green)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {copied ? <Check size={11} /> : <Copy size={11} />} Copy
          </button>

          {/* Close */}
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px' }}>
            ✕
          </button>
        </div>

        {/* Search bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', borderBottom: '1px solid var(--border-dim)',
          background: 'var(--bg-base)', flexShrink: 0,
        }}>
          <Search size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); goTo(e.shiftKey ? cur - 1 : cur + 1) }
              if (e.key === 'Escape') { setSearch('') }
            }}
            placeholder="Search… (Ctrl+F)"
            style={{ flex: 1, fontSize: 11, padding: '3px 8px' }}
          />
          {search && (
            <span style={{ fontSize: 10, color: matches.length ? 'var(--text-dim)' : 'var(--red)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
              {matches.length ? `${cur + 1}/${matches.length}` : 'no match'}
            </span>
          )}
          {matches.length > 1 && <>
            <button onClick={() => goTo(cur - 1)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11 }}>▲</button>
            <button onClick={() => goTo(cur + 1)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11 }}>▼</button>
          </>}
          {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12 }}>✕</button>}
        </div>

        {/* Content */}
        {viewTab === 'render' && respCT.includes('html') ? (
          <iframe sandbox="allow-scripts" srcDoc={bodyText} style={{ flex: 1, border: 'none', background: '#fff', minHeight: 0 }} title="Response render" />
        ) : (
          <textarea
            ref={taRef}
            readOnly
            value={shownText}
            className="code-view"
            style={{ flex: 1, minHeight: 0, padding: '12px 16px', fontSize: 12, lineHeight: 1.7, resize: 'none', border: 'none', outline: 'none', background: 'var(--bg-base)' }}
            spellCheck={false}
          />
        )}
      </div>
    </>
  )
}

// ── Misc helpers ──────────────────────────────────────────────────────────────
function statusClass(code) {
  if (!code) return 'status-0'
  if (code < 300) return 'status-2xx'
  if (code < 400) return 'status-3xx'
  if (code < 500) return 'status-4xx'
  return 'status-5xx'
}

const MODES = [
  { value: 'sniper',        label: 'Sniper',       desc: 'One payload set, cycle through positions' },
  { value: 'battering_ram', label: 'Battering Ram', desc: 'One payload set, all positions at once' },
  { value: 'pitchfork',     label: 'Pitchfork',    desc: 'Multiple sets, lockstep' },
  { value: 'cluster_bomb',  label: 'Cluster Bomb', desc: 'Every combination' },
]

const TRANSFORM_TYPES = [
  { value: 'url_encode',    label: 'URL Encode',    hasValue: false },
  { value: 'url_decode',    label: 'URL Decode',    hasValue: false },
  { value: 'base64_encode', label: 'Base64 Encode', hasValue: false },
  { value: 'base64_decode', label: 'Base64 Decode', hasValue: false },
  { value: 'hex_encode',    label: 'Hex Encode',    hasValue: false },
  { value: 'hex_decode',    label: 'Hex Decode',    hasValue: false },
  { value: 'md5',           label: 'MD5 Hash',      hasValue: false },
  { value: 'sha256',        label: 'SHA-256 Hash',  hasValue: false },
  { value: 'uppercase',     label: 'Uppercase',     hasValue: false },
  { value: 'lowercase',     label: 'Lowercase',     hasValue: false },
  { value: 'reverse',       label: 'Reverse',       hasValue: false },
  { value: 'html_encode',   label: 'HTML Encode',   hasValue: false },
  { value: 'prefix',        label: 'Add Prefix',    hasValue: true  },
  { value: 'suffix',        label: 'Add Suffix',    hasValue: true  },
]

function useDragV(initPct, min = 20, max = 80) {
  const [pct, setPct] = useState(initPct)
  const containerRef = useRef(null)
  const ref = useRef(pct)
  ref.current = pct
  const onMouseDown = (e) => {
    const startY = e.clientY
    const startPct = ref.current
    e.preventDefault()
    const onMove = (mv) => {
      if (!containerRef.current) return
      const h = containerRef.current.clientHeight
      if (h === 0) return
      const dpct = ((mv.clientY - startY) / h) * 100
      setPct(Math.max(min, Math.min(max, startPct + dpct)))
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return [pct, onMouseDown, containerRef]
}

// ── Default session config ────────────────────────────────────────────────────
const defaultSessionConfig = (store) => ({
  request: store.intruderRequest || '',
  host: store.intruderHost || '',
  https: store.intruderHttps ?? true,
  mode: store.intruderMode || 'sniper',
  payloadLines: store.intruderPayloadLines || [],
  transforms: store.intruderTransforms || [],
  concurrency: store.intruderConcurrency ?? 10,
  delay: store.intruderDelay ?? 0,
  grep: store.intruderGrep || '',
})

// ── Main component ────────────────────────────────────────────────────────────
export default function IntruderTab() {
  const {
    intruderRequest, intruderHost, intruderHttps,
    intruderMode, intruderPayloadLines, intruderGrep, intruderConcurrency, intruderDelay,
    intruderResults, intruderRunning, intruderTransforms,
    setIntruderRequest, setIntruderHost, setIntruderHttps,
    setIntruderMode, setIntruderPayloadLines, setIntruderGrep, setIntruderConcurrency, setIntruderDelay,
    clearIntruderResults, setIntruderRunning,
    addIntruderTransform, removeIntruderTransform, updateIntruderTransform,
  } = useStore()

  // ── Session tabs ────────────────────────────────────────────────────────────
  const sessionCounter = useRef(2)
  const [sessions, setSessions] = useState([{ id: 1, name: 'Session 1', config: null, results: [] }])
  const [activeSessionId, setActiveSessionId] = useState(1)
  const [renamingId, setRenamingId] = useState(null)
  const [renameVal, setRenameVal] = useState('')

  // Save current global-store state into the specified session's config
  const snapshotCurrentConfig = () => ({
    request: intruderRequest, host: intruderHost, https: intruderHttps,
    mode: intruderMode, payloadLines: [...intruderPayloadLines],
    transforms: [...intruderTransforms],
    concurrency: intruderConcurrency, delay: intruderDelay, grep: intruderGrep,
  })

  // Load a session's config into the global store
  const loadSessionConfig = (cfg) => {
    if (!cfg) return
    setIntruderRequest(cfg.request ?? '')
    setIntruderHost(cfg.host ?? '')
    setIntruderHttps(cfg.https ?? true)
    setIntruderMode(cfg.mode ?? 'sniper')
    setIntruderPayloadLines(cfg.payloadLines ?? [])
    useStore.setState({ intruderTransforms: cfg.transforms ?? [] })
    setIntruderConcurrency(cfg.concurrency ?? 10)
    setIntruderDelay(cfg.delay ?? 0)
    setIntruderGrep(cfg.grep ?? '')
  }

  const switchSession = (toId) => {
    if (toId === activeSessionId) return
    // Save current state into outgoing session
    const snapshot = snapshotCurrentConfig()
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, config: snapshot } : s))
    // Load incoming session
    const toSession = sessions.find(s => s.id === toId)
    if (toSession?.config) loadSessionConfig(toSession.config)
    else {
      // Brand new session: clear the form
      setIntruderRequest('')
      setIntruderHost('')
      setIntruderPayloadLines([])
      clearIntruderResults()
      useStore.setState({ intruderTransforms: [] })
      setIntruderGrep('')
    }
    setActiveSessionId(toId)
  }

  const addSession = () => {
    const id = sessionCounter.current++
    const snapshot = snapshotCurrentConfig()
    setSessions(prev => [...prev.map(s => s.id === activeSessionId ? { ...s, config: snapshot } : s),
      { id, name: `Session ${id}`, config: null, results: [] }])
    // Clear for new session
    setIntruderRequest('')
    setIntruderHost('')
    setIntruderPayloadLines([])
    clearIntruderResults()
    useStore.setState({ intruderTransforms: [] })
    setIntruderGrep('')
    setActiveSessionId(id)
  }

  const closeSession = (id, e) => {
    e.stopPropagation()
    if (sessions.length === 1) return
    const next = sessions.find(s => s.id !== id)
    if (id === activeSessionId && next) {
      loadSessionConfig(next.config)
      setActiveSessionId(next.id)
    }
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  // ── Filters, layout ─────────────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSizeOp, setFilterSizeOp] = useState('any')
  const [filterSizeVal, setFilterSizeVal] = useState('')
  const [filterMatchOnly, setFilterMatchOnly] = useState(false)
  const [selectedResult, setSelectedResult] = useState(null)

  const [topPct, onTopResize, containerRef] = useDragV(55, 22, 78)

  // Auto-scroll results table to show latest entry
  const resultsBodyRef = useRef(null)
  useEffect(() => {
    if (resultsBodyRef.current && intruderRunning) {
      const el = resultsBodyRef.current
      el.parentElement.scrollTop = el.parentElement.scrollHeight
    }
  }, [intruderResults.length, intruderRunning])

  const { taRef: reqTaRef, onContextMenu: reqCtxMenu, MenuEl: ReqMenuEl } =
    useEncoderMenu(() => intruderRequest, setIntruderRequest)

  // Large-file payload mode — stores file path + count instead of content
  const [payloadFile, setPayloadFile] = useState(null) // { path, name, count } | null

  const addMarkers = () => {
    const ta = reqTaRef.current
    if (!ta) return
    const { selectionStart, selectionEnd } = ta
    const val = intruderRequest
    const newVal = val.slice(0, selectionStart) + '§' + val.slice(selectionStart, selectionEnd) + '§' + val.slice(selectionEnd)
    setIntruderRequest(newVal)
  }

  const handleLoadFile = async () => {
    const result = await backend.openPayloadFile()
    if (!result) return
    if (result.lines && result.lines.length > 0) {
      // Small file — inline editing
      setIntruderPayloadLines(result.lines)
      setPayloadFile(null)
    } else {
      // Large file — path mode; Go streams it during attack
      setPayloadFile({ path: result.path, name: result.name, count: result.count })
      setIntruderPayloadLines([])
    }
  }

  const handleClearAll = () => {
    setIntruderRequest('')
    setIntruderHost('')
    setIntruderHttps(true)
    setIntruderMode('sniper')
    setIntruderPayloadLines([])
    setIntruderGrep('')
    setIntruderConcurrency(10)
    setIntruderDelay(0)
    useStore.setState({ intruderTransforms: [] })
    setPayloadFile(null)
    clearIntruderResults()
    setSelectedResult(null)
  }

  const handleAddLine  = () => setIntruderPayloadLines([...intruderPayloadLines, ''])
  const handleDelLine  = (idx) => setIntruderPayloadLines(intruderPayloadLines.filter((_, i) => i !== idx))
  const handleEditLine = (idx, val) => {
    const next = [...intruderPayloadLines]; next[idx] = val; setIntruderPayloadLines(next)
  }

  const handleStart = async () => {
    if (!intruderRequest.trim() || !intruderHost.trim()) return
    clearIntruderResults()
    setSelectedResult(null)
    setIntruderRunning(true)
    const payloadLines = intruderPayloadLines.filter(Boolean)
    const grepList = intruderGrep.split('\n').map(l => l.trim()).filter(Boolean)
    await backend.startIntruder({
      rawRequest: intruderRequest,
      host: intruderHost,
      useHttps: intruderHttps,
      mode: intruderMode,
      payloadSets: payloadFile ? [] : [payloadLines],
      payloadFiles: payloadFile ? [payloadFile.path] : [],
      concurrency: Number(intruderConcurrency) || 10,
      delayMs: Number(intruderDelay) || 0,
      grepMatch: grepList,
      transforms: intruderTransforms,
    })
  }

  const handleStop = () => { backend.stopIntruder(); setIntruderRunning(false) }

  const filtered = intruderResults.filter(r => {
    if (filterMatchOnly && !r.matched?.length) return false
    if (filterStatus.trim()) {
      const allowed = filterStatus.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      const code = String(r.statusCode || 0)
      const match = allowed.some(a => a.endsWith('xx') ? code.startsWith(a[0]) : code === a)
      if (!match) return false
    }
    if (filterSizeOp !== 'any' && filterSizeVal !== '') {
      const threshold = Number(filterSizeVal)
      if (filterSizeOp === 'gt' && r.length <= threshold) return false
      if (filterSizeOp === 'lt' && r.length >= threshold) return false
      if (filterSizeOp === 'eq' && r.length !== threshold) return false
    }
    return true
  })

  const modeDesc = MODES.find(m => m.value === intruderMode)?.desc

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── SESSION TAB STRIP ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '5px 10px',
        borderBottom: '1px solid var(--border-dim)', background: 'var(--bg-surface)', flexShrink: 0, overflowX: 'auto',
      }}>
        {sessions.map(s => (
          <div
            key={s.id}
            onClick={() => switchSession(s.id)}
            onDoubleClick={() => { setRenamingId(s.id); setRenameVal(s.name) }}
            className={`tab-btn ${s.id === activeSessionId ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
          >
            {renamingId === s.id ? (
              <input
                autoFocus
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onBlur={() => { setSessions(prev => prev.map(x => x.id === s.id ? { ...x, name: renameVal || x.name } : x)); setRenamingId(null) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
                onClick={e => e.stopPropagation()}
                style={{ width: 90, fontSize: 11, padding: '1px 4px' }}
              />
            ) : (
              <span style={{ fontSize: 12 }}>{s.name}</span>
            )}
            {sessions.length > 1 && (
              <X size={10} onClick={(e) => closeSession(s.id, e)} style={{ opacity: 0.5 }}
                onMouseEnter={e => e.currentTarget.style.opacity = 1}
                onMouseLeave={e => e.currentTarget.style.opacity = 0.5} />
            )}
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={addSession} style={{ marginLeft: 4, flexShrink: 0 }} title="New attack session">
          <Plus size={12} />
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>Double-click to rename</span>
      </div>

      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {/* ── CONFIG PANEL ── */}
        <div className="intruder-config" style={{ height: `${topPct}%` }}>
          {/* Target + mode row */}
          <div className="intruder-config-row">
            <span className="panel-header-title" style={{ color: 'var(--text-dim)' }}>Target</span>
            <label className="toggle">
              <input type="checkbox" checked={intruderHttps} onChange={e => setIntruderHttps(e.target.checked)} />
              <span className="toggle-track" />
            </label>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>HTTPS</span>
            <input value={intruderHost} onChange={e => setIntruderHost(e.target.value)}
              placeholder="target host" style={{ width: 200, fontSize: 12 }} />
            <span className="panel-header-title" style={{ color: 'var(--text-dim)', marginLeft: 8 }}>Mode</span>
            <select value={intruderMode} onChange={e => setIntruderMode(e.target.value)}>
              {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {modeDesc && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{modeDesc}</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {intruderRunning ? (
                <button className="btn btn-danger" onClick={handleStop}><Square size={12} /> Stop</button>
              ) : (
                <button className="btn btn-primary" onClick={handleStart}><Play size={12} /> Start Attack</button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => { clearIntruderResults(); setSelectedResult(null) }} title="Clear results only">
                <Trash2 size={11} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleClearAll} title="Clear everything — request, settings, payloads, results" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                Reset All
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 12, flex: 1, minHeight: 0 }}>
            {/* Request editor */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label>Request template — wrap values with <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>§markers§</code></label>
                <button className="btn btn-ghost btn-sm" onClick={addMarkers}>Add § markers</button>
              </div>
              <textarea
                ref={reqTaRef}
                id="intruder-editor"
                value={intruderRequest}
                onChange={e => setIntruderRequest(e.target.value)}
                onContextMenu={reqCtxMenu}
                placeholder={`POST /login HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{"user":"admin","pass":"§password§"}`}
                style={{
                  flex: 1, minHeight: 0,
                  background: 'var(--bg-base)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 12px',
                  fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7,
                  resize: 'none', outline: 'none',
                }}
                spellCheck={false}
              />
            </div>

            {/* Right panel: payloads + transforms + settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label>Payloads {payloadFile ? '' : `(${intruderPayloadLines.filter(Boolean).length})`}</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={handleLoadFile}><Upload size={11} /> Load File</button>
                  {!payloadFile && <button className="btn btn-ghost btn-sm" onClick={handleAddLine}><Plus size={11} /></button>}
                </div>
              </div>

              {/* Large-file mode banner */}
              {payloadFile ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(124,106,247,0.1)', border: '1px solid var(--accent-dim)',
                  borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 11,
                }}>
                  <Upload size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {payloadFile.name}
                    </div>
                    <div style={{ color: 'var(--text-dim)' }}>
                      {payloadFile.count.toLocaleString()} lines — streamed during attack
                    </div>
                  </div>
                  <button onClick={() => setPayloadFile(null)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}>
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <div className="payload-list" style={{ overflowY: 'auto', flex: 1, minHeight: 0, maxHeight: 100 }}>
                  {intruderPayloadLines.length === 0 && (
                    <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: '4px 0' }}>No payloads — load a file or add lines</div>
                  )}
                  {intruderPayloadLines.map((line, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <input value={line} onChange={e => handleEditLine(idx, e.target.value)}
                        style={{ flex: 1, padding: '2px 6px', fontSize: 11, minWidth: 0 }} spellCheck={false} />
                      <button onClick={() => handleDelLine(idx)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}>
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Transforms */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label>Transforms</label>
                  <button className="btn btn-ghost btn-sm" onClick={() => addIntruderTransform({ type: 'url_encode', value: '' })}><Plus size={11} /> Add</button>
                </div>
                {intruderTransforms.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>None</div>}
                <div style={{ overflowY: 'auto', maxHeight: 80 }}>
                  {intruderTransforms.map((t, idx) => {
                    const meta = TRANSFORM_TYPES.find(x => x.value === t.type)
                    return (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                        <select value={t.type} onChange={e => updateIntruderTransform(idx, { type: e.target.value, value: '' })}
                          style={{ fontSize: 11, padding: '2px 4px', flex: 1 }}>
                          {TRANSFORM_TYPES.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                        </select>
                        {meta?.hasValue && (
                          <input value={t.value} onChange={e => updateIntruderTransform(idx, { value: e.target.value })}
                            placeholder={t.type === 'prefix' ? 'prefix…' : 'suffix…'}
                            style={{ flex: 1, padding: '2px 6px', fontSize: 11, minWidth: 0 }} />
                        )}
                        <button onClick={() => removeIntruderTransform(idx)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}>
                          <X size={10} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Settings */}
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, display: 'block', marginBottom: 3 }}>Threads</label>
                  <input type="number" min={1} max={50} value={intruderConcurrency}
                    onChange={e => setIntruderConcurrency(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, display: 'block', marginBottom: 3 }}>Delay (ms)</label>
                  <input type="number" min={0} value={intruderDelay}
                    onChange={e => setIntruderDelay(e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, display: 'block', marginBottom: 3 }}>Grep strings (one per line)</label>
                <textarea value={intruderGrep} onChange={e => setIntruderGrep(e.target.value)}
                  placeholder={'success\nerror\nadmin'} spellCheck={false}
                  style={{
                    width: '100%', minHeight: 40,
                    background: 'var(--bg-base)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', padding: 6,
                    fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical', outline: 'none',
                  }} />
              </div>
            </div>
          </div>
        </div>

        {/* Vertical resize handle */}
        <div className="resize-handle-v" onMouseDown={onTopResize} />

        {/* ── RESULTS PANEL ── */}
        <div className="intruder-results" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Filter bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px',
            borderBottom: '1px solid var(--border-dim)', flexShrink: 0, background: 'var(--bg-surface)', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
              Filter
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
              Status
              <input value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                placeholder="200 or 2xx or 200,301" style={{ width: 130, padding: '2px 6px', fontSize: 11 }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
              Size
              <select value={filterSizeOp} onChange={e => setFilterSizeOp(e.target.value)} style={{ fontSize: 11, padding: '2px 4px' }}>
                <option value="any">any</option>
                <option value="gt">&gt;</option>
                <option value="lt">&lt;</option>
                <option value="eq">=</option>
              </select>
              {filterSizeOp !== 'any' && (
                <input type="number" value={filterSizeVal} onChange={e => setFilterSizeVal(e.target.value)}
                  placeholder="bytes" style={{ width: 70, padding: '2px 6px', fontSize: 11 }} />
              )}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={filterMatchOnly} onChange={e => setFilterMatchOnly(e.target.checked)} />
              Matches only
            </label>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)' }}>
              {filtered.length} / {intruderResults.length} results
              {intruderRunning && <span style={{ marginLeft: 6, color: 'var(--accent)' }}>● running</span>}
            </span>
          </div>

          {/* Results table */}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {filtered.length === 0 ? (
              <div className="empty-state" style={{ paddingTop: 40 }}>
                <Target size={32} />
                <p>{intruderResults.length === 0 ? 'Configure a request and hit Start Attack' : 'No results match the current filters'}</p>
                {intruderResults.length === 0 && <p style={{ fontSize: 11 }}>Mark positions with §value§ in your request</p>}
              </div>
            ) : (
              <table className="results-table">
                <thead>
                  <tr>
                    <th>#</th><th>Payload</th><th>Status</th><th>Length</th><th>Time</th><th>Matched</th><th>Error</th>
                  </tr>
                </thead>
                <tbody ref={resultsBodyRef}>
                  {filtered.map((r, i) => (
                    <tr
                      key={i}
                      onClick={() => setSelectedResult(r)}
                      style={{
                        background: r.matched?.length ? 'rgba(124,106,247,0.06)' : undefined,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = r.matched?.length ? 'rgba(124,106,247,0.06)' : ''}
                    >
                      <td style={{ color: 'var(--text-dim)' }}>{r.index}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.payload}</td>
                      <td>
                        {r.statusCode ? <span className={`status ${statusClass(r.statusCode)}`}>{r.statusCode}</span> : '—'}
                      </td>
                      <td>{r.length > 0 ? r.length : '—'}</td>
                      <td>{r.durationMs}ms</td>
                      <td>
                        {r.matched?.length
                          ? <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{r.matched.join(', ')}</span>
                          : ''}
                      </td>
                      <td style={{ color: 'var(--red)', fontSize: 10 }}>{r.error || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Response popup modal */}
    {selectedResult && (
      <ResponseModal result={selectedResult} onClose={() => setSelectedResult(null)} />
    )}

    {ReqMenuEl}
    </>
  )
}

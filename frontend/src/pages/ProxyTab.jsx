import { useState, useEffect, useRef } from 'react'
import { Shield, Search, Trash2, Send, Target, ArrowRight, X, ChevronsRight, RefreshCw, Copy, Terminal, Save } from 'lucide-react'
import { useStore } from '../stores/store'
import { backend } from '../bridge'
import { toHexDump, extractBody, isJsonLike, formatJson } from '../components/viewUtils'

function statusClass(code) {
  if (!code) return 'status-0'
  if (code < 300) return 'status-2xx'
  if (code < 400) return 'status-3xx'
  if (code < 500) return 'status-4xx'
  return 'status-5xx'
}

function methodClass(method) {
  const m = (method || '').toUpperCase()
  return ['GET','POST','PUT','DELETE','PATCH'].includes(m) ? `method-${m}` : 'method-other'
}

function toCurl(raw, host, https) {
  if (!raw) return ''
  const lines = raw.split('\n')
  const firstLine = (lines[0] || '').trim()
  const parts = firstLine.split(' ')
  const method = parts[0] || 'GET'
  const path = parts[1] || '/'
  const scheme = https ? 'https' : 'http'
  const urlHost = https ? host?.replace(/:443$/, '') : host?.replace(/:80$/, '')
  const url = `${scheme}://${urlHost}${path.startsWith('http') ? new URL(path).pathname : path}`
  let cmd = `curl -v -X ${method} '${url}'`
  for (const line of lines.slice(1)) {
    const t = line.trim()
    if (!t) break
    const ci = t.indexOf(':')
    if (ci === -1) continue
    const name = t.slice(0, ci).trim()
    const val = t.slice(ci + 1).trim()
    if (/^(host|content-length|transfer-encoding)$/i.test(name)) continue
    cmd += ` \\\n  -H '${name}: ${val}'`
  }
  const sep = raw.indexOf('\r\n\r\n')
  if (sep !== -1) {
    const body = raw.slice(sep + 4).trim()
    if (body) cmd += ` \\\n  --data '${body}'`
  }
  return cmd
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {})
}

// Horizontal drag-resize hook
function useDragH(initPx, min = 160, max = 700) {
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

// Vertical drag-resize hook (percentage)
function useDragV(initPct, min = 20, max = 80) {
  const [pct, setPct] = useState(initPct)
  const containerRef = useRef(null)
  const ref = useRef(pct)
  ref.current = pct
  const onMouseDown = (e) => {
    const startY = e.clientY; const startPct = ref.current; e.preventDefault()
    const onMove = (mv) => {
      if (!containerRef.current) return
      const h = containerRef.current.clientHeight; if (h === 0) return
      setPct(Math.max(min, Math.min(max, startPct + ((mv.clientY - startY) / h) * 100)))
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }
  return [pct, onMouseDown, containerRef]
}

// Small floating context menu — auto-flips near viewport edges
function CtxMenu({ menu, onClose, items }) {
  if (!menu) return null
  const MENU_W = 210
  const ITEM_H = 30
  const estH = items.filter(i => i !== 'sep').length * ITEM_H + items.filter(i => i === 'sep').length * 9 + 8
  const left = menu.x + MENU_W > window.innerWidth  ? Math.max(4, window.innerWidth  - MENU_W - 4) : menu.x
  const top  = menu.y + estH   > window.innerHeight ? Math.max(4, window.innerHeight - estH   - 4) : menu.y
  return (
    <div
      style={{
        position: 'fixed', top, left,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 4, zIndex: 300,
        minWidth: MENU_W, boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
      }}
      onClick={e => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={i} style={{ height: 1, background: 'var(--border-dim)', margin: '3px 4px' }} />
        ) : (
          <button
            key={i}
            onClick={() => { item.action(); onClose() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '7px 10px', background: 'none', color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer', textAlign: 'left',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            {item.icon && <span style={{ opacity: .65 }}>{item.icon}</span>}
            {item.label}
          </button>
        )
      )}
    </div>
  )
}

function GrepBar({ textareaRef, value }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [matchIdx, setMatchIdx] = useState(0)
  const [matches, setMatches] = useState([])
  const inputRef = useRef(null)

  const normalized = (value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  useEffect(() => {
    if (!query || !normalized) { setMatches([]); setMatchIdx(0); return }
    const results = []
    const lower = normalized.toLowerCase()
    const lq = query.toLowerCase()
    let i = 0
    while ((i = lower.indexOf(lq, i)) !== -1) { results.push(i); i += lq.length }
    setMatches(results)
    setMatchIdx(0)
  }, [query, value])

  const goTo = (idx) => {
    if (!matches.length || !textareaRef?.current) return
    const i = ((idx % matches.length) + matches.length) % matches.length
    setMatchIdx(i)
    const ta = textareaRef.current
    ta.focus()
    ta.setSelectionRange(matches[i], matches[i] + query.length)
  }

  useEffect(() => {
    if (!open || !textareaRef?.current) return
    const ta = textareaRef.current
    const handler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (!matches.length) return
        const cur = matchIdx % matches.length
        const next = e.shiftKey
          ? ((cur - 1 + matches.length) % matches.length)
          : ((cur + 1) % matches.length)
        setMatchIdx(next)
        ta.setSelectionRange(matches[next], matches[next] + query.length)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false); setQuery('')
      } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
        inputRef.current?.focus()
      }
    }
    ta.addEventListener('keydown', handler)
    return () => ta.removeEventListener('keydown', handler)
  }, [open, matches, matchIdx, query, textareaRef])

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }}
        style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
        title="Find in text (Ctrl+F)"
      >
        <Search size={11} />
      </button>
    )
  }

  const cur = matches.length ? matchIdx % matches.length : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); goTo(e.shiftKey ? cur - 1 : cur + 1) }
          if (e.key === 'Escape') { setOpen(false); setQuery('') }
        }}
        placeholder="Find…"
        style={{ width: 110, padding: '2px 6px', fontSize: 11 }}
      />
      {query.length > 0 && (
        <span style={{ fontSize: 10, color: matches.length ? 'var(--text-dim)' : 'var(--red)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {matches.length ? `${cur + 1}/${matches.length}` : 'no match'}
        </span>
      )}
      {matches.length > 1 && (
        <button onClick={() => goTo(cur + 1)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 10 }}>▼</button>
      )}
      <button onClick={() => { setOpen(false); setQuery('') }} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12 }}>✕</button>
    </div>
  )
}

export default function ProxyTab() {
  const {
    history, historySearch,
    addHistoryEntry, setSelectedEntry, setHistorySearch, clearHistory,
    interceptOn, interceptQueue,
    setInterceptOn, dequeueIntercept, clearInterceptQueue,
    interceptRespOn, interceptRespQueue,
    setInterceptRespOn, dequeueInterceptResp, clearInterceptRespQueue,
    scope, addScope, removeScope,
    sendToRepeater, sendToIntruder, sendToSQLMap,
  } = useStore()

  const [view, setView] = useState('intercept')
  const [interceptPane, setInterceptPane] = useState('request')
  const [interceptSel, setInterceptSel] = useState({ start: 0, end: 0 })
  const interceptTaRef = useRef(null)
  const interceptSelRef = useRef({ start: 0, end: 0, text: '' })
  const [selectedId, setSelectedId] = useState(null)
  const [scopeInput, setScopeInput] = useState('')
  const [editedRequest, setEditedRequest] = useState('')
  const [editedResponse, setEditedResponse] = useState('')
  const [contextMenu, setContextMenu] = useState(null)
  const [interceptCtx, setInterceptCtx] = useState(null)
  const [viewerCtx, setViewerCtx] = useState(null)    // for readonly history req/resp textareas
  const [hideAssets, setHideAssets] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [copyFlash, setCopyFlash] = useState('')
  const [respViewMode, setRespViewMode] = useState('raw') // 'raw' | 'hex' | 'render'

  const [leftPx, onLeftResize] = useDragH(340)
  const [reqPct, onReqResize, reqRespContainerRef] = useDragV(50)

  const reqViewRef = useRef(null)
  const respViewRef = useRef(null)

  const ASSET_MIMES = ['image/', 'font/', 'text/css', 'application/javascript', 'text/javascript']
  const isAsset = (e) => ASSET_MIMES.some(m => (e.mimeType || '').startsWith(m))

  const currentIntercepted = interceptQueue[0] ?? null

  useEffect(() => {
    if (currentIntercepted) {
      setEditedRequest(currentIntercepted.raw)
    } else {
      setEditedRequest('')
    }
  }, [currentIntercepted?.id])

  useEffect(() => {
    backend.getHistory('', 500, 0).then(entries => {
      entries?.forEach(addHistoryEntry)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setEditedResponse(interceptRespQueue[0]?.raw ?? '')
  }, [interceptRespQueue[0]?.id])

  useEffect(() => {
    if (interceptQueue.length > 0) { setView('intercept'); setInterceptPane('request') }
  }, [interceptQueue.length])

  useEffect(() => {
    if (interceptRespQueue.length > 0) { setView('intercept'); setInterceptPane('response') }
  }, [interceptRespQueue.length])

  useEffect(() => {
    const close = () => { setContextMenu(null); setInterceptCtx(null); setViewerCtx(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const flashCopy = (label) => {
    setCopyFlash(label)
    setTimeout(() => setCopyFlash(''), 1500)
  }

  const { selectedEntry: displayEntry } = useStore()

  useEffect(() => {
    if (reqViewRef.current) reqViewRef.current.scrollTop = 0
    if (respViewRef.current) respViewRef.current.scrollTop = 0
  }, [displayEntry?.id])

  const handleSelect = async (entry) => {
    setSelectedId(entry.id)
    setSelectedEntry(entry)
    const full = await backend.getEntry(entry.id).catch(() => null)
    if (full) setSelectedEntry(full)
  }

  const handleToggleIntercept = () => {
    const next = !interceptOn
    setInterceptOn(next)
    backend.setIntercept(next)
    if (!next) {
      clearInterceptQueue()
      clearInterceptRespQueue()
      setEditedRequest('')
      setEditedResponse('')
    }
  }

  const handleToggleInterceptResp = () => {
    const next = !interceptRespOn
    setInterceptRespOn(next)
    backend.setInterceptResponse(next)
    if (!next) { clearInterceptRespQueue(); setEditedResponse('') }
  }

  const handleForward = () => {
    if (!currentIntercepted) return
    backend.forwardRequest(currentIntercepted.id)
    dequeueIntercept()
  }

  const handleForwardEdited = () => {
    if (!currentIntercepted) return
    backend.modifyAndForward(currentIntercepted.id, editedRequest)
    dequeueIntercept()
  }

  const handleDrop = () => {
    if (!currentIntercepted) return
    backend.dropRequest(currentIntercepted.id)
    dequeueIntercept()
  }

  const handleForwardAll = () => {
    clearInterceptQueue()
    clearInterceptRespQueue()
    backend.forwardAllRequests()
    backend.forwardAllResponses()
  }

  const currentInterceptedResp = interceptRespQueue[0] ?? null

  const handleForwardResp = () => {
    if (!currentInterceptedResp) return
    backend.forwardResponse(currentInterceptedResp.id)
    dequeueInterceptResp()
  }

  const handleForwardEditedResp = () => {
    if (!currentInterceptedResp) return
    backend.modifyAndForwardResponse(currentInterceptedResp.id, editedResponse)
    dequeueInterceptResp()
  }

  const handleDropResp = () => {
    if (!currentInterceptedResp) return
    backend.dropResponse(currentInterceptedResp.id)
    dequeueInterceptResp()
  }

  const handleClear = () => {
    clearHistory()
    setSelectedId(null)
    backend.clearHistory()
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const entries = await backend.getHistory('', 500, 0)
      clearHistory()
      entries?.forEach(addHistoryEntry)
    } catch {}
    setRefreshing(false)
  }

  const handleAddScope = (e) => {
    e?.preventDefault()
    if (!scopeInput.trim()) return
    const next = [...scope, scopeInput.trim()]
    addScope(scopeInput.trim())
    backend.setScope(next)
    setScopeInput('')
  }

  const handleRemoveScope = (pattern) => {
    const next = scope.filter(p => p !== pattern)
    removeScope(pattern)
    backend.setScope(next)
  }

  // Encode / decode helpers
  const encB64  = (s) => { try { return btoa(unescape(encodeURIComponent(s))) } catch { return s } }
  const decB64  = (s) => { try { return decodeURIComponent(escape(atob(s))) } catch { return s } }
  const encURL  = (s) => encodeURIComponent(s)
  const decURL  = (s) => { try { return decodeURIComponent(s) } catch { return s } }
  const encHex  = (s) => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('')
  const decHex  = (s) => { try { return new TextDecoder().decode(new Uint8Array((s.match(/.{1,2}/g) || []).map(h => parseInt(h, 16)))) } catch { return s } }

  const captureInterceptSel = (ta) => {
    const start = ta.selectionStart || 0
    const end   = ta.selectionEnd   || 0
    const text  = ta.value.slice(start, end)
    interceptSelRef.current = { start, end, text }
    setInterceptSel({ start, end })
  }

  const applyEncodeToIntercept = (transform) => {
    const { start, end, text } = interceptSelRef.current
    if (!text) { flashCopy('Select text first'); return }
    const result = transform(text)
    const ta = interceptTaRef.current
    const base = ta ? ta.value : editedRequest
    setEditedRequest(base.slice(0, start) + result + base.slice(end))
    interceptSelRef.current = { start, end: start + result.length, text: result }
  }

  const handleInterceptContextMenu = (e) => {
    e.preventDefault()
    captureInterceptSel(e.target)
    setInterceptCtx({ x: e.clientX, y: e.clientY })
  }

  const handleViewerContextMenu = (e) => {
    e.preventDefault()
    const ta = e.target
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd)
    setViewerCtx({ x: e.clientX, y: e.clientY, ta, sel, allText: ta.value })
  }

  const makeInterceptCtxItems = (text, setter, isReq) => [
    { label: 'Cut',    icon: <Copy size={11} />, action: () => { const {start,end,text:sel}=interceptSelRef.current; if(!sel)return; navigator.clipboard.writeText(sel); const ta=interceptTaRef.current; const base=ta?ta.value:text; setter(base.slice(0,start)+base.slice(end)) } },
    { label: 'Copy',   icon: <Copy size={11} />, action: () => { const sel=interceptSelRef.current.text||text; navigator.clipboard.writeText(sel); flashCopy('Copied') } },
    { label: 'Paste',  icon: <Copy size={11} />, action: async () => { const clip=await navigator.clipboard.readText().catch(()=>''); if(!clip)return; const {start,end}=interceptSelRef.current; const ta=interceptTaRef.current; const base=ta?ta.value:text; setter(base.slice(0,start)+clip+base.slice(end)) } },
    { label: 'Select All', action: () => { const ta=interceptTaRef.current; if(ta){ta.select();captureInterceptSel(ta)} } },
    'sep',
    ...(isReq ? [
      { label: 'Send to Repeater', icon: <Send size={11} />, action: () => { const {addRepeaterTab,setActiveTab}=useStore.getState(); addRepeaterTab({request:text,host:currentIntercepted?.host,https:currentIntercepted?.https}); setActiveTab('repeater') } },
      { label: 'Send to Intruder', icon: <Target size={11} />, action: () => { const s=useStore.getState(); s.setIntruderRequest(text); s.setIntruderHost(currentIntercepted?.host); s.setIntruderHttps(currentIntercepted?.https); useStore.setState({activeTab:'intruder'}) } },
      { label: 'Send to SQLMap',   icon: <Terminal size={11} />, action: () => useStore.setState({activeTab:'sqlmap',sqlmapRequest:text}) },
      'sep',
    ] : []),
    { label: 'Copy as cURL', icon: <Copy size={11} />, action: () => { copyText(toCurl(text,currentIntercepted?.host,currentIntercepted?.https)); flashCopy('cURL') } },
    { label: 'Save as File',  icon: <Save size={11} />, action: () => backend.saveToFile(text).catch(()=>{}) },
    'sep',
    { label: 'Base64 Encode', action: () => applyEncodeToIntercept(encB64) },
    { label: 'Base64 Decode', action: () => applyEncodeToIntercept(decB64) },
    { label: 'URL Encode',    action: () => applyEncodeToIntercept(encURL) },
    { label: 'URL Decode',    action: () => applyEncodeToIntercept(decURL) },
    { label: 'Hex Encode',    action: () => applyEncodeToIntercept(encHex) },
    { label: 'Hex Decode',    action: () => applyEncodeToIntercept(decHex) },
  ]
  const interceptCtxItems = interceptPane === 'response'
    ? (currentInterceptedResp ? makeInterceptCtxItems(editedResponse, setEditedResponse, false) : [])
    : (currentIntercepted     ? makeInterceptCtxItems(editedRequest,  setEditedRequest,  true)  : [])

  const filtered = history.filter(e => {
    if (hideAssets && isAsset(e)) return false
    if (!historySearch) return true
    const q = historySearch.toLowerCase()
    return e.host?.toLowerCase().includes(q) ||
      e.url?.toLowerCase().includes(q) ||
      e.method?.toUpperCase() === historySearch.toUpperCase()
  })

  // Sub-tab strip
  const totalQueued = interceptQueue.length + interceptRespQueue.length
  const tabStrip = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 0,
      borderBottom: '1px solid var(--border-dim)',
      flexShrink: 0, background: 'var(--bg-surface)',
    }}>
      {['intercept', 'history'].map(v => (
        <button key={v} onClick={() => setView(v)} style={{
          padding: '8px 16px', fontSize: 12, fontWeight: 600,
          background: 'none', cursor: 'pointer',
          color: view === v ? 'var(--accent)' : 'var(--text-dim)',
          borderBottom: view === v ? '2px solid var(--accent)' : '2px solid transparent',
          textTransform: 'capitalize', letterSpacing: '.3px',
        }}>
          {v === 'intercept' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {(interceptOn || interceptRespOn) && totalQueued > 0 && (
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--red)', display: 'inline-block',
                  animation: 'pulse 1s ease-in-out infinite',
                }} />
              )}
              Intercept
              {totalQueued > 0 && (
                <span style={{
                  background: 'var(--red)', color: '#fff',
                  borderRadius: 10, fontSize: 9, fontWeight: 700,
                  padding: '1px 5px', lineHeight: 1.6,
                }}>{totalQueued}</span>
              )}
            </span>
          ) : 'HTTP History'}
        </button>
      ))}

      <button onClick={handleToggleIntercept} style={{
        display: 'flex', alignItems: 'center', gap: 5,
        marginLeft: 12, padding: '4px 10px',
        borderRadius: 'var(--radius-sm)', fontSize: 11,
        fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
        background: interceptOn ? 'rgba(248,113,113,0.12)' : 'var(--bg-raised)',
        border: `1px solid ${interceptOn ? 'rgba(248,113,113,0.5)' : 'var(--border)'}`,
        color: interceptOn ? 'var(--red)' : 'var(--text-secondary)',
      }}>
        <Shield size={11} />
        {interceptOn ? 'Intercept Req' : 'Intercept Req Off'}
      </button>

      <button onClick={handleToggleInterceptResp} style={{
        display: 'flex', alignItems: 'center', gap: 5,
        marginLeft: 6, padding: '4px 10px',
        borderRadius: 'var(--radius-sm)', fontSize: 11,
        fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
        background: interceptRespOn ? 'rgba(168,85,247,0.12)' : 'var(--bg-raised)',
        border: `1px solid ${interceptRespOn ? 'rgba(168,85,247,0.5)' : 'var(--border)'}`,
        color: interceptRespOn ? 'var(--purple, #a855f7)' : 'var(--text-secondary)',
      }}>
        <Shield size={11} />
        {interceptRespOn ? 'Intercept Resp' : 'Intercept Resp Off'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 10, flexWrap: 'nowrap', overflow: 'hidden' }}>
        {scope.map(p => (
          <span key={p} className="scope-tag" style={{ flexShrink: 0 }}>
            {p}<button onClick={() => handleRemoveScope(p)}>×</button>
          </span>
        ))}
      </div>

      <form onSubmit={handleAddScope} style={{ marginLeft: 'auto', display: 'flex', gap: 4, padding: '0 10px', flexShrink: 0 }}>
        <input
          placeholder="Add scope…"
          value={scopeInput}
          onChange={e => setScopeInput(e.target.value)}
          style={{ fontSize: 11, width: 140 }}
        />
        <button type="submit" className="btn btn-ghost btn-sm">+</button>
      </form>
    </div>
  )

  // INTERCEPT VIEW
  if (view === 'intercept') {
    const bothOff = !interceptOn && !interceptRespOn
    const hasQueued = currentIntercepted || currentInterceptedResp

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {tabStrip}

        {bothOff ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <Shield size={36} style={{ color: 'var(--text-dim)' }} />
            <p style={{ marginTop: 12 }}>Intercept is off</p>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '6px 0 16px' }}>
              Use the buttons above to intercept requests and/or responses.
            </p>
            <button className="btn btn-primary" onClick={handleToggleIntercept}>
              Turn On Intercept
            </button>
          </div>
        ) : !hasQueued ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: 'var(--red)', margin: '0 auto 16px',
              animation: 'pulse 1s ease-in-out infinite',
            }} />
            <p>Waiting for traffic…</p>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
              {interceptOn && interceptRespOn
                ? 'Both requests and responses will be caught.'
                : interceptOn
                  ? 'Requests will be caught before they are sent.'
                  : 'Responses will be caught before they reach the browser.'}
            </p>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Request / Response pane switcher */}
            <div style={{
              display: 'flex', gap: 0, flexShrink: 0,
              background: 'var(--bg-raised)', borderBottom: '1px solid var(--border-dim)',
              padding: '0 12px',
            }}>
              {currentIntercepted && (
                <button
                  onClick={() => setInterceptPane('request')}
                  style={{
                    padding: '6px 14px', fontSize: 11, fontWeight: 600, background: 'none', cursor: 'pointer',
                    color: interceptPane === 'request' ? 'var(--accent)' : 'var(--text-dim)',
                    borderBottom: interceptPane === 'request' ? '2px solid var(--accent)' : '2px solid transparent',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  Request
                  {interceptQueue.length > 1 && (
                    <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 10, fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>
                      +{interceptQueue.length - 1}
                    </span>
                  )}
                </button>
              )}
              {currentInterceptedResp && (
                <button
                  onClick={() => setInterceptPane('response')}
                  style={{
                    padding: '6px 14px', fontSize: 11, fontWeight: 600, background: 'none', cursor: 'pointer',
                    color: interceptPane === 'response' ? '#a855f7' : 'var(--text-dim)',
                    borderBottom: interceptPane === 'response' ? '2px solid #a855f7' : '2px solid transparent',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  Response
                  {interceptRespQueue.length > 1 && (
                    <span style={{ background: '#a855f7', color: '#fff', borderRadius: 10, fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>
                      +{interceptRespQueue.length - 1}
                    </span>
                  )}
                </button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                {copyFlash && (
                  <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✓ {copyFlash} copied</span>
                )}
                <button
                  onClick={handleForwardAll}
                  title="Forward all queued items — intercept stays ON"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 9px', borderRadius: 'var(--radius-sm)',
                    background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.35)',
                    color: 'var(--green)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <ChevronsRight size={11} /> Forward All
                </button>
              </div>
            </div>

            {/* Request pane */}
            {interceptPane === 'request' && currentIntercepted && (
              <>
                <div className="panel-header" style={{ gap: 8, flexShrink: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {currentIntercepted.https ? 'https' : 'http'}://{currentIntercepted.host}
                  </span>
                  {interceptQueue.length > 1 && (
                    <span style={{
                      background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.4)',
                      color: 'var(--red)', borderRadius: 4, fontSize: 10, fontWeight: 700,
                      padding: '2px 7px', flexShrink: 0,
                    }}>+{interceptQueue.length - 1} queued</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { copyText(editedRequest); flashCopy('Request') }} title="Copy raw request">
                      <Copy size={11} />
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => backend.saveToFile(editedRequest).catch(() => {})} title="Save as file">
                      <Save size={11} />
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={handleDrop} title="Block — browser gets 403">
                      <X size={11} /> Drop
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={handleForward} title="Send original, ignore edits">
                      <ArrowRight size={11} /> Forward
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={handleForwardEdited} title="Send with edits applied">
                      <ArrowRight size={11} /> Forward (edited)
                    </button>
                  </div>
                </div>
                <textarea
                  ref={interceptTaRef}
                  value={editedRequest}
                  onChange={e => setEditedRequest(e.target.value)}
                  onContextMenu={handleInterceptContextMenu}
                  onSelect={e => captureInterceptSel(e.target)}
                  onKeyUp={e => captureInterceptSel(e.target)}
                  onMouseUp={e => captureInterceptSel(e.target)}
                  spellCheck={false}
                  style={{
                    flex: 1, background: 'var(--bg-base)', border: 'none',
                    padding: '14px 18px', fontFamily: 'var(--font-mono)',
                    fontSize: 12, color: 'var(--text-primary)',
                    resize: 'none', outline: 'none', width: '100%',
                  }}
                />
                {/* Selection / char-count status bar */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
                  padding: '3px 14px', background: 'var(--bg-raised)',
                  borderTop: '1px solid var(--border-dim)', fontSize: 10,
                  color: interceptSel.end > interceptSel.start ? 'var(--accent)' : 'var(--text-dim)',
                }}>
                  {interceptSel.end > interceptSel.start
                    ? <>
                        <span>{interceptSel.end - interceptSel.start} chars selected</span>
                        <span style={{ color: 'var(--text-dim)' }}>·</span>
                        <span style={{ color: 'var(--text-dim)' }}>right-click to encode/decode selection</span>
                      </>
                    : <span>{editedRequest.length} chars total</span>
                  }
                  {copyFlash && <span style={{ marginLeft: 'auto', color: copyFlash.includes('Select') ? 'var(--yellow)' : 'var(--green)', fontWeight: 600 }}>{copyFlash}</span>}
                </div>
              </>
            )}

            {/* Response pane */}
            {interceptPane === 'response' && currentInterceptedResp && (
              <>
                <div className="panel-header" style={{ gap: 8, flexShrink: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Response {currentInterceptedResp.status ? `· ${currentInterceptedResp.status}` : ''}
                    {currentInterceptedResp.host ? ` · ${currentInterceptedResp.host}` : ''}
                  </span>
                  {interceptRespQueue.length > 1 && (
                    <span style={{
                      background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)',
                      color: '#a855f7', borderRadius: 4, fontSize: 10, fontWeight: 700,
                      padding: '2px 7px', flexShrink: 0,
                    }}>+{interceptRespQueue.length - 1} queued</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { copyText(editedResponse); flashCopy('Response') }} title="Copy raw response">
                      <Copy size={11} />
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={handleDropResp} title="Drop — browser gets nothing">
                      <X size={11} /> Drop
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={handleForwardResp} title="Send original response">
                      <ArrowRight size={11} /> Forward
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={handleForwardEditedResp} title="Send with edits applied">
                      <ArrowRight size={11} /> Forward (edited)
                    </button>
                  </div>
                </div>
                <textarea
                  value={editedResponse}
                  onChange={e => setEditedResponse(e.target.value)}
                  onContextMenu={handleInterceptContextMenu}
                  onSelect={e => captureInterceptSel(e.target)}
                  onKeyUp={e => captureInterceptSel(e.target)}
                  onMouseUp={e => captureInterceptSel(e.target)}
                  spellCheck={false}
                  style={{
                    flex: 1, background: 'var(--bg-base)', border: 'none',
                    padding: '14px 18px', fontFamily: 'var(--font-mono)',
                    fontSize: 12, color: 'var(--text-primary)',
                    resize: 'none', outline: 'none', width: '100%',
                  }}
                />
              </>
            )}
          </div>
        )}

        {/* Intercept right-click context menu */}
        <CtxMenu
          menu={interceptCtx}
          onClose={() => setInterceptCtx(null)}
          items={interceptCtxItems}
        />

        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    )
  }

  // HTTP HISTORY VIEW
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {tabStrip}

      <div className="panel" style={{ flex: 1, overflow: 'hidden' }}>
        {/* LEFT: history list — resizable width */}
        <div className="panel-left" style={{ width: leftPx, borderRight: 'none' }}>
          <div className="panel-header">
            <span className="panel-header-title">HTTP History</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => setHideAssets(v => !v)}
                style={{
                  padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11,
                  fontWeight: 500, cursor: 'pointer',
                  background: hideAssets ? 'var(--accent-dim)' : 'var(--bg-raised)',
                  border: `1px solid ${hideAssets ? 'var(--accent)' : 'var(--border)'}`,
                  color: hideAssets ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {hideAssets ? 'Hiding assets' : 'Show all'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleRefresh} disabled={refreshing} title="Reload from DB">
                <RefreshCw size={11} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleClear} title="Clear history">
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          <div className="search-bar">
            <Search size={13} style={{ color: 'var(--text-dim)', flexShrink: 0, alignSelf: 'center' }} />
            <input
              placeholder="Filter host, URL or method…"
              value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
            />
          </div>

          <div className="history-list">
            {filtered.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}>
                <Shield size={32} />
                <p>No requests yet</p>
                <p style={{ fontSize: 11, marginTop: 4 }}>Proxy your browser through 127.0.0.1:8080 and browse.</p>
              </div>
            ) : filtered.map(entry => {
              const isSel = entry.id === selectedId
              return (
                <div
                  key={entry.id}
                  onClick={() => handleSelect(entry)}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, entry }) }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 56px 1fr 52px 60px',
                    alignItems: 'center', gap: 8,
                    padding: '7px 14px',
                    paddingLeft: isSel ? 12 : 14,
                    borderBottom: '1px solid var(--border-dim)',
                    borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent',
                    background: isSel ? 'var(--bg-active)' : 'transparent',
                    cursor: 'pointer', transition: 'background 0.1s', userSelect: 'none',
                  }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
                >
                  <span className={`method ${methodClass(entry.method)}`}>{entry.method}</span>
                  <span className={`status ${statusClass(entry.statusCode)}`}>{entry.statusCode || '—'}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }} title={entry.url}>
                    {entry.host}{entry.url?.replace(/^https?:\/\/[^/]+/, '') || '/'}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                    {entry.responseLength > 0 ? `${(entry.responseLength / 1024).toFixed(1)}k` : '—'}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                    {entry.durationMs}ms
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Horizontal resize handle between list and viewer */}
        <div className="resize-handle-h" onMouseDown={onLeftResize} />

        {/* RIGHT: request/response viewer */}
        <div className="panel-main">
          {displayEntry ? (
            <>
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span className={`method ${methodClass(displayEntry.method)}`}>{displayEntry.method}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{displayEntry.url}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => sendToRepeater(displayEntry)} title="Send to Repeater">
                    <Send size={11} /> Repeater
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => sendToIntruder(displayEntry)} title="Send to Intruder">
                    <Target size={11} /> Intruder
                  </button>
                </div>
              </div>

              {/* Vertically resizable req/resp split */}
              <div ref={reqRespContainerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* Request pane */}
                <div style={{ height: `${reqPct}%`, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: 'none' }}>
                  <div className="pane-header">
                    Request
                    <GrepBar textareaRef={reqViewRef} value={displayEntry.requestHeaders || ''} />
                    <button
                      onClick={() => { copyText(displayEntry.requestHeaders); flashCopy('Request') }}
                      title="Copy request"
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      onClick={() => backend.saveToFile(displayEntry.requestHeaders || '').catch(() => {})}
                      title="Save request as file"
                      style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
                    >
                      <Save size={11} />
                    </button>
                  </div>
                  <textarea ref={reqViewRef} readOnly className="code-view" value={displayEntry.requestHeaders || ''} onContextMenu={handleViewerContextMenu} />
                </div>

                {/* Vertical resize handle */}
                <div className="resize-handle-v" onMouseDown={onReqResize} />

                {/* Response pane */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div className="pane-header">
                    Response
                    {displayEntry.statusCode && (
                      <span className={`status ${statusClass(displayEntry.statusCode)}`}>{displayEntry.statusCode}</span>
                    )}
                    {respViewMode === 'raw' && <GrepBar textareaRef={respViewRef} value={(displayEntry.responseHeaders || '') + '\n' + (displayEntry.responseBody || '')} />}
                    {/* View mode buttons */}
                    <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
                      {['raw', 'hex', 'render'].map(m => (
                        <button key={m} onClick={() => setRespViewMode(m)}
                          style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase',
                            background: respViewMode === m ? 'var(--accent)' : 'var(--bg-hover)',
                            color: respViewMode === m ? '#fff' : 'var(--text-dim)',
                            border: `1px solid ${respViewMode === m ? 'var(--accent)' : 'var(--border-dim)'}` }}>
                          {m}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => { copyText(displayEntry.responseHeaders + '\n' + displayEntry.responseBody); flashCopy('Response') }}
                      title="Copy response"
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      onClick={() => backend.saveToFile((displayEntry.responseHeaders || '') + '\n' + (displayEntry.responseBody || '')).catch(() => {})}
                      title="Save response as file"
                      style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
                    >
                      <Save size={11} />
                    </button>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginLeft: 6 }}>
                      {displayEntry.durationMs}ms · {displayEntry.mimeType}
                    </span>
                  </div>
                  {(() => {
                    const rawResp = (displayEntry.responseHeaders || '') + '\n' + (displayEntry.responseBody || '')
                    const body = displayEntry.responseBody || ''
                    const ct = (displayEntry.mimeType || '').toLowerCase()
                    if (respViewMode === 'hex') {
                      return <textarea ref={respViewRef} readOnly className="code-view" value={toHexDump(rawResp)} onContextMenu={handleViewerContextMenu} />
                    }
                    if (respViewMode === 'render') {
                      if (ct.includes('html')) {
                        return <iframe sandbox="allow-scripts" srcDoc={body} style={{ flex: 1, border: 'none', background: '#fff', width: '100%', height: '100%' }} title="Response render" />
                      }
                      const formatted = isJsonLike(ct, body) ? formatJson(body) : body
                      return <textarea ref={respViewRef} readOnly className="code-view" value={formatted} onContextMenu={handleViewerContextMenu} />
                    }
                    return <textarea ref={respViewRef} readOnly className="code-view" value={rawResp} onContextMenu={handleViewerContextMenu} />
                  })()}
                </div>
              </div>

              {copyFlash && (
                <div style={{
                  position: 'absolute', bottom: 16, right: 16,
                  background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.4)',
                  color: 'var(--green)', borderRadius: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600,
                }}>✓ {copyFlash} copied</div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <ArrowRight size={32} />
              <p>Select a request to inspect</p>
            </div>
          )}
        </div>
      </div>

      {/* History list right-click context menu */}
      {contextMenu && (
        <CtxMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Send to Repeater', icon: <Send size={11} />, action: () => sendToRepeater(contextMenu.entry) },
            { label: 'Send to Intruder', icon: <Target size={11} />, action: () => sendToIntruder(contextMenu.entry) },
            { label: 'Send to SQLMap', icon: <Terminal size={11} />, action: () => sendToSQLMap(contextMenu.entry) },
            'sep',
            { label: 'Copy URL', icon: <Copy size={11} />, action: () => copyText(contextMenu.entry.url) },
            {
              label: 'Copy as cURL', icon: <Copy size={11} />,
              action: () => copyText(toCurl(contextMenu.entry.requestHeaders, contextMenu.entry.host, contextMenu.entry.url?.startsWith('https')))
            },
            { label: 'Copy Request', icon: <Copy size={11} />, action: () => copyText(contextMenu.entry.requestHeaders) },
            { label: 'Save Request as File', icon: <Save size={11} />, action: () => backend.saveToFile(contextMenu.entry.requestHeaders || '').catch(() => {}) },
          ]}
        />
      )}

      {/* Viewer (readonly) right-click context menu */}
      {viewerCtx && (
        <CtxMenu
          menu={viewerCtx}
          onClose={() => setViewerCtx(null)}
          items={[
            { label: 'Copy Selection', icon: <Copy size={11} />, action: () => { if(viewerCtx.sel) navigator.clipboard.writeText(viewerCtx.sel) } },
            { label: 'Copy All',       icon: <Copy size={11} />, action: () => navigator.clipboard.writeText(viewerCtx.allText) },
            { label: 'Select All',     action: () => viewerCtx.ta?.select() },
            'sep',
            { label: 'Save as File',   icon: <Save size={11} />, action: () => backend.saveToFile(viewerCtx.allText).catch(() => {}) },
          ]}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Send, RefreshCw, Plus, X, Copy, Save, Search } from 'lucide-react'
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

// Horizontal drag-resize
function useDragH(initPx, min = 200, max = 1000) {
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
        const next = e.shiftKey ? ((cur - 1 + matches.length) % matches.length) : ((cur + 1) % matches.length)
        setMatchIdx(next)
        ta.setSelectionRange(matches[next], matches[next] + query.length)
      } else if (e.key === 'Escape') {
        e.preventDefault(); setOpen(false); setQuery('')
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
        title="Find in text"
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

function useEncoderMenu(getVal, setVal) {
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
    { label: 'Cut',       action: () => { const {start,end,text}=selRef.current; if(!text)return; navigator.clipboard.writeText(text); const ta=taRef.current; const base=ta?ta.value:(getVal?getVal():''); setVal(base.slice(0,start)+base.slice(end)) } },
    { label: 'Copy',      action: () => navigator.clipboard.writeText(selRef.current.text || (taRef.current?.value ?? '')) },
    { label: 'Paste',     action: async () => { const clip=await navigator.clipboard.readText().catch(()=>''); if(!clip)return; const {start,end}=selRef.current; const ta=taRef.current; const base=ta?ta.value:(getVal?getVal():''); setVal(base.slice(0,start)+clip+base.slice(end)) } },
    { label: 'Select All',action: () => { const ta=taRef.current; if(ta){ta.select();capture(ta)} } },
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

export default function RepeaterTab() {
  const {
    repeaterTabs, activeRepeaterTab,
    setActiveRepeaterTab, addRepeaterTab, closeRepeaterTab, updateRepeaterTab,
  } = useStore()

  const [loadingId, setLoadingId] = useState(null)
  const [followRedirects, setFollowRedirects] = useState(false)
  const [copyFlash, setCopyFlash] = useState('')
  const [leftPx, onLeftResize] = useDragH(Math.round(window.innerWidth * 0.45), 200, 1000)
  const [viewMode, setViewMode] = useState('raw') // 'raw' | 'hex' | 'render'

  const tab = repeaterTabs.find(t => t.id === activeRepeaterTab) || repeaterTabs[0]
  const respRef = useRef(null)

  const getCurrentRequest = () => tab?.request ?? ''
  const setCurrentRequest = (v) => updateRepeaterTab(tab.id, { request: v })

  const { taRef: reqTaRef, onContextMenu: reqCtxMenu, MenuEl: ReqMenuEl } =
    useEncoderMenu(getCurrentRequest, setCurrentRequest)

  const flashCopy = (label) => { setCopyFlash(label); setTimeout(() => setCopyFlash(''), 1500) }

  const [viewerCtx, setViewerCtx] = useState(null)
  const handleViewerCtx = (e) => {
    e.preventDefault()
    const ta = e.target
    setViewerCtx({ x: e.clientX, y: e.clientY, ta, sel: ta.value.slice(ta.selectionStart, ta.selectionEnd), allText: ta.value })
  }
  useEffect(() => {
    const close = () => setViewerCtx(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    if (respRef.current) respRef.current.scrollTop = 0
  }, [tab?.response])

  const handleSend = async () => {
    if (!tab.request.trim() || !tab.host.trim()) return
    setLoadingId(tab.id)
    try {
      const resp = await backend.sendRepeaterRequest({ raw: tab.request, host: tab.host, useHttps: tab.https, followRedirects })
      updateRepeaterTab(tab.id, { response: resp })
    } catch (err) {
      updateRepeaterTab(tab.id, { response: { error: String(err) } })
    } finally {
      setLoadingId(null)
    }
  }

  const loading = loadingId === tab.id
  const resp = tab.response
  const rawRespText = resp ? (resp.error ? `Error: ${resp.error}` : (resp.raw || '')) : ''
  const { body: respBody, contentType: respCT } = extractBody(rawRespText)
  const respText = (() => {
    if (!resp || resp.error) return rawRespText
    if (viewMode === 'hex') return toHexDump(rawRespText)
    if (viewMode === 'render') return isJsonLike(respCT, respBody) ? formatJson(respBody) : respBody
    return rawRespText
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 10px', borderBottom: '1px solid var(--border-dim)', overflowX: 'auto', flexShrink: 0 }}>
        {repeaterTabs.map(t => (
          <div key={t.id} onClick={() => setActiveRepeaterTab(t.id)} className={`tab-btn ${t.id === activeRepeaterTab ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {t.name}
            {repeaterTabs.length > 1 && (
              <X size={11} onClick={(e) => { e.stopPropagation(); closeRepeaterTab(t.id) }}
                style={{ opacity: 0.5 }} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0.5} />
            )}
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={() => addRepeaterTab()} style={{ marginLeft: 4 }} title="New tab">
          <Plus size={12} />
        </button>
      </div>

      {/* Toolbar */}
      <div className="panel-header" style={{ gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label className="toggle" title="HTTPS">
            <input type="checkbox" checked={tab.https} onChange={e => updateRepeaterTab(tab.id, { https: e.target.checked })} />
            <span className="toggle-track" />
          </label>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>HTTPS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label className="toggle" title="Follow 3xx redirects automatically">
            <input type="checkbox" checked={followRedirects} onChange={e => setFollowRedirects(e.target.checked)} />
            <span className="toggle-track" />
          </label>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Follow Redirects</span>
        </div>
        <input value={tab.host} onChange={e => updateRepeaterTab(tab.id, { host: e.target.value })}
          placeholder="host (e.g. localhost:9090)" style={{ width: 220, fontSize: 12 }} />
        <button className="btn btn-primary" onClick={handleSend} disabled={loading} style={{ marginLeft: 4 }}>
          {loading ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={12} />}
          Send
        </button>
        {resp && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {resp.statusCode && <span className={`status ${statusClass(resp.statusCode)}`}>{resp.statusCode}</span>}
            {resp.durationMs != null && <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{resp.durationMs}ms</span>}
          </div>
        )}
      </div>

      {/* Request / Response split — horizontal resizable */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Request pane */}
        <div className="repeater-pane" style={{ width: leftPx, flexShrink: 0, borderRight: 'none' }}>
          <div className="pane-header">
            Request
            <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 4 }}>right-click to encode/decode</span>
            <button onClick={() => { navigator.clipboard.writeText(tab.request); flashCopy('Request') }} title="Copy request"
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}>
              <Copy size={11} />
            </button>
            <button onClick={() => backend.saveToFile(tab.request).catch(() => {})} title="Save request as file"
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}>
              <Save size={11} />
            </button>
          </div>
          <div className="repeater-editor" style={{ flex: 1, overflow: 'hidden' }}>
            <textarea
              ref={reqTaRef}
              className="code-view"
              value={tab.request}
              onChange={e => updateRepeaterTab(tab.id, { request: e.target.value })}
              onContextMenu={reqCtxMenu}
              placeholder={"GET /path HTTP/1.1\r\nHost: localhost:9090\r\nUser-Agent: Harness/1.0\r\n\r\n"}
              style={{ width: '100%', height: '100%', resize: 'none', background: 'transparent', border: 'none', padding: '14px 16px', outline: 'none', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7 }}
              spellCheck={false}
            />
          </div>
        </div>

        {/* Horizontal resize handle */}
        <div className="resize-handle-h" onMouseDown={onLeftResize} />

        {/* Response pane */}
        <div className="repeater-pane" style={{ flex: 1, borderRight: 'none' }}>
          <div className="pane-header">
            Response
            {resp && !resp.error && (
              <>
                {viewMode === 'raw' && <GrepBar textareaRef={respRef} value={respText} />}
                {/* View mode buttons */}
                <div style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
                  {['raw', 'hex', 'render'].map(m => (
                    <button key={m} onClick={() => setViewMode(m)}
                      style={{ padding: '1px 7px', borderRadius: 3, fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase',
                        background: viewMode === m ? 'var(--accent)' : 'var(--bg-hover)',
                        color: viewMode === m ? '#fff' : 'var(--text-dim)',
                        border: `1px solid ${viewMode === m ? 'var(--accent)' : 'var(--border-dim)'}` }}>
                      {m}
                    </button>
                  ))}
                </div>
                <button onClick={() => { navigator.clipboard.writeText(resp.raw || ''); flashCopy('Response') }} title="Copy response"
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}>
                  <Copy size={11} />
                </button>
                <button onClick={() => backend.saveToFile(resp.raw || '').catch(() => {})} title="Save response as file"
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}>
                  <Save size={11} />
                </button>
              </>
            )}
            {copyFlash && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✓ {copyFlash} copied</span>}
          </div>
          {resp ? (
            viewMode === 'render' && respCT.includes('html') ? (
              <iframe
                sandbox="allow-scripts"
                srcDoc={respBody}
                style={{ flex: 1, border: 'none', background: '#fff', width: '100%', height: '100%' }}
                title="Response render"
              />
            ) : (
              <textarea ref={respRef} readOnly className="code-view" value={respText} onContextMenu={handleViewerCtx} />
            )
          ) : (
            <div className="empty-state">
              <Send size={28} />
              <p>Hit Send to fire the request</p>
              {!tab.https && <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>Getting 301? Enable HTTPS or turn on Follow Redirects.</p>}
            </div>
          )}
        </div>
      </div>

      {ReqMenuEl}
      {viewerCtx && (() => {
        const MENU_W = 180
        const items = [
          { label: 'Copy Selection', action: () => { if(viewerCtx.sel) navigator.clipboard.writeText(viewerCtx.sel) } },
          { label: 'Copy All',       action: () => navigator.clipboard.writeText(viewerCtx.allText) },
          { label: 'Select All',     action: () => viewerCtx.ta?.select() },
          'sep',
          { label: 'Save as File',   action: () => backend.saveToFile(viewerCtx.allText).catch(()=>{}) },
        ]
        const estH = items.filter(i=>i!=='sep').length*30+9+8
        const left = viewerCtx.x+MENU_W>window.innerWidth ? Math.max(4,window.innerWidth-MENU_W-4) : viewerCtx.x
        const top  = viewerCtx.y+estH>window.innerHeight ? Math.max(4,window.innerHeight-estH-4) : viewerCtx.y
        return (
          <div style={{position:'fixed',top,left,zIndex:300,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:4,minWidth:MENU_W,boxShadow:'0 8px 24px rgba(0,0,0,0.55)'}} onClick={e=>e.stopPropagation()}>
            {items.map((item,i) => item==='sep'
              ? <div key={i} style={{height:1,background:'var(--border-dim)',margin:'3px 4px'}}/>
              : <button key={i} onClick={()=>{item.action();setViewerCtx(null)}} style={{display:'flex',width:'100%',padding:'7px 10px',background:'none',color:'var(--text-secondary)',borderRadius:'var(--radius-sm)',fontSize:12,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>{item.label}</button>
            )}
          </div>
        )
      })()}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

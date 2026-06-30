import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { Network, Play, Square, Trash2, List, GitBranch, Upload, ChevronDown } from 'lucide-react'
import { useStore } from '../stores/store'
import { backend } from '../bridge'

function nodeToRequest(nodeUrl) {
  try {
    const u = new URL(nodeUrl)
    const host = u.host
    const path = u.pathname + (u.search || '') || '/'
    const https = u.protocol === 'https:'
    const raw = `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\n\r\n`
    return { raw, host, https }
  } catch {
    return { raw: `GET / HTTP/1.1\r\nHost: unknown\r\n\r\n`, host: 'unknown', https: false }
  }
}

function statusColor(code) {
  if (!code) return '#55556a'
  if (code < 300) return '#4ade80'
  if (code < 400) return '#60a5fa'
  if (code < 500) return '#facc15'
  return '#f87171'
}

export default function CrawlerTab() {
  const { crawlNodes, addCrawlNode, clearCrawlNodesStore, crawlRunning, setCrawlRunning } = useStore()
  const [seedURL, setSeedURL] = useState('')
  const [maxDepth, setMaxDepth] = useState(3)
  const [selected, setSelected] = useState(null)
  const [viewMode, setViewMode] = useState('list') // 'list' | 'graph'
  const [showWordlist, setShowWordlist] = useState(false)
  const [wordlistText, setWordlistText] = useState('')
  const svgRef = useRef(null)
  const listRef = useRef(null)
  const prevRunning = useRef(false)

  useEffect(() => {
    backend.getCrawlNodes().then(nodes => {
      if (nodes?.length) {
        clearCrawlNodesStore(nodes)
        setViewMode('graph')
      }
    }).catch(() => {})

  }, [])

  useEffect(() => {
    if (crawlRunning) {
      setViewMode('list')
      prevRunning.current = true
    }
  }, [crawlRunning])

  useEffect(() => {
    if (viewMode === 'list' && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [crawlNodes.length, viewMode])

  const buildGraph = useCallback(() => {
    if (!svgRef.current) return
    const nodes = useStore.getState().crawlNodes
    if (nodes.length === 0) return

    const container = svgRef.current.parentElement
    const W = container.clientWidth || 800
    const H = container.clientHeight || 500

    const svg = d3.select(svgRef.current)
    svg.attr('width', W).attr('height', H)
    svg.selectAll('*').remove()

    const g = svg.append('g')
    svg.call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => {
      g.attr('transform', e.transform)
    }))

    const nodeMap = new Map(nodes.map(n => [n.id, { ...n }]))
    const simNodes = [...nodeMap.values()]
    const links = simNodes
      .filter(n => n.parentId != null)
      .map(n => ({ source: n.parentId, target: n.id }))
      .filter(l => nodeMap.has(l.source))

    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(24))

    const link = g.append('g')
      .selectAll('line').data(links).join('line')
      .attr('stroke', '#2a2a35').attr('stroke-width', 1.5)

    const node = g.append('g')
      .selectAll('g').data(simNodes).join('g')
      .attr('cursor', 'pointer')
      .on('click', (e, d) => { e.stopPropagation(); setSelected(d) })
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
        .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null })
      )

    node.append('circle')
      .attr('r', 10)
      .attr('fill', d => statusColor(d.statusCode))
      .attr('fill-opacity', 0.85)
      .attr('stroke', '#0d0d0f')
      .attr('stroke-width', 2)

    node.append('text')
      .attr('dy', 22).attr('text-anchor', 'middle')
      .attr('font-size', 9).attr('fill', '#8888a0')
      .text(d => {
        try {
          const u = new URL(d.url)
          const p = u.pathname.length > 22 ? u.pathname.slice(0, 20) + '…' : u.pathname
          return p || '/'
        } catch { return d.url.slice(0, 20) }
      })

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    svg.on('click', () => setSelected(null))
  }, []) // ← intentionally no deps; pulls fresh nodes from store at call time

  useEffect(() => {
    if (viewMode !== 'graph') return
    const t = setTimeout(buildGraph, 100) // let DOM settle before measuring dimensions
    return () => clearTimeout(t)
  }, [viewMode]) // ← does NOT depend on crawlNodes; fires only on tab switch

  useEffect(() => {
    if (!crawlRunning && prevRunning.current) {
      prevRunning.current = false
      if (useStore.getState().crawlNodes.length > 0) {
        setTimeout(() => setViewMode('graph'), 300) // wait for last batch before rendering
      }
    }
  }, [crawlRunning])

  const handleLoadWordlist = async () => {
    const lines = await backend.loadPayloadFile().catch(() => [])
    if (lines?.length > 0) setWordlistText(lines.join('\n'))
  }

  const handleStart = async () => {
    if (!seedURL.trim()) return
    setCrawlRunning(true)
    clearCrawlNodesStore([])
    setSelected(null)
    setViewMode('list')
    const extraPaths = wordlistText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
    try {
      if (extraPaths.length > 0) {
        await backend.startCrawlWithPaths(seedURL, Number(maxDepth) || 3, extraPaths)
      } else {
        await backend.startCrawl(seedURL, Number(maxDepth) || 3)
      }
    } catch (e) {
      console.error('crawl error', e)
      setCrawlRunning(false)
    }
  }

  const handleStop = async () => {
    await backend.stopCrawl()
    setCrawlRunning(false)
  }

  const handleClear = async () => {
    await backend.clearCrawlNodes()
    clearCrawlNodesStore([])
    setCrawlRunning(false)
    setSelected(null)
    setViewMode('list')
    if (svgRef.current) d3.select(svgRef.current).selectAll('*').remove()
  }

  // Right-click context menu for list rows
  const [ctxMenu, setCtxMenu] = useState(null)
  useEffect(() => {
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const copyToClipboard = (text) => navigator.clipboard.writeText(text).catch(() => {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 0,
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-dim)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        <span className="panel-header-title">Seed URL</span>
        <input
          value={seedURL}
          onChange={e => setSeedURL(e.target.value)}
          placeholder="http://localhost:9090"
          style={{ width: 280, fontSize: 12 }}
          onKeyDown={e => e.key === 'Enter' && !crawlRunning && handleStart()}
        />
        <span className="panel-header-title" style={{ marginLeft: 8 }}>Max Depth</span>
        <input
          type="number" min={1} max={10}
          value={maxDepth}
          onChange={e => setMaxDepth(e.target.value)}
          style={{ width: 60 }}
        />
        {/* Wordlist toggle */}
        <button
          onClick={() => setShowWordlist(v => !v)}
          className="btn btn-ghost btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: wordlistText ? 'var(--accent)' : undefined }}
          title="Path wordlist for directory fuzzing"
        >
          <Upload size={11} /> Wordlist{wordlistText ? ` (${wordlistText.split('\n').filter(l=>l.trim()&&!l.startsWith('#')).length})` : ''} <ChevronDown size={10} />
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {crawlNodes.length > 0 && (
            <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              {[['list', <List size={11} />, 'URLs'], ['graph', <GitBranch size={11} />, 'Map']].map(([m, icon, label]) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    background: viewMode === m ? 'var(--accent)' : 'var(--bg-raised)',
                    color: viewMode === m ? '#fff' : 'var(--text-secondary)',
                    border: 'none',
                  }}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          )}
          {crawlRunning ? (
            <button className="btn btn-danger" onClick={handleStop}><Square size={12} /> Stop</button>
          ) : (
            <button className="btn btn-primary" onClick={handleStart}><Play size={12} /> Crawl</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleClear}><Trash2 size={11} /></button>
        </div>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {crawlNodes.length} nodes{crawlRunning ? ' — crawling…' : ''}
          </span>
        </div>

        {/* Wordlist panel */}
        {showWordlist && (
          <div style={{ padding: '8px 14px 10px', borderTop: '1px solid var(--border-dim)', background: 'var(--bg-base)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>PATH WORDLIST</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>One path per line — probed against the seed host alongside the crawl (404s are silently dropped)</span>
              <button className="btn btn-ghost btn-sm" onClick={handleLoadWordlist} style={{ marginLeft: 'auto' }}>
                <Upload size={10} /> Load file
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setWordlistText('')} style={{ color: 'var(--red)' }}>Clear</button>
            </div>
            <textarea
              value={wordlistText}
              onChange={e => setWordlistText(e.target.value)}
              placeholder={'/admin\n/login\n/api/v1\n/config\n/.env\n/backup\n/phpmyadmin'}
              spellCheck={false}
              style={{
                width: '100%', height: 80, resize: 'vertical',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', padding: '6px 10px',
                fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6, outline: 'none',
              }}
            />
          </div>
        )}
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── LIST VIEW ── */}
        {viewMode === 'list' && (
          <div ref={listRef} style={{ flex: 1, overflow: 'auto', background: 'var(--bg-base)' }}>
            {crawlNodes.length === 0 ? (
              <div className="empty-state" style={{ paddingTop: 80 }}>
                <Network size={40} />
                <p>Enter a seed URL and click Crawl</p>
                <p style={{ fontSize: 11 }}>Discovered URLs appear here live. The map builds when done.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 1 }}>
                    {['#', 'Status', 'Method', 'URL', 'Depth'].map(h => (
                      <th key={h} style={{
                        padding: '6px 10px', textAlign: 'left', fontWeight: 600,
                        fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase',
                        letterSpacing: '.5px', borderBottom: '1px solid var(--border-dim)',
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crawlNodes.map((n, i) => (
                    <tr
                      key={n.id}
                      onClick={() => setSelected(n)}
                      onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, node: n }) }}
                      style={{
                        borderBottom: '1px solid var(--border-dim)',
                        background: selected?.id === n.id ? 'var(--bg-active)' : 'transparent',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => { if (selected?.id !== n.id) e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { if (selected?.id !== n.id) e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ padding: '5px 10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                      <td style={{ padding: '5px 10px' }}>
                        <span style={{ color: statusColor(n.statusCode), fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {n.statusCode || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '5px 10px', color: 'var(--text-secondary)' }}>{n.method}</td>
                      <td style={{
                        padding: '5px 10px', fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)', maxWidth: 0, width: '100%',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }} title={n.url}>{n.url}</td>
                      <td style={{ padding: '5px 10px', color: 'var(--text-dim)', textAlign: 'center' }}>{n.depth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── GRAPH VIEW ── */}
        {viewMode === 'graph' && (
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg-base)' }}>
            {crawlNodes.length === 0 ? (
              <div className="empty-state" style={{ paddingTop: 80 }}>
                <Network size={40} />
                <p>No nodes to display</p>
              </div>
            ) : (
              <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
            )}
            {crawlNodes.length > 0 && (
              <div style={{
                position: 'absolute', bottom: 12, left: 12,
                background: 'rgba(13,13,15,0.85)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', padding: '6px 10px',
                display: 'flex', gap: 10, fontSize: 10, color: 'var(--text-secondary)',
              }}>
                {[['2xx','#4ade80'], ['3xx','#60a5fa'], ['4xx','#facc15'], ['5xx','#f87171']].map(([label, color]) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Selected node detail */}
        {selected && (
          <div style={{
            width: 280, borderLeft: '1px solid var(--border-dim)',
            background: 'var(--bg-surface)', padding: 14, overflow: 'auto',
            display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
            animation: 'slideInRight 0.18s ease',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="panel-header-title">Node Detail</span>
              <button onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: 'var(--text-dim)' }}>URL</span><br />
                <span style={{ color: 'var(--text-primary)' }}>{selected.url}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div><span style={{ color: 'var(--text-dim)' }}>Method</span><br />{selected.method}</div>
                <div><span style={{ color: 'var(--text-dim)' }}>Status</span><br />
                  <span style={{ color: statusColor(selected.statusCode) }}>{selected.statusCode || '—'}</span>
                </div>
                <div><span style={{ color: 'var(--text-dim)' }}>Depth</span><br />{selected.depth}</div>
                <div><span style={{ color: 'var(--text-dim)' }}>Parent</span><br />{selected.parentId ?? 'root'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const { addRepeaterTab, setActiveTab } = useStore.getState()
                const { raw, host, https } = nodeToRequest(selected.url)
                addRepeaterTab({ request: raw, host, https })
                setActiveTab('repeater')
              }}>Send to Repeater</button>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const s = useStore.getState()
                const { raw, host, https } = nodeToRequest(selected.url)
                s.setIntruderRequest(raw)
                s.setIntruderHost(host)
                s.setIntruderHttps(https)
                useStore.setState({ activeTab: 'intruder' })
              }}>Send to Intruder</button>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const { raw } = nodeToRequest(selected.url)
                useStore.setState({ activeTab: 'sqlmap', sqlmapRequest: raw })
              }}>Send to SQLMap</button>
              <button className="btn btn-ghost btn-sm" onClick={() => copyToClipboard(selected.url)}>Copy URL</button>
            </div>
          </div>
        )}
      </div>

      {/* Context menu — auto-flips near viewport edges */}
      {ctxMenu && (
        <div style={{
          position: 'fixed',
          top:  ctxMenu.y + 180 > window.innerHeight ? Math.max(4, ctxMenu.y - 180) : ctxMenu.y,
          left: ctxMenu.x + 180 > window.innerWidth  ? Math.max(4, ctxMenu.x - 180) : ctxMenu.x,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: 4, zIndex: 200,
          minWidth: 170, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {[
            {
              label: 'Send to Repeater', action: () => {
                const { addRepeaterTab, setActiveTab } = useStore.getState()
                const { raw, host, https } = nodeToRequest(ctxMenu.node.url)
                addRepeaterTab({ request: raw, host, https })
                setActiveTab('repeater')
                setCtxMenu(null)
              }
            },
            {
              label: 'Send to Intruder', action: () => {
                const s = useStore.getState()
                const { raw, host, https } = nodeToRequest(ctxMenu.node.url)
                s.setIntruderRequest(raw)
                s.setIntruderHost(host)
                s.setIntruderHttps(https)
                useStore.setState({ activeTab: 'intruder' })
                setCtxMenu(null)
              }
            },
            {
              label: 'Send to SQLMap', action: () => {
                const { raw } = nodeToRequest(ctxMenu.node.url)
                useStore.setState({ activeTab: 'sqlmap', sqlmapRequest: raw })
                setCtxMenu(null)
              }
            },
            { label: 'Copy URL', action: () => { copyToClipboard(ctxMenu.node.url); setCtxMenu(null) } },
          ].map(item => (
            <button key={item.label} onClick={item.action} style={{
              display: 'block', width: '100%', padding: '7px 10px',
              background: 'none', color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer', textAlign: 'left',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >{item.label}</button>
          ))}
        </div>
      )}
      <style>{`@keyframes slideInRight { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }`}</style>
    </div>
  )
}

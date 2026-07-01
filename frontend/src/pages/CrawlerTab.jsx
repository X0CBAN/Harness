import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { Network, Play, Square, Trash2, List, GitBranch, Upload, ChevronDown, Zap, Cpu } from 'lucide-react'
import { useStore } from '../stores/store'
import { backend } from '../bridge'

// Map detected tech strings to relevant nuclei tags
function techToNucleiTags(techList) {
  const tags = new Set(['exposure', 'misconfig'])
  techList.forEach(t => {
    const tl = t.toLowerCase()
    if (tl.includes('wordpress') || tl.includes('wp-')) tags.add('wordpress')
    if (tl.includes('php')) tags.add('php')
    if (tl.includes('apache')) tags.add('apache')
    if (tl.includes('nginx')) tags.add('nginx')
    if (tl.includes('asp.net') || tl.includes('iis')) { tags.add('aspx'); tags.add('iis') }
    if (tl.includes('drupal')) tags.add('drupal')
    if (tl.includes('joomla')) tags.add('joomla')
    if (tl.includes('laravel')) tags.add('laravel')
    if (tl.includes('django')) tags.add('django')
    if (tl.includes('flask')) tags.add('flask')
    if (tl.includes('java') || tl.includes('tomcat') || tl.includes('spring')) { tags.add('java'); tags.add('tomcat') }
    if (tl.includes('express') || tl.includes('node')) tags.add('node')
    if (tl.includes('ruby') || tl.includes('rails')) tags.add('rails')
    if (tl.includes('jquery')) tags.add('jquery')
    if (tl.includes('jenkins')) tags.add('jenkins')
    if (tl.includes('grafana')) tags.add('grafana')
    if (tl.includes('elastic')) tags.add('elasticsearch')
  })
  return [...tags].join(',')
}

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
  const { crawlNodes, addCrawlNode, clearCrawlNodesStore, crawlRunning, setCrawlRunning, setNucleiTarget, setNucleiTags, setActiveTab } = useStore()
  const [seedURL, setSeedURL] = useState('')
  const [maxDepth, setMaxDepth] = useState(3)
  const [selected, setSelected] = useState(null)
  const [viewMode, setViewMode] = useState('list') // 'list' | 'graph'
  const [showWordlist, setShowWordlist] = useState(false)
  const [wordlistText, setWordlistText] = useState('')
  const svgRef = useRef(null)
  const listRef = useRef(null)
  const prevRunning = useRef(false)
  const [fpProfile, setFpProfile] = useState(null)
  const [fpLoading, setFpLoading] = useState(false)
  const [fpError, setFpError] = useState('')

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
    const rawNodes = useStore.getState().crawlNodes
    if (rawNodes.length === 0) return

    const container = svgRef.current.parentElement
    const W = container.clientWidth || 900
    const H = container.clientHeight || 600

    const svg = d3.select(svgRef.current)
    svg.attr('width', W).attr('height', H)
    svg.selectAll('*').remove()

    const normParam = v => /^\d+$/.test(v) || /^[0-9a-f-]{36}$/i.test(v) ? '{n}' : v
    const canonUrl = url => {
      try {
        const u = new URL(url)
        const entries = [...new URLSearchParams(u.search)]
        if (!entries.length) return u.origin + u.pathname
        return u.origin + u.pathname + '?' + entries.map(([k,v]) => `${k}=${normParam(v)}`).join('&')
      } catch { return url }
    }
    const deduped = new Map()
    rawNodes.forEach(n => {
      const c = canonUrl(n.url)
      if (!deduped.has(c)) deduped.set(c, { ...n, count: 1 })
      else deduped.get(c).count++
    })
    const nodes = [...deduped.values()]

    const mkNode = (name) => ({ name, children: new Map(), meta: null })
    const root = mkNode('/')
    root.isRoot = true

    for (const n of nodes) {
      try {
        const u = new URL(n.url)
        const segs = u.pathname.split('/').filter(Boolean)
        const qs = u.search

        let cur = root
        for (const seg of segs) {
          if (!cur.children.has(seg)) cur.children.set(seg, mkNode(seg))
          cur = cur.children.get(seg)
        }
        if (qs) {
          const qKey = qs
          if (!cur.children.has(qKey)) cur.children.set(qKey, { ...mkNode(qs), isParam: true })
          cur.children.get(qKey).meta = n
        } else {
          if (!cur.meta) cur.meta = n
        }
      } catch { /* skip invalid URLs */ }
    }

    const toD3 = (node) => {
      const obj = { name: node.name, meta: node.meta, isRoot: node.isRoot, isParam: node.isParam }
      const kids = [...node.children.values()].map(toD3)
      if (kids.length) obj.children = kids
      return obj
    }
    const hierarchy = d3.hierarchy(toD3(root))

    const treeLayout = d3.tree().nodeSize([22, 200])
    treeLayout(hierarchy)

    const allX = hierarchy.descendants().map(d => d.x)
    const minX = Math.min(...allX), maxX = Math.max(...allX)
    const offsetY = H / 2 - (minX + maxX) / 2

    const cv = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const colBorder      = cv('--border')
    const colTextPrimary = cv('--text-primary')
    const colTextDim     = cv('--text-dim')
    const colBgBase      = cv('--bg-base')
    const colAccent      = cv('--accent')
    const colBgRaised    = cv('--bg-raised')
    const colYellow      = cv('--yellow') || '#facc15'

    const g = svg.append('g').attr('transform', `translate(80,${offsetY})`)
    svg.call(d3.zoom().scaleExtent([0.08, 4]).on('zoom', e => g.attr('transform', e.transform)))

    g.append('g').selectAll('path')
      .data(hierarchy.links())
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', colBorder)
      .attr('stroke-width', 1.2)
      .attr('d', d3.linkHorizontal().x(d => d.y).y(d => d.x))

    const nodeG = g.append('g').selectAll('g')
      .data(hierarchy.descendants())
      .join('g')
      .attr('transform', d => `translate(${d.y},${d.x})`)
      .attr('cursor', d => d.data.meta ? 'pointer' : 'default')
      .on('click', (e, d) => { e.stopPropagation(); if (d.data.meta) setSelected(d.data.meta) })

    nodeG.append('circle')
      .attr('r', d => d.data.isRoot ? 8 : d.data.isParam ? 4 : 6)
      .attr('fill', d => d.data.meta ? statusColor(d.data.meta.statusCode) : (d.data.isRoot ? colAccent : colBgRaised))
      .attr('fill-opacity', 0.9)
      .attr('stroke', colBgBase).attr('stroke-width', 1.5)

    nodeG.filter(d => d.data.meta?.count > 1)
      .append('text')
      .attr('dx', 0).attr('dy', -10)
      .attr('text-anchor', 'middle')
      .attr('font-size', 8).attr('fill', colYellow).attr('font-weight', '700')
      .text(d => `×${d.data.meta.count}`)

    nodeG.append('text')
      .attr('dx', d => (d.children ? -9 : 9))
      .attr('dy', 4)
      .attr('text-anchor', d => (d.children ? 'end' : 'start'))
      .attr('font-size', 9)
      .attr('fill', d => d.data.meta ? colTextPrimary : colTextDim)
      .text(d => {
        const name = d.data.name || '/'
        return name.length > 28 ? name.slice(0, 26) + '…' : name
      })

    svg.on('click', () => setSelected(null))
  }, [])

  useEffect(() => {
    if (viewMode !== 'graph') return
    const t = setTimeout(buildGraph, 100) // let DOM settle before measuring
    return () => clearTimeout(t)
  }, [viewMode])

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

  const detectedTech = useMemo(() => {
    const seen = new Set()
    crawlNodes.forEach(n => (n.tech || []).forEach(t => seen.add(t)))
    return [...seen]
  }, [crawlNodes])

  const handleFingerprint = async () => {
    const target = seedURL.trim() || (crawlNodes[0] ? (() => { try { const u = new URL(crawlNodes[0].url); return u.origin } catch { return '' } })() : '')
    if (!target) return
    setFpLoading(true)
    setFpError('')
    try {
      const profile = await backend.fingerprintTarget(target)
      setFpProfile(profile)
    } catch (e) {
      setFpError(String(e))
    } finally {
      setFpLoading(false)
    }
  }

  const handleScanWithNuclei = () => {
    setNucleiTarget(seedURL || (crawlNodes[0] ? new URL(crawlNodes[0].url).origin : ''))
    setNucleiTags(techToNucleiTags(detectedTech))
    setActiveTab('nuclei')
  }

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
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleFingerprint}
            disabled={fpLoading}
            title="Active tech-stack fingerprinting — probes 27+ paths and inspects headers/cookies"
            style={{ display: 'flex', alignItems: 'center', gap: 4, color: fpProfile ? 'var(--accent)' : undefined }}
          >
            <Cpu size={11} /> {fpLoading ? 'Profiling…' : 'Profile Stack'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleClear}><Trash2 size={11} /></button>
        </div>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {crawlNodes.length} nodes{crawlRunning ? ' — crawling…' : ''}
          </span>
        </div>

        {/* Tech detection banner */}
        {!crawlRunning && detectedTech.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
            borderTop: '1px solid var(--border-dim)', background: 'var(--bg-base)', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.5px', flexShrink: 0 }}>
              Tech detected
            </span>
            {detectedTech.map(t => (
              <span key={t} style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 10,
                background: 'rgba(124,106,247,0.12)', border: '1px solid var(--accent-dim)',
                color: 'var(--accent)', fontFamily: 'var(--font-mono)',
              }}>{t}</span>
            ))}
            <button
              onClick={handleScanWithNuclei}
              className="btn btn-primary"
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 12px', flexShrink: 0 }}
              title="Pre-fill Nuclei with detected tech tags and switch to Nuclei tab"
            >
              <Zap size={11} /> Scan with Nuclei
            </button>
          </div>
        )}

        {/* Fingerprint results panel */}
        {(fpProfile || fpError) && (
          <div style={{
            borderTop: '1px solid var(--border-dim)', background: 'var(--bg-base)',
            padding: '8px 14px', maxHeight: 220, overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Cpu size={11} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)' }}>
                Stack Profile — {fpProfile?.target}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setFpProfile(null); setFpError('') }}
                style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)' }}
              >✕</button>
            </div>
            {fpError && <div style={{ color: 'var(--red)', fontSize: 11 }}>{fpError}</div>}
            {fpProfile && fpProfile.findings.length === 0 && (
              <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>No signatures matched. Status: {fpProfile.statusCode}</div>
            )}
            {fpProfile && fpProfile.findings.length > 0 && (() => {
              const catColor = { server: '#60a5fa', language: '#4ade80', framework: '#f472b6', cms: '#fb923c', database: '#a78bfa', security: '#fbbf24' }
              const byCategory = {}
              fpProfile.findings.forEach(f => {
                if (!byCategory[f.category]) byCategory[f.category] = []
                byCategory[f.category].push(f)
              })
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(byCategory).map(([cat, findings]) => (
                    <div key={cat} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px',
                        color: catColor[cat] || '#888', minWidth: 64, paddingTop: 2,
                      }}>{cat}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {findings.map((f, i) => (
                          <span
                            key={i}
                            title={f.evidence}
                            style={{
                              fontSize: 10, padding: '2px 8px', borderRadius: 10,
                              background: `${catColor[cat] || '#888'}1a`,
                              border: `1px solid ${catColor[cat] || '#888'}44`,
                              color: catColor[cat] || '#888',
                              fontFamily: 'var(--font-mono)',
                              opacity: f.confidence === 'low' ? 0.6 : 1,
                              cursor: 'help',
                            }}
                          >
                            {f.tech}
                            {f.confidence === 'low' && <span style={{ fontSize: 8, marginLeft: 3, opacity: 0.7 }}>?</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

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
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', padding: '6px 10px',
                display: 'flex', gap: 10, fontSize: 10, color: 'var(--text-secondary)',
                opacity: 0.92,
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

import { useEffect, useState } from 'react'
import logoUrl from './assets/logo-bg-removed.png'
import { useStore } from './stores/store'
import ProxyTab from './pages/ProxyTab'
import RepeaterTab from './pages/RepeaterTab'
import IntruderTab from './pages/IntruderTab'
import RulesTab from './pages/RulesTab'
import SettingsTab from './pages/SettingsTab'
import CrawlerTab from './pages/CrawlerTab'
import TokensTab from './pages/TokensTab'
import SQLMapTab from './pages/SQLMapTab'
import NucleiTab from './pages/NucleiTab'
import ScriptsTab from './pages/ScriptsTab'
import SecretsTab from './pages/SecretsTab'
import { backend, connectWS } from './bridge'

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('harness-theme') || 'dark')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '')
    localStorage.setItem('harness-theme', theme)
  }, [theme])
  return [theme, setTheme]
}

const TABS = [
  { id: 'proxy',    label: 'Proxy' },
  { id: 'repeater', label: 'Repeater' },
  { id: 'intruder', label: 'Intruder' },
  { id: 'crawler',  label: 'Crawler' },
  { id: 'tokens',   label: 'Tokens' },
  { id: 'sqlmap',   label: 'SQLMap' },
  { id: 'nuclei',   label: 'Nuclei' },
  { id: 'scripts',  label: 'Scripts' },
  { id: 'secrets',  label: 'Secrets' },
  { id: 'rules',    label: 'Match & Replace' },
  { id: 'settings', label: 'Settings' },
]


function ChromeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="4"/>
      <line x1="21.17" y1="8" x2="12" y2="8"/>
      <line x1="3.95" y1="6.06" x2="8.54" y2="14"/>
      <line x1="10.88" y1="21.94" x2="15.46" y2="14"/>
    </svg>
  )
}

export default function App() {
  const { activeTab, setActiveTab, wsConnected } = useStore()
  const [launching, setLaunching] = useState(false)
  const [launchMsg, setLaunchMsg] = useState('')
  const [theme, setTheme] = useTheme()
  const [selLen, setSelLen] = useState(0)
  const [browserRunning, setBrowserRunning] = useState(false)
  const [shortcutFlash, setShortcutFlash] = useState(null)

  useEffect(() => {
    const handler = () => {
      const el = document.activeElement
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
        setSelLen((el.selectionEnd ?? 0) - (el.selectionStart ?? 0))
      } else {
        const sel = window.getSelection()
        setSelLen(sel ? sel.toString().length : 0)
      }
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [])

  useEffect(() => {
    let flashTimer = null
    const flash = (msg) => {
      setShortcutFlash(msg)
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => setShortcutFlash(null), 1400)
    }

    const onKeyDown = (e) => {
      if (!e.ctrlKey) return

      const active = document.activeElement
      if (active && active.tagName === 'INPUT') return

      const s = useStore.getState()
      if (s.activeTab !== 'proxy') return

      const key = e.key.toLowerCase()

      if (key === 'r' && !e.shiftKey && !e.altKey) {
        if (s.selectedEntry) {
          e.preventDefault()
          s.sendToRepeater(s.selectedEntry)
          flash('Ctrl+R → Repeater')
        }
        return
      }

      if (key === 'i' && !e.shiftKey && !e.altKey) {
        if (s.selectedEntry) {
          e.preventDefault()
          s.sendToIntruder(s.selectedEntry)
          flash('Ctrl+I → Intruder')
        }
        return
      }

      if (e.key === ' ') {
        if (s.interceptQueue.length > 0) {
          e.preventDefault()
          const current = s.interceptQueue[0]
          backend.forwardRequest(current.id)
          s.dequeueIntercept()
          flash('Ctrl+Space → Forwarded')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      clearTimeout(flashTimer)
    }
  }, [])

  useEffect(() => {
    const store = useStore.getState()

    const disconnect = connectWS(
      (msg) => {
        const s = useStore.getState()
        if (msg.type === 'history') s.addHistoryEntry(msg.entry)
        if (msg.type === 'intercepted') {
          s.enqueueIntercept(msg.request)
          useStore.setState({ activeTab: 'proxy' })
        }
        if (msg.type === 'intercepted_response') {
          s.enqueueInterceptResp(msg.response)
          useStore.setState({ activeTab: 'proxy' })
        }
        if (msg.type === 'intruder_result') {
          s.addIntruderResult(msg.result)
          if (msg.result?.done) s.setIntruderRunning(false)
        }
        if (msg.type === 'crawl_node') s.addCrawlNode(msg.node)
        if (msg.type === 'crawl_done') s.setCrawlRunning(false)
        if (msg.type === 'token_update') s.setActiveToken(msg.token || '')
        if (msg.type === 'sqlmap_output') s.addSQLMapOutput(msg.line)
        if (msg.type === 'sqlmap_done') {
          s.setSQLMapRunning(false)
          if (msg.msg) s.addSQLMapOutput('─── ' + msg.msg + ' ───')
        }
        if (msg.type === 'browser_stopped') setBrowserRunning(false)
        if (msg.type === 'nuclei_output') s.addNucleiOutput(msg.line)
        if (msg.type === 'nuclei_done') {
          s.setNucleiRunning(false)
          if (msg.msg) s.addNucleiOutput('─── ' + msg.msg + ' ───')
        }
      },
      () => useStore.setState({ wsConnected: true }),
      () => useStore.setState({ wsConnected: false })
    )

    return disconnect
  }, [])

  const handleLaunchBrowser = async () => {
    setLaunching(true)
    setLaunchMsg('')
    try {
      const msg = await backend.launchBrowser()
      setBrowserRunning(true)
      setLaunchMsg(msg)
      setTimeout(() => setLaunchMsg(''), 5000)
    } catch (err) {
      setLaunchMsg(String(err))
      setTimeout(() => setLaunchMsg(''), 8000)
    } finally {
      setLaunching(false)
    }
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'proxy':    return <ProxyTab />
      case 'repeater': return <RepeaterTab />
      case 'intruder': return <IntruderTab />
      case 'crawler':  return <CrawlerTab />
      case 'tokens':   return <TokensTab />
      case 'sqlmap':   return <SQLMapTab />
      case 'nuclei':   return <NucleiTab />
      case 'scripts':  return <ScriptsTab />
      case 'secrets':  return <SecretsTab />
      case 'rules':    return <RulesTab />
      case 'settings': return <SettingsTab />
      default:         return <ProxyTab />
    }
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-logo">
          <img src={logoUrl} alt="Harness" style={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }} />
          <span>Harness</span>
        </div>

        <nav className="titlebar-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="titlebar-right">
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-raised)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', fontSize: 14,
              WebkitAppRegion: 'no-drag', flexShrink: 0,
            }}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>

          <button
            onClick={handleLaunchBrowser}
            disabled={launching}
            title="Launch an isolated Chrome/Edge session with Harness proxy pre-configured."
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 'var(--radius-sm)',
              background: launching ? 'var(--bg-raised)' : 'var(--accent)',
              border: 'none', color: 'white',
              fontSize: 12, fontWeight: 600, cursor: launching ? 'not-allowed' : 'pointer',
              opacity: launching ? 0.7 : 1,
              transition: 'all 0.15s',
              WebkitAppRegion: 'no-drag',
            }}
          >
            <ChromeIcon />
            {launching ? 'Launching…' : 'Launch Browser'}
          </button>

          <div className="proxy-badge" title={browserRunning ? 'Browser connected through proxy' : 'No browser connected — click Launch Browser'}>
            <span className="dot" style={{
              background: browserRunning ? 'var(--green)' : 'var(--text-dim)',
              boxShadow: browserRunning ? '0 0 6px var(--green)' : 'none',
            }} />
            :8080
          </div>
        </div>
      </header>

      {launchMsg && (() => {
        const isErr = !launchMsg.startsWith('✓')
        return (
          <div style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 999,
            background: isErr ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.10)',
            border: `1px solid ${isErr ? 'rgba(248,113,113,0.35)' : 'rgba(74,222,128,0.35)'}`,
            borderRadius: 'var(--radius)',
            padding: '12px 16px',
            maxWidth: 380,
            fontSize: 12,
            color: isErr ? 'var(--red)' : 'var(--green)',
            lineHeight: 1.6,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            whiteSpace: 'pre-wrap',
          }}>
            {launchMsg}
          </div>
        )
      })()}

      <main style={{ overflow: 'hidden' }}>
        {renderTab()}
      </main>

      {shortcutFlash && (
        <div style={{
          position: 'fixed', bottom: selLen > 0 ? 36 : 10, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, background: 'rgba(124,106,247,0.15)', border: '1px solid var(--accent)',
          color: 'var(--accent)', borderRadius: 10, fontSize: 10, fontWeight: 700,
          padding: '3px 12px', fontFamily: 'var(--font-mono)', pointerEvents: 'none',
          letterSpacing: '.4px', whiteSpace: 'nowrap',
          animation: 'shortcutFadeIn 0.12s ease',
        }}>
          {shortcutFlash}
        </div>
      )}

      {selLen > 0 && (
        <div style={{
          position: 'fixed', bottom: 10, left: '50%', transform: 'translateX(-50%)',
          zIndex: 999, background: 'var(--accent-dim)', border: '1px solid var(--accent)',
          color: 'var(--accent)', borderRadius: 10, fontSize: 10, fontWeight: 600,
          padding: '3px 12px', fontFamily: 'var(--font-mono)', pointerEvents: 'none',
          letterSpacing: '.4px',
        }}>
          {selLen} chars
        </div>
      )}

      <style>{`@keyframes shortcutFadeIn { from { opacity:0; transform:translateX(-50%) translateY(4px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>
    </div>
  )
}

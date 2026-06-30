import { useEffect, useState } from 'react'
import { Shield, Info, Server, Key, Cpu, Globe, Zap, Eye, Code2, Bug, ChevronRight } from 'lucide-react'
import { backend } from '../bridge'

const FEATURE_SECTIONS = [
  {
    icon: Globe,
    title: 'Proxy',
    items: ['Full HTTP/HTTPS interception with MITM', 'Request & response intercept queue', 'Forward, drop, or modify on the fly', 'Scope filtering — only capture what matters', 'Match & Replace rules with URL scope, regex, case options', 'Auto-clear history on restart'],
  },
  {
    icon: Code2,
    title: 'Repeater',
    items: ['Replay any request with instant editing', 'Multiple tabs, horizontal drag-resize', 'Follow-redirects toggle', 'Grep search, hex view, live HTML/JSON render', 'Right-click encode/decode on selection'],
  },
  {
    icon: Zap,
    title: 'Intruder',
    items: ['Sniper, Battering Ram, Pitchfork, Cluster Bomb modes', 'Unlimited payload lines — large files streamed from disk', '14 payload transforms (MD5, SHA-256, Base64, URL, Hex, Reverse…)', 'Grep matching, response length & status filters', 'Session tabs — keep multiple attack configs open', 'Request / Response / Hex / Render modal with search & decode'],
  },
  {
    icon: Globe,
    title: 'Crawler',
    items: ['Passive HTML spider + JS fetch/XHR extraction', 'D3 force-directed graph — click nodes to send to Repeater', 'Wordlist fuzzing (paste paths or load file)', '404 auto-filtered — only real nodes shown', 'JSON API response URL extraction', 'Smart parent-path inference from discovered URLs', '401/403 nodes preserved — shows auth-protected surface'],
  },
  {
    icon: Bug,
    title: 'Nuclei',
    items: ['One-click scan via locally installed Nuclei', 'Tag & severity filters, custom templates path', 'Streaming output with severity color-coding', 'Uses Harness as upstream proxy for traffic capture'],
  },
  {
    icon: Eye,
    title: 'Secrets Scanner',
    items: ['Real-time sensitive data exposure detection', '15 built-in patterns: JWT, AWS, GitHub, private keys, credit cards, passwords, SQL, stack traces, IPs…', 'Live mode auto-scans new proxy traffic', 'Severity-filtered findings table with snippet preview', 'One-click Send to Repeater · CSV export'],
  },
  {
    icon: Code2,
    title: 'Scripts',
    items: ['In-browser JavaScript analysis engine', '9 built-in templates (SQL params, open redirects, JWT, admin paths, errors…)', 'Access both proxy history and crawl nodes', 'Right-click Send to Repeater / Intruder / SQLMap'],
  },
  {
    icon: Key,
    title: 'Tokens',
    items: ['Regex / JSONPath extraction rules', 'Auto-inject token into every proxy request', 'Re-auth macro with automatic 401 retry'],
  },
]

export default function SettingsTab() {
  const [port, setPort] = useState('8080')
  const [certMsg, setCertMsg] = useState('')
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    backend.getProxyPort().then(setPort).catch(() => {})
  }, [])

  const handleInstallCert = async () => {
    setInstalling(true)
    setCertMsg('')
    try {
      const msg = await backend.installCACert()
      setCertMsg(msg || 'CA certificate installed successfully.')
    } catch (err) {
      setCertMsg(String(err))
    } finally {
      setInstalling(false)
    }
  }

  const handleExportCert = async () => {
    setCertMsg('')
    try {
      const msg = await backend.openCertForInstall()
      setCertMsg(msg || 'Certificate saved to Desktop.')
    } catch (err) {
      setCertMsg(String(err))
    }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 800 }}>

      {/* About */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Harness</h2>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            Enterprise-grade HTTP proxy &amp; security testing platform · v1.0.0<br />
            Open source · Windows · Built with Go + Wails + React
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: 600 }}>Go</span>
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontWeight: 600 }}>Wails</span>
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: 'rgba(96,165,250,0.1)', color: '#60a5fa', fontWeight: 600 }}>React</span>
        </div>
      </div>

      {/* Proxy address */}
      <section>
        <SectionHeader icon={Server} title="Proxy" />
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 80 }}>Listen</span>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--accent)' }}>127.0.0.1:{port}</code>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)', display: 'inline-block', marginLeft: 4 }} />
            <span style={{ fontSize: 11, color: 'var(--green)' }}>running</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7 }}>
            Configure your browser to use <strong style={{ color: 'var(--text-secondary)' }}>127.0.0.1:{port}</strong> as HTTP and HTTPS proxy.<br />
            Chrome/Edge: FoxyProxy extension · Firefox: Settings → Network → Manual proxy
          </p>
        </div>
      </section>

      {/* CA Certificate */}
      <section>
        <SectionHeader icon={Shield} title="CA Certificate" />
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Harness signs HTTPS traffic with its own CA. Install it once and your browser will trust all intercepted connections.
          </p>

          {/* Quick install */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleInstallCert}
              disabled={installing}
              style={{ flex: 1 }}
            >
              <Shield size={13} /> {installing ? 'Installing…' : 'Install CA to Windows Trust Store'}
            </button>
            <button className="btn btn-ghost" onClick={handleExportCert} style={{ flex: 1 }}>
              Export .crt + .pem to Desktop
            </button>
          </div>
          {certMsg && (
            <p style={{ fontSize: 11, color: certMsg.toLowerCase().includes('error') || certMsg.toLowerCase().includes('fail') ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--font-mono)' }}>
              {certMsg}
            </p>
          )}

          {/* Manual download */}
          <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 12 }}>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>Or download from the proxy itself (with browser proxied through Harness):</p>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', background: 'var(--bg-base)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              http://127.0.0.1:{port}
            </code>
          </div>

          {/* Steps */}
          <details style={{ marginTop: 2 }}>
            <summary style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', userSelect: 'none' }}>Manual install steps</summary>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Chrome / Edge — .crt file</p>
                <ol style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 2.2, paddingLeft: 18 }}>
                  <li>Double-click <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>harness-ca.crt</code> → Install Certificate</li>
                  <li>Current User → Next → Place in: <strong style={{ color: 'var(--text-secondary)' }}>Trusted Root Certification Authorities</strong></li>
                  <li>OK → Next → Finish → Yes on the warning → Fully restart browser</li>
                </ol>
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Firefox — .pem file</p>
                <ol style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 2.2, paddingLeft: 18 }}>
                  <li>Settings → Privacy &amp; Security → View Certificates → Authorities → Import</li>
                  <li>Select <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>harness-ca.pem</code> → Trust to identify websites → OK</li>
                </ol>
                <div style={{ display: 'flex', gap: 6, padding: '6px 10px', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginTop: 6 }}>
                  <Info size={12} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>Firefox has its own certificate store and ignores Windows. Always use the .pem file for Firefox.</p>
                </div>
              </div>
            </div>
          </details>
        </div>
      </section>

      {/* Feature reference */}
      <section>
        <SectionHeader icon={Zap} title="Feature Reference" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {FEATURE_SECTIONS.map(sec => (
            <FeatureCard key={sec.title} {...sec} />
          ))}
        </div>
      </section>

      {/* Build info */}
      <div style={{ fontSize: 11, color: 'var(--text-dim)', paddingBottom: 12, borderTop: '1px solid var(--border-dim)', paddingTop: 12 }}>
        Harness v1.0.0 · SQLite history · Go 1.21 · Wails v2 · React + Vite
      </div>
    </div>
  )
}

function SectionHeader({ icon: Icon, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
      <Icon size={13} style={{ color: 'var(--accent)' }} />
      <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-dim)' }}>{title}</h3>
    </div>
  )
}

function FeatureCard({ icon: Icon, title, items }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}>
        <Icon size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>{title}</span>
        {open ? <ChevronDown size={13} style={{ color: 'var(--text-dim)' }} /> : <ChevronRight size={13} style={{ color: 'var(--text-dim)' }} />}
      </div>
      {open && (
        <ul style={{ padding: '0 14px 12px 30px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((item, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, listStyleType: 'disc' }}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// eslint-disable-next-line no-unused-vars
function ChevronDown({ size, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={style}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

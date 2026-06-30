import { useEffect, useState } from 'react'
import { Plus, Trash2, Repeat, ChevronDown, ChevronRight, Zap } from 'lucide-react'
import { useStore } from '../stores/store'
import { backend } from '../bridge'

const TARGETS = [
  { value: 'request_header',  label: 'Request headers' },
  { value: 'request_body',    label: 'Request body' },
  { value: 'response_header', label: 'Response headers' },
  { value: 'response_body',   label: 'Response body' },
]

const ACTIONS = [
  { value: 'replace', label: 'Replace' },
  { value: 'remove',  label: 'Remove' },
]

const PRESETS = [
  {
    name: 'Strip CSP',
    comment: 'Removes Content-Security-Policy to allow inline scripts',
    target: 'response_header', action: 'remove', isRegex: true, caseSensitive: false,
    match: 'Content-Security-Policy[^\\r\\n]*', replace: '', urlScope: '',
  },
  {
    name: 'Strip HSTS',
    comment: 'Removes Strict-Transport-Security',
    target: 'response_header', action: 'remove', isRegex: true, caseSensitive: false,
    match: 'Strict-Transport-Security[^\\r\\n]*', replace: '', urlScope: '',
  },
  {
    name: 'Spoof User-Agent',
    comment: 'Override the browser User-Agent sent with every request',
    target: 'request_header', action: 'replace', isRegex: true, caseSensitive: false,
    match: 'User-Agent: [^\\r\\n]+', replace: 'User-Agent: Harness/1.0', urlScope: '',
  },
  {
    name: 'Add X-Forwarded-For',
    comment: 'Inject IP spoofing header into requests',
    target: 'request_header', action: 'replace', isRegex: false, caseSensitive: false,
    match: '', replace: '', urlScope: '',
  },
  {
    name: 'Disable Encoding',
    comment: 'Remove Accept-Encoding so responses arrive uncompressed',
    target: 'request_header', action: 'remove', isRegex: true, caseSensitive: false,
    match: 'Accept-Encoding: [^\\r\\n]+', replace: '', urlScope: '',
  },
  {
    name: 'Flag SQL errors',
    comment: 'Log responses containing SQL error strings',
    target: 'response_body', action: 'replace', isRegex: true, caseSensitive: false,
    match: '(SQL syntax|ORA-\\d+|mysql_fetch)', replace: '⚠️SQL_ERR⚠️$1', urlScope: '',
  },
]

function RuleCard({ rule, onUpdate, onRemove }) {
  const [open, setOpen] = useState(true)
  const [testInput, setTestInput] = useState('')

  // Live preview
  const preview = (() => {
    if (!testInput || !rule.match) return null
    try {
      const replacement = rule.action === 'remove' ? '' : rule.replace
      if (rule.isRegex) {
        const flags = rule.caseSensitive ? 'g' : 'gi'
        const re = new RegExp(rule.match, flags)
        return testInput.replace(re, replacement)
      } else {
        const escaped = rule.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const flags = rule.caseSensitive ? 'g' : 'gi'
        const re = new RegExp(escaped, flags)
        return testInput.replace(re, replacement)
      }
    } catch {
      return '(invalid regex)'
    }
  })()

  const regexOk = (() => {
    if (!rule.isRegex || !rule.match) return true
    try { new RegExp(rule.match); return true } catch { return false }
  })()

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${rule.enabled ? 'var(--border)' : 'var(--border-dim)'}`,
      borderRadius: 'var(--radius)',
      opacity: rule.enabled ? 1 : 0.6,
      overflow: 'hidden',
    }}>
      {/* Card header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-raised)', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <label className="toggle" style={{ transform: 'scale(0.8)', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={rule.enabled} onChange={e => onUpdate({ enabled: e.target.checked })} />
          <span className="toggle-track" />
        </label>
        {open ? <ChevronDown size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} /> : <ChevronRight size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}
        <input
          value={rule.name}
          onChange={e => onUpdate({ name: e.target.value })}
          onClick={e => e.stopPropagation()}
          style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, flex: 1, border: 'none', background: 'transparent', color: 'var(--text-primary)', outline: 'none' }}
          placeholder="Rule name"
        />
        {/* Quick summary badges */}
        <span style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 6px', borderRadius: 3, flexShrink: 0 }}>
          {TARGETS.find(t => t.value === rule.target)?.label || rule.target}
        </span>
        {rule.urlScope && (
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {rule.urlScope}
          </span>
        )}
        <button onClick={e => { e.stopPropagation(); onRemove() }}
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 3, flexShrink: 0, display: 'flex', alignItems: 'center' }}
          title="Delete rule">
          <Trash2 size={12} />
        </button>
      </div>

      {open && (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Row 1: Target / Action */}
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-dim)' }}>Target</span>
              <select value={rule.target} onChange={e => onUpdate({ target: e.target.value })} style={{ fontSize: 12 }}>
                {TARGETS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 120 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-dim)' }}>Action</span>
              <select value={rule.action || 'replace'} onChange={e => onUpdate({ action: e.target.value })} style={{ fontSize: 12 }}>
                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </label>
          </div>

          {/* Row 2: Match / Replace */}
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.7px', color: rule.isRegex && !regexOk ? 'var(--red)' : 'var(--text-dim)' }}>
                Match {rule.isRegex && !regexOk ? '— invalid regex' : ''}
              </span>
              <input
                value={rule.match}
                onChange={e => onUpdate({ match: e.target.value })}
                placeholder={rule.isRegex ? 'regex pattern…' : 'literal text…'}
                style={{ fontSize: 12, fontFamily: 'var(--font-mono)', borderColor: rule.isRegex && !regexOk ? 'var(--red)' : undefined }}
              />
            </label>
            {rule.action !== 'remove' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-dim)' }}>Replace with</span>
                <input
                  value={rule.replace}
                  onChange={e => onUpdate({ replace: e.target.value })}
                  placeholder="replacement text (leave empty to delete)…"
                  style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}
                />
              </label>
            )}
          </div>

          {/* Row 3: Options */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rule.isRegex} onChange={e => onUpdate({ isRegex: e.target.checked })} style={{ width: 13, height: 13, accentColor: 'var(--accent)' }} />
              Regex
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rule.caseSensitive || false} onChange={e => onUpdate({ caseSensitive: e.target.checked })} style={{ width: 13, height: 13, accentColor: 'var(--accent)' }} />
              Case-sensitive
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 180 }}>
              <span style={{ whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>URL scope:</span>
              <input
                value={rule.urlScope || ''}
                onChange={e => onUpdate({ urlScope: e.target.value })}
                placeholder="e.g. api.example.com (empty = all)"
                style={{ fontSize: 11, fontFamily: 'var(--font-mono)', flex: 1 }}
              />
            </label>
          </div>

          {/* Row 4: Comment */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Note:</span>
            <input
              value={rule.comment || ''}
              onChange={e => onUpdate({ comment: e.target.value })}
              placeholder="Optional description / note…"
              style={{ fontSize: 11, flex: 1, color: 'var(--text-dim)', fontStyle: 'italic' }}
            />
          </label>

          {/* Row 5: Live test */}
          <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-dim)', marginBottom: 5 }}>Live test</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea
                value={testInput}
                onChange={e => setTestInput(e.target.value)}
                placeholder="Paste sample text to test the rule…"
                rows={3}
                style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)', resize: 'vertical', lineHeight: 1.6 }}
              />
              <textarea
                readOnly
                value={preview ?? ''}
                placeholder="Preview will appear here…"
                rows={3}
                style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)', resize: 'vertical', lineHeight: 1.6, background: 'var(--bg-base)', color: preview !== testInput ? 'var(--accent)' : 'var(--text-secondary)' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RulesTab() {
  const { rules, setRules, addRule, updateRule, removeRule } = useStore()
  const [showPresets, setShowPresets] = useState(false)

  useEffect(() => {
    backend.getRules().then((r) => { if (r?.length) setRules(r) }).catch(() => {})
  }, [])

  const sync = (next) => backend.setRules(next).catch(() => {})

  const handleUpdate = (id, patch) => {
    updateRule(id, patch)
    setTimeout(() => sync(useStore.getState().rules), 0)
  }

  const handleAdd = (preset) => {
    addRule(preset)
    setTimeout(() => sync(useStore.getState().rules), 0)
  }

  const handleRemove = (id) => {
    removeRule(id)
    setTimeout(() => sync(useStore.getState().rules), 0)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <span className="panel-header-title">Match &amp; Replace</span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPresets(p => !p)}>
            <Zap size={11} /> Presets
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => handleAdd()}>
            <Plus size={11} /> Add rule
          </button>
        </div>
      </div>

      {/* Preset strip */}
      {showPresets && (
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-dim)', background: 'var(--bg-raised)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.name} onClick={() => { handleAdd(p); setShowPresets(false) }}
              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title={p.comment}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {rules.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: 60 }}>
            <Repeat size={32} />
            <p>No rules yet</p>
            <p style={{ fontSize: 11 }}>Rules rewrite traffic as it passes through the proxy.<br />Use Presets to add common rules instantly.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 960 }}>
            {rules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onUpdate={(patch) => handleUpdate(rule.id, patch)}
                onRemove={() => handleRemove(rule.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useTheme } from '../contexts/ThemeContext'

const CHALLENGE_TYPES = [
  { value: 'books_count', label: 'Books Read', icon: '📚', unit: 'books' },
  { value: 'pages_count', label: 'Pages Read', icon: '📖', unit: 'pages' },
  { value: 'genre_diversity', label: 'Different Genres', icon: '🎨', unit: 'genres' },
  { value: 'streak_days', label: 'Reading Streak', icon: '🔥', unit: 'days' },
]

export default function NewChallengeModal({ onClose, onSave }) {
  const { theme } = useTheme()
  const [type, setType] = useState('books_count')
  const [target, setTarget] = useState('')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const year = now.getFullYear()

  const typeInfo = CHALLENGE_TYPES.find(t => t.value === type)

  async function handleSave() {
    if (!target || !title.trim()) return
    setSaving(true)
    await onSave({
      title: title.trim(),
      challenge_type: type,
      target_value: parseInt(target),
      month,
      year,
      is_system: false,
    })
    setSaving(false)
    onClose()
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '8px 12px',
    border: `1px solid ${theme.border}`, borderRadius: 8,
    fontSize: 13, background: theme.bgCard, color: theme.text,
    fontFamily: "'DM Sans', sans-serif", outline: 'none',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 16,
          padding: '24px', width: '100%', maxWidth: 420,
        }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, margin: '0 0 18px' }}>
          New Challenge
        </h3>

        <label style={{ fontSize: 12, color: theme.textSubtle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Type
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {CHALLENGE_TYPES.map(ct => (
            <button
              key={ct.value}
              onClick={() => setType(ct.value)}
              style={{
                padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                border: type === ct.value ? `2px solid ${theme.rust}` : `1px solid ${theme.border}`,
                background: type === ct.value ? theme.rustLight : theme.bgCard,
                color: theme.text, fontSize: 13, fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {ct.icon} {ct.label}
            </button>
          ))}
        </div>

        <label style={{ fontSize: 12, color: theme.textSubtle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Challenge title
        </label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={`e.g., Read 5 ${typeInfo.unit} this month`}
          style={{ ...inputStyle, marginTop: 6, marginBottom: 16 }}
        />

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: theme.textSubtle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Target ({typeInfo.unit})
            </label>
            <input
              type="number"
              min="1"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="e.g., 5"
              style={{ ...inputStyle, marginTop: 6 }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: theme.textSubtle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Month
            </label>
            <select
              value={month}
              onChange={e => setMonth(parseInt(e.target.value))}
              style={{ ...inputStyle, marginTop: 6, cursor: 'pointer' }}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(year, i, 1).toLocaleDateString('en-US', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', background: 'transparent', border: `1px solid ${theme.border}`,
              borderRadius: 8, fontSize: 13, color: theme.textSubtle, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || !target || saving}
            style={{
              padding: '8px 18px', background: theme.rust, color: 'white',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: title.trim() && target ? 'pointer' : 'default',
              opacity: title.trim() && target ? 1 : 0.5,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {saving ? 'Creating…' : 'Create Challenge'}
          </button>
        </div>
      </div>
    </div>
  )
}

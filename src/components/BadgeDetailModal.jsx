import { useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { TIER_STYLES } from '../lib/badges'

export default function BadgeDetailModal({ badge, onClose }) {
  const { theme } = useTheme()

  useEffect(() => {
    if (!badge) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [badge, onClose])

  if (!badge) return null

  const ts = TIER_STYLES[badge.tier]
  const overflow = badge.earned
    ? Math.max(0, badge.prog.value - badge.prog.max)
    : 0
  const remaining = badge.earned
    ? 0
    : Math.max(0, badge.prog.max - badge.prog.value)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${badge.name} details`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.bg,
          border: `1px solid ${theme.border}`,
          borderRadius: 14,
          maxWidth: 420, width: '100%',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          textAlign: 'center',
          color: theme.text,
          position: 'relative',
        }}
      >
        <button
          aria-label="Close"
          onClick={onClose}
          style={{
            position: 'absolute', top: 10, right: 10,
            background: 'transparent', border: 'none',
            fontSize: 22, lineHeight: 1, cursor: 'pointer',
            color: theme.textSubtle, padding: 4,
          }}
        >×</button>

        <div
          style={{
            width: 96, height: 96, borderRadius: '50%',
            background: badge.earned ? ts.bg : theme.bgSubtle,
            border: `2px solid ${badge.earned ? ts.border : theme.borderLight}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px', fontSize: 48, lineHeight: 1,
          }}
        >
          {badge.earned ? badge.emoji : '🔒'}
        </div>

        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Georgia, serif', marginBottom: 6 }}>
          {badge.name}
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
            padding: '3px 10px', borderRadius: 20,
            background: ts.bg, color: ts.text, border: `1px solid ${ts.border}`,
          }}>{ts.label}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
            padding: '3px 10px', borderRadius: 20,
            background: theme.bgSubtle, color: theme.textSubtle, border: `1px solid ${theme.border}`,
          }}>{badge.category}</span>
        </div>

        <div style={{ fontSize: 14, color: theme.text, lineHeight: 1.5, marginBottom: 18 }}>
          {badge.desc}
        </div>

        <div style={{
          background: theme.bgSubtle,
          border: `1px solid ${theme.borderLight}`,
          borderRadius: 10,
          padding: 14,
          textAlign: 'left',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: theme.textSubtle, marginBottom: 8 }}>
            {badge.earned ? 'Earned' : 'Progress'}
          </div>

          <div style={{ height: 6, background: theme.border, borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{
              height: '100%', width: `${badge.pct}%`,
              background: ts.text, borderRadius: 3, transition: 'width 0.4s',
            }} />
          </div>

          <div style={{ fontSize: 13, color: theme.text }}>
            <strong>{badge.prog.value.toLocaleString()}</strong>
            <span style={{ color: theme.textSubtle }}> / {badge.prog.max.toLocaleString()} {badge.prog.label}</span>
          </div>

          {badge.earned && overflow > 0 && (
            <div style={{ fontSize: 12, color: ts.text, marginTop: 6 }}>
              {overflow.toLocaleString()} beyond the requirement — nice.
            </div>
          )}
          {!badge.earned && remaining > 0 && (
            <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 6 }}>
              {remaining.toLocaleString()} more {badge.prog.label} to unlock.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { LEVELS, LEVEL_THRESHOLDS, TIER_POINTS } from '../lib/level'

export default function LevelDetailModal({ open, currentLevel, currentPoints, onClose }) {
  const { theme } = useTheme()

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reader levels"
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
          maxWidth: 460, width: '100%',
          maxHeight: '85vh', overflowY: 'auto',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
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

        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Georgia, serif', marginBottom: 6 }}>
          Reader Levels
        </div>
        <div style={{ fontSize: 13, color: theme.textSubtle, lineHeight: 1.5, marginBottom: 16 }}>
          Earn points by unlocking badges:
          {' '}<strong>Bronze {TIER_POINTS.bronze}</strong>,
          {' '}<strong>Silver {TIER_POINTS.silver}</strong>,
          {' '}<strong>Gold {TIER_POINTS.gold}</strong>,
          {' '}<strong>Platinum {TIER_POINTS.platinum}</strong>.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {LEVELS.map((entry, i) => {
            const isCurrent = entry.level === currentLevel
            const threshold = LEVEL_THRESHOLDS[i]
            const reached = currentPoints >= threshold
            const isMax = i === LEVELS.length - 1
            const nextThreshold = isMax ? null : LEVEL_THRESHOLDS[i + 1]
            return (
              <div
                key={entry.level}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 10,
                  background: isCurrent ? 'rgba(192,82,30,0.08)' : theme.bgSubtle,
                  border: `1px solid ${isCurrent ? entry.ring : theme.borderLight}`,
                  opacity: reached ? 1 : 0.65,
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: entry.ring, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, fontWeight: 800,
                  flexShrink: 0,
                }}>{entry.level}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: theme.text }}>
                      {entry.title}
                    </div>
                    {isCurrent && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
                        padding: '2px 8px', borderRadius: 20,
                        background: entry.ring, color: '#fff',
                      }}>You</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>
                    {isMax
                      ? `${threshold}+ points · max level`
                      : `${threshold} – ${nextThreshold - 1} points`}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

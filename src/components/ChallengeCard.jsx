import { useTheme } from '../contexts/ThemeContext'

const TYPE_ICONS = {
  books_count: '📚',
  pages_count: '📖',
  genre_diversity: '🎨',
  streak_days: '🔥',
}

export default function ChallengeCard({ challenge, progress, onDelete }) {
  const { theme } = useTheme()
  const { currentValue, isComplete } = progress
  const pct = Math.min(100, Math.round((currentValue / challenge.target_value) * 100))

  return (
    <div style={{
      background: theme.bgCard, border: `1px solid ${isComplete ? theme.sage : theme.border}`,
      borderRadius: 12, padding: '14px 18px',
      opacity: challenge.status === 'expired' ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{TYPE_ICONS[challenge.challenge_type] || '🎯'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, fontFamily: "'DM Sans', sans-serif" }}>
            {challenge.title}
            {isComplete && <span style={{ color: theme.sage, marginLeft: 6 }}>✓</span>}
          </div>
          {challenge.description && (
            <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>{challenge.description}</div>
          )}
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            style={{
              background: 'none', border: 'none', fontSize: 12,
              color: theme.textSubtle, cursor: 'pointer', padding: '2px 4px',
            }}
          >
            ✕
          </button>
        )}
      </div>
      {/* Progress bar */}
      <div style={{
        height: 8, background: theme.bgSubtle, borderRadius: 4, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 4, transition: 'width 0.5s ease',
          background: isComplete ? theme.sage : theme.rust,
          width: `${pct}%`,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 11, color: theme.textSubtle }}>
          {currentValue} / {challenge.target_value}
        </span>
        <span style={{ fontSize: 11, color: isComplete ? theme.sage : theme.rust, fontWeight: 600 }}>
          {pct}%
        </span>
      </div>
    </div>
  )
}

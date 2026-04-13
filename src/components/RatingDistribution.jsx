import { useTheme } from '../contexts/ThemeContext'

export default function RatingDistribution({ stars_1 = 0, stars_2 = 0, stars_3 = 0, stars_4 = 0, stars_5 = 0, rating_count = 0 }) {
  const { theme } = useTheme()
  const bars = [
    { label: '5', count: stars_5 },
    { label: '4', count: stars_4 },
    { label: '3', count: stars_3 },
    { label: '2', count: stars_2 },
    { label: '1', count: stars_1 },
  ]
  const maxCount = Math.max(...bars.map(b => b.count), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
      {bars.map(({ label, count }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: theme.gold, width: 16, textAlign: 'right', flexShrink: 0 }}>
            {label}★
          </span>
          <div style={{
            flex: 1, height: 10, background: theme.bgSubtle,
            borderRadius: 5, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 5,
              background: theme.gold,
              width: count > 0 ? `${Math.max(4, (count / maxCount) * 100)}%` : '0%',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <span style={{ fontSize: 11, color: theme.textSubtle, width: 24, flexShrink: 0 }}>
            {count}
          </span>
        </div>
      ))}
    </div>
  )
}

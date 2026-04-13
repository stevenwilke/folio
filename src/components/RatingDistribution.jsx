import { useTheme } from '../contexts/ThemeContext'

export default function RatingDistribution({ stars_1 = 0, stars_2 = 0, stars_3 = 0, stars_4 = 0, stars_5 = 0 }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6, maxWidth: 200 }}>
      {bars.map(({ label, count }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: theme.textSubtle, width: 10, textAlign: 'right', flexShrink: 0 }}>
            {label}
          </span>
          <div style={{
            flex: 1, height: 6, background: theme.bgSubtle,
            borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 3,
              background: theme.gold,
              width: count > 0 ? `${Math.max(4, (count / maxCount) * 100)}%` : '0%',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <span style={{ fontSize: 10, color: theme.textSubtle, width: 16, flexShrink: 0 }}>
            {count}
          </span>
        </div>
      ))}
    </div>
  )
}

import { useTheme } from '../contexts/ThemeContext'

export default function ReadingHeatmap({ activityDates }) {
  const { theme } = useTheme()

  // Build 52 weeks x 7 days grid going back from today
  const today = new Date()
  const dateCountMap = {}
  for (const d of activityDates) {
    dateCountMap[d] = (dateCountMap[d] || 0) + 1
  }

  // Find the most recent Sunday to align the grid
  const endDate = new Date(today)
  const startOffset = 52 * 7 + today.getDay()
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - startOffset + 1)

  const weeks = []
  let current = new Date(startDate)
  let week = []

  while (current <= endDate) {
    const dateStr = current.toISOString().slice(0, 10)
    const count = dateCountMap[dateStr] || 0
    week.push({ date: dateStr, count })
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
    current.setDate(current.getDate() + 1)
  }
  if (week.length > 0) weeks.push(week)

  const cellSize = 11
  const cellGap = 2
  const totalSize = cellSize + cellGap

  function getColor(count) {
    if (count === 0) return theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
    if (count === 1) return 'rgba(90,122,90,0.35)'
    if (count === 2) return 'rgba(90,122,90,0.55)'
    return 'rgba(90,122,90,0.8)'
  }

  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', '']
  const monthLabels = []
  // Build month labels for the top row
  let lastMonth = -1
  for (let w = 0; w < weeks.length; w++) {
    const firstDay = weeks[w][0]
    if (firstDay) {
      const m = new Date(firstDay.date).getMonth()
      if (m !== lastMonth) {
        monthLabels.push({ week: w, label: new Date(firstDay.date).toLocaleDateString('en-US', { month: 'short' }) })
        lastMonth = m
      }
    }
  }

  const svgWidth = weeks.length * totalSize + 30
  const svgHeight = 7 * totalSize + 20

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <svg width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
        {/* Month labels */}
        {monthLabels.map(({ week, label }) => (
          <text
            key={`m-${week}`}
            x={week * totalSize + 30}
            y={10}
            style={{ fontSize: 10, fill: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}
          >
            {label}
          </text>
        ))}
        {/* Day labels */}
        {dayLabels.map((label, i) => (
          label ? (
            <text
              key={`d-${i}`}
              x={0}
              y={i * totalSize + 28}
              style={{ fontSize: 9, fill: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}
            >
              {label}
            </text>
          ) : null
        ))}
        {/* Grid cells */}
        {weeks.map((week, wi) => (
          week.map((day, di) => (
            <rect
              key={day.date}
              x={wi * totalSize + 30}
              y={di * totalSize + 16}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={getColor(day.count)}
            >
              <title>{day.date}: {day.count} activit{day.count === 1 ? 'y' : 'ies'}</title>
            </rect>
          ))
        ))}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 10, color: theme.textSubtle }}>Less</span>
        {[0, 1, 2, 3].map(n => (
          <div key={n} style={{
            width: cellSize, height: cellSize, borderRadius: 2,
            background: getColor(n),
          }} />
        ))}
        <span style={{ fontSize: 10, color: theme.textSubtle }}>More</span>
      </div>
    </div>
  )
}

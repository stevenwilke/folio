import { useTheme } from '../contexts/ThemeContext'

export default function SparklineChart({ data, width = 200, height = 50, color, label }) {
  const { theme } = useTheme()
  const lineColor = color || theme.rust

  if (!data || data.length < 2) return null

  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const padY = 4
  const effectiveHeight = height - padY * 2

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width
    const y = padY + effectiveHeight - ((val - min) / range) * effectiveHeight
    return `${x},${y}`
  }).join(' ')

  // Fill area
  const fillPoints = `0,${height} ${points} ${width},${height}`

  return (
    <div>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <polygon
          points={fillPoints}
          fill={lineColor}
          opacity={0.1}
        />
        <polyline
          points={points}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Latest value dot */}
        {data.length > 0 && (() => {
          const lastVal = data[data.length - 1]
          const x = width
          const y = padY + effectiveHeight - ((lastVal - min) / range) * effectiveHeight
          return <circle cx={x} cy={y} r={3} fill={lineColor} />
        })()}
      </svg>
      {label && (
        <div style={{ fontSize: 11, color: theme.textSubtle, marginTop: 4 }}>{label}</div>
      )}
    </div>
  )
}

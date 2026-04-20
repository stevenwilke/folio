import { getLevelInfo } from '../lib/level'

/**
 * Avatar with a colored level ring and a small level chip in the corner.
 *
 * Props:
 *   src      – avatar image url (falsy → initial fallback)
 *   name     – used for the initial fallback
 *   size     – avatar diameter in px (default 40)
 *   level    – integer 1-10 (optional; defaults to 1 when missing)
 *   points   – optional points value for tooltip
 *   showChip – render the small numeric chip (default true)
 *   onClick  – forwarded to the wrapper
 */
export default function LevelAvatar({
  src,
  name = '?',
  size = 40,
  level,
  points,
  showChip = true,
  onClick,
  style,
  title,
}) {
  const lvl = Number.isFinite(level) && level > 0 ? level : 1
  const info = getLevelInfo(lvl, points || 0)
  const ringWidth = Math.max(2, Math.round(size / 18))
  const chipSize = Math.max(14, Math.round(size * 0.36))
  const initial = (name || '?').charAt(0).toUpperCase()
  const tooltip = title ?? `Level ${info.level} · ${info.title}`

  const avatarSize = size
  const outerSize = size + ringWidth * 2

  return (
    <div
      onClick={onClick}
      title={tooltip}
      style={{
        position: 'relative',
        width: outerSize,
        height: outerSize,
        cursor: onClick ? 'pointer' : undefined,
        flexShrink: 0,
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: `conic-gradient(${info.ring} ${info.progressPct * 3.6}deg, rgba(0,0,0,0.08) 0deg)`,
          padding: ringWidth,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: avatarSize,
            height: avatarSize,
            borderRadius: '50%',
            overflow: 'hidden',
            background: '#e5dfd5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6a5b4a',
            fontFamily: 'Georgia, serif',
            fontWeight: 700,
            fontSize: Math.round(avatarSize * 0.42),
          }}
        >
          {src ? (
            <img
              src={src}
              alt={name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            initial
          )}
        </div>
      </div>
      {showChip && (
        <div
          aria-label={`Level ${info.level}`}
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: chipSize,
            height: chipSize,
            borderRadius: '50%',
            background: info.ring,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(9, Math.round(chipSize * 0.58)),
            fontWeight: 800,
            fontFamily: "'DM Sans', sans-serif",
            border: '2px solid #fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            lineHeight: 1,
          }}
        >
          {info.level}
        </div>
      )}
    </div>
  )
}

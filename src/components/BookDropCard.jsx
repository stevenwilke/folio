import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'
import { formatDistance } from '../lib/geo'

const CONDITION_LABELS = {
  like_new: 'Like New',
  very_good: 'Very Good',
  good: 'Good',
  acceptable: 'Acceptable',
}

const CONDITION_COLORS = {
  like_new:    '#5a7a5a',
  very_good:   '#5a7a5a',
  good:        '#b8860b',
  acceptable:  '#c0521e',
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30)  return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export default function BookDropCard({ drop, distanceKm, onClick }) {
  const { theme } = useTheme()
  const book = drop.books
  const profile = drop.profiles

  return (
    <div
      onClick={onClick}
      style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12,
        overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      {/* Cover */}
      <div style={{ width: '100%', aspectRatio: '2/3', background: theme.bgSubtle }}>
        {book?.cover_image_url ? (
          <img src={getCoverUrl(book)} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: theme.textSubtle, padding: 10, textAlign: 'center' }}>
            {book?.title}
          </div>
        )}
      </div>

      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, lineHeight: 1.3, fontFamily: "'DM Sans', sans-serif" }}>
          {book?.title}
        </div>
        <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>
          {book?.author}
        </div>

        {/* Condition badge */}
        <span style={{
          display: 'inline-block', marginTop: 6, fontSize: 10, fontWeight: 600,
          padding: '2px 8px', borderRadius: 10,
          background: `${CONDITION_COLORS[drop.condition]}18`,
          color: CONDITION_COLORS[drop.condition],
        }}>
          {CONDITION_LABELS[drop.condition]}
        </span>

        {/* Location */}
        <div style={{ fontSize: 11, color: theme.textSubtle, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>📍</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {drop.location_name}
          </span>
        </div>

        {/* Distance + time */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: theme.textSubtle }}>
          {distanceKm != null && <span>{formatDistance(distanceKm)} away</span>}
          <span>{timeAgo(drop.created_at)}</span>
        </div>

        {/* Dropper */}
        {profile?.username && (
          <div style={{ fontSize: 11, color: theme.textSubtle, marginTop: 4 }}>
            Freed by {profile.username}
          </div>
        )}
      </div>
    </div>
  )
}

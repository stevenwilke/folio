import { useTheme } from '../contexts/ThemeContext'

export default function QuoteCard({ quoteText, bookTitle, bookAuthor, pageNumber, note, username, createdAt, onShare, onDelete, compact }) {
  const { theme } = useTheme()

  return (
    <div style={{
      background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12,
      padding: compact ? '12px 14px' : '16px 20px',
      borderLeft: `3px solid ${theme.gold}`,
    }}>
      <div style={{
        fontFamily: 'Georgia, serif', fontSize: compact ? 14 : 15, fontStyle: 'italic',
        color: theme.text, lineHeight: 1.55, marginBottom: 8,
      }}>
        "{quoteText}"
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div style={{ fontSize: 12, color: theme.textSubtle }}>
          — <span style={{ fontWeight: 600, color: theme.text }}>{bookTitle}</span>
          {bookAuthor && <span> by {bookAuthor}</span>}
          {pageNumber && <span> · p.{pageNumber}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {username && (
            <span style={{ fontSize: 11, color: theme.textSubtle }}>
              Saved by {username}
            </span>
          )}
          {onShare && (
            <button
              onClick={onShare}
              style={{
                background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6,
                padding: '3px 8px', fontSize: 11, color: theme.rust, cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
              }}
            >
              Share to Feed
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              style={{
                background: 'none', border: 'none', padding: '3px 6px',
                fontSize: 11, color: theme.textSubtle, cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {note && (
        <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 6, fontStyle: 'normal' }}>
          Note: {note}
        </div>
      )}
    </div>
  )
}

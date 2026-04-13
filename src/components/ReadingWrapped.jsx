import { useTheme } from '../contexts/ThemeContext'

export default function ReadingWrapped({ entries, sessions, year }) {
  const { theme } = useTheme()

  const readEntries = entries.filter(e => {
    if (!e.has_read && e.read_status !== 'read') return false
    return new Date(e.updated_at).getFullYear() === year
  })

  const yearSessions = (sessions || []).filter(s => {
    if (s.status !== 'completed' || !s.ended_at) return false
    return new Date(s.ended_at).getFullYear() === year
  })

  const totalBooks = readEntries.length
  const totalPages = readEntries.reduce((sum, e) => sum + (e.books?.pages || 0), 0)
  const totalMinutes = yearSessions.reduce((sum, s) => {
    if (!s.started_at || !s.ended_at) return sum
    return sum + (new Date(s.ended_at) - new Date(s.started_at)) / 60000
  }, 0)
  const totalHours = Math.round(totalMinutes / 60)

  // Favorite genre
  const genreMap = {}
  readEntries.forEach(e => {
    const g = e.books?.genre || 'Unknown'
    genreMap[g] = (genreMap[g] || 0) + 1
  })
  const favGenre = Object.entries(genreMap).sort((a, b) => b[1] - a[1])[0]

  // Most-read author
  const authorMap = {}
  readEntries.forEach(e => {
    const a = e.books?.author || 'Unknown'
    authorMap[a] = (authorMap[a] || 0) + 1
  })
  const favAuthor = Object.entries(authorMap).sort((a, b) => b[1] - a[1])[0]

  // Longest book
  const longestBook = readEntries.reduce((best, e) =>
    (e.books?.pages || 0) > (best?.books?.pages || 0) ? e : best, null)

  // Reading personality
  const topGenres = Object.entries(genreMap).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g)
  const personality = topGenres.length >= 2
    ? `The ${topGenres[0]} & ${topGenres[1]} Enthusiast`
    : topGenres.length === 1
      ? `The ${topGenres[0]} Devotee`
      : 'The Explorer'

  if (totalBooks === 0) return null

  const statStyle = {
    textAlign: 'center', padding: '12px 8px',
  }
  const numStyle = {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontSize: 28, fontWeight: 700, color: theme.text, lineHeight: 1.1,
  }
  const labelStyle = {
    fontSize: 11, color: theme.textSubtle, marginTop: 4,
    textTransform: 'uppercase', letterSpacing: 0.8,
  }

  return (
    <div style={{
      background: `linear-gradient(135deg, ${theme.bgCard}, ${theme.bgSubtle})`,
      border: `1px solid ${theme.border}`, borderRadius: 16,
      padding: '24px 28px', marginBottom: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 24 }}>📖</span>
        <div>
          <div style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: 20, fontWeight: 700, color: theme.text,
          }}>
            {year} Reading Wrapped
          </div>
          <div style={{ fontSize: 13, color: theme.gold, fontWeight: 600, fontStyle: 'italic' }}>
            {personality}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        <div style={statStyle}>
          <div style={numStyle}>{totalBooks}</div>
          <div style={labelStyle}>Books</div>
        </div>
        <div style={statStyle}>
          <div style={numStyle}>{totalPages.toLocaleString()}</div>
          <div style={labelStyle}>Pages</div>
        </div>
        <div style={statStyle}>
          <div style={numStyle}>{totalHours}</div>
          <div style={labelStyle}>Hours</div>
        </div>
        <div style={statStyle}>
          <div style={numStyle}>{Object.keys(genreMap).length}</div>
          <div style={labelStyle}>Genres</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {favGenre && (
          <div style={{
            background: theme.bgCard, borderRadius: 10, padding: '12px 14px',
            border: `1px solid ${theme.border}`,
          }}>
            <div style={{ fontSize: 10, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              Top Genre
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{favGenre[0]}</div>
            <div style={{ fontSize: 12, color: theme.textSubtle }}>{favGenre[1]} books</div>
          </div>
        )}
        {favAuthor && (
          <div style={{
            background: theme.bgCard, borderRadius: 10, padding: '12px 14px',
            border: `1px solid ${theme.border}`,
          }}>
            <div style={{ fontSize: 10, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              Top Author
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{favAuthor[0]}</div>
            <div style={{ fontSize: 12, color: theme.textSubtle }}>{favAuthor[1]} books</div>
          </div>
        )}
        {longestBook?.books && (
          <div style={{
            background: theme.bgCard, borderRadius: 10, padding: '12px 14px',
            border: `1px solid ${theme.border}`,
          }}>
            <div style={{ fontSize: 10, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              Longest Book
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, lineHeight: 1.3 }}>
              {longestBook.books.title}
            </div>
            <div style={{ fontSize: 12, color: theme.textSubtle }}>{longestBook.books.pages} pages</div>
          </div>
        )}
        {yearSessions.length > 0 && (
          <div style={{
            background: theme.bgCard, borderRadius: 10, padding: '12px 14px',
            border: `1px solid ${theme.border}`,
          }}>
            <div style={{ fontSize: 10, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              Reading Sessions
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{yearSessions.length}</div>
            <div style={{ fontSize: 12, color: theme.textSubtle }}>
              {Math.round(totalMinutes / yearSessions.length)} min avg
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

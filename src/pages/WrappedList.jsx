import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { getCoverUrl } from '../lib/coverUrl'

/**
 * Filtered book list — the deep-link target from Stats cards.
 *   /wrapped-list?type=genre&value=Non-Fiction&year=2026
 *   /wrapped-list?type=year&value=2026
 *   /wrapped-list?type=month&value=2026-04
 */
export default function WrappedList({ session }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { theme } = useTheme()
  const isMobile = useIsMobile()

  const type  = params.get('type')  || 'all-read'
  const value = params.get('value') || ''
  const year  = params.get('year')  ? parseInt(params.get('year'), 10) : null
  const customTitle = params.get('title')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const screenTitle =
    customTitle
      || (type === 'genre'  ? `${value} books`
      :   type === 'author' ? `By ${value}`
      :   type === 'year'   ? `Books read in ${value}`
      :   type === 'month'  ? `Books read in ${formatMonth(value)}`
      :   'Books')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      let q = supabase
        .from('collection_entries')
        .select('id, read_status, added_at, books!inner(id, title, author, cover_image_url, genre, pages)')
        .eq('user_id', session.user.id)
        .eq('read_status', 'read')

      if (type === 'genre')  q = q.eq('books.genre', value)
      if (type === 'author') q = q.eq('books.author', value)

      const { data } = await q.order('added_at', { ascending: false })
      let result = data || []

      if (year != null) {
        result = result.filter(r => r.added_at && new Date(r.added_at).getFullYear() === year)
      }
      if (type === 'month') {
        // value is YYYY-MM
        result = result.filter(r => r.added_at && r.added_at.startsWith(value))
      }

      if (!cancelled) { setRows(result); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [type, value, year, session.user.id])

  const containerStyle = {
    maxWidth: 1100,
    margin: '0 auto',
    padding: isMobile ? '20px 16px 80px' : '32px 24px',
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text }}>
      <NavBar session={session} />
      <div style={containerStyle}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 8,
            padding: '6px 12px', color: theme.textSubtle, cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif", fontSize: 13, marginBottom: 16,
          }}
        >← Back</button>

        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, margin: '0 0 4px' }}>
          {screenTitle}
        </h1>
        <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 24 }}>
          {loading ? 'Loading…' : `${rows.length} book${rows.length === 1 ? '' : 's'}`}
        </div>

        {!loading && rows.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: theme.textSubtle }}>
            No books match this filter yet.
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 18,
        }}>
          {rows.map(r => (
            <BookTile key={r.id} book={r.books} theme={theme} />
          ))}
        </div>
      </div>
    </div>
  )
}

function BookTile({ book, theme }) {
  const url = getCoverUrl(book)
  return (
    <div style={{
      background: theme.bgSubtle, border: `1px solid ${theme.borderLight}`,
      borderRadius: 8, overflow: 'hidden', padding: 8,
    }}>
      <div style={{
        aspectRatio: '2/3', background: theme.border, borderRadius: 4,
        overflow: 'hidden', marginBottom: 8,
      }}>
        {url
          ? <img src={url} alt={book?.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => e.target.style.display = 'none'} />
          : null
        }
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, lineHeight: 1.3, marginBottom: 2 }}>
        {book?.title}
      </div>
      <div style={{ fontSize: 11, color: theme.textSubtle, lineHeight: 1.3 }}>
        {book?.author}
      </div>
    </div>
  )
}

function formatMonth(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

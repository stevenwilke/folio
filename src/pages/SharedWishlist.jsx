import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { getCoverUrl } from '../lib/coverUrl'

/**
 * Public-facing landing page for "share my wishlist" links from the mobile app.
 * Shows the user's full want-to-read list (no clipping/scrolling-required),
 * with a clear link back to the full profile.
 *
 * Works for unauthenticated visitors — no session required.
 */
export default function SharedWishlist({ session }) {
  const { username } = useParams()
  const { theme } = useTheme()
  const isMobile = useIsMobile()

  const [profile, setProfile] = useState(null)
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, level, level_points, is_public')
        .eq('username', username)
        .maybeSingle()

      if (!prof) { if (!cancelled) { setNotFound(true); setLoading(false) }; return }
      if (!cancelled) setProfile(prof)

      const { data: rows } = await supabase
        .from('collection_entries')
        .select('id, added_at, books!inner(id, title, author, cover_image_url, isbn_13, isbn_10)')
        .eq('user_id', prof.id)
        .eq('read_status', 'want')
        .order('added_at', { ascending: false })

      if (!cancelled) {
        setBooks(rows || [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [username])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg }}>
        <NavBar session={session} />
        <div style={{ padding: 80, textAlign: 'center', color: theme.textSubtle }}>Loading…</div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg }}>
        <NavBar session={session} />
        <div style={{ padding: 80, textAlign: 'center', color: theme.textSubtle }}>
          We couldn't find @{username}.
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, paddingBottom: 60 }}>
      <NavBar session={session} />

      <div style={{ maxWidth: 920, margin: '0 auto', padding: isMobile ? '24px 16px' : '40px 24px' }}>
        <div style={{ marginBottom: 8, fontSize: 12, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 1.2 }}>
          Reading Wishlist
        </div>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: isMobile ? 26 : 32, fontWeight: 700, margin: '0 0 6px' }}>
          @{profile.username}'s Want-to-Read List
        </h1>
        <div style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 4 }}>
          {books.length} book{books.length === 1 ? '' : 's'} on the list
        </div>
        <Link
          to={`/profile/${profile.username}`}
          style={{ fontSize: 13, color: theme.rust, textDecoration: 'none', fontWeight: 600 }}
        >
          View full profile →
        </Link>

        {books.length === 0 ? (
          <div style={{ marginTop: 32, padding: 40, textAlign: 'center', background: theme.bgSubtle, borderRadius: 12, color: theme.textSubtle }}>
            @{profile.username} hasn't added any books to their wishlist yet.
          </div>
        ) : (
          <div style={{
            marginTop: 28,
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: isMobile ? 14 : 20,
          }}>
            {books.map(r => <WishlistTile key={r.id} book={r.books} theme={theme} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function WishlistTile({ book, theme }) {
  const url = getCoverUrl(book)
  return (
    <div style={{
      background: theme.bgSubtle, border: `1px solid ${theme.borderLight}`,
      borderRadius: 10, overflow: 'hidden', padding: 10,
    }}>
      <div style={{
        aspectRatio: '2/3', background: theme.border, borderRadius: 4,
        overflow: 'hidden', marginBottom: 10,
      }}>
        {url ? <img src={url} alt={book?.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => e.target.style.display = 'none'} /> : null}
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

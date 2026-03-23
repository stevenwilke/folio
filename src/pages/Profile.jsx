import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BookDetail from './BookDetail'

const STATUS_LABELS = {
  owned:   'In Library',
  read:    'Read',
  reading: 'Reading',
  want:    'Want to Read',
}
const STATUS_COLORS = {
  owned:   { bg: 'rgba(138,127,114,0.15)', color: '#8a7f72' },
  read:    { bg: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
  reading: { bg: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
  want:    { bg: 'rgba(184,134,11,0.12)',  color: '#b8860b' },
}

export default function Profile({ session }) {
  const { username } = useParams()
  const navigate = useNavigate()
  const [profile, setProfile]       = useState(null)
  const [books, setBooks]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [notFound, setNotFound]     = useState(false)
  const [filter, setFilter]         = useState('all')
  const [selectedBook, setSelectedBook] = useState(null)

  const isOwnProfile = session?.user?.id === profile?.id

  useEffect(() => {
    fetchProfile()
  }, [username])

  async function fetchProfile() {
    setLoading(true)
    setNotFound(false)
    setBooks([])
    setProfile(null)

    const { data: prof } = await supabase
      .from('profiles')
      .select('id, username, bio, is_public, created_at')
      .eq('username', username)
      .maybeSingle()

    if (!prof) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setProfile(prof)

    const isOwn = session?.user?.id === prof.id
    if (!prof.is_public && !isOwn) {
      setLoading(false)
      return
    }

    const { data: entries } = await supabase
      .from('collection_entries')
      .select(`
        id, read_status, user_rating, review_text, added_at,
        books ( id, title, author, cover_image_url, genre, published_year )
      `)
      .eq('user_id', prof.id)
      .order('added_at', { ascending: false })

    setBooks(entries || [])
    setLoading(false)
  }

  const stats = {
    total:   books.length,
    read:    books.filter(b => b.read_status === 'read').length,
    reading: books.filter(b => b.read_status === 'reading').length,
    want:    books.filter(b => b.read_status === 'want').length,
    avgRating: (() => {
      const rated = books.filter(b => b.user_rating)
      if (!rated.length) return null
      return (rated.reduce((sum, b) => sum + b.user_rating, 0) / rated.length).toFixed(1)
    })(),
  }

  const filtered = filter === 'all' ? books : books.filter(e => e.read_status === filter)
  const reviews  = books.filter(b => b.review_text)

  const joinDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  if (loading) {
    return (
      <div style={s.page}>
        <Topbar navigate={navigate} session={session} />
        <div style={s.empty}>Loading…</div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div style={s.page}>
        <Topbar navigate={navigate} session={session} />
        <div style={{ ...s.empty, paddingTop: 80 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📚</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, color: '#1a1208', marginBottom: 8 }}>
            Profile not found
          </div>
          <div style={{ color: '#8a7f72', marginBottom: 24 }}>
            No user with the username "{username}" exists.
          </div>
          <button style={s.btnPrimary} onClick={() => navigate('/')}>
            {session ? 'Go to My Library' : 'Go to Folio'}
          </button>
        </div>
      </div>
    )
  }

  const isPrivate = !profile.is_public && !isOwnProfile

  return (
    <div style={s.page}>
      <Topbar navigate={navigate} session={session} />

      <div style={s.content}>

        {/* Profile header */}
        <div style={s.profileHeader}>
          <div style={s.avatar}>
            {profile.username.charAt(0).toUpperCase()}
          </div>
          <div style={s.profileInfo}>
            <div style={s.profileName}>{profile.username}</div>
            {profile.bio && <div style={s.profileBio}>{profile.bio}</div>}
            {joinDate && <div style={s.profileMeta}>Member since {joinDate}</div>}
          </div>
          {isOwnProfile && (
            <button style={s.btnGhost} onClick={() => navigate('/')}>
              ← My Library
            </button>
          )}
        </div>

        {isPrivate ? (
          <div style={s.privateBox}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, color: '#1a1208', marginBottom: 8 }}>
              This shelf is private
            </div>
            <div style={{ color: '#8a7f72', fontSize: 14 }}>
              {profile.username} hasn't made their library public yet.
            </div>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div style={s.statsRow}>
              {[
                ['Total Books', stats.total,   null],
                ['Read',        stats.read,    '#5a7a5a'],
                ['Reading',     stats.reading, '#c0521e'],
                ['Want to Read',stats.want,    '#b8860b'],
                ...(stats.avgRating ? [['Avg Rating', `${stats.avgRating} ★`, '#b8860b']] : []),
              ].map(([label, val, color]) => (
                <div key={label} style={s.statCard}>
                  <div style={{ ...s.statVal, color: color || '#1a1208' }}>{val}</div>
                  <div style={s.statLabel}>{label}</div>
                </div>
              ))}
            </div>

            {/* Filter pills */}
            <div style={s.filterRow}>
              {['all', 'owned', 'read', 'reading', 'want'].map(f => (
                <button
                  key={f}
                  style={filter === f ? s.filterActive : s.filterInactive}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All Books' : STATUS_LABELS[f]}
                </button>
              ))}
            </div>

            {/* Book grid */}
            {books.length === 0 ? (
              <div style={s.empty}>
                {isOwnProfile
                  ? 'Your library is empty — add your first book!'
                  : `${profile.username} hasn't added any books yet.`}
              </div>
            ) : filtered.length === 0 ? (
              <div style={s.empty}>No books with this status.</div>
            ) : (
              <div style={s.grid}>
                {filtered.map(entry => (
                  <ProfileBookCard
                    key={entry.id}
                    entry={entry}
                    onSelect={session ? () => setSelectedBook(entry.books.id) : undefined}
                  />
                ))}
              </div>
            )}

            {/* Reviews */}
            {reviews.length > 0 && (
              <div style={s.reviewsSection}>
                <div style={s.sectionTitle}>
                  Reviews by {profile.username}
                  <span style={s.sectionCount}>{reviews.length}</span>
                </div>
                <div style={s.reviewsList}>
                  {reviews.map(entry => (
                    <ReviewCard
                      key={entry.id}
                      entry={entry}
                      onBookClick={session ? () => setSelectedBook(entry.books.id) : undefined}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Book detail overlay */}
      {selectedBook && session && (
        <div style={{ position: 'fixed', inset: 0, background: '#f5f0e8', zIndex: 40, overflowY: 'auto', isolation: 'isolate' }}>
          <BookDetail
            bookId={selectedBook}
            session={session}
            onBack={() => setSelectedBook(null)}
          />
        </div>
      )}
    </div>
  )
}

// ---- TOPBAR ----
function Topbar({ navigate, session }) {
  return (
    <div style={s.topbar}>
      <div style={s.logo} onClick={() => navigate('/')} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && navigate('/')}>
        Folio
      </div>
      <div style={s.topbarRight}>
        {session
          ? <button style={s.btnGhost} onClick={() => navigate('/')}>My Library</button>
          : <button style={s.btnPrimary} onClick={() => navigate('/')}>Sign In</button>
        }
      </div>
    </div>
  )
}

// ---- PROFILE BOOK CARD ----
function ProfileBookCard({ entry, onSelect }) {
  const book   = entry.books
  const status = entry.read_status

  return (
    <div
      style={{ ...s.card, cursor: onSelect ? 'pointer' : 'default' }}
      onClick={onSelect}
    >
      <div style={s.coverWrap}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={s.coverImg} />
          : <FakeCover title={book.title} />
        }
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={s.bookTitle}>{book.title}</div>
        <div style={s.bookAuthor}>{book.author}</div>
        <div style={{ marginTop: 6 }}>
          <span style={{ ...s.badge, ...STATUS_COLORS[status] }}>
            {STATUS_LABELS[status]}
          </span>
        </div>
        {entry.user_rating && (
          <div style={s.cardRating}>
            {'★'.repeat(entry.user_rating)}{'☆'.repeat(5 - entry.user_rating)}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- REVIEW CARD ----
function ReviewCard({ entry, onBookClick }) {
  const book = entry.books
  return (
    <div style={s.reviewCard}>
      <div
        style={{ ...s.reviewCover, cursor: onBookClick ? 'pointer' : 'default' }}
        onClick={onBookClick}
      >
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
          : <MiniCover title={book.title} />
        }
      </div>
      <div style={s.reviewBody}>
        <div
          onClick={onBookClick}
          role={onBookClick ? 'button' : undefined}
          style={{ ...s.reviewBookTitle, cursor: onBookClick ? 'pointer' : 'default' }}
        >
          {book.title}
        </div>
        <div style={s.reviewBookAuthor}>{book.author}</div>
        {entry.user_rating && (
          <div style={s.reviewStars}>
            {'★'.repeat(entry.user_rating)}{'☆'.repeat(5 - entry.user_rating)}
          </div>
        )}
        <div style={s.reviewText}>{entry.review_text}</div>
        <div style={s.reviewDate}>
          {new Date(entry.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
    </div>
  )
}

// ---- FAKE COVER ----
function FakeCover({ title }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const color  = colors[title.charCodeAt(0) % colors.length]
  const color2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return (
    <div style={{ ...s.fakeCover, background: `linear-gradient(135deg, ${color}, ${color2})` }}>
      <div style={s.fakeSpine} />
      <span style={s.fakeCoverText}>{title}</span>
    </div>
  )
}

function MiniCover({ title }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const color  = colors[title.charCodeAt(0) % colors.length]
  const color2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return (
    <div style={{ width: '100%', height: '100%', borderRadius: 4, background: `linear-gradient(135deg, ${color}, ${color2})` }} />
  )
}

// ---- STYLES ----
const s = {
  page:           { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif" },
  topbar:         { position: 'sticky', top: 0, zIndex: 10, background: 'rgba(245,240,232,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #d4c9b0', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:           { fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, color: '#1a1208', cursor: 'pointer' },
  topbarRight:    { display: 'flex', gap: 10, alignItems: 'center' },
  content:        { padding: '32px 32px', maxWidth: 960, margin: '0 auto' },
  btnPrimary:     { padding: '8px 16px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnGhost:       { padding: '8px 16px', background: 'transparent', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#1a1208' },

  profileHeader:  { display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 32, background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, padding: '28px 28px' },
  avatar:         { width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontSize: 26, color: 'white', fontWeight: 700, flexShrink: 0 },
  profileInfo:    { flex: 1 },
  profileName:    { fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 700, color: '#1a1208', marginBottom: 6 },
  profileBio:     { fontSize: 14, color: '#3a3028', lineHeight: 1.5, marginBottom: 6 },
  profileMeta:    { fontSize: 12, color: '#8a7f72' },

  privateBox:     { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, padding: '60px 32px', textAlign: 'center', marginTop: 8 },

  statsRow:       { display: 'flex', gap: 14, marginBottom: 28, flexWrap: 'wrap' },
  statCard:       { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 12, padding: '18px 22px', flex: 1, minWidth: 100 },
  statVal:        { fontFamily: 'Georgia, serif', fontSize: 30, fontWeight: 700 },
  statLabel:      { fontSize: 11, color: '#8a7f72', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },

  filterRow:      { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
  filterActive:   { padding: '7px 16px', borderRadius: 8, border: 'none', background: '#c0521e', color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  filterInactive: { padding: '7px 16px', borderRadius: 8, border: '1px solid #d4c9b0', background: 'transparent', color: '#1a1208', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

  grid:           { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 20, marginBottom: 48 },
  card:           {},
  coverWrap:      { width: '100%', aspectRatio: '2/3' },
  coverImg:       { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 5, boxShadow: '2px 3px 10px rgba(26,18,8,0.2)' },
  fakeCover:      { width: '100%', height: '100%', borderRadius: 5, display: 'flex', alignItems: 'flex-end', padding: '8px 8px 8px 14px', position: 'relative', overflow: 'hidden', boxShadow: '2px 3px 10px rgba(26,18,8,0.2)' },
  fakeSpine:      { position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, background: 'rgba(0,0,0,0.2)' },
  fakeCoverText:  { fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.5)', lineHeight: 1.3, position: 'relative', zIndex: 1 },
  bookTitle:      { fontSize: 13, fontWeight: 500, lineHeight: 1.3, color: '#1a1208' },
  bookAuthor:     { fontSize: 12, color: '#8a7f72', marginTop: 2 },
  badge:          { display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 500 },
  cardRating:     { fontSize: 11, color: '#b8860b', marginTop: 4, letterSpacing: 1 },

  empty:          { color: '#8a7f72', fontSize: 14, padding: '60px 0', textAlign: 'center' },

  reviewsSection: { marginTop: 8 },
  sectionTitle:   { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: '#1a1208', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 },
  sectionCount:   { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(192,82,30,0.1)', color: '#c0521e', borderRadius: 20, padding: '2px 10px', fontSize: 13, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 },
  reviewsList:    { display: 'flex', flexDirection: 'column', gap: 16 },
  reviewCard:     { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 12, padding: '18px', display: 'flex', gap: 16 },
  reviewCover:    { width: 52, height: 78, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: '#e8dfc8' },
  reviewBody:     { flex: 1 },
  reviewBookTitle:{ fontSize: 15, fontWeight: 600, color: '#1a1208', lineHeight: 1.3, marginBottom: 2 },
  reviewBookAuthor:{ fontSize: 13, color: '#8a7f72', marginBottom: 6 },
  reviewStars:    { fontSize: 13, color: '#b8860b', letterSpacing: 1, marginBottom: 8 },
  reviewText:     { fontSize: 14, color: '#3a3028', lineHeight: 1.6 },
  reviewDate:     { fontSize: 12, color: '#8a7f72', marginTop: 8 },
}

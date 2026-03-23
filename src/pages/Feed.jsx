import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BookDetail from './BookDetail'

const ACTION_TEXT = {
  read:    'finished reading',
  reading: 'started reading',
  want:    'wants to read',
  owned:   'added to their library',
}

const ACTION_COLOR = {
  read:    '#5a7a5a',
  reading: '#c0521e',
  want:    '#b8860b',
  owned:   '#8a7f72',
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Feed({ session }) {
  const navigate = useNavigate()
  const [activity, setActivity]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [hasFriends, setHasFriends] = useState(true)
  const [selectedBook, setSelectedBook] = useState(null)
  const [myUsername, setMyUsername]     = useState(null)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('username')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setMyUsername(data?.username || null))
  }, [session.user.id])

  useEffect(() => { fetchFeed() }, [])

  async function fetchFeed() {
    setLoading(true)

    // Step 1: get accepted friend IDs
    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)

    const friendIds = (friendships || []).map(f =>
      f.requester_id === session.user.id ? f.addressee_id : f.requester_id
    )

    if (!friendIds.length) {
      setHasFriends(false)
      setLoading(false)
      return
    }

    setHasFriends(true)

    // Step 2: get friend profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', friendIds)

    // Step 3: get their recent activity
    const { data: entries } = await supabase
      .from('collection_entries')
      .select('id, user_id, read_status, user_rating, review_text, added_at, books(id, title, author, cover_image_url)')
      .in('user_id', friendIds)
      .order('added_at', { ascending: false })
      .limit(50)

    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]))
    setActivity((entries || []).map(e => ({ ...e, profile: profileMap[e.user_id] })))
    setLoading(false)
  }

  return (
    <div style={s.page}>
      {/* Topbar */}
      <div style={s.topbar}>
        <div style={s.logo} onClick={() => navigate('/')} role="button" tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && navigate('/')}>
          Folio
        </div>
        <div style={s.topbarRight}>
          <button style={s.btnActive}>Feed</button>
          <button style={s.btnGhost} onClick={() => navigate('/')}>My Library</button>
          {myUsername && (
            <button style={s.btnGhost} onClick={() => navigate(`/profile/${myUsername}`)}>
              My Profile
            </button>
          )}
        </div>
      </div>

      <div style={s.content}>
        <div style={s.pageHeader}>
          <div style={s.pageTitle}>Friends' Activity</div>
          <div style={s.pageSubtitle}>See what your friends are reading and reviewing</div>
        </div>

        {loading ? (
          <div style={s.empty}>Loading feed…</div>
        ) : !hasFriends ? (
          <div style={s.emptyBox}>
            <div style={s.emptyIcon}>📚</div>
            <div style={s.emptyTitle}>No connections yet</div>
            <div style={s.emptyText}>
              Add friends to see their reading activity here.
            </div>
            <button style={s.btnPrimary} onClick={() => navigate('/')}>
              Go to My Library
            </button>
          </div>
        ) : activity.length === 0 ? (
          <div style={s.emptyBox}>
            <div style={s.emptyIcon}>📖</div>
            <div style={s.emptyTitle}>No activity yet</div>
            <div style={s.emptyText}>
              Your friends haven't added any books recently.
            </div>
          </div>
        ) : (
          <div style={s.feed}>
            {activity.map(item => (
              <ActivityCard
                key={item.id}
                item={item}
                onBookClick={() => setSelectedBook(item.books.id)}
                onProfileClick={() => navigate(`/profile/${item.profile?.username}`)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedBook && (
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

// ---- ACTIVITY CARD ----
function ActivityCard({ item, onBookClick, onProfileClick }) {
  const book    = item.books
  const profile = item.profile
  const action  = ACTION_TEXT[item.read_status] || 'added'
  const color   = ACTION_COLOR[item.read_status] || '#8a7f72'

  return (
    <div style={s.card}>
      {/* Avatar */}
      <div style={s.avatar} onClick={onProfileClick} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onProfileClick()}>
        {profile?.username?.charAt(0).toUpperCase() || '?'}
      </div>

      {/* Body */}
      <div style={s.cardBody}>
        <div style={s.cardTop}>
          <span style={s.username} onClick={onProfileClick} role="button" tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onProfileClick()}>
            {profile?.username}
          </span>
          {' '}
          <span style={{ ...s.action, color }}>{action}</span>
          {' '}
          <span style={s.bookLink} onClick={onBookClick} role="button" tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onBookClick()}>
            {book.title}
          </span>
          <span style={s.byAuthor}> by {book.author}</span>
        </div>

        {item.user_rating && (
          <div style={s.stars}>
            {'★'.repeat(item.user_rating)}{'☆'.repeat(5 - item.user_rating)}
          </div>
        )}

        {item.review_text && (
          <div style={s.review}>"{item.review_text}"</div>
        )}

        <div style={s.meta}>{timeAgo(item.added_at)}</div>
      </div>

      {/* Book cover */}
      <div style={s.coverWrap} onClick={onBookClick} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onBookClick()}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={s.coverImg} />
          : <FakeCover title={book.title} />
        }
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
    <div style={{ width: '100%', height: '100%', borderRadius: 4, background: `linear-gradient(135deg, ${color}, ${color2})` }} />
  )
}

// ---- STYLES ----
const s = {
  page:        { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif" },
  topbar:      { position: 'sticky', top: 0, zIndex: 10, background: 'rgba(245,240,232,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #d4c9b0', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:        { fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, color: '#1a1208', cursor: 'pointer' },
  topbarRight: { display: 'flex', gap: 10, alignItems: 'center' },
  btnActive:   { padding: '8px 16px', background: '#1a1208', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnGhost:    { padding: '8px 16px', background: 'transparent', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#1a1208' },
  btnPrimary:  { padding: '10px 20px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

  content:     { padding: '32px 32px', maxWidth: 680, margin: '0 auto' },
  pageHeader:  { marginBottom: 28 },
  pageTitle:   { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, color: '#1a1208', marginBottom: 6 },
  pageSubtitle:{ fontSize: 14, color: '#8a7f72' },

  feed:        { display: 'flex', flexDirection: 'column', gap: 2 },
  card:        { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 14, padding: '18px 20px', display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 12 },

  avatar:      { width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 16, flexShrink: 0, cursor: 'pointer' },
  cardBody:    { flex: 1, minWidth: 0 },
  cardTop:     { fontSize: 14, color: '#3a3028', lineHeight: 1.5, flexWrap: 'wrap' },
  username:    { fontWeight: 700, color: '#1a1208', cursor: 'pointer' },
  action:      { fontWeight: 500 },
  bookLink:    { fontWeight: 600, color: '#c0521e', cursor: 'pointer' },
  byAuthor:    { color: '#8a7f72' },
  stars:       { fontSize: 14, color: '#b8860b', letterSpacing: 1, marginTop: 6 },
  review:      { fontSize: 13, color: '#3a3028', lineHeight: 1.6, marginTop: 8, fontStyle: 'italic', borderLeft: '3px solid #d4c9b0', paddingLeft: 10 },
  meta:        { fontSize: 12, color: '#8a7f72', marginTop: 8 },

  coverWrap:   { width: 52, height: 78, flexShrink: 0, borderRadius: 4, overflow: 'hidden', cursor: 'pointer' },
  coverImg:    { width: '100%', height: '100%', objectFit: 'cover' },

  empty:       { color: '#8a7f72', fontSize: 14, padding: '60px 0', textAlign: 'center' },
  emptyBox:    { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, padding: '60px 32px', textAlign: 'center' },
  emptyIcon:   { fontSize: 40, marginBottom: 16 },
  emptyTitle:  { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: '#1a1208', marginBottom: 8 },
  emptyText:   { fontSize: 14, color: '#8a7f72', marginBottom: 24 },
}

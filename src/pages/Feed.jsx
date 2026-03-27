import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BookDetail from './BookDetail'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'
import { useIsMobile } from '../hooks/useIsMobile'

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
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const [activity, setActivity]         = useState([])
  const [friendListings, setFriendListings] = useState([])
  const [loading, setLoading]           = useState(true)
  const [hasFriends, setHasFriends]     = useState(true)
  const [selectedBook, setSelectedBook] = useState(null)

  const s = makeStyles(theme, isMobile)

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

    // Step 3: get their recent activity + active listings in parallel
    const [{ data: entries }, { data: listings }] = await Promise.all([
      supabase
        .from('collection_entries')
        .select('id, user_id, read_status, user_rating, review_text, added_at, books(id, title, author, cover_image_url, isbn_13, isbn_10)')
        .in('user_id', friendIds)
        .order('added_at', { ascending: false })
        .limit(50),
      supabase
        .from('listings')
        .select('id, price, condition, created_at, seller_id, books(id, title, author, cover_image_url), profiles!listings_seller_id_fkey(username)')
        .in('seller_id', friendIds)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(12),
    ])

    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]))
    setActivity((entries || []).map(e => ({ ...e, profile: profileMap[e.user_id] })))
    setFriendListings(listings || [])
    setLoading(false)
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />

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
        ) : (
          <div style={s.feed}>
            {/* Friends' marketplace listings */}
            {friendListings.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  🏪 For Sale by Friends
                  <span style={{ fontSize: 12, fontWeight: 500, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}>{friendListings.length} listing{friendListings.length !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }}>
                  {friendListings.map(l => (
                    <FriendListingCard key={l.id} listing={l} onView={() => navigate('/marketplace')} theme={theme} />
                  ))}
                </div>
              </div>
            )}
            {/* Activity feed */}
            {activity.length === 0 ? (
              <div style={{ ...s.emptyBox, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={s.emptyIcon}>📰</div>
                <div style={s.emptyTitle}>No activity yet</div>
                <div style={s.emptyText}>Your friends haven't added any books recently.</div>
              </div>
            ) : activity.map(item => (
              <ActivityCard
                key={item.id}
                item={item}
                theme={theme}
                onBookClick={() => setSelectedBook(item.books.id)}
                onProfileClick={() => navigate(`/profile/${item.profile?.username}`)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedBook && (
        <div style={{ position: 'fixed', inset: 0, background: theme.bg, zIndex: 40, overflowY: 'auto', isolation: 'isolate' }}>
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
function ActivityCard({ item, onBookClick, onProfileClick, theme }) {
  const isMobile = useIsMobile()
  const s       = makeStyles(theme, isMobile)
  const book    = item.books
  const profile = item.profile
  const action  = ACTION_TEXT[item.read_status] || 'added'
  const color   = ACTION_COLOR[item.read_status] || theme.textSubtle
  const [hover, setHover] = useState(false)

  return (
    <div
      style={{ ...s.card, borderLeft: `3px solid ${color}`, ...(hover ? s.cardHover : {}), cursor: 'pointer' }}
      onClick={onBookClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Avatar */}
      <div style={s.avatar} onClick={e => { e.stopPropagation(); onProfileClick() }} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onProfileClick()}>
        {profile?.username?.charAt(0).toUpperCase() || '?'}
      </div>

      {/* Body */}
      <div style={s.cardBody}>
        <div style={s.cardTop}>
          <span style={s.username} onClick={e => { e.stopPropagation(); onProfileClick() }} role="button" tabIndex={0}>
            {profile?.username}
          </span>
          {' '}
          <span style={{ ...s.action, color }}>{action}</span>
          {' '}
          <span style={s.bookLink}>{book.title}</span>
          <span style={s.byAuthor}> by {book.author}</span>
        </div>

        {item.user_rating && (
          <div style={s.stars}>
            {'★'.repeat(item.user_rating)}{'☆'.repeat(5 - item.user_rating)}
            <span style={s.ratingNum}> {item.user_rating}/5</span>
          </div>
        )}

        {item.review_text && (
          <div style={s.review}>"{item.review_text}"</div>
        )}

        <div style={s.meta}>
          {timeAgo(item.added_at)}
          <span style={s.tapHint}> · Tap to view &amp; borrow</span>
        </div>
      </div>

      {/* Book cover */}
      <div style={s.coverWrap}>
        {(() => {
          const url = getCoverUrl(book)
          return url
            ? <img src={url} alt={book.title} style={s.coverImg} onError={e => e.target.style.display='none'} />
            : <FakeCover title={book.title} />
        })()}
      </div>
    </div>
  )
}

// ---- FRIEND LISTING CARD ----
const COND_LABEL = { like_new: 'Like New', very_good: 'Very Good', good: 'Good', acceptable: 'Acceptable', poor: 'Poor' }
function FriendListingCard({ listing, onView, theme }) {
  const book = listing.books
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#8b2500','#b8860b','#3d5a5a']
  const c = colors[(book.title || '').charCodeAt(0) % colors.length]
  const c2 = colors[((book.title || '').charCodeAt(0) + 3) % colors.length]
  return (
    <div
      onClick={onView}
      style={{ flexShrink: 0, width: 130, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', boxShadow: theme.shadowCard }}
    >
      <div style={{ width: '100%', height: 90, background: `linear-gradient(135deg, ${c}, ${c2})`, position: 'relative', overflow: 'hidden' }}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} />
          : null}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.3, marginBottom: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{book.title}</div>
        <div style={{ fontSize: 11, color: theme.textSubtle, marginBottom: 6 }}>{listing.profiles?.username}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: theme.text }}>${Number(listing.price).toFixed(2)}</span>
          <span style={{ fontSize: 10, color: theme.textSubtle }}>{COND_LABEL[listing.condition] || listing.condition}</span>
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
    <div style={{ width: '100%', height: '100%', borderRadius: 4, background: `linear-gradient(135deg, ${color}, ${color2})` }} />
  )
}

// ---- STYLES ----
function makeStyles(theme, isMobile = false) {
  return {
    page:        { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },

    content:     { padding: isMobile ? '16px' : '32px 32px', maxWidth: isMobile ? '100%' : 680, margin: '0 auto' },
    pageHeader:  { marginBottom: 28 },
    pageTitle:   { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, color: theme.text, marginBottom: 6 },
    pageSubtitle:{ fontSize: 14, color: theme.textSubtle },

    feed:        { display: 'flex', flexDirection: 'column', gap: 2 },
    card:        { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: isMobile ? '14px 16px' : '18px 20px', display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 12, borderLeft: `3px solid ${theme.borderLight}` },

    avatar:      { width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 16, flexShrink: 0, cursor: 'pointer' },
    cardBody:    { flex: 1, minWidth: 0 },
    cardTop:     { fontSize: 14, color: theme.text, lineHeight: 1.5, flexWrap: 'wrap' },
    username:    { fontWeight: 700, color: theme.text, cursor: 'pointer' },
    action:      { fontWeight: 500 },
    bookLink:    { fontWeight: 600, color: theme.rust, cursor: 'pointer' },
    byAuthor:    { color: theme.textSubtle },
    stars:       { fontSize: 14, color: theme.gold, letterSpacing: 1, marginTop: 6 },
    review:      { fontSize: 13, color: theme.text, lineHeight: 1.6, marginTop: 8, fontStyle: 'italic', borderLeft: `3px solid ${theme.border}`, paddingLeft: 10 },
    meta:        { fontSize: 12, color: theme.textSubtle, marginTop: 8 },

    cardHover:   { boxShadow: theme.shadowCard, transform: 'translateY(-1px)', transition: 'all 0.15s' },
    ratingNum:   { fontSize: 11, color: theme.textSubtle, fontWeight: 400 },
    tapHint:     { color: theme.rust, fontWeight: 500 },
    coverWrap:   { width: 52, height: 78, flexShrink: 0, borderRadius: 4, overflow: 'hidden' },
    coverImg:    { width: '100%', height: '100%', objectFit: 'cover' },

    btnPrimary:  { padding: '8px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

    empty:       { color: theme.textSubtle, fontSize: 14, padding: '60px 0', textAlign: 'center' },
    emptyBox:    { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: '60px 32px', textAlign: 'center' },
    emptyIcon:   { fontSize: 40, marginBottom: 16 },
    emptyTitle:  { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 8 },
    emptyText:   { fontSize: 14, color: theme.textSubtle, marginBottom: 24 },
  }
}

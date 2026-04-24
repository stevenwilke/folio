import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BookDetail from './BookDetail'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { getCoverUrl } from '../lib/coverUrl'
import { enrichBook } from '../lib/enrichBook'
import { fetchBlockedUserIds } from '../lib/moderation'

const NYT_API_KEY = import.meta.env.VITE_NYT_API_KEY || '2vGCkSNIV0d51GG4sERlG9pwoYG7b8ktvPLFBNmbsCWtK2oO'

const NYT_LISTS = [
  { key: 'hardcover-fiction',                    label: 'Fiction',         emoji: '📖' },
  { key: 'combined-print-and-e-book-nonfiction', label: 'Nonfiction',      emoji: '🧠' },
  { key: 'trade-fiction-paperback',              label: 'Paperback',       emoji: '📄' },
  { key: 'young-adult-hardcover',                label: 'Young Adult',     emoji: '🌟' },
]

async function fetchNYTList(listKey) {
  try {
    const r = await fetch(
      `https://api.nytimes.com/svc/books/v3/lists/current/${listKey}.json?api-key=${NYT_API_KEY}`
    )
    if (!r.ok) return []
    const j = await r.json()
    return (j.results?.books ?? []).map(b => ({
      rank:        b.rank,
      title:       b.title,
      author:      b.author,
      description: b.description || null,
      coverUrl:    b.book_image   || null,
      isbn13:      b.primary_isbn13 || null,
      isbn10:      b.primary_isbn10 || null,
      publisher:   b.publisher    || null,
      weeksOnList: b.weeks_on_list ?? 0,
      // normalise to what the rest of Discover expects
      olKey:       `nyt-${b.primary_isbn13 || b.title}`,
      year:        null,
    }))
  } catch { return [] }
}

const GENRES = [
  { label: 'Fiction',            slug: 'fiction',                      emoji: '📖' },
  { label: 'Mystery',            slug: 'mystery_and_detective_stories', emoji: '🔍' },
  { label: 'Sci-Fi',             slug: 'science_fiction',               emoji: '🚀' },
  { label: 'Fantasy',            slug: 'fantasy_fiction',               emoji: '🧙' },
  { label: 'Romance',            slug: 'romance',                       emoji: '❤️' },
  { label: 'Historical Fiction', slug: 'historical_fiction',            emoji: '🏰' },
  { label: 'Biography',          slug: 'biography',                     emoji: '👤' },
  { label: 'Self-Help',          slug: 'self-help',                     emoji: '💡' },
  { label: 'Science',            slug: 'science',                       emoji: '🔬' },
  { label: 'History',            slug: 'history',                       emoji: '📜' },
  { label: 'Young Adult',        slug: 'young_adult_fiction',           emoji: '🌟' },
  { label: 'Horror',             slug: 'horror_tales',                  emoji: '👻' },
  { label: 'Classics',           slug: 'classics',                      emoji: '🎭' },
  { label: 'Graphic Novels',     slug: 'comics_and_graphic_novels',     emoji: '💬' },
  { label: 'Business',           slug: 'business_and_economics',        emoji: '💼' },
  { label: 'Poetry',             slug: 'poetry',                        emoji: '✍️' },
]

const STATUS_LABELS = { owned: 'In Library', read: 'Read', reading: 'Reading', want: 'Want' }
const STATUS_COLORS = { owned: '#5a7a5a', read: '#b8860b', reading: '#c0521e', want: '#7a5ea8' }

async function fetchSubjectBooks(slug, limit = 18) {
  try {
    const r = await fetch(`https://openlibrary.org/subjects/${slug}.json?limit=${limit}`)
    const j = await r.json()
    return (j.works ?? []).map(w => ({
      olKey:    w.key,
      title:    w.title,
      author:   w.authors?.[0]?.name ?? null,
      coverUrl: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : null,
      year:     w.first_publish_year ?? null,
    }))
  } catch { return [] }
}

async function fetchNewReleases(limit = 24) {
  const year = new Date().getFullYear()
  // Current year + last year only — 3 years was too wide and let high-rated
  // books from 2+ years back dominate (they've had longer to accumulate
  // ratings than genuinely new ones).
  const cutoff = year - 1
  try {
    // Lucene range query on first_publish_year so reprints of old books are excluded
    const r = await fetch(
      `https://openlibrary.org/search.json?q=first_publish_year:[${cutoff}+TO+${year}]&sort=rating&limit=${limit * 3}&fields=key,title,author_name,cover_i,first_publish_year`
    )
    const j = await r.json()
    // OL only supports one sort key; sort client-side by year desc first so
    // this-year books outrank last-year ones, breaking ties by the rating
    // order OL already returned (which we preserve with a stable sort).
    const results = (j.docs ?? [])
      .filter(d => d.cover_i && d.first_publish_year >= cutoff)
      .map((d, i) => ({ d, i }))
      .sort((a, b) => (b.d.first_publish_year - a.d.first_publish_year) || (a.i - b.i))
      .slice(0, limit)
      .map(({ d }) => ({
        olKey:    d.key,
        title:    d.title,
        author:   d.author_name?.[0] ?? null,
        coverUrl: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`,
        year:     d.first_publish_year ?? null,
      }))
    if (results.length >= 4) return results
  } catch { /* fall through */ }
  // Fallback: weekly trending, still filter for recent first-pub years
  try {
    const r = await fetch(`https://openlibrary.org/trending/weekly.json?limit=40`)
    const j = await r.json()
    return (j.works ?? [])
      .filter(w => w.cover_id && w.first_publish_year >= cutoff)
      .slice(0, limit)
      .map(w => ({
        olKey:    w.key,
        title:    w.title,
        author:   w.authors?.[0]?.name ?? null,
        coverUrl: `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg`,
        year:     w.first_publish_year ?? null,
      }))
  } catch { return [] }
}

async function searchOL(query, limit = 10) {
  try {
    const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,cover_i,first_publish_year&limit=${limit}`)
    const j = await r.json()
    return (j.docs ?? []).map(d => ({
      olKey:    d.key,
      title:    d.title,
      author:   d.author_name?.[0] ?? null,
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      year:     d.first_publish_year ?? null,
    }))
  } catch { return [] }
}

async function fetchRecommendations(userId) {
  // 1. Get user's collection
  const { data: myBooks } = await supabase
    .from('collection_entries')
    .select('book_id, user_rating, books(author, genre)')
    .eq('user_id', userId)

  if (!myBooks || myBooks.length < 3) return { recs: [], hasEnoughData: myBooks?.length >= 3 }

  const myBookIds = new Set(myBooks.map(b => b.book_id))

  // Find user's top authors and genres
  const authorCount = {}, genreCount = {}
  for (const b of myBooks) {
    if (b.books?.author) authorCount[b.books.author] = (authorCount[b.books.author] || 0) + 1
    if (b.books?.genre) genreCount[b.books.genre] = (genreCount[b.books.genre] || 0) + 1
  }
  const topAuthors = Object.entries(authorCount).sort((a,b) => b[1]-a[1]).slice(0,3).map(([a])=>a)
  const topGenres  = Object.entries(genreCount).sort((a,b) => b[1]-a[1]).slice(0,3).map(([g])=>g)

  // Find highly-rated books in other users' collections
  const { data: candidates } = await supabase
    .from('collection_entries')
    .select('book_id, user_rating, books(id, title, author, genre, cover_image_url, isbn_13, isbn_10)')
    .neq('user_id', userId)
    .not('user_rating', 'is', null)
    .gte('user_rating', 4)
    .limit(200)

  // Score and filter
  const scored = {}
  for (const c of (candidates || [])) {
    const book = c.books
    if (!book || myBookIds.has(c.book_id)) continue
    const id = c.book_id
    if (!scored[id]) scored[id] = { book, score: 0, reason: '', ratings: [] }
    scored[id].ratings.push(c.user_rating)
    if (topAuthors.includes(book.author)) { scored[id].score += 3; if (!scored[id].reason) scored[id].reason = `More by ${book.author}` }
    else if (topGenres.includes(book.genre)) { scored[id].score += 1; if (!scored[id].reason) scored[id].reason = `Popular in ${book.genre}` }
    scored[id].score += (c.user_rating || 0) * 0.1
  }

  const recs = Object.values(scored)
    .filter(s => s.score > 0)
    .sort((a,b) => b.score - a.score)
    .slice(0, 12)
    .map(s => ({ ...s.book, _reason: s.reason, _avgRating: Math.round(s.ratings.reduce((a,b)=>a+b,0)/s.ratings.length * 10) / 10 }))

  return { recs, hasEnoughData: true }
}

function titleKey(title, author) {
  return `${(title ?? '').toLowerCase().trim()}||${(author ?? '').toLowerCase().trim()}`
}

function FakeCover({ title, author }) {
  const hue = Math.abs((title + (author ?? '')).split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360
  const bg  = `hsl(${hue},28%,36%)`
  const words = title.split(' ').slice(0, 4)
  return (
    <div style={{ width: '100%', height: '100%', background: bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 8, boxSizing: 'border-box' }}>
      {words.map((w, i) => (
        <span key={i} style={{ color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'Georgia,serif', textAlign: 'center', lineHeight: '15px' }}>{w}</span>
      ))}
    </div>
  )
}

function DiscoverCard({ book, onPreview, myBookIds }) {
  const { theme } = useTheme()
  const [hover, setHover] = useState(false)
  const have = myBookIds.has(titleKey(book.title, book.author))
  const s = makeStyles(theme)
  return (
    <div
      style={{ ...s.card, ...(hover ? s.cardHover : {}), cursor: 'pointer' }}
      onClick={() => onPreview(book)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.cardCover}>
        {book.coverUrl
          ? <img src={book.coverUrl} alt={book.title} style={s.coverImg} loading="lazy" />
          : <FakeCover title={book.title} author={book.author} />}
        {have && <div style={s.haveBadge}>In Library</div>}
      </div>
      <div style={s.cardBody}>
        <div style={s.cardTitle}>{book.title}</div>
        {book.author && <div style={s.cardAuthor}>{book.author}</div>}
        {book.year   && <div style={s.cardYear}>{book.year}</div>}
      </div>
    </div>
  )
}

// ---- FRIEND STATS (reused in preview + detail) ----
function PreviewFriendStats({ stats }) {
  const { theme } = useTheme()
  if (stats === null) return <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 8, fontStyle: 'italic' }}>Checking friends…</div>
  if (!stats.length) return <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 8 }}>👥 No friends have read this yet</div>
  const withRating = stats.filter(s => s.user_rating)
  const avg = withRating.length
    ? (withRating.reduce((sum, s) => sum + s.user_rating, 0) / withRating.length).toFixed(1) : null
  const names = stats.map(s => s.profiles?.username).filter(Boolean)
  const display = names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} and ${names[1]}`
    : `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 > 1 ? 's' : ''}`
  return (
    <div style={{ fontSize: 12, color: theme.text, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span>👥</span>
      <span><strong>{display}</strong> {stats.length === 1 ? 'has' : 'have'} read this</span>
      {avg && <span style={{ color: theme.gold, fontWeight: 600 }}>· avg ★{avg}</span>}
    </div>
  )
}

// ---- QUICK PREVIEW MODAL ----
function QuickPreview({ book, myBookIds, onAdd, onViewDetail, onClose, session }) {
  const { theme } = useTheme()
  const [desc,        setDesc]        = useState(null)
  const [adding,      setAdding]      = useState(false)
  const [added,       setAdded]       = useState(null)
  const [friendStats, setFriendStats] = useState(null)
  const have = myBookIds.has(titleKey(book.title, book.author))
  const s = makeStyles(theme)

  useEffect(() => {
    setDesc(null)
    // NYT books carry their own description
    if (book.description) { setDesc(book.description); return }
    if (!book.olKey || book.olKey.startsWith('nyt-')) return
    const key = book.olKey.replace('/works/', '')
    fetch(`https://openlibrary.org/works/${key}.json`)
      .then(r => r.json())
      .then(j => {
        const raw = j.description
        const text = typeof raw === 'string' ? raw : raw?.value ?? null
        setDesc(text ? text.split('\n')[0].slice(0, 300) + (text.length > 300 ? '…' : '') : null)
      })
      .catch(() => {})
  }, [book.olKey, book.description])

  useEffect(() => {
    if (!session) return
    setFriendStats(null)
    async function load() {
      // Look up book ID by title
      const { data: bookRow } = await supabase.from('books').select('id').eq('title', book.title).limit(1)
      const bookId = bookRow?.[0]?.id
      if (!bookId) { setFriendStats([]); return }
      const { data: fs } = await supabase.from('friendships').select('requester_id, addressee_id')
        .eq('status', 'accepted').or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
      const ids = (fs || []).map(f => f.requester_id === session.user.id ? f.addressee_id : f.requester_id)
      if (!ids.length) { setFriendStats([]); return }
      const { data: statRows } = await supabase.from('collection_entries')
        .select('user_rating, user_id').eq('book_id', bookId).in('user_id', ids)
      let friendStatsData = statRows || []
      if (friendStatsData.length) {
        const uids = [...new Set(friendStatsData.map(e => e.user_id).filter(Boolean))]
        const { data: ps } = await supabase.from('profiles').select('id, username').in('id', uids)
        const pm = Object.fromEntries((ps || []).map(p => [p.id, p.username]))
        friendStatsData = friendStatsData.map(e => ({ ...e, profiles: { username: pm[e.user_id] } }))
      }
      setFriendStats(friendStatsData)
    }
    load()
  }, [book.title, session])

  async function handleAdd(status, e) {
    e.stopPropagation()
    if (adding || added || have) return
    setAdding(true)
    try { await onAdd(book, status); setAdded(status) }
    finally { setAdding(false) }
  }

  return (
    <div style={s.previewBackdrop} onClick={onClose}>
      <div style={s.previewBox} onClick={e => e.stopPropagation()}>
        {/* Cover + info side by side */}
        <div style={s.previewTop}>
          <div style={s.previewCover}>
            {book.coverUrl
              ? <img src={book.coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
              : <FakeCover title={book.title} author={book.author} />}
          </div>
          <div style={s.previewInfo}>
            <div style={s.previewTitle}>{book.title}</div>
            {book.author && <div style={s.previewAuthor}>by {book.author}</div>}
            {book.year   && <div style={s.previewYear}>{book.year}</div>}
            {desc && <div style={s.previewDesc}>{desc}</div>}
          {/* Friend stats */}
          <PreviewFriendStats stats={friendStats} />
          </div>
        </div>

        {/* Actions */}
        <div style={s.previewActions}>
          {!have && !added && (
            <div style={s.previewAddRow}>
              <span style={s.previewAddLabel}>Add to library:</span>
              {adding
                ? <span style={s.addingDots}>···</span>
                : Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <button key={key}
                      style={{ ...s.addBtn, borderColor: STATUS_COLORS[key], color: STATUS_COLORS[key] }}
                      onClick={e => handleAdd(key, e)}>{label}</button>
                  ))
              }
            </div>
          )}
          {(have || added) && (
            <div style={s.previewInLib}>✓ {have ? 'In your library' : `Added as "${STATUS_LABELS[added]}"`}</div>
          )}
          <button style={s.previewDetailBtn} onClick={onViewDetail}>
            View Full Details →
          </button>
        </div>

        <button style={s.previewClose} onClick={onClose}>✕</button>
      </div>
    </div>
  )
}

function TrendingCard({ book, onPreview, myBookIds }) {
  const { theme } = useTheme()
  const [hover, setHover] = useState(false)
  const have = myBookIds.has(titleKey(book.title, book.author))
  const s = makeStyles(theme)
  return (
    <div
      style={{ ...s.card, ...(hover ? s.cardHover : {}), cursor: 'pointer' }}
      onClick={() => onPreview(book)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.cardCover}>
        {book.coverUrl
          ? <img src={book.coverUrl} alt={book.title} style={s.coverImg} loading="lazy" />
          : <FakeCover title={book.title} author={book.author} />}
        {have && <div style={s.haveBadge}>In Library</div>}
        {book.friendCount > 0 && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            background: '#c0521e', color: '#fff',
            fontSize: 10, fontWeight: 700, borderRadius: 20,
            padding: '2px 7px', lineHeight: '14px',
          }}>
            {book.friendCount} {book.friendCount === 1 ? 'friend' : 'friends'}
          </div>
        )}
      </div>
      <div style={s.cardBody}>
        <div style={s.cardTitle}>{book.title}</div>
        {book.author && <div style={s.cardAuthor}>{book.author}</div>}
        {book.avgRating != null && (
          <div style={{ fontSize: 11, color: '#b8860b', fontWeight: 600, marginTop: 2 }}>★ {book.avgRating}</div>
        )}
      </div>
    </div>
  )
}

function AuthorCard({ book, onPreview, myBookIds }) {
  const { theme } = useTheme()
  const [hover, setHover] = useState(false)
  const have = myBookIds.has(titleKey(book.title, book.author))
  const s = makeStyles(theme)
  return (
    <div
      style={{ ...s.card, ...(hover ? s.cardHover : {}), cursor: 'pointer' }}
      onClick={() => onPreview(book)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.cardCover}>
        {book.coverUrl
          ? <img src={book.coverUrl} alt={book.title} style={s.coverImg} loading="lazy" />
          : <FakeCover title={book.title} author={book.author} />}
        {have && <div style={s.haveBadge}>In Library</div>}
      </div>
      <div style={s.cardBody}>
        <div style={s.cardTitle}>{book.title}</div>
        {book._lovedAuthor && (
          <div style={{
            display: 'inline-block', marginBottom: 3,
            background: 'rgba(192,82,30,0.12)', color: '#c0521e',
            fontSize: 10, fontWeight: 700, borderRadius: 20,
            padding: '1px 7px',
          }}>
            {book._lovedAuthor}
          </div>
        )}
        {book.year && <div style={s.cardYear}>{book.year}</div>}
      </div>
    </div>
  )
}

function RecommendationCard({ book, theme, onView }) {
  const [hover, setHover] = useState(false)
  const url = getCoverUrl(book)
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#8b2500','#b8860b','#3d5a5a']
  const c = colors[(book.title||'').charCodeAt(0) % colors.length]
  const c2 = colors[((book.title||'').charCodeAt(0)+3) % colors.length]
  return (
    <div onClick={onView} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ flexShrink: 0, width: 120, cursor: 'pointer', transform: hover ? 'translateY(-2px)' : 'none', transition: 'transform 0.15s' }}>
      <div style={{ width: 120, height: 160, borderRadius: 8, overflow: 'hidden', background: `linear-gradient(135deg,${c},${c2})`, marginBottom: 8, boxShadow: hover ? '0 6px 18px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.1)' }}>
        {url && <img src={url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{book.title}</div>
      <div style={{ fontSize: 11, color: theme.textSubtle, marginBottom: 4 }}>{book.author}</div>
      {book._reason && (
        <div style={{ fontSize: 10, background: 'rgba(192,82,30,0.1)', color: '#c0521e', borderRadius: 10, padding: '2px 7px', display: 'inline-block' }}>{book._reason}</div>
      )}
    </div>
  )
}

function AIPickCard({ book, theme, myBookIds, onPreview }) {
  const [hover, setHover] = useState(false)
  const have = myBookIds.has(titleKey(book.title, book.author))
  const colors = ['#5a3e7a','#1e5f74','#7a3b3b','#3a6b4a','#6b4a1e','#3a4a6b']
  const c  = colors[Math.abs((book.title||'').charCodeAt(0)) % colors.length]
  const c2 = colors[(Math.abs((book.title||'').charCodeAt(0)) + 3) % colors.length]
  return (
    <div
      onClick={onPreview}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ flexShrink: 0, width: 130, cursor: 'pointer', transform: hover ? 'translateY(-3px)' : 'none', transition: 'transform 0.15s' }}
    >
      <div style={{ width: 130, height: 175, borderRadius: 10, overflow: 'hidden', background: `linear-gradient(135deg,${c},${c2})`, marginBottom: 8, boxShadow: hover ? '0 8px 22px rgba(0,0,0,0.22)' : '0 2px 8px rgba(0,0,0,0.12)', position: 'relative' }}>
        {book.coverUrl && <img src={book.coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />}
        {have && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(90,122,90,0.9)', color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'center', padding: '3px 0' }}>In Library</div>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.35, marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{book.title}</div>
      {book.author && <div style={{ fontSize: 11, color: theme.textSubtle, marginBottom: 5 }}>{book.author}</div>}
      {book._aiReason && (
        <div style={{ fontSize: 10, background: 'rgba(80,60,120,0.1)', color: '#7b5ea8', borderRadius: 10, padding: '2px 8px', display: 'inline-block', lineHeight: 1.4 }}>{book._aiReason}</div>
      )}
    </div>
  )
}

function NYTCard({ book, myBookIds, onPreview }) {
  const { theme } = useTheme()
  const [hover, setHover] = useState(false)
  const have = myBookIds.has(titleKey(book.title, book.author))
  const rankColors = ['#b8860b', '#8a9ba8', '#a0673a'] // gold, silver, bronze for top 3
  const rankColor  = book.rank <= 3 ? rankColors[book.rank - 1] : theme.textSubtle

  return (
    <div
      onClick={() => onPreview(book)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flexShrink: 0, width: 130, cursor: 'pointer',
        transform: hover ? 'translateY(-3px)' : 'none',
        transition: 'transform 0.15s',
      }}
    >
      <div style={{ position: 'relative', width: 130, height: 175, borderRadius: 10, overflow: 'hidden', marginBottom: 8, boxShadow: hover ? '0 8px 22px rgba(0,0,0,0.22)' : '0 2px 8px rgba(0,0,0,0.12)', background: '#2c2c2c' }}>
        {book.coverUrl
          ? <img src={book.coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />
          : <FakeCover title={book.title} author={book.author} />
        }
        {/* Rank badge */}
        <div style={{
          position: 'absolute', top: 7, left: 7,
          width: 26, height: 26, borderRadius: '50%',
          background: rankColor, color: '#fff',
          fontSize: 11, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {book.rank}
        </div>
        {/* In library badge */}
        {have && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(90,122,90,0.9)', color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'center', padding: '3px 0' }}>
            In Library
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.35, marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {book.title}
      </div>
      {book.author && (
        <div style={{ fontSize: 11, color: theme.textSubtle, marginBottom: 4 }}>{book.author}</div>
      )}
      {book.weeksOnList > 0 && (
        <div style={{ fontSize: 10, background: 'rgba(184,134,11,0.12)', color: '#9a7200', borderRadius: 10, padding: '2px 7px', display: 'inline-block', fontWeight: 600 }}>
          {book.weeksOnList === 1 ? 'New this week' : `${book.weeksOnList} weeks on list`}
        </div>
      )}
    </div>
  )
}

function BookRow({ books, myBookIds, onPreview, loading }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  if (loading) return (
    <div style={s.row}>
      {[...Array(6)].map((_, i) => <div key={i} style={s.skeleton} />)}
    </div>
  )
  if (!books.length) return <p style={s.rowEmpty}>Nothing found yet.</p>
  return (
    <div style={s.row}>
      {books.map((b, i) => (
        <DiscoverCard key={b.olKey ?? i} book={b} myBookIds={myBookIds} onPreview={onPreview} />
      ))}
    </div>
  )
}

export default function Discover({ session }) {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const [myBookIds,   setMyBookIds]   = useState(new Set())

  const [forYou,        setForYou]        = useState([])
  const [forYouLoad,    setForYouLoad]    = useState(true)
  const [forYouLabel,   setForYouLabel]   = useState('Recommended for you')

  const [newReleases,   setNewReleases]   = useState([])
  const [newRelLoad,    setNewRelLoad]    = useState(true)

  const [friends,       setFriends]       = useState([])
  const [friendsLoad,   setFriendsLoad]   = useState(true)
  const [hasFriends,    setHasFriends]    = useState(true)

  const [trending,      setTrending]      = useState([])
  const [trendingLoad,  setTrendingLoad]  = useState(true)
  const [hasTrendingFriends, setHasTrendingFriends] = useState(true)

  const [fromAuthors,   setFromAuthors]   = useState([])
  const [fromAuthLoad,  setFromAuthLoad]  = useState(true)

  const [activeGenre, setActiveGenre] = useState(null)
  const [genreBooks,  setGenreBooks]  = useState([])
  const [genreLoad,   setGenreLoad]   = useState(false)

  const [recommendations, setRecommendations] = useState([])
  const [recsLoading,     setRecsLoading]     = useState(true)
  const [hasEnoughData,   setHasEnoughData]   = useState(true)

  const [aiRecs,        setAiRecs]        = useState([])
  const [aiRecsLoad,    setAiRecsLoad]    = useState(true)
  const [aiRecsError,   setAiRecsError]   = useState(false)

  const [nytList,      setNytList]      = useState(NYT_LISTS[0].key)
  const [nytBooks,     setNytBooks]     = useState([])
  const [nytLoad,      setNytLoad]      = useState(true)
  const [nytError,     setNytError]     = useState(false)
  const [nytCache,     setNytCache]     = useState({})    // key → books[]

  const [previewBook,  setPreviewBook]  = useState(null)   // OL book object for quick preview
  const [selectedBook, setSelectedBook] = useState(null)   // Supabase UUID for full detail

  const s = makeStyles(theme, isMobile)

  // ── Back-button support ───────────────────────────────────────────────────
  // Push a history entry whenever a modal opens so the browser back button
  // closes it instead of leaving the Discover page entirely.
  function openPreview(book) {
    window.history.pushState({ discover: 'preview' }, '')
    setPreviewBook(book)
  }
  function openDetail(bookId) {
    window.history.pushState({ discover: 'detail' }, '')
    setSelectedBook(bookId)
  }
  function closeAll() {
    setSelectedBook(null)
    setPreviewBook(null)
  }

  useEffect(() => {
    function onPop() {
      // Close the top-most layer
      if (selectedBook) { setSelectedBook(null); return }
      if (previewBook)  { setPreviewBook(null);  return }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [selectedBook, previewBook])

  useEffect(() => {
    if (!session) return
    fetchRecommendations(session.user.id).then(({ recs, hasEnoughData }) => {
      setRecommendations(recs)
      setHasEnoughData(hasEnoughData)
      setRecsLoading(false)
    })
  }, [session?.user?.id])

  useEffect(() => {
    async function loadNYT(key) {
      if (nytCache[key]) { setNytBooks(nytCache[key]); setNytLoad(false); return }
      setNytLoad(true); setNytError(false)
      const books = await fetchNYTList(key)
      if (!books.length) { setNytError(true); setNytLoad(false); return }
      setNytCache(prev => ({ ...prev, [key]: books }))
      setNytBooks(books)
      setNytLoad(false)
    }
    loadNYT(nytList)
  }, [nytList])

  useEffect(() => {
    async function init() {
      const { data: entries } = await supabase.from('collection_entries')
        .select('read_status, user_rating, books(title, author)')
        .eq('user_id', session.user.id)
      const books = (entries ?? []).map(e => e.books).filter(Boolean)
      setMyBookIds(new Set(books.map(b => titleKey(b.title, b.author))))
      buildForYou(entries ?? [], books)
      buildFriends()
      buildNewReleases(new Set(books.map(b => titleKey(b.title, b.author))))
      buildTrending()
      buildFromFavoriteAuthors(entries ?? [], new Set(books.map(b => titleKey(b.title, b.author))))
      buildAIRecs(entries ?? [])
    }
    init()
  }, [session.user.id])

  async function buildForYou(entries, books) {
    setForYouLoad(true)
    try {
      const loved = entries.filter(e => e.user_rating >= 4 || ['read','owned'].includes(e.read_status))
      const authorCount = {}
      loved.forEach(e => {
        const a = e.books?.author
        if (a) authorCount[a] = (authorCount[a] ?? 0) + 1
      })
      const topAuthors = Object.entries(authorCount).sort((a,b) => b[1]-a[1]).slice(0,3).map(([a])=>a)
      const ownedKeys  = new Set(books.map(b => titleKey(b.title, b.author)))

      if (topAuthors.length) {
        setForYouLabel(topAuthors.length === 1 ? `More by ${topAuthors[0]}` : `Because you read ${topAuthors[0]} & others`)
        const results = await Promise.all(topAuthors.map(a => searchOL(`author:"${a}"`, 12)))
        // Shuffle each author's pool so the carousel doesn't show the same
        // books on every visit, then round-robin interleave across authors so
        // the top author can't monopolize the first N visible slots.
        const pools = results.map(list => {
          const arr = [...list]
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[arr[i], arr[j]] = [arr[j], arr[i]]
          }
          return arr
        })
        const interleaved = []
        const maxLen = Math.max(...pools.map(p => p.length))
        for (let i = 0; i < maxLen; i++) {
          for (const pool of pools) if (pool[i]) interleaved.push(pool[i])
        }
        const seen = new Set()
        const filtered = interleaved.filter(b => {
          const k = titleKey(b.title, b.author)
          if (seen.has(k) || ownedKeys.has(k)) return false
          seen.add(k); return true
        }).slice(0, 20)
        if (filtered.length) { setForYou(filtered); setForYouLoad(false); return }
      }

      setForYouLabel('Popular picks you might enjoy')
      const fallback = await fetchSubjectBooks('fiction', 20)
      const ownedKeys2 = new Set(books.map(b => titleKey(b.title, b.author)))
      setForYou(fallback.filter(b => !ownedKeys2.has(titleKey(b.title, b.author))))
    } catch { setForYou([]) }
    finally { setForYouLoad(false) }
  }

  async function buildNewReleases(ownedKeys) {
    setNewRelLoad(true)
    try {
      const books = await fetchNewReleases(24)
      setNewReleases(books.filter(b => !ownedKeys.has(titleKey(b.title, b.author))))
    } catch { setNewReleases([]) }
    finally { setNewRelLoad(false) }
  }

  async function buildFriends() {
    setFriendsLoad(true)
    try {
      const [fsResult, blockedIds] = await Promise.all([
        supabase.from('friendships').select('requester_id,addressee_id')
          .eq('status','accepted')
          .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`),
        fetchBlockedUserIds(session.user.id),
      ])
      const blockedSet = new Set(blockedIds)
      const ids = (fsResult.data ?? [])
        .map(f => f.requester_id === session.user.id ? f.addressee_id : f.requester_id)
        .filter(id => !blockedSet.has(id))
      if (!ids.length) { setHasFriends(false); setFriendsLoad(false); return }

      const { data: entries } = await supabase.from('collection_entries')
        .select('read_status, user_id, books(title, author, cover_image_url, published_year)')
        .in('user_id', ids).order('updated_at', { ascending: false }).limit(40)

      const entryUserIds = [...new Set((entries ?? []).map(e => e.user_id).filter(Boolean))]
      let profileMap = {}
      if (entryUserIds.length) {
        const { data: ps } = await supabase.from('profiles').select('id, username').in('id', entryUserIds)
        profileMap = Object.fromEntries((ps || []).map(p => [p.id, p.username]))
      }

      const seen = new Set()
      const unique = (entries ?? []).filter(e => {
        const k = titleKey(e.books?.title, e.books?.author)
        if (seen.has(k)) return false; seen.add(k); return true
      }).slice(0, 18).map(e => ({
        olKey: titleKey(e.books?.title, e.books?.author),
        title: e.books?.title, author: e.books?.author,
        coverUrl: e.books?.cover_image_url, year: e.books?.published_year,
        friendName: profileMap[e.user_id], status: e.read_status,
      }))
      setFriends(unique)
    } catch { setFriends([]) }
    finally { setFriendsLoad(false) }
  }

  async function buildTrending() {
    setTrendingLoad(true)
    try {
      const { data: friends } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
        .eq('status', 'accepted')

      const friendIds = (friends ?? []).map(f =>
        f.requester_id === session.user.id ? f.addressee_id : f.requester_id
      )

      if (!friendIds.length) {
        setHasTrendingFriends(false)
        setTrendingLoad(false)
        return
      }

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('collection_entries')
        .select('book_id, user_rating, books(id, title, author, cover_image_url, isbn_13, isbn_10, genre)')
        .in('user_id', friendIds)
        .gte('updated_at', thirtyDaysAgo)
        .order('updated_at', { ascending: false })
        .limit(60)

      // Deduplicate by book_id, count friends, and compute avg rating
      const bookMap = {}
      ;(data ?? []).forEach(entry => {
        const bid = entry.book_id
        if (!bid || !entry.books) return
        if (!bookMap[bid]) {
          bookMap[bid] = { ...entry.books, friendCount: 0, ratings: [] }
        }
        bookMap[bid].friendCount++
        if (entry.user_rating) bookMap[bid].ratings.push(entry.user_rating)
      })

      const results = Object.values(bookMap)
        .sort((a, b) => b.friendCount - a.friendCount || (b.ratings.length ? b.ratings.reduce((s,r) => s+r, 0)/b.ratings.length : 0) - (a.ratings.length ? a.ratings.reduce((s,r) => s+r, 0)/a.ratings.length : 0))
        .slice(0, 20)
        .map(b => ({
          olKey:       b.id,
          title:       b.title,
          author:      b.author,
          coverUrl:    b.cover_image_url,
          friendCount: b.friendCount,
          avgRating:   b.ratings.length ? Math.round((b.ratings.reduce((s,r) => s+r, 0) / b.ratings.length) * 10) / 10 : null,
          _isTrending: true,
        }))

      setTrending(results)
    } catch {
      setTrending([])
    }
    finally { setTrendingLoad(false) }
  }

  async function buildFromFavoriteAuthors(entries, ownedKeys) {
    setFromAuthLoad(true)
    try {
      const authorCounts = {}
      entries.forEach(e => {
        if (e.read_status !== 'read') return
        const a = e.books?.author
        if (a) authorCounts[a] = (authorCounts[a] || 0) + 1
      })
      const topAuthors = Object.entries(authorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([author]) => author)

      if (!topAuthors.length) {
        setFromAuthLoad(false)
        return
      }

      const currentYear = new Date().getFullYear()
      const cutoffYear  = currentYear - 5

      const results = await Promise.all(
        topAuthors.map(author =>
          fetch(`https://openlibrary.org/search.json?author=${encodeURIComponent(author)}&sort=new&limit=5&fields=key,title,author_name,cover_i,first_publish_year`)
            .then(r => r.json())
            .then(d => (d.docs || [])
              .filter(b => b.first_publish_year >= cutoffYear)
              .map(b => ({
                olKey:    b.key,
                title:    b.title,
                author:   b.author_name?.[0] ?? author,
                coverUrl: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null,
                year:     b.first_publish_year ?? null,
                _lovedAuthor: author,
              }))
            )
            .catch(() => [])
        )
      )

      const seen = new Set()
      const flat = results.flat().filter(b => {
        const k = titleKey(b.title, b.author)
        if (seen.has(k) || ownedKeys.has(k)) return false
        seen.add(k)
        return true
      }).slice(0, 10)

      setFromAuthors(flat)
    } catch {
      setFromAuthors([])
    }
    finally { setFromAuthLoad(false) }
  }

  async function buildAIRecs(entries) {
    setAiRecsLoad(true)
    setAiRecsError(false)
    try {
      // Send user's library to the edge function
      const books = entries.map(e => ({
        title:       e.books?.title  ?? '',
        author:      e.books?.author ?? null,
        genre:       null,
        user_rating: e.user_rating   ?? null,
        read_status: e.read_status   ?? 'owned',
        has_read:    e.has_read      ?? false,
      })).filter(b => b.title)

      if (books.length < 3) { setAiRecsLoad(false); return }

      const { data, error } = await supabase.functions.invoke('ai-book-recommendations', {
        body: { books },
      })

      if (error) {
        console.error('[AI Recs] invoke error:', error)
        setAiRecsError(true)
        setAiRecsLoad(false)
        return
      }

      if (!data?.recommendations?.length) {
        setAiRecsLoad(false)
        return
      }

      // For each AI recommendation, search Open Library to get cover + key
      const ownedKeys = new Set(entries.map(e => titleKey(e.books?.title, e.books?.author)))
      const enriched = await Promise.all(
        data.recommendations.map(async (rec) => {
          try {
            const q = encodeURIComponent(`${rec.title} ${rec.author ?? ''}`)
            const r = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=3&fields=key,title,author_name,cover_i,first_publish_year`)
            const j = await r.json()
            const match = (j.docs ?? []).find(d => d.cover_i) ?? j.docs?.[0]
            return {
              olKey:    match?.key ?? titleKey(rec.title, rec.author),
              title:    rec.title,
              author:   rec.author,
              coverUrl: match?.cover_i ? `https://covers.openlibrary.org/b/id/${match.cover_i}-M.jpg` : null,
              year:     match?.first_publish_year ?? null,
              _aiReason: rec.reason,
            }
          } catch {
            return { olKey: titleKey(rec.title, rec.author), title: rec.title, author: rec.author, coverUrl: null, year: null, _aiReason: rec.reason }
          }
        })
      )

      // Filter out any that match owned books
      const fresh = enriched.filter(b => !ownedKeys.has(titleKey(b.title, b.author)))
      setAiRecs(fresh)
    } catch {
      setAiRecsError(true)
    } finally {
      setAiRecsLoad(false)
    }
  }

  async function handleGenre(genre) {
    if (activeGenre?.slug === genre.slug) { setActiveGenre(null); setGenreBooks([]); return }
    setActiveGenre(genre); setGenreLoad(true); setGenreBooks([])
    const books = await fetchSubjectBooks(genre.slug, 22)
    setGenreBooks(books); setGenreLoad(false)
    setTimeout(() => document.getElementById('genre-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  async function handleBookClick(book) {
    const payload = { title: book.title, author: book.author, cover_image_url: book.coverUrl, published_year: book.year ?? null }
    // Try to find existing book first
    const { data: existing } = await supabase.from('books').select('id').eq('title', book.title).limit(1)
    if (existing?.length) {
      const bookId = existing[0].id
      // Enrich in background — do NOT await
      enrichBook(bookId, {
        isbn_13: book.isbn13 || null,
        isbn_10: book.isbn10 || null,
        title: book.title,
        author: book.author,
        cover_image_url: book.coverUrl || null,
        description: null,
      })
      openDetail(bookId)
      return
    }
    // Insert and get ID — if insert fails due to race condition, try finding again
    const { data: nb, error } = await supabase.from('books').insert(payload).select('id').single()
    if (nb?.id) {
      // Enrich in background — do NOT await
      enrichBook(nb.id, {
        isbn_13: book.isbn13 || null,
        isbn_10: book.isbn10 || null,
        title: book.title,
        author: book.author,
        cover_image_url: book.coverUrl || null,
        description: null,
      })
      openDetail(nb.id)
      return
    }
    if (error) {
      const { data: retry } = await supabase.from('books').select('id').eq('title', book.title).limit(1)
      if (retry?.length) {
        const bookId = retry[0].id
        // Enrich in background — do NOT await
        enrichBook(bookId, {
          isbn_13: book.isbn13 || null,
          isbn_10: book.isbn10 || null,
          title: book.title,
          author: book.author,
          cover_image_url: book.coverUrl || null,
          description: null,
        })
        openDetail(bookId)
      }
    }
  }

  async function handleAdd(book, status) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const payload = { title: book.title, author: book.author, cover_image_url: book.coverUrl, published_year: book.year ?? null }
    let bookId
    const { data: existing } = await supabase.from('books').select('id').eq('title', book.title).limit(1)
    if (existing?.length) { bookId = existing[0].id }
    else {
      const { data: nb } = await supabase.from('books').insert(payload).select('id').single()
      bookId = nb?.id
    }
    if (!bookId) return
    // Enrich in background — do NOT await
    enrichBook(bookId, {
      isbn_13: book.isbn13 || null,
      isbn_10: book.isbn10 || null,
      title: book.title,
      author: book.author,
      cover_image_url: book.coverUrl || null,
      description: null,
    })
    await supabase.from('collection_entries').upsert({ user_id: user.id, book_id: bookId, read_status: status }, { onConflict: 'user_id,book_id' })
    setMyBookIds(prev => new Set([...prev, titleKey(book.title, book.author)]))
  }

  return (
    <div style={s.root}>
      <NavBar session={session} />

      <div style={s.page}>
        {/* Header */}
        <div style={s.pageHead}>
          <h1 style={s.pageTitle}>Discover</h1>
          <p  style={s.pageSub}>Find your next great read</p>
        </div>

        {/* Collaborative Recommendations */}
        {!recsLoading && hasEnoughData && recommendations.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 4 }}>
              🔮 Popular With Readers Like You
            </div>
            <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 14 }}>Highly-rated by readers who share your taste</div>
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }}>
              {recommendations.map(book => (
                <RecommendationCard key={book.id} book={book} theme={theme} onView={() => openDetail(book.id)} />
              ))}
            </div>
          </div>
        )}

        {/* NYT Best Sellers */}
        <section style={s.section}>
          <div style={s.secHead}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={s.secTitle}>📰 New York Times Best Sellers</h2>
              <span style={{ fontSize: 11, color: theme.textSubtle, fontStyle: 'italic' }}>Updated weekly</span>
            </div>
            <p style={s.secSub}>This week's official bestseller lists</p>
          </div>

          {/* List tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
            {NYT_LISTS.map(list => (
              <button
                key={list.key}
                onClick={() => setNytList(list.key)}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: nytList === list.key ? 700 : 400,
                  fontFamily: "'DM Sans', sans-serif",
                  background: nytList === list.key ? theme.rust : theme.bgCard,
                  color:      nytList === list.key ? '#fff'     : theme.textSubtle,
                  border:     nytList === list.key ? 'none'     : `1px solid ${theme.border}`,
                  transition: 'all 0.15s',
                }}
              >
                {list.emoji} {list.label}
              </button>
            ))}
          </div>

          {/* Books */}
          {nytLoad ? (
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
              {[...Array(8)].map((_, i) => <div key={i} style={s.skeleton} />)}
            </div>
          ) : nytError ? (
            <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '18px 22px', fontSize: 14, color: theme.textSubtle }}>
              ⚠️ Couldn't load the bestseller list right now — try again in a moment.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin', scrollbarColor: `${theme.border} transparent` }}>
              {nytBooks.map((book, i) => (
                <NYTCard key={book.olKey ?? i} book={book} myBookIds={myBookIds} onPreview={openPreview} />
              ))}
            </div>
          )}

          {/* NYT attribution (required by their API ToS) */}
          {!nytLoad && !nytError && (
            <div style={{ marginTop: 10, fontSize: 11, color: theme.textSubtle, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Data provided by</span>
              <a href="https://www.nytimes.com/books/best-sellers/" target="_blank" rel="noopener noreferrer" style={{ color: theme.rust, textDecoration: 'none', fontWeight: 600 }}>
                The New York Times
              </a>
            </div>
          )}
        </section>

        {/* Trending in Your Network */}
        <section style={s.section}>
          <div style={s.secHead}>
            <h2 style={s.secTitle}>🔥 Trending in Your Network</h2>
            <p  style={s.secSub}>Books your friends picked up this week</p>
          </div>
          {!hasTrendingFriends
            ? <div style={s.emptyRow}>
                <span>👥</span>
                <span>Add friends to see what they're reading this week!</span>
                <button style={s.emptyBtn} onClick={() => navigate('/feed')}>Find Friends →</button>
              </div>
            : trendingLoad
              ? <div style={s.row}>{[...Array(5)].map((_, i) => <div key={i} style={s.skeleton} />)}</div>
              : trending.length === 0
                ? <div style={s.emptyRow}><span>📚</span><span>No activity from friends this week yet.</span></div>
                : <div style={s.row}>
                    {trending.map((b, i) => (
                      <TrendingCard key={b.olKey ?? i} book={b} myBookIds={myBookIds} onPreview={openPreview} />
                    ))}
                  </div>
          }
        </section>

        {/* For You */}
        <section style={s.section}>
          <div style={s.secHead}>
            <h2 style={s.secTitle}>{forYouLabel}</h2>
            <p  style={s.secSub}>Tailored to your reading history</p>
          </div>
          <BookRow books={forYou} myBookIds={myBookIds} onPreview={openPreview} onAdd={handleAdd} loading={forYouLoad} />
        </section>

        {/* New from Authors You Love */}
        {(fromAuthLoad || fromAuthors.length > 0) && (
          <section style={s.section}>
            <div style={s.secHead}>
              <h2 style={s.secTitle}>✍️ New from Authors You Love</h2>
              <p  style={s.secSub}>Recent titles from your most-read authors</p>
            </div>
            {fromAuthLoad
              ? <div style={s.row}>{[...Array(5)].map((_, i) => <div key={i} style={s.skeleton} />)}</div>
              : fromAuthors.length === 0
                ? <p style={s.rowEmpty}>Read more books to unlock author recommendations.</p>
                : <div style={s.row}>
                    {fromAuthors.map((b, i) => (
                      <AuthorCard key={b.olKey ?? i} book={b} myBookIds={myBookIds} onPreview={openPreview} />
                    ))}
                  </div>
            }
          </section>
        )}

        {/* New Releases */}
        <section style={s.section}>
          <div style={s.secHead}>
            <h2 style={s.secTitle}>✨ New Releases</h2>
            <p  style={s.secSub}>Fresh titles published this year</p>
          </div>
          <BookRow books={newReleases} myBookIds={myBookIds} onPreview={openPreview} onAdd={handleAdd} loading={newRelLoad} />
        </section>

        {/* Friends Are Reading */}
        <section style={s.section}>
          <div style={s.secHead}>
            <h2 style={s.secTitle}>Friends Are Reading</h2>
            <p  style={s.secSub}>See what the people you follow have been picking up</p>
          </div>
          {!hasFriends
            ? <div style={s.emptyRow}>
                <span>👥</span>
                <span>Add friends to see what they're reading</span>
                <button style={s.emptyBtn} onClick={() => navigate('/feed')}>Find Friends →</button>
              </div>
            : <BookRow books={friends} myBookIds={myBookIds} onPreview={openPreview} onAdd={handleAdd} loading={friendsLoad} />
          }
        </section>

        {/* AI Picks — loads async, placed lower so page renders fast */}
        <section style={{ marginBottom: 40 }}>
          <div style={{ marginBottom: 14 }}>
            <h2 style={{ ...s.secTitle, display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px' }}>
              <span>✨</span>
              <span>AI Picks For You</span>
              <span style={{ fontSize: 11, fontWeight: 500, background: 'rgba(192,82,30,0.12)', color: '#c0521e', borderRadius: 20, padding: '2px 9px', letterSpacing: 0.3 }}>Powered by Claude</span>
            </h2>
            <p style={s.secSub}>Personalized suggestions based on your reading taste</p>
          </div>
          {aiRecsLoad ? (
            <div style={{ ...s.row }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} style={{ ...s.skeleton, opacity: 0.6 + i * 0.05 }} />
              ))}
            </div>
          ) : aiRecs.length > 0 ? (
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin', scrollbarColor: `${theme.border} transparent` }}>
              {aiRecs.map((book, i) => (
                <AIPickCard key={book.olKey ?? i} book={book} theme={theme} myBookIds={myBookIds} onPreview={() => openPreview(book)} />
              ))}
            </div>
          ) : aiRecsError ? (
            <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '18px 22px', fontSize: 14, color: theme.textSubtle }}>
              ⚠️ Couldn't load AI recommendations right now — try refreshing the page.
            </div>
          ) : (
            <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '18px 22px', fontSize: 14, color: theme.textSubtle }}>
              ✨ Add at least 3 books to your library to unlock AI-powered recommendations!
            </div>
          )}
        </section>

        {/* Browse by Genre */}
        <section style={s.section}>
          <div style={s.secHead}>
            <h2 style={s.secTitle}>Browse by Genre</h2>
            <p  style={s.secSub}>Tap a genre to explore</p>
          </div>
          <div style={s.genreGrid}>
            {GENRES.map(g => (
              <button key={g.slug}
                style={{ ...s.chip, ...(activeGenre?.slug === g.slug ? s.chipActive : {}) }}
                onClick={() => handleGenre(g)}>
                <span>{g.emoji}</span><span>{g.label}</span>
              </button>
            ))}
          </div>

          {activeGenre && (
            <div id="genre-results" style={s.genrePanel}>
              <div style={s.genrePanelHead}>
                <span style={s.genrePanelTitle}>{activeGenre.emoji} {activeGenre.label}</span>
                <button style={s.closeBtn} onClick={() => { setActiveGenre(null); setGenreBooks([]) }}>✕ Close</button>
              </div>
              <BookRow books={genreBooks} myBookIds={myBookIds} onPreview={openPreview} onAdd={handleAdd} loading={genreLoad} />
            </div>
          )}
        </section>
      </div>

      {/* Quick Preview — first click */}
      {previewBook && !selectedBook && (
        <QuickPreview
          book={previewBook}
          myBookIds={myBookIds}
          onAdd={handleAdd}
          onViewDetail={() => handleBookClick(previewBook)}
          onClose={() => { window.history.back() }}
          session={session}
        />
      )}

      {/* Full Book Detail — second click */}
      {selectedBook && (
        <div style={{ position: 'fixed', inset: 0, background: theme.bg, zIndex: 50, overflowY: 'auto' }}>
          <BookDetail
            bookId={selectedBook}
            session={session}
            onBack={() => { window.history.back() }}
          />
        </div>
      )}
    </div>
  )
}

function makeStyles(theme, isMobile = false) {
  return {
    root: { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans',sans-serif" },
    page: { maxWidth: 1200, margin: '0 auto', padding: isMobile ? '16px 16px 60px' : '36px 28px 80px' },

    pageHead:  { marginBottom: 40 },
    pageTitle: { fontFamily: 'Georgia,serif', fontSize: 34, fontWeight: 700, color: theme.text, margin: '0 0 6px' },
    pageSub:   { color: theme.textSubtle, fontSize: 15, margin: 0 },

    section: { marginBottom: 56 },
    secHead: { marginBottom: 18 },
    secTitle:{ fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 700, color: theme.text, margin: '0 0 3px' },
    secSub:  { color: theme.textSubtle, fontSize: 13, margin: 0 },

    row:      { display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 12, scrollbarWidth: 'thin', scrollbarColor: `${theme.border} transparent`, WebkitOverflowScrolling: 'touch' },
    rowEmpty: { color: theme.textSubtle, fontSize: 14, margin: '12px 0 0' },
    skeleton: { flexShrink: 0, width: isMobile ? 120 : 148, height: isMobile ? 230 : 280, borderRadius: 10, background: theme.bgSubtle },

    card:     { flexShrink: 0, width: isMobile ? 120 : 148, background: theme.bgCard, borderRadius: 10, border: `1px solid ${theme.borderLight}`, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s' },
    cardHover:{ transform: 'translateY(-3px)', boxShadow: theme.shadowCard },
    cardCover:{ position: 'relative', width: '100%', height: 210, background: theme.bgSubtle, overflow: 'hidden' },
    coverImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
    haveBadge:{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(90,122,90,0.9)', color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'center', padding: '4px 0' },

    // Quick Preview
    previewBackdrop: { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.55)', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
    previewBox:      { background: theme.bgCard, borderRadius: 18, padding: 28, maxWidth: 560, width: '100%', boxShadow: '0 20px 60px rgba(26,18,8,0.25)', position: 'relative', maxHeight: '90vh', overflowY: 'auto' },
    previewTop:      { display: 'flex', gap: 20, marginBottom: 20 },
    previewCover:    { width: 110, height: 165, flexShrink: 0, borderRadius: 6, overflow: 'hidden', boxShadow: '0 4px 12px rgba(26,18,8,0.18)' },
    previewInfo:     { flex: 1, minWidth: 0 },
    previewTitle:    { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 6, lineHeight: 1.3 },
    previewAuthor:   { fontSize: 14, color: theme.sage, fontWeight: 500, marginBottom: 4 },
    previewYear:     { fontSize: 12, color: theme.textSubtle, marginBottom: 10 },
    previewDesc:     { fontSize: 13, color: theme.text, lineHeight: 1.65, marginTop: 8 },
    previewActions:  { borderTop: `1px solid ${theme.borderLight}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 },
    previewAddRow:   { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
    previewAddLabel: { fontSize: 12, color: theme.textSubtle, marginRight: 4 },
    previewInLib:    { fontSize: 13, color: theme.sage, fontWeight: 600 },
    previewDetailBtn:{ padding: '10px 20px', background: theme.rust, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start', fontFamily: "'DM Sans', sans-serif" },
    previewClose:    { position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', fontSize: 18, color: theme.textSubtle, cursor: 'pointer', lineHeight: 1 },
    cardBody: { padding: '10px 10px 8px' },
    cardTitle:{ fontSize: 12, fontWeight: 700, color: theme.text, lineHeight: '15px', marginBottom: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
    cardAuthor:{ fontSize: 11, color: theme.textSubtle, marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
    cardYear: { fontSize: 10, color: theme.textSubtle, marginBottom: 6 },
    cardActions:{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 },
    addBtn:   { padding: '3px 7px', background: theme.bgCard, borderRadius: 4, border: '1px solid', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" },
    addingDots:{ color: theme.rust, fontSize: 18, padding: '0 4px' },

    genreGrid: { display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
    chip:      { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 24, background: theme.bgCard, border: `1.5px solid ${theme.border}`, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: theme.text, fontFamily: "'DM Sans',sans-serif", transition: 'all 0.15s' },
    chipActive:{ background: theme.rust, borderColor: theme.rust, color: '#fff' },

    genrePanel:     { background: theme.bgCard, border: `1px solid ${theme.borderLight}`, borderRadius: 12, padding: '20px 20px 8px', marginTop: 4 },
    genrePanelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    genrePanelTitle:{ fontFamily: 'Georgia,serif', fontSize: 20, fontWeight: 700, color: theme.text },
    closeBtn:       { padding: '5px 12px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, cursor: 'pointer', color: theme.textSubtle, fontFamily: "'DM Sans',sans-serif" },

    emptyRow: { display: 'flex', alignItems: 'center', gap: 12, color: theme.textSubtle, fontSize: 14, padding: '16px 0' },
    emptyBtn: { padding: '7px 14px', background: theme.rust, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" },
  }
}

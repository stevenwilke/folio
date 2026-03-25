import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BookDetail from './BookDetail'

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

async function fetchNewReleases(limit = 20) {
  const year = new Date().getFullYear()
  // Try recent years using query syntax (more reliable than filter param)
  for (const y of [year, year - 1, year - 2]) {
    try {
      const r = await fetch(
        `https://openlibrary.org/search.json?q=publish_year:${y}&sort=rating&limit=${limit}&fields=key,title,author_name,cover_i,first_publish_year`
      )
      const j = await r.json()
      const results = (j.docs ?? []).filter(d => d.cover_i).map(d => ({
        olKey:    d.key,
        title:    d.title,
        author:   d.author_name?.[0] ?? null,
        coverUrl: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`,
        year:     d.first_publish_year ?? null,
      }))
      if (results.length >= 4) return results
    } catch { /* fall through */ }
  }
  // Final fallback: weekly trending
  try {
    const r = await fetch(`https://openlibrary.org/trending/weekly.json?limit=${limit}`)
    const j = await r.json()
    return (j.works ?? []).filter(w => w.cover_id).map(w => ({
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

function DiscoverCard({ book, onSelect, myBookIds, onAdd }) {
  const [adding, setAdding] = useState(false)
  const [added,  setAdded]  = useState(null)
  const [hover,  setHover]  = useState(false)
  const have = myBookIds.has(titleKey(book.title, book.author))

  async function handleAdd(status, e) {
    e.stopPropagation()
    if (adding || added || have) return
    setAdding(true)
    try { await onAdd(book, status); setAdded(status) }
    finally { setAdding(false) }
  }

  return (
    <div
      style={{ ...s.card, ...(hover ? s.cardHover : {}) }}
      onClick={() => onSelect(book)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.cardCover}>
        {book.coverUrl
          ? <img src={book.coverUrl} alt={book.title} style={s.coverImg} loading="lazy" />
          : <FakeCover title={book.title} author={book.author} />}
        {(have || added) && (
          <div style={s.haveBadge}>{have ? 'In Library' : STATUS_LABELS[added]}</div>
        )}
      </div>
      <div style={s.cardBody}>
        <div style={s.cardTitle}>{book.title}</div>
        {book.author && <div style={s.cardAuthor}>{book.author}</div>}
        {book.year   && <div style={s.cardYear}>{book.year}</div>}
        {!have && !added && (
          <div style={s.cardActions} onClick={e => e.stopPropagation()}>
            {adding
              ? <span style={s.addingDots}>···</span>
              : Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <button key={key} style={{ ...s.addBtn, borderColor: STATUS_COLORS[key], color: STATUS_COLORS[key] }}
                    onClick={e => handleAdd(key, e)}>{label}</button>
                ))
            }
          </div>
        )}
      </div>
    </div>
  )
}

function BookRow({ books, myBookIds, onSelect, onAdd, loading }) {
  if (loading) return (
    <div style={s.row}>
      {[...Array(6)].map((_, i) => <div key={i} style={s.skeleton} />)}
    </div>
  )
  if (!books.length) return <p style={s.rowEmpty}>Nothing found yet.</p>
  return (
    <div style={s.row}>
      {books.map((b, i) => (
        <DiscoverCard key={b.olKey ?? i} book={b} myBookIds={myBookIds} onSelect={onSelect} onAdd={onAdd} />
      ))}
    </div>
  )
}

export default function Discover({ session }) {
  const navigate = useNavigate()
  const [myUsername,  setMyUsername]  = useState(null)
  const [myBookIds,   setMyBookIds]   = useState(new Set())

  const [forYou,        setForYou]        = useState([])
  const [forYouLoad,    setForYouLoad]    = useState(true)
  const [forYouLabel,   setForYouLabel]   = useState('Recommended for you')

  const [newReleases,   setNewReleases]   = useState([])
  const [newRelLoad,    setNewRelLoad]    = useState(true)

  const [friends,       setFriends]       = useState([])
  const [friendsLoad,   setFriendsLoad]   = useState(true)
  const [hasFriends,    setHasFriends]    = useState(true)

  const [activeGenre, setActiveGenre] = useState(null)
  const [genreBooks,  setGenreBooks]  = useState([])
  const [genreLoad,   setGenreLoad]   = useState(false)

  const [selectedBook, setSelectedBook] = useState(null)

  useEffect(() => {
    async function init() {
      const [{ data: profile }, { data: entries }] = await Promise.all([
        supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle(),
        supabase.from('collection_entries')
          .select('read_status, rating, books(title, author)')
          .eq('user_id', session.user.id),
      ])
      setMyUsername(profile?.username ?? null)
      const books = (entries ?? []).map(e => e.books).filter(Boolean)
      setMyBookIds(new Set(books.map(b => titleKey(b.title, b.author))))
      buildForYou(entries ?? [], books)
      buildFriends()
      buildNewReleases(new Set(books.map(b => titleKey(b.title, b.author))))
    }
    init()
  }, [session.user.id])

  async function buildForYou(entries, books) {
    setForYouLoad(true)
    try {
      const loved = entries.filter(e => e.rating >= 4 || ['read','owned'].includes(e.read_status))
      const authorCount = {}
      loved.forEach(e => {
        const a = e.books?.author
        if (a) authorCount[a] = (authorCount[a] ?? 0) + 1
      })
      const topAuthors = Object.entries(authorCount).sort((a,b) => b[1]-a[1]).slice(0,3).map(([a])=>a)
      const ownedKeys  = new Set(books.map(b => titleKey(b.title, b.author)))

      if (topAuthors.length) {
        setForYouLabel(topAuthors.length === 1 ? `More by ${topAuthors[0]}` : `Because you read ${topAuthors[0]} & others`)
        const results = await Promise.all(topAuthors.map(a => searchOL(`author:"${a}"`, 8)))
        const seen = new Set()
        const filtered = results.flat().filter(b => {
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
      const { data: fs } = await supabase.from('friendships').select('requester_id,addressee_id')
        .eq('status','accepted')
        .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
      const ids = (fs ?? []).map(f => f.requester_id === session.user.id ? f.addressee_id : f.requester_id)
      if (!ids.length) { setHasFriends(false); setFriendsLoad(false); return }

      const { data: entries } = await supabase.from('collection_entries')
        .select('read_status, books(title, author, cover_image_url, published_year), profiles(username)')
        .in('user_id', ids).order('updated_at', { ascending: false }).limit(40)

      const seen = new Set()
      const unique = (entries ?? []).filter(e => {
        const k = titleKey(e.books?.title, e.books?.author)
        if (seen.has(k)) return false; seen.add(k); return true
      }).slice(0, 18).map(e => ({
        olKey: titleKey(e.books?.title, e.books?.author),
        title: e.books?.title, author: e.books?.author,
        coverUrl: e.books?.cover_image_url, year: e.books?.published_year,
        friendName: e.profiles?.username, status: e.read_status,
      }))
      setFriends(unique)
    } catch { setFriends([]) }
    finally { setFriendsLoad(false) }
  }

  async function handleGenre(genre) {
    if (activeGenre?.slug === genre.slug) { setActiveGenre(null); setGenreBooks([]); return }
    setActiveGenre(genre); setGenreLoad(true); setGenreBooks([])
    const books = await fetchSubjectBooks(genre.slug, 22)
    setGenreBooks(books); setGenreLoad(false)
    setTimeout(() => document.getElementById('genre-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
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
    await supabase.from('collection_entries').upsert({ user_id: user.id, book_id: bookId, read_status: status }, { onConflict: 'user_id,book_id' })
    setMyBookIds(prev => new Set([...prev, titleKey(book.title, book.author)]))
  }

  return (
    <div style={s.root}>
      {/* Topbar */}
      <div style={s.topbar}>
        <div style={s.logo} onClick={() => navigate('/')} role="button" tabIndex={0}>Folio</div>
        <div style={s.topbarRight}>
          <button style={s.navBtn}       onClick={() => navigate('/')}>Library</button>
          <button style={s.navBtnActive} onClick={() => navigate('/discover')}>Discover</button>
          <button style={s.navBtn}       onClick={() => navigate('/feed')}>Feed</button>
          <button style={s.navBtn}       onClick={() => navigate('/loans')}>Loans</button>
          <button style={s.navBtn}       onClick={() => navigate('/marketplace')}>Marketplace</button>
          {myUsername && <button style={s.navBtn} onClick={() => navigate(`/profile/${myUsername}`)}>My Profile</button>}
        </div>
      </div>

      <div style={s.page}>
        {/* Header */}
        <div style={s.pageHead}>
          <h1 style={s.pageTitle}>Discover</h1>
          <p  style={s.pageSub}>Find your next great read</p>
        </div>

        {/* For You */}
        <section style={s.section}>
          <div style={s.secHead}>
            <h2 style={s.secTitle}>{forYouLabel}</h2>
            <p  style={s.secSub}>Tailored to your reading history</p>
          </div>
          <BookRow books={forYou} myBookIds={myBookIds} onSelect={setSelectedBook} onAdd={handleAdd} loading={forYouLoad} />
        </section>

        {/* New Releases */}
        <section style={s.section}>
          <div style={s.secHead}>
            <h2 style={s.secTitle}>✨ New Releases</h2>
            <p  style={s.secSub}>Fresh titles published this year</p>
          </div>
          <BookRow books={newReleases} myBookIds={myBookIds} onSelect={setSelectedBook} onAdd={handleAdd} loading={newRelLoad} />
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
            : <BookRow books={friends} myBookIds={myBookIds} onSelect={setSelectedBook} onAdd={handleAdd} loading={friendsLoad} />
          }
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
              <BookRow books={genreBooks} myBookIds={myBookIds} onSelect={setSelectedBook} onAdd={handleAdd} loading={genreLoad} />
            </div>
          )}
        </section>
      </div>

      {selectedBook && (
        <BookDetail
          book={{ title: selectedBook.title, author: selectedBook.author, cover_image_url: selectedBook.coverUrl, published_year: selectedBook.year }}
          session={session}
          onClose={() => setSelectedBook(null)}
        />
      )}
    </div>
  )
}

const s = {
  root: { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans',sans-serif" },
  page: { maxWidth: 1200, margin: '0 auto', padding: '36px 28px 80px' },

  topbar:      { position: 'sticky', top: 0, zIndex: 10, background: 'rgba(245,240,232,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #d4c9b0', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:        { fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 700, color: '#1a1208', cursor: 'pointer' },
  topbarRight: { display: 'flex', gap: 4, alignItems: 'center' },
  navBtn:      { padding: '6px 12px', background: 'none', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', color: '#3a3028', fontFamily: "'DM Sans',sans-serif" },
  navBtnActive:{ padding: '6px 12px', background: 'rgba(192,82,30,0.12)', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', color: '#c0521e', fontWeight: 700, fontFamily: "'DM Sans',sans-serif" },

  pageHead:  { marginBottom: 40 },
  pageTitle: { fontFamily: 'Georgia,serif', fontSize: 34, fontWeight: 700, color: '#1a1208', margin: '0 0 6px' },
  pageSub:   { color: '#8a7f72', fontSize: 15, margin: 0 },

  section: { marginBottom: 56 },
  secHead: { marginBottom: 18 },
  secTitle:{ fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 700, color: '#1a1208', margin: '0 0 3px' },
  secSub:  { color: '#8a7f72', fontSize: 13, margin: 0 },

  row:      { display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 12, scrollbarWidth: 'thin', scrollbarColor: '#d4c9b0 transparent', WebkitOverflowScrolling: 'touch' },
  rowEmpty: { color: '#8a7f72', fontSize: 14, margin: '12px 0 0' },
  skeleton: { flexShrink: 0, width: 148, height: 280, borderRadius: 10, background: '#e8e0d4' },

  card:     { flexShrink: 0, width: 148, background: '#fdfaf4', borderRadius: 10, border: '1px solid #e8dece', overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s' },
  cardHover:{ transform: 'translateY(-3px)', boxShadow: '0 6px 20px rgba(0,0,0,0.10)' },
  cardCover:{ position: 'relative', width: '100%', height: 210, background: '#e0d8cc', overflow: 'hidden' },
  coverImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  haveBadge:{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(90,122,90,0.9)', color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'center', padding: '4px 0' },
  cardBody: { padding: '10px 10px 8px' },
  cardTitle:{ fontSize: 12, fontWeight: 700, color: '#1a1208', lineHeight: '15px', marginBottom: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  cardAuthor:{ fontSize: 11, color: '#8a7f72', marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  cardYear: { fontSize: 10, color: '#a09080', marginBottom: 6 },
  cardActions:{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  addBtn:   { padding: '3px 7px', background: '#fdfaf4', borderRadius: 4, border: '1px solid', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" },
  addingDots:{ color: '#c0521e', fontSize: 18, padding: '0 4px' },

  genreGrid: { display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  chip:      { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 24, background: '#fdfaf4', border: '1.5px solid #d4c9b0', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#3a3028', fontFamily: "'DM Sans',sans-serif", transition: 'all 0.15s' },
  chipActive:{ background: '#c0521e', borderColor: '#c0521e', color: '#fff' },

  genrePanel:     { background: '#fdfaf4', border: '1px solid #e0d4c0', borderRadius: 12, padding: '20px 20px 8px', marginTop: 4 },
  genrePanelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  genrePanelTitle:{ fontFamily: 'Georgia,serif', fontSize: 20, fontWeight: 700, color: '#1a1208' },
  closeBtn:       { padding: '5px 12px', background: 'none', border: '1px solid #d4c9b0', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#8a7f72', fontFamily: "'DM Sans',sans-serif" },

  emptyRow: { display: 'flex', alignItems: 'center', gap: 12, color: '#8a7f72', fontSize: 14, padding: '16px 0' },
  emptyBtn: { padding: '7px 14px', background: '#c0521e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" },
}

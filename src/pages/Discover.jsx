import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const GENRE_LIST = [
  { label: 'Fiction',        subject: 'fiction' },
  { label: 'Science Fiction',subject: 'science_fiction' },
  { label: 'Mystery',        subject: 'mystery' },
  { label: 'Fantasy',        subject: 'fantasy' },
  { label: 'Biography',      subject: 'biography' },
  { label: 'History',        subject: 'history' },
  { label: 'Romance',        subject: 'romance' },
  { label: 'Thriller',       subject: 'thriller' },
  { label: 'Non-Fiction',    subject: 'nonfiction' },
  { label: 'Horror',         subject: 'horror' },
  { label: 'Classics',       subject: 'classics' },
  { label: 'Poetry',         subject: 'poetry' },
  { label: 'Self-Help',      subject: 'self-help' },
  { label: 'Travel',         subject: 'travel' },
]

export default function Discover({ session }) {
  const navigate = useNavigate()
  const [myUsername, setMyUsername]       = useState(null)
  const [loading, setLoading]             = useState(true)
  const [trending, setTrending]           = useState([])
  const [forYou, setForYou]               = useState([])
  const [forYouGenre, setForYouGenre]     = useState(null)
  const [friendsReading, setFriendsReading] = useState([])
  const [selectedGenre, setSelectedGenre] = useState(null)
  const [genreBooks, setGenreBooks]       = useState([])
  const [genreLoading, setGenreLoading]   = useState(false)

  useEffect(() => {
    supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setMyUsername(data?.username || null))
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadTrending(), loadForYou(), loadFriendsReading()])
    setLoading(false)
  }

  async function loadTrending() {
    try {
      const res  = await fetch('https://openlibrary.org/trending/weekly.json?limit=16')
      const data = await res.json()
      setTrending(data.works || [])
    } catch { setTrending([]) }
  }

  async function loadForYou() {
    // Get user's top-rated books to infer preferred genres
    const { data: rated } = await supabase
      .from('collection_entries')
      .select('user_rating, books(genre)')
      .eq('user_id', session.user.id)
      .gte('user_rating', 4)
      .not('user_rating', 'is', null)

    // Get all their book titles to exclude from recommendations
    const { data: all } = await supabase
      .from('collection_entries')
      .select('books(title)')
      .eq('user_id', session.user.id)
    const myTitles = new Set((all || []).map(e => e.books?.title?.toLowerCase()).filter(Boolean))

    let topGenre = null
    if (rated?.length) {
      const counts = {}
      for (const e of rated) {
        const g = e.books?.genre
        if (g) counts[g] = (counts[g] || 0) + 1
      }
      topGenre = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
    }

    const subject = topGenre
      ? topGenre.toLowerCase().replace(/\s+/g, '_')
      : 'literary_fiction'
    setForYouGenre(topGenre || 'Literary Fiction')

    try {
      const res  = await fetch(`https://openlibrary.org/subjects/${subject}.json?limit=24`)
      const data = await res.json()
      const books = (data.works || [])
        .filter(w => !myTitles.has(w.title?.toLowerCase()))
        .slice(0, 14)
      setForYou(books)
    } catch { setForYou([]) }
  }

  async function loadFriendsReading() {
    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
      .eq('status', 'accepted')

    if (!friendships?.length) { setFriendsReading([]); return }

    const friendIds = friendships.map(f =>
      f.requester_id === session.user.id ? f.addressee_id : f.requester_id
    )

    const { data: entries } = await supabase
      .from('collection_entries')
      .select('id, user_id, books(id, title, author, cover_image_url)')
      .in('user_id', friendIds)
      .eq('read_status', 'reading')
      .order('added_at', { ascending: false })
      .limit(10)

    if (!entries?.length) { setFriendsReading([]); return }

    const uids = [...new Set(entries.map(e => e.user_id))]
    const { data: profiles } = await supabase
      .from('profiles').select('id, username, avatar_url').in('id', uids)
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]))

    setFriendsReading(entries.map(e => ({ ...e, profile: profileMap[e.user_id] })))
  }

  async function loadGenre(genre) {
    setSelectedGenre(genre.label)
    setGenreLoading(true)
    setGenreBooks([])
    try {
      const res  = await fetch(`https://openlibrary.org/subjects/${genre.subject}.json?limit=24`)
      const data = await res.json()
      setGenreBooks(data.works || [])
    } catch { setGenreBooks([]) }
    setGenreLoading(false)
  }

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.logo} onClick={() => navigate('/')}>Folio</div>
        <nav style={s.navLinks}>
          <button style={s.navLink}       onClick={() => navigate('/')}>Library</button>
          <button style={s.navLinkActive}>Discover</button>
          <button style={s.navLink}       onClick={() => navigate('/feed')}>Feed</button>
          <button style={s.navLink}       onClick={() => navigate('/loans')}>Loans</button>
          <button style={s.navLink}       onClick={() => navigate('/marketplace')}>Marketplace</button>
          {myUsername && (
            <button style={s.navLink} onClick={() => navigate(`/profile/${myUsername}`)}>
              My Profile
            </button>
          )}
        </nav>
      </div>

      <div style={s.content}>
        <div style={s.hero}>
          <h1 style={s.heroTitle}>Discover Your Next Read</h1>
          <p style={s.heroSub}>
            {forYouGenre
              ? `Personalized picks based on your reading taste`
              : `Browse trending books and curated recommendations`}
          </p>
        </div>

        {loading ? (
          <div style={s.empty}>Loading recommendations…</div>
        ) : (
          <>
            {/* For You */}
            {forYou.length > 0 && (
              <Section
                title="Recommended For You"
                sub={forYouGenre ? `Because you enjoy ${forYouGenre}` : undefined}
              >
                <BookRow>
                  {forYou.map(book => (
                    <DiscoverCard key={book.key} book={book} session={session} />
                  ))}
                </BookRow>
              </Section>
            )}

            {/* Friends Are Reading */}
            {friendsReading.length > 0 && (
              <Section title="Friends Are Reading">
                <BookRow>
                  {friendsReading.map(entry => (
                    <FriendCard
                      key={entry.id}
                      entry={entry}
                      onNavigate={u => navigate(`/profile/${u}`)}
                    />
                  ))}
                </BookRow>
              </Section>
            )}

            {/* Trending */}
            {trending.length > 0 && (
              <Section title="Trending This Week">
                <BookRow>
                  {trending.map(book => (
                    <DiscoverCard key={book.key} book={book} session={session} />
                  ))}
                </BookRow>
              </Section>
            )}

            {/* Browse by Genre */}
            <Section title="Browse by Genre">
              <div style={s.genreGrid}>
                {GENRE_LIST.map(g => (
                  <button
                    key={g.subject}
                    style={selectedGenre === g.label ? s.genrePillActive : s.genrePill}
                    onClick={() => loadGenre(g)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              {selectedGenre && (
                <div style={{ marginTop: 28 }}>
                  <div style={s.genreHeading}>{selectedGenre}</div>
                  {genreLoading ? (
                    <div style={s.empty}>Loading…</div>
                  ) : (
                    <BookRow>
                      {genreBooks.slice(0, 14).map(book => (
                        <DiscoverCard key={book.key} book={book} session={session} />
                      ))}
                    </BookRow>
                  )}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

// ---- SECTION WRAPPER ----
function Section({ title, sub, children }) {
  return (
    <section style={{ marginBottom: 52 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={s.sectionTitle}>{title}</div>
        {sub && <div style={s.sectionSub}>{sub}</div>}
      </div>
      {children}
    </section>
  )
}

// ---- HORIZONTAL SCROLL ROW ----
function BookRow({ children }) {
  return (
    <div style={s.bookRow}>
      {children}
    </div>
  )
}

// ---- DISCOVER BOOK CARD ----
function DiscoverCard({ book, session }) {
  const [adding, setAdding] = useState(false)
  const [added, setAdded]   = useState(null)
  const [showMenu, setShowMenu] = useState(false)

  const coverUrl = book.cover_id
    ? `https://covers.openlibrary.org/b/id/${book.cover_id}-M.jpg`
    : book.cover_edition_key
    ? `https://covers.openlibrary.org/b/olid/${book.cover_edition_key}-M.jpg`
    : null
  const author = book.authors?.[0]?.name || book.author_name?.[0] || 'Unknown'

  async function add(status) {
    setAdding(true)
    setShowMenu(false)
    try {
      let bookId = null
      const { data: existing } = await supabase
        .from('books').select('id').eq('title', book.title).maybeSingle()
      if (existing) {
        bookId = existing.id
      } else {
        const { data: nb } = await supabase.from('books').insert({
          title: book.title, author, cover_image_url: coverUrl,
          published_year: book.first_publish_year || null,
          genre: book.subject?.[0] || null,
        }).select().single()
        if (nb) bookId = nb.id
      }
      if (bookId) {
        await supabase.from('collection_entries').upsert(
          { user_id: session.user.id, book_id: bookId, read_status: status },
          { onConflict: 'user_id,book_id' }
        )
        setAdded(status)
      }
    } catch {}
    setAdding(false)
  }

  const STATUS_LABELS = { owned: 'In Library', read: 'Read', reading: 'Reading', want: 'Want to Read' }

  return (
    <div style={s.card}>
      <div style={s.cardCover}>
        {coverUrl
          ? <img src={coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <MiniCover title={book.title} />
        }
      </div>
      <div style={s.cardBody}>
        <div style={s.cardTitle}>{book.title}</div>
        <div style={s.cardAuthor}>{author}</div>
        {book.first_publish_year && <div style={s.cardYear}>{book.first_publish_year}</div>}
        <div style={{ marginTop: 'auto', paddingTop: 10 }}>
          {added ? (
            <div style={s.addedLabel}>✓ {STATUS_LABELS[added]}</div>
          ) : (
            <div style={{ position: 'relative' }}>
              <button
                style={s.addBtn}
                disabled={adding}
                onClick={() => setShowMenu(v => !v)}
              >
                {adding ? '…' : '+ Add'}
              </button>
              {showMenu && (
                <div style={s.addMenu}>
                  {Object.entries(STATUS_LABELS).map(([val, label]) => (
                    <div key={val} style={s.addMenuItem} onClick={() => add(val)}>
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- FRIEND READING CARD ----
function FriendCard({ entry, onNavigate }) {
  const book    = entry.books
  const profile = entry.profile
  return (
    <div style={s.card}>
      <div style={s.cardCover}>
        {book?.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <MiniCover title={book?.title || ''} />
        }
      </div>
      <div style={s.cardBody}>
        <div style={s.cardTitle}>{book?.title}</div>
        <div style={s.cardAuthor}>{book?.author}</div>
        <div style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={s.friendDot}>{profile?.username?.charAt(0).toUpperCase()}</div>
          <span
            style={{ fontSize: 12, color: '#c0521e', cursor: 'pointer', fontWeight: 500 }}
            onClick={() => onNavigate(profile?.username)}
          >
            {profile?.username}
          </span>
          <span style={{ fontSize: 12, color: '#8a7f72' }}>reading</span>
        </div>
      </div>
    </div>
  )
}

// ---- MINI COVER ----
function MiniCover({ title }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const c1 = colors[(title.charCodeAt(0) || 0) % colors.length]
  const c2 = colors[((title.charCodeAt(0) || 0) + 3) % colors.length]
  return (
    <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg, ${c1}, ${c2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, boxSizing: 'border-box' }}>
      <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, fontFamily: 'Georgia, serif', textAlign: 'center', fontStyle: 'italic', lineHeight: 1.3 }}>{title}</span>
    </div>
  )
}

// ---- STYLES ----
const s = {
  page: { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif", color: '#1a1208' },
  topbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 32px', height: 60, background: '#fdfaf4',
    borderBottom: '1px solid #d4c9b0', position: 'sticky', top: 0, zIndex: 10,
  },
  logo: { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: '#c0521e', cursor: 'pointer', letterSpacing: '-0.3px' },
  navLinks: { display: 'flex', alignItems: 'center', gap: 2 },
  navLink: {
    background: 'none', border: 'none', padding: '6px 12px', borderRadius: 6,
    fontSize: 14, color: '#3a3028', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },
  navLinkActive: {
    background: 'rgba(192,82,30,0.1)', border: 'none', padding: '6px 12px', borderRadius: 6,
    fontSize: 14, color: '#c0521e', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
  },
  content: { maxWidth: 1200, margin: '0 auto', padding: '40px 32px' },
  hero: { marginBottom: 44 },
  heroTitle: { fontFamily: 'Georgia, serif', fontSize: 34, color: '#1a1208', margin: 0, fontWeight: 700, letterSpacing: '-0.5px' },
  heroSub: { color: '#8a7f72', fontSize: 16, margin: '8px 0 0' },
  sectionTitle: { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: '#1a1208' },
  sectionSub: { fontSize: 13, color: '#8a7f72', marginTop: 4 },
  bookRow: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  card: {
    width: 155, background: '#fdfaf4', borderRadius: 10,
    border: '1px solid #d4c9b0', overflow: 'hidden',
    display: 'flex', flexDirection: 'column', flexShrink: 0,
  },
  cardCover: { width: '100%', height: 195, background: '#e8dfc8', overflow: 'hidden', flexShrink: 0 },
  cardBody: { padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column' },
  cardTitle: {
    fontSize: 13, fontWeight: 600, color: '#1a1208', lineHeight: 1.35,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  cardAuthor: { fontSize: 12, color: '#8a7f72', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardYear: { fontSize: 11, color: '#b0a898', marginTop: 2 },
  addBtn: {
    width: '100%', padding: '6px 0', background: '#c0521e', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },
  addMenu: {
    position: 'absolute', bottom: '110%', left: 0, right: 0,
    background: '#fdfaf4', border: '1px solid #d4c9b0',
    borderRadius: 8, boxShadow: '0 4px 16px rgba(26,18,8,0.12)', zIndex: 20, overflow: 'hidden',
  },
  addMenuItem: {
    padding: '9px 14px', fontSize: 13, cursor: 'pointer', color: '#1a1208',
    borderBottom: '1px solid #f0e8d8',
  },
  addedLabel: { fontSize: 12, color: '#5a7a5a', fontWeight: 600 },
  friendDot: {
    width: 20, height: 20, borderRadius: '50%',
    background: 'linear-gradient(135deg, #c0521e, #b8860b)',
    color: '#fff', fontSize: 10, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  genreGrid: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  genrePill: {
    padding: '8px 18px', borderRadius: 20, border: '1px solid #d4c9b0',
    background: '#fdfaf4', color: '#3a3028', fontSize: 14, cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  genrePillActive: {
    padding: '8px 18px', borderRadius: 20, border: '1px solid #c0521e',
    background: '#c0521e', color: '#fff', fontSize: 14, cursor: 'pointer',
    fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
  },
  genreHeading: { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: '#1a1208', marginBottom: 16 },
  empty: { color: '#8a7f72', fontSize: 14, padding: '24px 0' },
}

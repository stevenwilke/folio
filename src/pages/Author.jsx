import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import SearchModal from '../components/SearchModal'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'

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

export default function Author({ session }) {
  const { authorName } = useParams()
  const navigate        = useNavigate()
  const { theme }       = useTheme()

  const decoded = decodeURIComponent(authorName)

  const [folioBooks,   setFolioBooks]   = useState([])   // books in Folio DB by this author
  const [olBooks,      setOlBooks]      = useState([])   // OL extras not in Folio
  const [myEntries,    setMyEntries]    = useState({})   // bookId → entry
  const [friendData,   setFriendData]   = useState({})   // bookId → [{ username, status }]
  const [friendCount,  setFriendCount]  = useState(0)    // total distinct friends who have any book
  const [loading,      setLoading]      = useState(true)
  const [showSearch,   setShowSearch]   = useState(false)
  const [addTarget,    setAddTarget]    = useState(null) // OL book being added

  useEffect(() => {
    loadAll()
  }, [authorName])

  async function loadAll() {
    setLoading(true)

    // 1. Folio DB + Open Library — in parallel
    const [folioRes, olRes] = await Promise.all([
      supabase
        .from('books')
        .select('*')
        .ilike('author', `%${decoded}%`)
        .order('published_year', { ascending: false }),
      fetch(`https://openlibrary.org/search.json?author=${encodeURIComponent(decoded)}&limit=20`)
        .then(r => r.ok ? r.json() : { docs: [] })
        .catch(() => ({ docs: [] })),
    ])

    const folio = folioRes.data || []
    setFolioBooks(folio)

    // Build a set of ISBNs already in Folio
    const folioIsbnSet = new Set()
    const folioTitleSet = new Set()
    for (const b of folio) {
      if (b.isbn_13) folioIsbnSet.add(b.isbn_13)
      if (b.isbn_10) folioIsbnSet.add(b.isbn_10)
      folioTitleSet.add(b.title?.toLowerCase().trim())
    }

    // OL extras
    const extras = (olRes.docs || [])
      .filter(doc => {
        const isbn13 = doc.isbn?.find(i => i.length === 13)
        const isbn10 = doc.isbn?.find(i => i.length === 10)
        if (isbn13 && folioIsbnSet.has(isbn13)) return false
        if (isbn10 && folioIsbnSet.has(isbn10)) return false
        if (folioTitleSet.has(doc.title?.toLowerCase().trim())) return false
        return true
      })
      .slice(0, 12)
      .map(doc => ({
        key:      doc.key,
        title:    doc.title,
        author:   doc.author_name?.[0] || decoded,
        year:     doc.first_publish_year || null,
        isbn13:   doc.isbn?.find(i => i.length === 13) || null,
        isbn10:   doc.isbn?.find(i => i.length === 10) || null,
        coverId:  doc.cover_i || null,
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
        genre:    doc.subject?.[0] || null,
        source:   'openlibrary',
      }))
    setOlBooks(extras)

    // 2. My entries for Folio books
    if (session && folio.length > 0) {
      const bookIds = folio.map(b => b.id)
      const { data: entries } = await supabase
        .from('collection_entries')
        .select('book_id, read_status, user_rating')
        .eq('user_id', session.user.id)
        .in('book_id', bookIds)
      const map = {}
      for (const e of entries || []) map[e.book_id] = e
      setMyEntries(map)

      // 3. Friend data for Folio books
      await loadFriendData(bookIds)
    }

    setLoading(false)
  }

  async function loadFriendData(bookIds) {
    if (!session) return

    // Get friend IDs
    const { data: fs } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)

    const friendIds = (fs || []).map(f =>
      f.requester_id === session.user.id ? f.addressee_id : f.requester_id
    )
    if (!friendIds.length) return

    // Get friend entries for these books
    const { data: friendEntries } = await supabase
      .from('collection_entries')
      .select('user_id, book_id, read_status, profiles(username, avatar_url)')
      .in('user_id', friendIds)
      .in('book_id', bookIds)

    const byBook = {}
    const allFriendIds = new Set()
    for (const e of friendEntries || []) {
      if (!byBook[e.book_id]) byBook[e.book_id] = []
      byBook[e.book_id].push({ username: e.profiles?.username, status: e.read_status, avatar_url: e.profiles?.avatar_url })
      allFriendIds.add(e.user_id)
    }
    setFriendData(byBook)
    setFriendCount(allFriendIds.size)
  }

  async function addOlBook(book, status) {
    setAddTarget(book.key)

    let coverUrl = book.coverUrl
    const { data: existing } = await supabase
      .from('books')
      .select('id')
      .or(
        [
          book.isbn13 ? `isbn_13.eq.${book.isbn13}` : null,
          book.isbn10 ? `isbn_10.eq.${book.isbn10}` : null,
        ].filter(Boolean).join(',') || `title.ilike.${book.title}`
      )
      .maybeSingle()

    let bookId = existing?.id
    if (!bookId) {
      const { data: inserted } = await supabase
        .from('books')
        .insert({
          title:            book.title,
          author:           book.author,
          isbn_13:          book.isbn13 || null,
          isbn_10:          book.isbn10 || null,
          genre:            book.genre  || null,
          published_year:   book.year   || null,
          cover_image_url:  coverUrl,
        })
        .select('id')
        .single()
      bookId = inserted?.id
    }

    if (bookId) {
      await supabase
        .from('collection_entries')
        .upsert({ user_id: session.user.id, book_id: bookId, read_status: status }, { onConflict: 'user_id,book_id' })
      window.dispatchEvent(new CustomEvent('folio:bookAdded'))
      loadAll()
    }
    setAddTarget(null)
  }

  const myReadCount  = folioBooks.filter(b => myEntries[b.id]?.read_status === 'read').length
  const totalFolio   = folioBooks.length

  const s = makeStyles(theme)

  if (loading) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.loadingWrap}>Loading author…</div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />

      <div style={s.content}>
        {/* Author header */}
        <div style={s.authorHeader}>
          <div style={s.authorInitial}>{decoded.charAt(0).toUpperCase()}</div>
          <div>
            <h1 style={s.authorName}>{decoded}</h1>
            <div style={s.authorMeta}>
              <span>{totalFolio} book{totalFolio !== 1 ? 's' : ''} in Folio</span>
              {friendCount > 0 && (
                <>
                  <span style={s.dot}>·</span>
                  <span>{friendCount} friend{friendCount !== 1 ? 's' : ''} have read their work</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Your progress (logged in, has Folio books) */}
        {session && totalFolio > 0 && (
          <div style={s.progressSection}>
            <div style={s.progressLabel}>
              You've read <strong>{myReadCount}</strong> of <strong>{totalFolio}</strong> book{totalFolio !== 1 ? 's' : ''} by {decoded}
            </div>
            <div style={s.progressBarWrap}>
              <div
                style={{
                  ...s.progressBarFill,
                  width: `${totalFolio > 0 ? Math.round((myReadCount / totalFolio) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* In Folio section */}
        {folioBooks.length > 0 && (
          <section style={s.section}>
            <h2 style={s.sectionTitle}>In Folio</h2>
            <div style={s.bookGrid}>
              {folioBooks.map(book => {
                const entry   = myEntries[book.id]
                const friends = friendData[book.id] || []
                return (
                  <FolioBookCard
                    key={book.id}
                    book={book}
                    entry={entry}
                    friends={friends}
                    theme={theme}
                    session={session}
                    onStatusChange={async (status) => {
                      if (entry) {
                        await supabase.from('collection_entries').update({ read_status: status }).eq('id', entry.id)
                      } else {
                        await supabase.from('collection_entries').insert({ user_id: session.user.id, book_id: book.id, read_status: status })
                        window.dispatchEvent(new CustomEvent('folio:bookAdded'))
                      }
                      loadAll()
                    }}
                  />
                )
              })}
            </div>
          </section>
        )}

        {/* More by this author (OL results) */}
        {olBooks.length > 0 && (
          <section style={s.section}>
            <h2 style={s.sectionTitle}>More by {decoded}</h2>
            <div style={s.bookGrid}>
              {olBooks.map(book => (
                <OlBookCard
                  key={book.key}
                  book={book}
                  theme={theme}
                  adding={addTarget === book.key}
                  onAdd={addOlBook}
                />
              ))}
            </div>
          </section>
        )}

        {folioBooks.length === 0 && olBooks.length === 0 && (
          <div style={s.emptyState}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
            <div style={s.emptyTitle}>No books found for "{decoded}"</div>
            <div style={s.emptySub}>Try searching with a slightly different name.</div>
          </div>
        )}
      </div>

      {showSearch && (
        <SearchModal
          session={session}
          onClose={() => setShowSearch(false)}
          onAdded={() => { setShowSearch(false); loadAll() }}
        />
      )}
    </div>
  )
}

// ── Folio book card (exists in DB) ──
function FolioBookCard({ book, entry, friends, theme, session, onStatusChange }) {
  const [hover,      setHover]      = useState(false)
  const [showMenu,   setShowMenu]   = useState(false)
  const [changing,   setChanging]   = useState(false)

  const coverUrl = getCoverUrl(book)

  async function handleStatus(status) {
    setChanging(true)
    setShowMenu(false)
    await onStatusChange(status)
    setChanging(false)
  }

  return (
    <div
      style={{ position: 'relative' }}
      onMouseLeave={() => { setHover(false); setShowMenu(false) }}
    >
      <div
        style={{
          background: theme.bgCard,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          overflow: 'hidden',
          transition: 'box-shadow 0.15s, transform 0.15s',
          boxShadow: hover ? theme.shadowCard : 'none',
          transform: hover ? 'translateY(-2px)' : 'none',
          cursor: 'pointer',
        }}
        onMouseEnter={() => setHover(true)}
        onClick={() => setShowMenu(v => !v)}
      >
        {/* Cover */}
        <div style={{ position: 'relative', background: '#d4c9b0', aspectRatio: '2/3' }}>
          {coverUrl
            ? <img src={coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
            : <FakeCover title={book.title} />
          }
          {entry && (
            <div style={{
              position: 'absolute', top: 6, left: 6,
              ...STATUS_COLORS[entry.read_status],
              padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 600,
              backdropFilter: 'blur(4px)',
            }}>
              {STATUS_LABELS[entry.read_status]}
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ padding: '10px 10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, lineHeight: 1.3, marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {book.title}
          </div>
          {book.published_year && (
            <div style={{ fontSize: 11, color: theme.textSubtle }}>{book.published_year}</div>
          )}
          {friends.length > 0 && (
            <div style={{ fontSize: 11, color: theme.sage, marginTop: 4 }}>
              {friends.length} friend{friends.length !== 1 ? 's' : ''} have this
            </div>
          )}
        </div>
      </div>

      {/* Status dropdown */}
      {showMenu && session && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 30,
          background: theme.bgCard, border: `1px solid ${theme.border}`,
          borderRadius: 10, minWidth: 150, boxShadow: '0 6px 20px rgba(26,18,8,0.15)',
          marginTop: 4,
        }}>
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <div
              key={status}
              style={{
                padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                color: entry?.read_status === status ? '#c0521e' : theme.text,
                fontWeight: entry?.read_status === status ? 600 : 400,
                fontFamily: "'DM Sans', sans-serif",
              }}
              onClick={e => { e.stopPropagation(); handleStatus(status) }}
            >
              {changing ? '…' : label}
              {entry?.read_status === status && ' ✓'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Open Library book card ──
function OlBookCard({ book, theme, adding, onAdd }) {
  const [hover,      setHover]      = useState(false)
  const [showMenu,   setShowMenu]   = useState(false)

  return (
    <div
      style={{ position: 'relative' }}
      onMouseLeave={() => { setHover(false); setShowMenu(false) }}
    >
      <div
        style={{
          background: theme.bgCard,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          overflow: 'hidden',
          transition: 'box-shadow 0.15s, transform 0.15s',
          boxShadow: hover ? theme.shadowCard : 'none',
          transform: hover ? 'translateY(-2px)' : 'none',
          cursor: 'pointer',
        }}
        onMouseEnter={() => setHover(true)}
        onClick={() => setShowMenu(v => !v)}
      >
        {/* Cover */}
        <div style={{ background: '#d4c9b0', aspectRatio: '2/3', position: 'relative' }}>
          {book.coverUrl
            ? <img src={book.coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
            : <FakeCover title={book.title} />
          }
        </div>

        {/* Info */}
        <div style={{ padding: '10px 10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, lineHeight: 1.3, marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {book.title}
          </div>
          {book.year && (
            <div style={{ fontSize: 11, color: theme.textSubtle }}>{book.year}</div>
          )}
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 10, background: 'rgba(184,134,11,0.12)', color: '#b8860b', padding: '2px 7px', borderRadius: 10, fontWeight: 500 }}>
              Open Library
            </span>
          </div>
        </div>
      </div>

      {/* Add to library dropdown */}
      {showMenu && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 30,
          background: theme.bgCard, border: `1px solid ${theme.border}`,
          borderRadius: 10, minWidth: 150, boxShadow: '0 6px 20px rgba(26,18,8,0.15)',
          marginTop: 4,
        }}>
          <div style={{ padding: '8px 14px 6px', fontSize: 11, fontWeight: 600, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Add to Library
          </div>
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <div
              key={status}
              style={{ padding: '9px 14px', fontSize: 13, cursor: adding ? 'default' : 'pointer', color: theme.text, fontFamily: "'DM Sans', sans-serif" }}
              onClick={e => { e.stopPropagation(); !adding && onAdd(book, status) }}
            >
              {adding ? '…' : label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Fake cover fallback ──
function FakeCover({ title }) {
  const colors = ['#c0521e', '#5a7a5a', '#b8860b', '#8a7f72', '#1a1208']
  const idx    = (title || '').charCodeAt(0) % colors.length
  return (
    <div style={{
      width: '100%', height: '100%',
      background: colors[idx],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 10,
    }}>
      <span style={{ fontFamily: 'Georgia, serif', color: 'rgba(255,255,255,0.85)', fontSize: 11, textAlign: 'center', lineHeight: 1.4, fontWeight: 600 }}>
        {title?.slice(0, 40)}
      </span>
    </div>
  )
}

function makeStyles(theme) {
  return {
    page:    { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content: { maxWidth: 960, margin: '0 auto', padding: '36px 32px' },
    loadingWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: theme.textSubtle, fontSize: 15 },

    authorHeader: {
      display: 'flex',
      gap: 20,
      alignItems: 'center',
      marginBottom: 28,
    },
    authorInitial: {
      width: 64, height: 64, borderRadius: '50%',
      background: 'linear-gradient(135deg, #c0521e, #b8860b)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 26, color: 'white',
      flexShrink: 0,
    },
    authorName: {
      fontFamily: "'Playfair Display', Georgia, serif",
      fontSize: 32,
      fontWeight: 700,
      color: theme.text,
      margin: 0,
      lineHeight: 1.2,
    },
    authorMeta: {
      display: 'flex',
      gap: 6,
      alignItems: 'center',
      fontSize: 14,
      color: theme.textSubtle,
      marginTop: 6,
    },
    dot: { color: theme.border },

    progressSection: {
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 32,
    },
    progressLabel: {
      fontSize: 14,
      color: theme.text,
      marginBottom: 10,
    },
    progressBarWrap: {
      height: 8,
      background: theme.bgSubtle,
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      background: 'linear-gradient(90deg, #c0521e, #b8860b)',
      borderRadius: 4,
      transition: 'width 0.4s ease',
      minWidth: 4,
    },

    section: { marginBottom: 48 },
    sectionTitle: {
      fontFamily: 'Georgia, serif',
      fontSize: 20,
      fontWeight: 700,
      color: theme.text,
      marginBottom: 20,
      marginTop: 0,
    },
    bookGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
      gap: 16,
    },

    emptyState: {
      textAlign: 'center',
      padding: '80px 32px',
    },
    emptyTitle: {
      fontFamily: 'Georgia, serif',
      fontSize: 20,
      fontWeight: 700,
      color: theme.text,
      marginBottom: 8,
    },
    emptySub: {
      fontSize: 14,
      color: theme.textSubtle,
    },
  }
}

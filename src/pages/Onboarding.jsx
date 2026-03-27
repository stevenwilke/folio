import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SearchModal from '../components/SearchModal'
import GoodreadsImportModal from '../components/GoodreadsImportModal'
import { useTheme } from '../contexts/ThemeContext'

const POPULAR_BOOKS = [
  { isbn: '9780525559474', title: 'The Midnight Library',       author: 'Matt Haig' },
  { isbn: '9780385737951', title: 'The Hunger Games',           author: 'Suzanne Collins' },
  { isbn: '9780743273565', title: 'The Great Gatsby',           author: 'F. Scott Fitzgerald' },
  { isbn: '9780061120084', title: 'To Kill a Mockingbird',      author: 'Harper Lee' },
  { isbn: '9780316769174', title: 'The Catcher in the Rye',     author: 'J.D. Salinger' },
  { isbn: '9780062315007', title: 'The Alchemist',              author: 'Paulo Coelho' },
]

export default function Onboarding({ session }) {
  const navigate  = useNavigate()
  const { theme } = useTheme()

  const [step,         setStep]         = useState(1)
  const [imported,     setImported]     = useState(false)
  const [showImport,   setShowImport]   = useState(false)
  const [showSearch,   setShowSearch]   = useState(false)

  // Step 2: friend search state
  const [friendQuery,      setFriendQuery]      = useState('')
  const [friendResults,    setFriendResults]    = useState([])
  const [friendSearching,  setFriendSearching]  = useState(false)
  const [friendSearched,   setFriendSearched]   = useState(false)
  const [acting,           setActing]           = useState(null)

  async function searchFriends() {
    const q = friendQuery.trim()
    if (!q) return
    setFriendSearching(true)
    setFriendSearched(true)

    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${q}%`)
      .neq('id', session.user.id)
      .limit(10)

    const ids = (data || []).map(p => p.id)
    let statusMap = {}
    if (ids.length) {
      const { data: fs } = await supabase
        .from('friendships')
        .select('id, requester_id, addressee_id, status')
        .or(
          ids.map(id =>
            `and(requester_id.eq.${session.user.id},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${session.user.id})`
          ).join(',')
        )
      for (const f of fs || []) {
        const otherId = f.requester_id === session.user.id ? f.addressee_id : f.requester_id
        statusMap[otherId] = { friendshipId: f.id, status: f.status, iAmRequester: f.requester_id === session.user.id }
      }
    }

    setFriendResults((data || []).map(p => ({ ...p, friendship: statusMap[p.id] || null })))
    setFriendSearching(false)
  }

  async function addFriend(userId) {
    setActing(userId)
    await supabase.from('friendships').insert({ requester_id: session.user.id, addressee_id: userId })
    setActing(null)
    searchFriends()
  }

  function finish() {
    localStorage.setItem('exlibris-onboarded', 'true')
    navigate('/')
  }

  const s = makeStyles(theme)

  return (
    <div style={s.page}>
      {/* Progress dots */}
      <div style={s.progressBar}>
        {[1, 2, 3].map(n => (
          <div key={n} style={n === step ? s.dotActive : n < step ? s.dotDone : s.dot} />
        ))}
      </div>

      {/* ── STEP 1: Welcome ── */}
      {step === 1 && (
        <div style={s.stepWrap}>
          <div style={s.logo}>Ex Libris</div>
          <div style={s.tagline}>Welcome to Ex Libris! Let's set up your reading life.</div>

          <div style={s.featureGrid}>
            {[
              { emoji: '📚', title: 'Track your books',    desc: 'Keep a library of everything you\'ve read, are reading, and want to read' },
              { emoji: '👥', title: 'Connect with friends', desc: 'See what your friends are reading and share recommendations' },
              { emoji: '🛒', title: 'Discover & Trade',    desc: 'Find new books and trade with your community' },
            ].map(f => (
              <div key={f.title} style={s.featureCard}>
                <div style={s.featureEmoji}>{f.emoji}</div>
                <div style={s.featureTitle}>{f.title}</div>
                <div style={s.featureDesc}>{f.desc}</div>
              </div>
            ))}
          </div>

          <button style={s.btnPrimary} onClick={() => setStep(2)}>
            Get Started →
          </button>
        </div>
      )}

      {/* ── STEP 2: Import & Find Friends ── */}
      {step === 2 && (
        <div style={s.stepWrap}>
          <div style={s.stepHeading}>Build your reading world</div>
          <div style={s.stepSub}>Import your books and connect with friends who read.</div>

          <div style={s.twoCol}>
            {/* Import card */}
            <div style={s.card}>
              <div style={s.cardEmoji}>📥</div>
              <div style={s.cardTitle}>Import from Goodreads</div>
              <div style={s.cardDesc}>Already have a reading history? Bring it over in seconds.</div>
              {imported ? (
                <div style={s.importedBadge}>✓ Done</div>
              ) : (
                <button style={s.btnOutline} onClick={() => setShowImport(true)}>
                  Upload CSV
                </button>
              )}
            </div>

            {/* Find Friends card */}
            <div style={s.card}>
              <div style={s.cardEmoji}>👥</div>
              <div style={s.cardTitle}>Find Friends</div>
              <div style={s.cardDesc}>Search by username to connect with fellow readers.</div>
              <div style={s.friendSearchRow}>
                <input
                  style={s.friendInput}
                  placeholder="Search by username…"
                  value={friendQuery}
                  onChange={e => setFriendQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchFriends()}
                />
                <button
                  style={s.btnSmall}
                  onClick={searchFriends}
                  disabled={friendSearching || !friendQuery.trim()}
                >
                  {friendSearching ? '…' : 'Search'}
                </button>
              </div>
              {friendSearched && !friendSearching && (
                <div style={s.friendResults}>
                  {friendResults.length === 0 ? (
                    <div style={s.noResults}>No users found</div>
                  ) : (
                    friendResults.map(user => {
                      const f = user.friendship
                      return (
                        <div key={user.id} style={s.friendRow}>
                          <div style={s.friendAvatar}>
                            {user.avatar_url
                              ? <img src={user.avatar_url} alt={user.username} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                              : <div style={{ width: 32, height: 32, borderRadius: '50%', background: `linear-gradient(135deg, ${theme.rust}, ${theme.gold})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 13 }}>{user.username.charAt(0).toUpperCase()}</div>
                            }
                          </div>
                          <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: theme.text }}>{user.username}</div>
                          {!f && (
                            <button style={s.btnTiny} onClick={() => addFriend(user.id)} disabled={acting === user.id}>
                              {acting === user.id ? '…' : '+ Add'}
                            </button>
                          )}
                          {f?.status === 'accepted' && <span style={{ fontSize: 12, color: theme.sage, fontWeight: 500 }}>Friends ✓</span>}
                          {f?.status === 'pending' && <span style={{ fontSize: 12, color: theme.textSubtle }}>Requested ✓</span>}
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={s.stepActions}>
            <button style={s.btnSkip} onClick={() => setStep(3)}>Skip for now</button>
            <button style={s.btnPrimary} onClick={() => setStep(3)}>Continue →</button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Add First Book ── */}
      {step === 3 && (
        <div style={s.stepWrap}>
          <div style={s.stepHeading}>What are you reading right now?</div>
          <div style={s.stepSub}>Add a book to kick off your Ex Libris library.</div>

          <button style={s.searchTrigger} onClick={() => setShowSearch(true)}>
            <span style={{ color: theme.textSubtle, fontSize: 15 }}>Search for a book...</span>
            <span style={{ fontSize: 13, color: theme.rust, fontWeight: 500 }}>Search</span>
          </button>

          <div style={s.popularHeading}>Or browse what's popular</div>

          <div style={s.popularGrid}>
            {POPULAR_BOOKS.map(book => (
              <PopularBookCard
                key={book.isbn}
                book={book}
                theme={theme}
                session={session}
                onAdded={() => {}}
              />
            ))}
          </div>

          <div style={s.stepActions}>
            <button style={s.btnSkip} onClick={() => setStep(2)}>← Back</button>
            <button style={s.btnPrimary} onClick={finish}>
              Start Exploring →
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showImport && (
        <GoodreadsImportModal
          session={session}
          onClose={() => setShowImport(false)}
          onImported={() => {
            localStorage.setItem('exlibris-onboarded', '1')
            setImported(true)
            setShowImport(false)
            navigate('/')
          }}
        />
      )}
      {showSearch && (
        <SearchModal
          session={session}
          onClose={() => setShowSearch(false)}
          onAdded={() => setShowSearch(false)}
        />
      )}
    </div>
  )
}

// ── Popular book card with hover add-to-library ──
function PopularBookCard({ book, theme, session, onAdded }) {
  const [hover,   setHover]   = useState(false)
  const [adding,  setAdding]  = useState(false)
  const [added,   setAdded]   = useState(false)
  const [showStatus, setShowStatus] = useState(false)

  async function handleAdd(status) {
    setAdding(true)
    // Upsert book into books table
    const { data: existing } = await supabase
      .from('books')
      .select('id')
      .eq('isbn_13', book.isbn)
      .maybeSingle()

    let bookId = existing?.id
    if (!bookId) {
      const coverUrl = `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`
      const { data: inserted } = await supabase
        .from('books')
        .insert({ title: book.title, author: book.author, isbn_13: book.isbn, cover_image_url: coverUrl })
        .select('id')
        .single()
      bookId = inserted?.id
    }

    if (bookId) {
      await supabase
        .from('collection_entries')
        .upsert({ user_id: session.user.id, book_id: bookId, read_status: status }, { onConflict: 'user_id,book_id' })
      window.dispatchEvent(new CustomEvent('exlibris:bookAdded'))
    }

    setAdded(true)
    setAdding(false)
    setShowStatus(false)
    onAdded()
  }

  const coverUrl = `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: hover ? '0 6px 20px rgba(26,18,8,0.22)' : '2px 3px 10px rgba(26,18,8,0.14)',
        transition: 'box-shadow 0.15s, transform 0.15s',
        transform: hover ? 'translateY(-3px)' : 'none',
        background: '#d4c9b0',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setShowStatus(false) }}
      onClick={() => !added && setShowStatus(v => !v)}
    >
      <img
        src={coverUrl}
        alt={book.title}
        style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
        onError={e => { e.target.style.display = 'none' }}
      />
      {added && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(90,122,90,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 28 }}>✓</span>
        </div>
      )}
      {!added && showStatus && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,18,8,0.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 }}>
          {[
            { s: 'reading', label: 'Reading' },
            { s: 'read',    label: 'Read' },
            { s: 'want',    label: 'Want to Read' },
          ].map(({ s, label }) => (
            <button
              key={s}
              style={{ padding: '5px 12px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', width: '100%', fontFamily: "'DM Sans', sans-serif" }}
              onClick={e => { e.stopPropagation(); handleAdd(s) }}
              disabled={adding}
            >
              {adding ? '…' : label}
            </button>
          ))}
        </div>
      )}
      {!added && hover && !showStatus && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(26,18,8,0.7)', padding: '6px 8px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'white', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{book.title}</div>
        </div>
      )}
    </div>
  )
}

function makeStyles(theme) {
  return {
    page: {
      minHeight: '100vh',
      background: theme.bg,
      fontFamily: "'DM Sans', sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingBottom: 60,
    },
    progressBar: {
      display: 'flex',
      gap: 10,
      marginTop: 40,
      marginBottom: 48,
    },
    dot: {
      width: 10, height: 10, borderRadius: '50%',
      background: theme.border,
      transition: 'background 0.2s',
    },
    dotActive: {
      width: 10, height: 10, borderRadius: '50%',
      background: '#c0521e',
    },
    dotDone: {
      width: 10, height: 10, borderRadius: '50%',
      background: '#5a7a5a',
    },
    stepWrap: {
      width: '100%',
      maxWidth: 680,
      padding: '0 24px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    },
    logo: {
      fontFamily: 'Georgia, serif',
      fontSize: 52,
      fontWeight: 700,
      color: '#1a1208',
      letterSpacing: '-1px',
      marginBottom: 16,
    },
    tagline: {
      fontSize: 20,
      color: theme.text,
      textAlign: 'center',
      marginBottom: 40,
      maxWidth: 480,
      lineHeight: 1.5,
    },
    featureGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 20,
      width: '100%',
      marginBottom: 44,
    },
    featureCard: {
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 16,
      padding: '24px 20px',
      textAlign: 'center',
    },
    featureEmoji: { fontSize: 32, marginBottom: 12 },
    featureTitle: { fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 8 },
    featureDesc:  { fontSize: 13, color: theme.textSubtle, lineHeight: 1.5 },

    stepHeading: {
      fontFamily: 'Georgia, serif',
      fontSize: 28,
      fontWeight: 700,
      color: theme.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    stepSub: {
      fontSize: 15,
      color: theme.textSubtle,
      textAlign: 'center',
      marginBottom: 36,
    },

    twoCol: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 20,
      width: '100%',
      marginBottom: 36,
      alignItems: 'start',
    },
    card: {
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 16,
      padding: '24px 22px',
    },
    cardEmoji: { fontSize: 28, marginBottom: 10 },
    cardTitle: { fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 6 },
    cardDesc:  { fontSize: 13, color: theme.textSubtle, lineHeight: 1.5, marginBottom: 16 },

    importedBadge: {
      display: 'inline-block',
      padding: '6px 16px',
      background: 'rgba(90,122,90,0.15)',
      color: '#5a7a5a',
      borderRadius: 20,
      fontSize: 13,
      fontWeight: 600,
    },

    friendSearchRow: { display: 'flex', gap: 8, marginBottom: 8 },
    friendInput: {
      flex: 1,
      padding: '7px 11px',
      border: `1px solid ${theme.border}`,
      borderRadius: 7,
      fontSize: 13,
      fontFamily: "'DM Sans', sans-serif",
      outline: 'none',
      background: theme.bg,
      color: theme.text,
    },
    friendResults: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' },
    friendRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' },
    friendAvatar: { flexShrink: 0 },
    noResults: { fontSize: 13, color: theme.textSubtle, padding: '8px 0', textAlign: 'center' },

    searchTrigger: {
      width: '100%',
      padding: '14px 20px',
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 10,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      cursor: 'pointer',
      marginBottom: 32,
      fontFamily: "'DM Sans', sans-serif",
    },

    popularHeading: {
      fontSize: 16,
      fontWeight: 600,
      color: theme.textMuted,
      marginBottom: 16,
      alignSelf: 'flex-start',
    },
    popularGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: 12,
      width: '100%',
      marginBottom: 36,
    },

    stepActions: {
      display: 'flex',
      gap: 16,
      alignItems: 'center',
      marginTop: 4,
    },

    btnPrimary: {
      padding: '13px 32px',
      background: '#c0521e',
      color: 'white',
      border: 'none',
      borderRadius: 10,
      fontSize: 16,
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: "'DM Sans', sans-serif",
    },
    btnOutline: {
      padding: '8px 18px',
      background: 'transparent',
      color: '#c0521e',
      border: '1px solid #c0521e',
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: "'DM Sans', sans-serif",
    },
    btnSkip: {
      padding: '10px 20px',
      background: 'transparent',
      color: theme.textSubtle,
      border: 'none',
      fontSize: 14,
      cursor: 'pointer',
      fontFamily: "'DM Sans', sans-serif",
    },
    btnSmall: {
      padding: '7px 14px',
      background: theme.text,
      color: theme.bg,
      border: 'none',
      borderRadius: 7,
      fontSize: 13,
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: "'DM Sans', sans-serif",
      whiteSpace: 'nowrap',
    },
    btnTiny: {
      padding: '4px 10px',
      background: '#c0521e',
      color: 'white',
      border: 'none',
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: "'DM Sans', sans-serif",
      whiteSpace: 'nowrap',
    },
  }
}

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'

export default function Shelves({ session }) {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const [shelves, setShelves]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [showCreate, setShowCreate]   = useState(false)
  const [activeShelf, setActiveShelf] = useState(null) // shelf object when viewing detail

  useEffect(() => {
    fetchShelves()
  }, [])

  async function fetchShelves() {
    setLoading(true)
    const { data } = await supabase
      .from('shelves')
      .select('*, shelf_books(count)')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
    setShelves(data || [])
    setLoading(false)
  }

  async function deleteShelf(id) {
    if (!window.confirm('Delete this shelf and all its books?')) return
    await supabase.from('shelves').delete().eq('id', id).eq('user_id', session.user.id)
    fetchShelves()
  }

  const s = {
    page:          { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content:       { padding: isMobile ? '16px' : '28px 32px', maxWidth: 1000, margin: '0 auto' },

    pageHeader:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
    pageTitle:     { fontFamily: "'Playfair Display', Georgia, serif", fontSize: isMobile ? 22 : 30, fontWeight: 700, color: theme.text, margin: 0 },

    empty:         { color: theme.textSubtle, fontSize: 14, padding: '32px 0' },
    emptyState:    { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 0', textAlign: 'center' },

    grid:          { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: isMobile ? 14 : 20 },

    btnPrimary:    { padding: '8px 18px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:      { padding: '8px 14px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.text },
  }

  if (activeShelf) {
    return (
      <ShelfDetail
        shelf={activeShelf}
        session={session}
        onBack={() => { setActiveShelf(null); fetchShelves() }}
      />
    )
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <h1 style={s.pageTitle}>My Shelves</h1>
          <button style={s.btnPrimary} onClick={() => setShowCreate(true)}>
            + New Shelf
          </button>
        </div>

        {/* Create shelf modal */}
        {showCreate && (
          <CreateShelfModal
            session={session}
            onClose={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); fetchShelves() }}
          />
        )}

        {loading ? (
          <div style={s.empty}>Loading shelves…</div>
        ) : shelves.length === 0 ? (
          <div style={s.emptyState}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📚</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 6 }}>No shelves yet</div>
            <div style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 20 }}>Create a shelf to organise your books into custom reading lists.</div>
            <button style={s.btnPrimary} onClick={() => setShowCreate(true)}>+ Create your first shelf</button>
          </div>
        ) : (
          <div style={s.grid}>
            {shelves.map(shelf => (
              <ShelfCard
                key={shelf.id}
                shelf={shelf}
                onView={() => setActiveShelf(shelf)}
                onDelete={() => deleteShelf(shelf.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- SHELF CARD ----
function ShelfCard({ shelf, onView, onDelete }) {
  const { theme } = useTheme()
  const [hover, setHover] = useState(false)
  const [covers, setCovers] = useState([])

  useEffect(() => {
    async function loadCovers() {
      const { data } = await supabase
        .from('shelf_books')
        .select('books(cover_image_url, title)')
        .eq('shelf_id', shelf.id)
        .limit(3)
      setCovers((data || []).map(r => r.books).filter(Boolean))
    }
    loadCovers()
  }, [shelf.id])

  const bookCount = shelf.shelf_books?.[0]?.count ?? 0

  const s = {
    shelfCard:     {
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      boxShadow: theme.shadowCard,
      transition: 'box-shadow 0.18s, transform 0.18s',
      cursor: 'default',
    },
    shelfCardHover: {
      boxShadow: '0 6px 20px rgba(26,18,8,0.12)',
      transform: 'translateY(-2px)',
    },
    coverStack:    { minHeight: 76 },
    coverStackEmpty: { width: 48, height: 68, background: theme.bgSubtle, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    shelfCardBody: { flex: 1 },
    shelfName:     { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 17, fontWeight: 700, color: theme.text, marginBottom: 4 },
    shelfDesc:     { fontSize: 13, color: theme.textMuted, lineHeight: 1.5, marginBottom: 6 },
    shelfMeta:     { fontSize: 12, color: theme.textSubtle },
    shelfCardActions: { display: 'flex', gap: 8 },
    btnView:       { padding: '6px 14px', background: theme.rust, color: 'white', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", flex: 1 },
    btnDelete:     { padding: '6px 12px', background: 'none', border: '1px solid #f5c6c6', borderRadius: 7, fontSize: 12, color: '#c0392b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  }

  return (
    <div
      style={{ ...s.shelfCard, ...(hover ? s.shelfCardHover : {}) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Mini cover stack */}
      <div style={s.coverStack}>
        {covers.length === 0 ? (
          <div style={s.coverStackEmpty}>
            <span style={{ fontSize: 28, opacity: 0.4 }}>📖</span>
          </div>
        ) : (
          <div style={{ position: 'relative', height: 72 }}>
            {covers.slice(0, 3).map((book, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: i * 18,
                  top: i * 2,
                  width: 48,
                  height: 68,
                  borderRadius: 4,
                  overflow: 'hidden',
                  boxShadow: '1px 2px 6px rgba(26,18,8,0.18)',
                  border: '1px solid rgba(255,255,255,0.6)',
                  zIndex: 3 - i,
                }}
              >
                {book.cover_image_url ? (
                  <img
                    src={book.cover_image_url}
                    alt={book.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <MiniCover title={book.title} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={s.shelfCardBody}>
        <div style={s.shelfName}>{shelf.name}</div>
        {shelf.description && (
          <div style={s.shelfDesc}>{shelf.description}</div>
        )}
        <div style={s.shelfMeta}>
          {bookCount} {bookCount === 1 ? 'book' : 'books'}
        </div>
      </div>

      <div style={s.shelfCardActions}>
        <button style={s.btnView} onClick={onView}>View</button>
        <button style={s.btnDelete} onClick={e => { e.stopPropagation(); onDelete() }}>Delete</button>
      </div>
    </div>
  )
}

// ---- CREATE SHELF MODAL ----
function CreateShelfModal({ session, onClose, onCreated }) {
  const { theme } = useTheme()
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState(null)

  async function submit() {
    if (!name.trim()) { setError('Shelf name is required.'); return }
    setSubmitting(true)
    setError(null)
    const { error: err } = await supabase
      .from('shelves')
      .insert({ user_id: session.user.id, name: name.trim(), description: description.trim() || null })
    if (err) {
      setError('Could not create shelf. Please try again.')
      setSubmitting(false)
    } else {
      onCreated()
    }
  }

  const s = {
    overlay:       { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:         { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 480, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
    modalHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' },
    modalTitle:    { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: theme.text },
    closeBtn:      { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4 },
    modalBody:     { padding: '20px 24px 24px' },
    fieldGroup:    { marginBottom: 16 },
    fieldLabel:    { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    input:         { width: '100%', padding: '9px 13px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    textarea:      { width: '100%', padding: '9px 13px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    btnPrimary:    { padding: '8px 18px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:      { padding: '8px 14px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.text },
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>New Shelf</div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.modalBody}>
          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>Shelf Name *</label>
            <input
              style={s.input}
              placeholder="e.g. Summer Reads, Classics, Book Club…"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>Description (optional)</label>
            <textarea
              style={s.textarea}
              placeholder="What's this shelf for?"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...s.btnPrimary, opacity: submitting ? 0.6 : 1 }} onClick={submit} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Shelf'}
            </button>
            <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Genre colour palette (for bookshelf view) ───────────────────────────────
const GENRE_COLORS = {
  'Science Fiction':    { spine: '#1a5c8a', text: '#e8f4fd' },
  'Fantasy':            { spine: '#5a2d82', text: '#f0e8ff' },
  'Mystery':            { spine: '#1a4d2e', text: '#e8f5ee' },
  'Thriller':           { spine: '#7a1a1a', text: '#ffe8e8' },
  'Horror':             { spine: '#2a0a0a', text: '#ffd0d0' },
  'Romance':            { spine: '#8a1a5c', text: '#ffe8f4' },
  'Historical Fiction': { spine: '#5c3a1a', text: '#fff0e0' },
  'Literary Fiction':   { spine: '#1a5c3a', text: '#e8fff0' },
  'Biography':          { spine: '#4a3a0a', text: '#fff8e0' },
  'Non-Fiction':        { spine: '#1a3a5c', text: '#e0f0ff' },
  'Self-Help':          { spine: '#5c4a1a', text: '#fff5e0' },
  'Young Adult':        { spine: '#1a7a5c', text: '#e0fff8' },
  "Children's":         { spine: '#7a5c1a', text: '#fff8e0' },
  'Graphic Novel':      { spine: '#3a1a7a', text: '#ece8ff' },
  'Poetry':             { spine: '#7a3a5c', text: '#ffe8f4' },
}
const DEFAULT_SPINE_COLOR = { spine: '#6b5c4a', text: '#fff8f0' }

function getGenreColor(genre) {
  if (!genre) return DEFAULT_SPINE_COLOR
  for (const [key, val] of Object.entries(GENRE_COLORS)) {
    if (genre.toLowerCase().includes(key.toLowerCase())) return val
  }
  return DEFAULT_SPINE_COLOR
}

function getSpineWidth(pages) {
  if (!pages) return 22
  return Math.max(16, Math.min(36, Math.round(pages / 18)))
}

// ── Book Spine component ─────────────────────────────────────────────────────
function BookSpine({ book }) {
  const [hovered, setHovered] = useState(false)
  const colors = getGenreColor(book.genre)
  const w = getSpineWidth(book.pages)
  // deterministic height variation based on title to avoid flicker
  const h = 130 + ((book.title?.charCodeAt(0) || 0) % 5) * 5
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        width: w,
        height: h,
        background: colors.spine,
        borderRadius: '2px 2px 1px 1px',
        flexShrink: 0,
        cursor: 'default',
        boxShadow: hovered
          ? '2px 0 8px rgba(0,0,0,0.4), inset 1px 0 0 rgba(255,255,255,0.1)'
          : '1px 0 3px rgba(0,0,0,0.3)',
        transition: 'transform 0.1s, box-shadow 0.1s',
        transform: hovered ? 'translateY(-4px) scaleY(1.02)' : 'none',
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        transform: 'rotate(180deg)',
        fontSize: Math.max(7, Math.min(10, w - 4)),
        color: colors.text,
        padding: '4px 2px',
        lineHeight: 1.2,
        wordBreak: 'break-word',
        overflow: 'hidden',
      }}>
        {book.title?.length > 30 ? book.title.slice(0, 28) + '…' : book.title}
      </div>
      {hovered && (
        <div style={{
          position: 'absolute',
          bottom: '110%',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: 8,
          fontSize: 11,
          whiteSpace: 'nowrap',
          zIndex: 100,
          pointerEvents: 'none',
          minWidth: 160,
          textAlign: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{book.title}</div>
          {book.author && <div style={{ opacity: 0.8, fontSize: 10 }}>by {book.author}</div>}
          {book.genre && <div style={{ opacity: 0.6, fontSize: 10, marginTop: 2 }}>{book.genre}</div>}
          {book.pages && <div style={{ opacity: 0.5, fontSize: 10, marginTop: 1 }}>{book.pages} pages</div>}
        </div>
      )}
    </div>
  )
}

// ── Bookshelf View component ─────────────────────────────────────────────────
function BookshelfView({ books, theme }) {
  if (books.length === 0) return null
  return (
    <div>
      <div style={{
        background: '#f5efe6',
        borderRadius: 6,
        padding: '12px 16px 0 16px',
        boxShadow: 'inset 0 -4px 0 #b8956a, 0 2px 8px rgba(0,0,0,0.08)',
        minHeight: 165,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, flexWrap: 'wrap', paddingBottom: 0 }}>
          {books.map((book, i) => (
            <BookSpine key={book.id || i} book={book} />
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12, color: theme.textSubtle, textAlign: 'center', marginTop: 8 }}>
        Hover over any spine to see details · Width reflects page count · Colours represent genre
      </div>
    </div>
  )
}

// ---- SHELF DETAIL VIEW ----
function ShelfDetail({ shelf, session, onBack }) {
  const { theme } = useTheme()
  const [shelfBooks, setShelfBooks]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [showAddBooks, setShowAddBooks] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collection, setCollection]   = useState([])
  const [collectionLoaded, setCollectionLoaded] = useState(false)
  const [viewMode, setViewMode]       = useState('list') // 'list' | 'shelf'

  useEffect(() => {
    fetchShelfBooks()
  }, [shelf.id])

  async function fetchShelfBooks() {
    setLoading(true)
    const { data } = await supabase
      .from('shelf_books')
      .select('*, books(*)')
      .eq('shelf_id', shelf.id)
      .order('added_at', { ascending: false })
    setShelfBooks(data || [])
    setLoading(false)
  }

  async function loadCollection() {
    if (collectionLoaded) return
    const { data } = await supabase
      .from('collection_entries')
      .select('id, books(id, title, author, cover_image_url)')
      .eq('user_id', session.user.id)
    setCollection(data || [])
    setCollectionLoaded(true)
  }

  async function addBookToShelf(bookId) {
    // Prevent duplicates
    if (shelfBooks.some(sb => sb.book_id === bookId)) return
    await supabase.from('shelf_books').insert({ shelf_id: shelf.id, book_id: bookId })
    fetchShelfBooks()
  }

  async function removeBookFromShelf(bookId) {
    await supabase.from('shelf_books').delete().eq('shelf_id', shelf.id).eq('book_id', bookId)
    fetchShelfBooks()
  }

  const shelfBookIds = new Set(shelfBooks.map(sb => sb.book_id))

  const filteredCollection = collection.filter(entry => {
    const book = entry.books
    if (!book) return false
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return book.title?.toLowerCase().includes(q) || book.author?.toLowerCase().includes(q)
  })

  const s = {
    page:          { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content:       { padding: '28px 32px', maxWidth: 1000, margin: '0 auto' },
    pageTitle:     { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 30, fontWeight: 700, color: theme.text, margin: 0 },
    empty:         { color: theme.textSubtle, fontSize: 14, padding: '32px 0' },
    emptyState:    { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 0', textAlign: 'center' },

    backLink:      { background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: theme.rust, fontFamily: "'DM Sans', sans-serif", padding: 0, fontWeight: 500, marginBottom: 20, display: 'block' },
    detailHeader:  { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24 },
    detailDesc:    { fontSize: 14, color: theme.textMuted, marginTop: 6, lineHeight: 1.6 },

    addBooksPanel: { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '20px 22px', marginBottom: 28, boxShadow: theme.shadowCard },
    addBooksHeader:{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 14 },
    addBooksList:  { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' },
    addBookRow:    { display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: `1px solid ${theme.borderLight}` },
    addBookCover:  { width: 32, height: 46, flexShrink: 0, borderRadius: 3, overflow: 'hidden', background: theme.bgSubtle },
    alreadyAdded:  { fontSize: 12, color: theme.sage, fontWeight: 500, padding: '4px 10px' },
    btnAddToShelf: { padding: '5px 12px', background: theme.rust, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", flexShrink: 0 },

    shelfBooksGrid:    { display: 'flex', flexDirection: 'column', gap: 2 },
    shelfBookCard:     { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: theme.bgCard, border: `1px solid ${theme.borderLight}`, borderRadius: 10, marginBottom: 6 },
    shelfBookCover:    { width: 40, height: 56, flexShrink: 0, borderRadius: 5, overflow: 'hidden', background: theme.bgSubtle },
    shelfBookTitle:    { fontSize: 14, fontWeight: 500, color: theme.text, lineHeight: 1.3 },
    shelfBookAuthor:   { fontSize: 12, color: theme.textSubtle, marginTop: 2 },
    removeFromShelfBtn:{ background: 'none', border: 'none', fontSize: 14, color: theme.textSubtle, cursor: 'pointer', padding: '4px 6px', borderRadius: 4, flexShrink: 0, transition: 'color 0.12s' },

    input:         { width: '100%', padding: '9px 13px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    btnPrimary:    { padding: '8px 18px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.content}>
        <button style={s.backLink} onClick={onBack}>← Back to shelves</button>

        <div style={s.detailHeader}>
          <div>
            <h1 style={s.pageTitle}>{shelf.name}</h1>
            {shelf.description && <p style={s.detailDesc}>{shelf.description}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* View mode toggle */}
            <div style={{ display: 'flex', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <button onClick={() => setViewMode('list')} title="List view"
                style={{ padding: '5px 10px', border: 'none', background: viewMode === 'list' ? theme.rust : 'transparent', color: viewMode === 'list' ? 'white' : theme.textSubtle, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>
                ☰
              </button>
              <button onClick={() => setViewMode('shelf')} title="Bookshelf view"
                style={{ padding: '5px 10px', border: 'none', borderLeft: `1px solid ${theme.border}`, background: viewMode === 'shelf' ? theme.rust : 'transparent', color: viewMode === 'shelf' ? 'white' : theme.textSubtle, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>
                📚
              </button>
            </div>
            <button
              style={s.btnPrimary}
              onClick={() => { setShowAddBooks(v => !v); loadCollection() }}
            >
              {showAddBooks ? '✕ Close' : '+ Add Books'}
            </button>
          </div>
        </div>

        {/* Add books panel */}
        {showAddBooks && (
          <div style={s.addBooksPanel}>
            <div style={s.addBooksHeader}>Add from your collection</div>
            <input
              style={{ ...s.input, marginBottom: 14 }}
              placeholder="Search by title or author…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
            {!collectionLoaded ? (
              <div style={{ color: theme.textSubtle, fontSize: 13 }}>Loading collection…</div>
            ) : filteredCollection.length === 0 ? (
              <div style={{ color: theme.textSubtle, fontSize: 13 }}>No books match your search.</div>
            ) : (
              <div style={s.addBooksList}>
                {filteredCollection.map(entry => {
                  const book = entry.books
                  const alreadyAdded = shelfBookIds.has(book.id)
                  return (
                    <div key={entry.id} style={s.addBookRow}>
                      <div style={s.addBookCover}>
                        {book.cover_image_url
                          ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <MiniCover title={book.title} />
                        }
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: theme.text }}>{book.title}</div>
                        <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>{book.author}</div>
                      </div>
                      {alreadyAdded ? (
                        <span style={s.alreadyAdded}>✓ Added</span>
                      ) : (
                        <button style={s.btnAddToShelf} onClick={() => addBookToShelf(book.id)}>
                          Add
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Books in shelf */}
        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : shelfBooks.length === 0 ? (
          <div style={s.emptyState}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📖</div>
            <div style={{ fontSize: 15, color: theme.textSubtle }}>No books on this shelf yet.</div>
            <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 6 }}>Use "+ Add Books" to add from your collection.</div>
          </div>
        ) : viewMode === 'shelf' ? (
          <BookshelfView
            books={shelfBooks.map(sb => sb.books).filter(Boolean)}
            theme={theme}
          />
        ) : (
          <div style={s.shelfBooksGrid}>
            {shelfBooks.map(sb => {
              const book = sb.books
              if (!book) return null
              return (
                <div key={sb.shelf_id + sb.book_id} style={s.shelfBookCard}>
                  <div style={s.shelfBookCover}>
                    {book.cover_image_url
                      ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 5 }} />
                      : <MiniCover title={book.title} rounded />
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.shelfBookTitle}>{book.title}</div>
                    <div style={s.shelfBookAuthor}>{book.author}</div>
                  </div>
                  <button
                    style={s.removeFromShelfBtn}
                    onClick={() => removeBookFromShelf(book.id)}
                    title="Remove from shelf"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- MINI COVER ----
function MiniCover({ title, rounded }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const color  = colors[(title?.charCodeAt(0) || 0) % colors.length]
  const color2 = colors[((title?.charCodeAt(0) || 0) + 3) % colors.length]
  return (
    <div style={{
      width: '100%', height: '100%',
      background: `linear-gradient(135deg, ${color}, ${color2})`,
      borderRadius: rounded ? 5 : 4,
      display: 'flex', alignItems: 'flex-end',
      padding: '4px 4px 4px 7px',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'rgba(0,0,0,0.2)' }} />
      <span style={{ fontSize: 7, fontWeight: 500, color: 'rgba(255,255,255,0.9)', lineHeight: 1.2, position: 'relative', zIndex: 1 }}>
        {title}
      </span>
    </div>
  )
}

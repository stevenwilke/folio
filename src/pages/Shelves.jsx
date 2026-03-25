import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'

export default function Shelves({ session }) {
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
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1208', marginBottom: 6 }}>No shelves yet</div>
            <div style={{ fontSize: 14, color: '#8a7f72', marginBottom: 20 }}>Create a shelf to organise your books into custom reading lists.</div>
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

// ---- SHELF DETAIL VIEW ----
function ShelfDetail({ shelf, session, onBack }) {
  const [shelfBooks, setShelfBooks]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [showAddBooks, setShowAddBooks] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collection, setCollection]   = useState([])
  const [collectionLoaded, setCollectionLoaded] = useState(false)

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
          <button
            style={s.btnPrimary}
            onClick={() => { setShowAddBooks(v => !v); loadCollection() }}
          >
            {showAddBooks ? '✕ Close' : '+ Add Books'}
          </button>
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
              <div style={{ color: '#8a7f72', fontSize: 13 }}>Loading collection…</div>
            ) : filteredCollection.length === 0 ? (
              <div style={{ color: '#8a7f72', fontSize: 13 }}>No books match your search.</div>
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
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1208' }}>{book.title}</div>
                        <div style={{ fontSize: 12, color: '#8a7f72', marginTop: 2 }}>{book.author}</div>
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
            <div style={{ fontSize: 15, color: '#8a7f72' }}>No books on this shelf yet.</div>
            <div style={{ fontSize: 13, color: '#b0a898', marginTop: 6 }}>Use "+ Add Books" to add from your collection.</div>
          </div>
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

// ---- STYLES ----
const s = {
  page:          { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif" },
  content:       { padding: '28px 32px', maxWidth: 1000, margin: '0 auto' },

  pageHeader:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  pageTitle:     { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 30, fontWeight: 700, color: '#1a1208', margin: 0 },

  empty:         { color: '#8a7f72', fontSize: 14, padding: '32px 0' },
  emptyState:    { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 0', textAlign: 'center' },

  grid:          { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 },

  shelfCard:     {
    background: '#fdfaf4',
    border: '1px solid #d4c9b0',
    borderRadius: 12,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    boxShadow: '0 2px 8px rgba(26,18,8,0.06)',
    transition: 'box-shadow 0.18s, transform 0.18s',
    cursor: 'default',
  },
  shelfCardHover: {
    boxShadow: '0 6px 20px rgba(26,18,8,0.12)',
    transform: 'translateY(-2px)',
  },
  coverStack:    { minHeight: 76 },
  coverStackEmpty: { width: 48, height: 68, background: '#e8dfc8', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  shelfCardBody: { flex: 1 },
  shelfName:     { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 17, fontWeight: 700, color: '#1a1208', marginBottom: 4 },
  shelfDesc:     { fontSize: 13, color: '#5a4f44', lineHeight: 1.5, marginBottom: 6 },
  shelfMeta:     { fontSize: 12, color: '#8a7f72' },
  shelfCardActions: { display: 'flex', gap: 8 },

  btnPrimary:    { padding: '8px 18px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnGhost:      { padding: '8px 14px', background: 'none', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#3a3028' },
  btnView:       { padding: '6px 14px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", flex: 1 },
  btnDelete:     { padding: '6px 12px', background: 'none', border: '1px solid #f5c6c6', borderRadius: 7, fontSize: 12, color: '#c0392b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

  overlay:       { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:         { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, width: 480, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
  modalHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' },
  modalTitle:    { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: '#1a1208' },
  closeBtn:      { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#8a7f72', padding: 4 },
  modalBody:     { padding: '20px 24px 24px' },
  fieldGroup:    { marginBottom: 16 },
  fieldLabel:    { display: 'block', fontSize: 11, fontWeight: 600, color: '#3a3028', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:         { width: '100%', padding: '9px 13px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: 'white', color: '#1a1208', boxSizing: 'border-box' },
  textarea:      { width: '100%', padding: '9px 13px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: 'white', color: '#1a1208', boxSizing: 'border-box' },

  // Detail view
  backLink:      { background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: '#c0521e', fontFamily: "'DM Sans', sans-serif", padding: 0, fontWeight: 500, marginBottom: 20, display: 'block' },
  detailHeader:  { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24 },
  detailDesc:    { fontSize: 14, color: '#5a4f44', marginTop: 6, lineHeight: 1.6 },

  addBooksPanel: { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 12, padding: '20px 22px', marginBottom: 28, boxShadow: '0 2px 8px rgba(26,18,8,0.06)' },
  addBooksHeader:{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 15, fontWeight: 700, color: '#1a1208', marginBottom: 14 },
  addBooksList:  { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' },
  addBookRow:    { display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #f0e8d8' },
  addBookCover:  { width: 32, height: 46, flexShrink: 0, borderRadius: 3, overflow: 'hidden', background: '#e8dfc8' },
  alreadyAdded:  { fontSize: 12, color: '#5a7a5a', fontWeight: 500, padding: '4px 10px' },
  btnAddToShelf: { padding: '5px 12px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", flexShrink: 0 },

  shelfBooksGrid:    { display: 'flex', flexDirection: 'column', gap: 2 },
  shelfBookCard:     { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: '#fdfaf4', border: '1px solid #e8dfc8', borderRadius: 10, marginBottom: 6 },
  shelfBookCover:    { width: 40, height: 56, flexShrink: 0, borderRadius: 5, overflow: 'hidden', background: '#e8dfc8' },
  shelfBookTitle:    { fontSize: 14, fontWeight: 500, color: '#1a1208', lineHeight: 1.3 },
  shelfBookAuthor:   { fontSize: 12, color: '#8a7f72', marginTop: 2 },
  removeFromShelfBtn:{ background: 'none', border: 'none', fontSize: 14, color: '#b0a898', cursor: 'pointer', padding: '4px 6px', borderRadius: 4, flexShrink: 0, transition: 'color 0.12s' },
}

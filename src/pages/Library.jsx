import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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

export default function Library({ session }) {
  const [books, setBooks]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('all')
  const [showSearch, setShowSearch] = useState(false)

  useEffect(() => { fetchCollection() }, [])

  async function fetchCollection() {
    setLoading(true)
    const { data, error } = await supabase
      .from('collection_entries')
      .select(`
        id, read_status, user_rating, added_at,
        books ( id, title, author, cover_image_url, genre, published_year )
      `)
      .eq('user_id', session.user.id)
      .order('added_at', { ascending: false })

    if (!error) setBooks(data || [])
    setLoading(false)
  }

  const filtered = filter === 'all' ? books : books.filter(e => e.read_status === filter)

  const stats = {
    total:   books.length,
    read:    books.filter(b => b.read_status === 'read').length,
    reading: books.filter(b => b.read_status === 'reading').length,
    want:    books.filter(b => b.read_status === 'want').length,
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.logo}>Folio</div>
        <div style={s.topbarRight}>
          <button style={s.btnPrimary} onClick={() => setShowSearch(true)}>+ Add Book</button>
          <button style={s.btnGhost} onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      <div style={s.content}>
        <div style={s.statsRow}>
          {[
            ['Total Books', stats.total,   null],
            ['Read',        stats.read,    '#5a7a5a'],
            ['Reading',     stats.reading, '#c0521e'],
            ['Want to Read',stats.want,    '#b8860b'],
          ].map(([label, val, color]) => (
            <div key={label} style={s.statCard}>
              <div style={{ ...s.statVal, color: color || '#1a1208' }}>{val}</div>
              <div style={s.statLabel}>{label}</div>
            </div>
          ))}
        </div>

        <div style={s.filterRow}>
          {['all', 'owned', 'read', 'reading', 'want'].map(f => (
            <button key={f} style={filter === f ? s.filterActive : s.filterInactive}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'All Books' : STATUS_LABELS[f]}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={s.empty}>Loading your library…</div>
        ) : filtered.length === 0 ? (
          <div style={s.empty}>
            {books.length === 0
              ? 'Your library is empty — add your first book!'
              : 'No books with this status yet.'}
          </div>
        ) : (
          <div style={s.grid}>
            {filtered.map(entry => (
              <BookCard key={entry.id} entry={entry} onUpdate={fetchCollection} />
            ))}
          </div>
        )}
      </div>

      {showSearch && (
        <SearchModal
          session={session}
          onClose={() => setShowSearch(false)}
          onAdded={() => { setShowSearch(false); fetchCollection() }}
        />
      )}
    </div>
  )
}

// ---- BOOK CARD ----
function BookCard({ entry, onUpdate }) {
  const book   = entry.books
  const status = entry.read_status
  const [menuOpen, setMenuOpen] = useState(false)

  async function changeStatus(newStatus) {
    await supabase
      .from('collection_entries')
      .update({ read_status: newStatus })
      .eq('id', entry.id)
    setMenuOpen(false)
    onUpdate()
  }

  async function removeBook() {
    await supabase.from('collection_entries').delete().eq('id', entry.id)
    setMenuOpen(false)
    onUpdate()
  }

  return (
    <div style={s.card}>
      <div style={s.coverWrap}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={s.coverImg} />
          : <FakeCover title={book.title} />
        }
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={s.bookTitle}>{book.title}</div>
        <div style={s.bookAuthor}>{book.author}</div>
        <div style={{ position: 'relative', marginTop: 6 }}>
          <span
            style={{ ...s.badge, ...STATUS_COLORS[status], cursor: 'pointer' }}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {STATUS_LABELS[status]} ▾
          </span>
          {menuOpen && (
            <div style={s.menu}>
              {Object.entries(STATUS_LABELS).map(([val, label]) => (
                <div key={val} style={{
                  ...s.menuItem,
                  fontWeight: val === status ? 600 : 400,
                  color: val === status ? '#1a1208' : '#3a3028',
                }} onClick={() => changeStatus(val)}>
                  {val === status ? '✓ ' : ''}{label}
                </div>
              ))}
              <div style={{ ...s.menuItem, borderTop: '1px solid #e8dfc8', color: '#c0521e', marginTop: 4 }}
                onClick={removeBook}>
                Remove from library
              </div>
            </div>
          )}
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

// ---- SEARCH MODAL ----
function SearchModal({ session, onClose, onAdded }) {
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState([])
  const [searching, setSearching]   = useState(false)
  const [adding, setAdding]         = useState(null)
  const [addedBooks, setAddedBooks] = useState({})

  async function search() {
    if (!query.trim()) return
    setSearching(true)
    setResults([])
    try {
      const res  = await fetch(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,isbn,cover_i,first_publish_year,subject&limit=12`
      )
      const data = await res.json()
      setResults(data.docs || [])
    } catch {
      setResults([])
    }
    setSearching(false)
  }

  async function addBook(doc, status) {
    setAdding(doc.key + status)

    const isbn13   = doc.isbn?.find(i => i.length === 13) || null
    const isbn10   = doc.isbn?.find(i => i.length === 10) || null
    const coverUrl = doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : null

    let bookId = null

    if (isbn13) {
      const { data: existing } = await supabase
        .from('books').select('id').eq('isbn_13', isbn13).maybeSingle()
      if (existing) bookId = existing.id
    }

    if (!bookId) {
      const { data: existing } = await supabase
        .from('books').select('id')
        .eq('title', doc.title)
        .eq('author', doc.author_name?.[0] || 'Unknown')
        .maybeSingle()
      if (existing) bookId = existing.id
    }

    if (!bookId) {
      const { data: newBook, error: insertError } = await supabase
        .from('books')
        .insert({
          title:           doc.title,
          author:          doc.author_name?.[0] || 'Unknown',
          isbn_13:         isbn13,
          isbn_10:         isbn10,
          cover_image_url: coverUrl,
          published_year:  doc.first_publish_year || null,
          genre:           doc.subject?.[0] || null,
        })
        .select()
        .single()

      if (insertError || !newBook) {
        console.error('Book insert failed:', insertError)
        setAdding(null)
        return
      }
      bookId = newBook.id
    }

    const { error: collectionError } = await supabase
      .from('collection_entries')
      .upsert({
        user_id:     session.user.id,
        book_id:     bookId,
        read_status: status,
      }, { onConflict: 'user_id,book_id' })

    if (collectionError) {
      console.error('Collection insert failed:', collectionError)
      setAdding(null)
      return
    }

    setAddedBooks(prev => ({ ...prev, [doc.key]: status }))
    setAdding(null)
    onAdded()
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>Add a Book</div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.searchRow}>
          <input
            style={s.searchInput}
            placeholder="Search by title, author, or ISBN…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            autoFocus
          />
          <button style={s.btnPrimary} onClick={search} disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
        </div>

        <div style={s.results}>
          {searching && <div style={s.empty}>Searching Open Library…</div>}
          {!searching && results.length === 0 && query && (
            <div style={s.empty}>No results — try a different search.</div>
          )}
          {!searching && results.length === 0 && !query && (
            <div style={s.empty}>Search for a title, author, or ISBN above.</div>
          )}

          {results.map(doc => {
            const coverUrl     = doc.cover_i
              ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-S.jpg`
              : null
            const alreadyAdded = addedBooks[doc.key]

            return (
              <div key={doc.key} style={s.resultRow}>
                <div style={s.resultCover}>
                  {coverUrl
                    ? <img src={coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 3 }} />
                    : <div style={{ width: '100%', height: '100%', background: '#d4c9b0', borderRadius: 3 }} />
                  }
                </div>

                <div style={s.resultInfo}>
                  <div style={s.resultTitle}>{doc.title}</div>
                  <div style={s.resultAuthor}>{doc.author_name?.[0] || 'Unknown author'}</div>
                  {doc.first_publish_year && (
                    <div style={s.resultYear}>{doc.first_publish_year}</div>
                  )}
                </div>

                <div style={s.resultActions}>
                  {alreadyAdded ? (
                    <div style={s.addedConfirm}>✓ {STATUS_LABELS[alreadyAdded]}</div>
                  ) : (
                    <>
                      {/* Primary button — just adds to library */}
                      <button
                        style={{
                          ...s.addBtnPrimary,
                          ...(adding === doc.key + 'owned' ? s.addBtnLoading : {}),
                        }}
                        disabled={!!adding}
                        onClick={() => addBook(doc, 'owned')}
                      >
                        {adding === doc.key + 'owned' ? '…' : '+ Add to Library'}
                      </button>

                      {/* Secondary row — optional status shortcuts */}
                      <div style={s.statusShortcuts}>
                        {['read', 'reading', 'want'].map(status => (
                          <button
                            key={status}
                            style={{
                              ...s.addBtn,
                              ...(adding === doc.key + status ? s.addBtnLoading : {}),
                            }}
                            disabled={!!adding}
                            onClick={() => addBook(doc, status)}
                          >
                            {adding === doc.key + status ? '…' : STATUS_LABELS[status]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---- STYLES ----
const s = {
  page:           { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif" },
  topbar:         { position: 'sticky', top: 0, zIndex: 10, background: 'rgba(245,240,232,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #d4c9b0', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:           { fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, color: '#1a1208' },
  topbarRight:    { display: 'flex', gap: 10, alignItems: 'center' },
  content:        { padding: '28px 32px' },
  statsRow:       { display: 'flex', gap: 14, marginBottom: 28 },
  statCard:       { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 12, padding: '18px 22px', flex: 1 },
  statVal:        { fontFamily: 'Georgia, serif', fontSize: 30, fontWeight: 700 },
  statLabel:      { fontSize: 11, color: '#8a7f72', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
  filterRow:      { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
  filterActive:   { padding: '7px 16px', borderRadius: 8, border: 'none', background: '#c0521e', color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  filterInactive: { padding: '7px 16px', borderRadius: 8, border: '1px solid #d4c9b0', background: 'transparent', color: '#1a1208', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  grid:           { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 20 },
  card:           { cursor: 'default' },
  coverWrap:      { width: '100%', aspectRatio: '2/3' },
  coverImg:       { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 5, boxShadow: '2px 3px 10px rgba(26,18,8,0.2)' },
  fakeCover:      { width: '100%', height: '100%', borderRadius: 5, display: 'flex', alignItems: 'flex-end', padding: '8px 8px 8px 14px', position: 'relative', overflow: 'hidden', boxShadow: '2px 3px 10px rgba(26,18,8,0.2)' },
  fakeSpine:      { position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, background: 'rgba(0,0,0,0.2)' },
  fakeCoverText:  { fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.5)', lineHeight: 1.3, position: 'relative', zIndex: 1 },
  bookTitle:      { fontSize: 13, fontWeight: 500, lineHeight: 1.3, color: '#1a1208' },
  bookAuthor:     { fontSize: 12, color: '#8a7f72', marginTop: 2 },
  badge:          { display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 500 },
  menu:           { position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 8, zIndex: 20, minWidth: 160, boxShadow: '0 4px 16px rgba(26,18,8,0.12)' },
  menuItem:       { padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: '#3a3028' },
  empty:          { color: '#8a7f72', fontSize: 14, padding: '40px 0', textAlign: 'center' },
  btnPrimary:     { padding: '8px 16px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnGhost:       { padding: '8px 16px', background: 'transparent', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#1a1208' },
  overlay:        { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:          { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, width: 600, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
  modalHeader:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' },
  modalTitle:     { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: '#1a1208' },
  closeBtn:       { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#8a7f72', padding: 4 },
  searchRow:      { display: 'flex', gap: 10, padding: '16px 24px' },
  searchInput:    { flex: 1, padding: '9px 14px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: 'white', color: '#1a1208' },
  results:        { overflowY: 'auto', padding: '0 24px 20px', flex: 1 },
  resultRow:      { display: 'flex', gap: 14, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #e8dfc8' },
  resultCover:    { width: 36, height: 54, flexShrink: 0, borderRadius: 3, overflow: 'hidden', background: '#d4c9b0' },
  resultInfo:     { flex: 1 },
  resultTitle:    { fontSize: 14, fontWeight: 500, color: '#1a1208', lineHeight: 1.3 },
  resultAuthor:   { fontSize: 12, color: '#8a7f72', marginTop: 2 },
  resultYear:     { fontSize: 11, color: '#8a7f72', marginTop: 2 },
  resultActions:  { display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'flex-end' },
  addBtnPrimary:  { padding: '6px 14px', fontSize: 12, background: '#c0521e', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 500, whiteSpace: 'nowrap' },
  statusShortcuts:{ display: 'flex', gap: 4 },
  addBtn:         { padding: '4px 8px', fontSize: 11, background: 'transparent', border: '1px solid #d4c9b0', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#1a1208', whiteSpace: 'nowrap' },
  addBtnLoading:  { opacity: 0.5, cursor: 'not-allowed' },
  addedConfirm:   { fontSize: 12, color: '#5a7a5a', fontWeight: 500 },
}
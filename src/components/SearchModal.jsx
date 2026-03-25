import { useState } from 'react'
import { supabase } from '../lib/supabase'
import ManualAddModal from './ManualAddModal'
import { useTheme } from '../contexts/ThemeContext'

const STATUS_LABELS = {
  owned:   'In Library',
  read:    'Read',
  reading: 'Reading',
  want:    'Want to Read',
}

// Normalize an Open Library doc into a unified result shape
function fromOL(doc) {
  return {
    key:      `ol-${doc.key}`,
    title:    doc.title,
    author:   doc.author_name?.[0] || 'Unknown author',
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-S.jpg` : null,
    saveCoverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    year:     doc.first_publish_year || null,
    isbn13:   doc.isbn?.find(i => i.length === 13) || null,
    isbn10:   doc.isbn?.find(i => i.length === 10) || null,
    genre:    doc.subject?.[0] || null,
    source:   'openlibrary',
    bookId:   null,
  }
}

// Normalize a Supabase book row into the same shape
function fromFolio(b) {
  return {
    key:          `folio-${b.id}`,
    title:        b.title,
    author:       b.author || 'Unknown author',
    coverUrl:     b.cover_image_url || null,
    saveCoverUrl: b.cover_image_url || null,
    year:         b.published_year || null,
    isbn13:       b.isbn_13 || null,
    isbn10:       b.isbn_10 || null,
    genre:        b.genre || null,
    source:       'folio',
    bookId:       b.id,
  }
}

export default function SearchModal({ session, onClose, onAdded = () => {} }) {
  const { theme } = useTheme()
  const [showManual, setShowManual] = useState(false)
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState([])
  const [searching,  setSearching]  = useState(false)
  const [adding,     setAdding]     = useState(null)
  const [addedBooks, setAddedBooks] = useState({})

  async function search() {
    if (!query.trim()) return
    setSearching(true)
    setResults([])

    // Detect ISBN queries (digits only, 10 or 13 chars)
    const stripped = query.replace(/[-\s]/g, '')
    const isIsbn   = /^\d{10,13}$/.test(stripped)

    // Build Supabase query
    let folioQ = supabase
      .from('books')
      .select('id, title, author, isbn_13, isbn_10, cover_image_url, published_year, genre')
      .limit(8)

    if (isIsbn) {
      folioQ = folioQ.or(`isbn_13.eq.${stripped},isbn_10.eq.${stripped}`)
    } else {
      folioQ = folioQ.or(`title.ilike.%${query.trim()}%,author.ilike.%${query.trim()}%`)
    }

    try {
      const [olJson, { data: folioBooks }] = await Promise.all([
        fetch(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,isbn,cover_i,first_publish_year,subject&limit=12`
        ).then(r => r.json()).catch(() => ({ docs: [] })),
        folioQ,
      ])

      // Normalize Folio results
      const folioResults = (folioBooks || []).map(fromFolio)

      // Build a set of ISBNs already covered by Folio results (for dedup)
      const folioIsbn13s = new Set(folioResults.map(r => r.isbn13).filter(Boolean))
      const folioIsbn10s = new Set(folioResults.map(r => r.isbn10).filter(Boolean))

      // Normalize OL results, skipping any whose ISBN already appears in Folio
      const olResults = (olJson.docs || [])
        .filter(doc => {
          const i13 = doc.isbn?.find(i => i.length === 13)
          const i10 = doc.isbn?.find(i => i.length === 10)
          if (i13 && folioIsbn13s.has(i13)) return false
          if (i10 && folioIsbn10s.has(i10)) return false
          return true
        })
        .map(fromOL)

      // Folio community results first, then Open Library
      setResults([...folioResults, ...olResults])
    } catch {
      setResults([])
    }

    setSearching(false)
  }

  async function addBook(result, status) {
    setAdding(result.key + status)

    let bookId = result.bookId  // already set for Folio results

    if (!bookId) {
      // Try to find existing book by ISBN or title+author
      if (result.isbn13) {
        const { data } = await supabase.from('books').select('id').eq('isbn_13', result.isbn13).maybeSingle()
        if (data) bookId = data.id
      }
      if (!bookId && result.isbn10) {
        const { data } = await supabase.from('books').select('id').eq('isbn_10', result.isbn10).maybeSingle()
        if (data) bookId = data.id
      }
      if (!bookId) {
        const { data } = await supabase.from('books').select('id')
          .eq('title', result.title).eq('author', result.author).maybeSingle()
        if (data) bookId = data.id
      }

      // Still not found — insert a new book record
      if (!bookId) {
        const { data: newBook, error } = await supabase.from('books').insert({
          title:           result.title,
          author:          result.author,
          isbn_13:         result.isbn13,
          isbn_10:         result.isbn10,
          cover_image_url: result.saveCoverUrl,
          published_year:  result.year,
          genre:           result.genre,
        }).select().single()

        if (error || !newBook) {
          console.error('Book insert failed:', error)
          setAdding(null)
          return
        }
        bookId = newBook.id
      }
    }

    const { error: collectionError } = await supabase
      .from('collection_entries')
      .upsert(
        { user_id: session.user.id, book_id: bookId, read_status: status },
        { onConflict: 'user_id,book_id' }
      )

    if (collectionError) {
      console.error('Collection upsert failed:', collectionError)
      setAdding(null)
      return
    }

    setAddedBooks(prev => ({ ...prev, [result.key]: status }))
    setAdding(null)
    window.dispatchEvent(new CustomEvent('folio:bookAdded'))
    onAdded()
  }

  const s = makeStyles(theme)

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
          {searching && <div style={s.empty}>Searching…</div>}
          {!searching && results.length === 0 && query && (
            <div style={s.empty}>No results — try a different search.</div>
          )}
          {!searching && results.length === 0 && !query && (
            <div style={s.empty}>Search for a title, author, or ISBN above.</div>
          )}

          {!searching && (
            <div style={s.manualRow}>
              <span style={s.manualText}>Can't find it?</span>
              <button style={s.manualBtn} onClick={() => setShowManual(true)}>
                Add manually →
              </button>
            </div>
          )}

          {results.map(result => {
            const alreadyAdded = addedBooks[result.key]
            return (
              <div key={result.key} style={s.resultRow}>
                <div style={s.resultCover}>
                  {result.coverUrl
                    ? <img src={result.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 3 }} />
                    : <div style={{ width: '100%', height: '100%', background: theme.border, borderRadius: 3 }} />
                  }
                </div>

                <div style={s.resultInfo}>
                  <div style={s.resultTitleRow}>
                    <div style={s.resultTitle}>{result.title}</div>
                    {result.source === 'folio' && (
                      <span style={s.folioBadge}>📚 In Folio</span>
                    )}
                  </div>
                  <div style={s.resultAuthor}>{result.author}</div>
                  {result.year && <div style={s.resultYear}>{result.year}</div>}
                </div>

                <div style={s.resultActions}>
                  {alreadyAdded ? (
                    <div style={s.addedConfirm}>✓ {STATUS_LABELS[alreadyAdded]}</div>
                  ) : (
                    <>
                      <button
                        style={{ ...s.addBtnPrimary, ...(adding === result.key + 'owned' ? s.addBtnLoading : {}) }}
                        disabled={!!adding}
                        onClick={() => addBook(result, 'owned')}
                      >
                        {adding === result.key + 'owned' ? '…' : '+ Add to Library'}
                      </button>
                      <div style={s.statusShortcuts}>
                        {['read', 'reading', 'want'].map(status => (
                          <button
                            key={status}
                            style={{ ...s.addBtn, ...(adding === result.key + status ? s.addBtnLoading : {}) }}
                            disabled={!!adding}
                            onClick={() => addBook(result, status)}
                          >
                            {adding === result.key + status ? '…' : STATUS_LABELS[status]}
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

      {showManual && (
        <ManualAddModal
          session={session}
          onClose={() => setShowManual(false)}
          onAdded={() => { setShowManual(false); onAdded() }}
        />
      )}
    </div>
  )
}

function makeStyles(theme) {
  return {
    overlay:        { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:          { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 600, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
    modalHeader:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' },
    modalTitle:     { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text },
    closeBtn:       { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4 },
    searchRow:      { display: 'flex', gap: 10, padding: '16px 24px' },
    searchInput:    { flex: 1, padding: '9px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgSubtle, color: theme.text },
    results:        { overflowY: 'auto', padding: '0 24px 20px', flex: 1 },
    resultRow:      { display: 'flex', gap: 14, alignItems: 'center', padding: '14px 0', borderBottom: `1px solid ${theme.borderLight}` },
    resultCover:    { width: 36, height: 54, flexShrink: 0, borderRadius: 3, overflow: 'hidden', background: theme.border },
    resultInfo:     { flex: 1, minWidth: 0 },
    resultTitleRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    resultTitle:    { fontSize: 14, fontWeight: 500, color: theme.text, lineHeight: 1.3 },
    folioBadge:     { fontSize: 10, fontWeight: 600, color: theme.sage, background: theme.sageLight, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0 },
    resultAuthor:   { fontSize: 12, color: theme.textSubtle, marginTop: 2 },
    resultYear:     { fontSize: 11, color: theme.textSubtle, marginTop: 2 },
    resultActions:  { display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'flex-end' },
    addBtnPrimary:  { padding: '6px 14px', fontSize: 12, background: theme.rust, color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 500, whiteSpace: 'nowrap' },
    statusShortcuts:{ display: 'flex', gap: 4 },
    addBtn:         { padding: '4px 8px', fontSize: 11, background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.text, whiteSpace: 'nowrap' },
    addBtnLoading:  { opacity: 0.5, cursor: 'not-allowed' },
    addedConfirm:   { fontSize: 12, color: theme.sage, fontWeight: 500 },
    manualRow:      { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 6px', borderBottom: `1px solid ${theme.borderLight}`, marginBottom: 4 },
    manualText:     { fontSize: 12, color: theme.textSubtle },
    manualBtn:      { fontSize: 12, fontWeight: 600, color: theme.rust, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'DM Sans', sans-serif" },
    btnPrimary:     { padding: '8px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    empty:          { padding: '40px 0', textAlign: 'center', color: theme.textSubtle, fontSize: 14 },
  }
}

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import ManualAddModal from './ManualAddModal'

const STATUS_LABELS = {
  owned:   'In Library',
  read:    'Read',
  reading: 'Reading',
  want:    'Want to Read',
}

export default function SearchModal({ session, onClose, onAdded = () => {} }) {
  const [showManual, setShowManual] = useState(false)
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
    window.dispatchEvent(new CustomEvent('folio:bookAdded'))
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

          {!searching && (
            <div style={s.manualRow}>
              <span style={s.manualText}>Can't find it?</span>
              <button style={s.manualBtn} onClick={() => setShowManual(true)}>
                Add manually →
              </button>
            </div>
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
                      <button
                        style={{ ...s.addBtnPrimary, ...(adding === doc.key + 'owned' ? s.addBtnLoading : {}) }}
                        disabled={!!adding}
                        onClick={() => addBook(doc, 'owned')}
                      >
                        {adding === doc.key + 'owned' ? '…' : '+ Add to Library'}
                      </button>
                      <div style={s.statusShortcuts}>
                        {['read', 'reading', 'want'].map(status => (
                          <button
                            key={status}
                            style={{ ...s.addBtn, ...(adding === doc.key + status ? s.addBtnLoading : {}) }}
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

const s = {
  overlay:        { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
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
  manualRow:      { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 6px', borderBottom: '1px solid #e8dfc8', marginBottom: 4 },
  manualText:     { fontSize: 12, color: '#8a7f72' },
  manualBtn:      { fontSize: 12, fontWeight: 600, color: '#c0521e', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'DM Sans', sans-serif" },
  btnPrimary:     { padding: '8px 16px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  empty:          { padding: '40px 0', textAlign: 'center', color: '#8a7f72', fontSize: 14 },
}

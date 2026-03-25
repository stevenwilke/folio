import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'

// Map Goodreads exclusive_shelf to our status
function mapShelf(shelf) {
  if (shelf === 'read')              return 'read'
  if (shelf === 'currently-reading') return 'reading'
  if (shelf === 'to-read')           return 'want'
  return 'owned'
}

// Parse Goodreads CSV export
function parseGoodreadsCSV(text) {
  const lines = text.split('\n').filter(l => l.trim())
  if (!lines.length) return []

  // Find header row
  const header = parseCSVLine(lines[0])
  const idx = {
    title:   header.findIndex(h => h.toLowerCase() === 'title'),
    author:  header.findIndex(h => h.toLowerCase() === 'author'),
    isbn:    header.findIndex(h => h.toLowerCase() === 'isbn'),
    isbn13:  header.findIndex(h => h.toLowerCase() === 'isbn13'),
    rating:  header.findIndex(h => h.toLowerCase() === 'my rating'),
    pages:   header.findIndex(h => h.toLowerCase() === 'number of pages'),
    year:    header.findIndex(h => h.toLowerCase() === 'original publication year'),
    shelf:   header.findIndex(h => h.toLowerCase() === 'exclusive shelf'),
    review:  header.findIndex(h => h.toLowerCase() === 'my review'),
    binding: header.findIndex(h => h.toLowerCase() === 'binding'),
  }

  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line)
    const isbn13 = cleanIsbn(cols[idx.isbn13])
    const isbn10 = cleanIsbn(cols[idx.isbn])
    return {
      title:   cols[idx.title]  || '',
      author:  cols[idx.author] || '',
      isbn13:  isbn13 || null,
      isbn10:  isbn10 || null,
      rating:  parseInt(cols[idx.rating]) || null,
      pages:   parseInt(cols[idx.pages])  || null,
      year:    parseInt(cols[idx.year])   || null,
      status:  mapShelf(cols[idx.shelf]   || ''),
      review:  cols[idx.review]?.trim()   || null,
      format:  cols[idx.binding]?.trim()  || null,
    }
  }).filter(b => b.title)
}

function cleanIsbn(raw) {
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9X]/gi, '')
  return cleaned.length >= 10 ? cleaned : null
}

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (line[i] === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += line[i]
    }
  }
  result.push(current.trim())
  return result
}

async function fetchCoverUrl(isbn13, isbn10) {
  // Try isbn13 first, then isbn10
  const candidates = [isbn13, isbn10].filter(Boolean)
  for (const isbn of candidates) {
    try {
      // Open Library cover exists check — a HEAD request tells us if cover exists
      const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok) return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`
    } catch { /* skip */ }
  }
  return null
}

export default function GoodreadsImportModal({ session, onClose, onImported }) {
  const { theme } = useTheme()
  const fileRef   = useRef(null)
  const [books,    setBooks]    = useState([])
  const [step,     setStep]     = useState('upload')  // upload | preview | importing | done
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error,    setError]    = useState(null)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = parseGoodreadsCSV(ev.target.result)
        if (!parsed.length) { setError('No books found. Make sure this is a Goodreads CSV export.'); return }
        setBooks(parsed)
        setStep('preview')
        setError(null)
      } catch {
        setError('Could not parse the file. Please use the official Goodreads CSV export.')
      }
    }
    reader.readAsText(file)
  }

  async function startImport() {
    setStep('importing')
    setProgress({ done: 0, total: books.length })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not authenticated.'); setStep('preview'); return }

    for (let i = 0; i < books.length; i++) {
      const b = books[i]
      try {
        // Find or create book
        let bookId = null
        if (b.isbn13) {
          const { data } = await supabase.from('books').select('id').eq('isbn_13', b.isbn13).maybeSingle()
          if (data) bookId = data.id
        }
        if (!bookId && b.isbn10) {
          const { data } = await supabase.from('books').select('id').eq('isbn_10', b.isbn10).maybeSingle()
          if (data) bookId = data.id
        }
        if (!bookId) {
          const { data } = await supabase.from('books').select('id')
            .eq('title', b.title).eq('author', b.author).maybeSingle()
          if (data) bookId = data.id
        }
        if (!bookId) {
          const coverUrl = await fetchCoverUrl(b.isbn13, b.isbn10)
          const { data: newBook } = await supabase.from('books').insert({
            title: b.title, author: b.author,
            isbn_13: b.isbn13, isbn_10: b.isbn10,
            pages: b.pages, published_year: b.year,
            format: b.format,
            cover_image_url: coverUrl,
          }).select('id').single()
          if (newBook) bookId = newBook.id
        }

        if (bookId) {
          await supabase.from('collection_entries').upsert({
            user_id:     user.id,
            book_id:     bookId,
            read_status: b.status,
            user_rating: b.rating || null,
            review_text: b.review || null,
          }, { onConflict: 'user_id,book_id' })
        }
      } catch { /* skip failed books */ }

      setProgress({ done: i + 1, total: books.length })
    }
    setStep('done')
  }

  const STATUS_LABELS = { read: 'Read', reading: 'Reading', want: 'Want to Read', owned: 'In Library' }
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  const s = makeStyles(theme)

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div style={s.title}>Import from Goodreads</div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          {step === 'upload' && (
            <>
              <div style={s.instructions}>
                <div style={s.step}><span style={s.stepNum}>1</span> Open Goodreads → My Books → Import/Export → Export Library</div>
                <div style={s.step}><span style={s.stepNum}>2</span> Download the CSV file</div>
                <div style={s.step}><span style={s.stepNum}>3</span> Upload it below</div>
              </div>
              <div style={s.uploadArea} onClick={() => fileRef.current?.click()}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                <div style={{ fontWeight: 600, color: theme.text, fontSize: 14 }}>Click to select your Goodreads CSV</div>
                <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 4 }}>goodreads_library_export.csv</div>
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFile} />
              {error && <div style={s.errorMsg}>{error}</div>}
            </>
          )}

          {step === 'preview' && (
            <>
              <div style={s.previewHeader}>
                Found <strong>{books.length} books</strong> in your Goodreads library
              </div>
              <div style={s.previewList}>
                {books.slice(0, 8).map((b, i) => (
                  <div key={i} style={s.previewRow}>
                    <div style={{ flex: 1 }}>
                      <div style={s.previewTitle}>{b.title}</div>
                      <div style={s.previewAuthor}>{b.author}</div>
                    </div>
                    <div style={{ ...s.statusBadge, ...getStatusStyle(b.status) }}>
                      {STATUS_LABELS[b.status]}
                    </div>
                  </div>
                ))}
                {books.length > 8 && (
                  <div style={{ padding: '8px 0', fontSize: 12, color: theme.textSubtle, textAlign: 'center' }}>
                    …and {books.length - 8} more books
                  </div>
                )}
              </div>
              <div style={s.footer}>
                <button style={s.btnGhost} onClick={() => setStep('upload')}>Back</button>
                <button style={s.btnSave} onClick={startImport}>
                  Import {books.length} Books
                </button>
              </div>
            </>
          )}

          {step === 'importing' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📚</div>
              <div style={{ fontWeight: 600, color: theme.text, marginBottom: 4 }}>
                Importing {progress.done} of {progress.total}…
              </div>
              <div style={s.importProgressBg}>
                <div style={{ ...s.importProgressFill, width: `${pct}%` }} />
              </div>
              <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 8 }}>{pct}% complete</div>
            </div>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 8 }}>
                Import Complete!
              </div>
              <div style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 24 }}>
                {progress.total} books imported to your Folio library.
              </div>
              <button style={s.btnSave} onClick={onImported}>View My Library</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getStatusStyle(status) {
  const map = {
    read:    { background: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
    reading: { background: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
    want:    { background: 'rgba(184,134,11,0.12)',  color: '#b8860b' },
    owned:   { background: 'rgba(138,127,114,0.15)', color: '#8a7f72' },
  }
  return map[status] || map.owned
}

function makeStyles(theme) {
  return {
    overlay:          { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:            { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 520, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: theme.shadow },
    header:           { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: `1px solid ${theme.borderLight}`, flexShrink: 0 },
    title:            { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text },
    closeBtn:         { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4 },
    body:             { padding: '24px', overflowY: 'auto', flex: 1 },
    instructions:     { marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 },
    step:             { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: theme.textMuted },
    stepNum:          { width: 24, height: 24, borderRadius: '50%', background: theme.rust, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 },
    uploadArea:       { border: `2px dashed ${theme.border}`, borderRadius: 12, padding: '32px 24px', textAlign: 'center', cursor: 'pointer', background: theme.bgCard, transition: 'border-color 0.15s' },
    errorMsg:         { fontSize: 13, color: theme.rust, marginTop: 12 },
    previewHeader:    { fontSize: 14, color: theme.textMuted, marginBottom: 16 },
    previewList:      { border: `1px solid ${theme.borderLight}`, borderRadius: 8, overflow: 'hidden', marginBottom: 20 },
    previewRow:       { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: `1px solid ${theme.borderLight}` },
    previewTitle:     { fontSize: 13, fontWeight: 500, color: theme.text, lineHeight: 1.3 },
    previewAuthor:    { fontSize: 11, color: theme.textSubtle, marginTop: 2 },
    statusBadge:      { fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, flexShrink: 0 },
    footer:           { display: 'flex', justifyContent: 'flex-end', gap: 10 },
    btnGhost:         { padding: '8px 16px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textMuted },
    btnSave:          { padding: '8px 20px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    importProgressBg: { width: '100%', height: 8, background: theme.bgSubtle, borderRadius: 4, overflow: 'hidden', margin: '12px 0' },
    importProgressFill:{ height: '100%', background: theme.rust, borderRadius: 4, transition: 'width 0.3s' },
  }
}

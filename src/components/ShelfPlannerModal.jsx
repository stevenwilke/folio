import { useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'

// ── Genre colour palette ──────────────────────────────────────────────────────
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
const DEFAULT_COLOR = { spine: '#6b5c4a', text: '#fff8f0' }

const GENRE_OVERRIDES_KEY = 'folio-genre-overrides'
const PLANNER_CONFIG_KEY  = 'folio-planner-config'
const ALL_GENRES = Object.keys(GENRE_COLORS)

function getGenreColor(genre) {
  if (!genre) return DEFAULT_COLOR
  for (const [key, val] of Object.entries(GENRE_COLORS)) {
    if (genre.toLowerCase().includes(key.toLowerCase())) return val
  }
  return DEFAULT_COLOR
}

function getSpineWidth(pages) {
  if (!pages) return 22
  return Math.max(16, Math.min(36, Math.round(pages / 18)))
}

// ── Sort methods ──────────────────────────────────────────────────────────────
const SORT_METHODS = [
  { id: 'alpha-title',  label: 'A → Z by Title',       icon: '🔤' },
  { id: 'alpha-author', label: 'A → Z by Author',       icon: '👤' },
  { id: 'genre',        label: 'Grouped by Genre',       icon: '📚' },
  { id: 'genre-alpha',  label: 'Genre, then Title A→Z', icon: '🗂️' },
  { id: 'year',         label: 'By Publication Year',   icon: '📅' },
  { id: 'series',       label: 'By Series',             icon: '📖' },
  { id: 'color',        label: 'Rainbow (by Genre)',     icon: '🌈' },
  { id: 'status',       label: 'By Reading Status',     icon: '✅' },
]

const COLOR_ORDER = [
  'Romance', 'Horror', 'Thriller', 'Literary Fiction', 'Mystery',
  'Historical Fiction', 'Biography', 'Non-Fiction', 'Self-Help',
  'Young Adult', "Children's", 'Science Fiction', 'Fantasy',
  'Graphic Novel', 'Poetry',
]

function sortBooks(books, method) {
  const copy = [...books]
  switch (method) {
    case 'alpha-title':
      return copy.sort((a, b) => a.title.localeCompare(b.title))
    case 'alpha-author':
      return copy.sort((a, b) => {
        const aLast = (a.author || 'zzz').split(' ').pop() || ''
        const bLast = (b.author || 'zzz').split(' ').pop() || ''
        return aLast.localeCompare(bLast) || a.title.localeCompare(b.title)
      })
    case 'genre':
    case 'genre-alpha':
      return copy.sort((a, b) => {
        const gA = a.genre || 'zzz'
        const gB = b.genre || 'zzz'
        if (gA !== gB) return gA.localeCompare(gB)
        return method === 'genre-alpha' ? a.title.localeCompare(b.title) : 0
      })
    case 'year':
      return copy.sort((a, b) => (a.published_year || 9999) - (b.published_year || 9999))
    case 'series':
      return copy.sort((a, b) => {
        const sA = a.series_name || 'zzz'
        const sB = b.series_name || 'zzz'
        if (sA !== sB) return sA.localeCompare(sB)
        return (a.series_position || 0) - (b.series_position || 0)
      })
    case 'color':
      return copy.sort((a, b) => {
        const iA = COLOR_ORDER.indexOf(a.genre || '')
        const iB = COLOR_ORDER.indexOf(b.genre || '')
        const posA = iA === -1 ? 999 : iA
        const posB = iB === -1 ? 999 : iB
        return posA - posB || a.title.localeCompare(b.title)
      })
    case 'status': {
      const order = { reading: 0, read: 1, want: 2, owned: 3 }
      return copy.sort((a, b) => {
        const sA = order[a.read_status] ?? 9
        const sB = order[b.read_status] ?? 9
        return sA - sB || a.title.localeCompare(b.title)
      })
    }
    default:
      return copy
  }
}

function distributeToShelves(books, shelves) {
  // shelves: [{capacity: N}, ...]
  const result = shelves.map(s => ({ ...s, books: [] }))
  let bookIdx = 0
  for (const shelf of result) {
    while (bookIdx < books.length && shelf.books.length < shelf.capacity) {
      shelf.books.push(books[bookIdx++])
    }
  }
  // Any overflow goes on a new shelf
  if (bookIdx < books.length) {
    result.push({ capacity: books.length, books: books.slice(bookIdx) })
  }
  return result
}

// ── Book Spine component ──────────────────────────────────────────────────────
function BookSpine({ book, width, height = 140, showTitle = true, onClick }) {
  const [hovered, setHovered] = useState(false)
  const colors = getGenreColor(book.genre)
  const w = width ?? getSpineWidth(book.pages)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onClick?.(book)}
      style={{
        position: 'relative',
        width: w,
        height,
        background: colors.spine,
        borderRadius: '2px 2px 1px 1px',
        flexShrink: 0,
        cursor: 'pointer',
        boxShadow: hovered
          ? '2px 0 8px rgba(0,0,0,0.4), inset 1px 0 0 rgba(255,255,255,0.1)'
          : '1px 0 3px rgba(0,0,0,0.3)',
        transition: 'transform 0.1s, box-shadow 0.1s',
        transform: hovered ? 'translateY(-4px) scaleY(1.02)' : 'none',
        overflow: 'hidden',
      }}
    >
      {showTitle && (
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
          {book.title.length > 30 ? book.title.slice(0, 28) + '…' : book.title}
        </div>
      )}
      {/* Hover tooltip */}
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
          {book.genre && (
            <div style={{ opacity: 0.6, fontSize: 10, marginTop: 2 }}>
              {book.genre}
              {book._hasOverride && <span style={{ opacity: 0.7 }}> (overridden)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Shelf Row component ───────────────────────────────────────────────────────
function ShelfRow({ shelfNumber, books, shelfColor, onBookClick }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: '#8a7f72',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 6,
      }}>
        Shelf {shelfNumber} · {books.length} books
      </div>
      <div style={{
        background: '#f5efe6',
        borderRadius: 6,
        padding: '12px 16px 0 16px',
        boxShadow: 'inset 0 -4px 0 ' + shelfColor + ', 0 2px 8px rgba(0,0,0,0.08)',
        minHeight: 165,
      }}>
        {books.length === 0 ? (
          <div style={{ color: '#bbb', fontSize: 13, paddingBottom: 16, paddingTop: 8 }}>
            Empty shelf
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, overflowX: 'auto', paddingBottom: 0 }}>
            {books.map((book, i) => (
              <BookSpine key={book.id || i} book={book} height={130 + ((book.title?.charCodeAt(0) || 0) % 5) * 5} onClick={onBookClick} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Print Guide component ─────────────────────────────────────────────────────
function PrintGuide({ shelves, sortMethod, onClose, onGenreChange }) {
  const [editingBookId, setEditingBookId] = useState(null)
  const methodLabel = SORT_METHODS.find(m => m.id === sortMethod)?.label || sortMethod

  function handlePrint() {
    const win = window.open('', '_blank')
    const html = `<!DOCTYPE html>
<html>
<head>
<title>Shelf Arrangement Guide</title>
<style>
  body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; color: #222; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .subtitle { color: #888; font-size: 13px; margin-bottom: 32px; }
  .shelf { margin-bottom: 28px; page-break-inside: avoid; }
  .shelf-header { font-size: 14px; font-weight: bold; border-bottom: 2px solid #333; padding-bottom: 4px; margin-bottom: 10px; }
  .book { font-size: 12px; padding: 4px 0; border-bottom: 1px solid #eee; display: flex; }
  .num { color: #888; width: 28px; flex-shrink: 0; }
  .title { flex: 1; font-weight: 500; }
  .author { color: #666; font-size: 11px; }
  .genre { color: #999; font-size: 10px; float: right; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>📚 Shelf Arrangement Guide</h1>
<div class="subtitle">Arranged: ${methodLabel} · Generated ${new Date().toLocaleDateString()}</div>
${shelves.map((shelf, si) => `
<div class="shelf">
  <div class="shelf-header">Shelf ${si + 1} — ${shelf.books.length} books</div>
  ${shelf.books.map((book, bi) => `
  <div class="book">
    <span class="num">${bi + 1}.</span>
    <span class="title">${book.title}${book.series_name ? ` (${book.series_name} #${book.series_position || ''})` : ''}</span>
    <span class="author">${book.author ? ' — ' + book.author : ''}</span>
    ${book.genre ? `<span class="genre">${book.genre}</span>` : ''}
  </div>`).join('')}
</div>`).join('')}
</body>
</html>`
    win.document.write(html)
    win.document.close()
    win.print()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Arrangement: {methodLabel}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            {shelves.length} shelves · {shelves.reduce((s, sh) => s + sh.books.length, 0)} books
          </div>
        </div>
        <button onClick={handlePrint} style={{
          background: '#c0521e', color: '#fff', border: 'none', borderRadius: 8,
          padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          🖨️ Print Guide
        </button>
      </div>
      {shelves.map((shelf, si) => (
        <div key={si} style={{ marginBottom: 20 }}>
          <div style={{
            fontWeight: 600, fontSize: 13, color: '#5c4a3a', borderBottom: '1px solid #e0d5c8',
            paddingBottom: 6, marginBottom: 8,
          }}>
            Shelf {si + 1} · {shelf.books.length} books
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {shelf.books.map((book, bi) => {
              const bookKey = book.id || `${si}-${bi}`
              const gc = getGenreColor(book.genre)
              return (
                <div key={bookKey} style={{
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                  padding: '4px 0', borderBottom: '1px solid #f5f0ea',
                }}>
                  <span style={{ color: '#bbb', width: 24, flexShrink: 0, textAlign: 'right' }}>{bi + 1}.</span>
                  <span style={{ flex: 1, fontWeight: 500 }}>{book.title}</span>
                  {book.author && <span style={{ color: '#888', fontSize: 11 }}>{book.author}</span>}
                  {/* Editable genre pill */}
                  <div style={{ flexShrink: 0, position: 'relative' }}>
                    {editingBookId === bookKey ? (
                      <select
                        autoFocus
                        defaultValue={book.genre || ''}
                        onChange={e => {
                          onGenreChange(book.id, e.target.value || null)
                          setEditingBookId(null)
                        }}
                        onBlur={() => setEditingBookId(null)}
                        style={{
                          fontSize: 11, borderRadius: 6, border: '1px solid #d4c9b0',
                          padding: '2px 6px', background: '#fff', cursor: 'pointer',
                          maxWidth: 160,
                        }}
                      >
                        {book._hasOverride && (
                          <option value="">↩ Reset to "{book._originalGenre || 'no genre'}"</option>
                        )}
                        {!book._hasOverride && !book.genre && (
                          <option value="">— pick a genre —</option>
                        )}
                        {ALL_GENRES.map(g => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    ) : (
                      <span
                        onClick={() => setEditingBookId(bookKey)}
                        title="Click to change genre for shelf planning"
                        style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 10, cursor: 'pointer',
                          background: book.genre ? gc.spine + '22' : '#f0ebe3',
                          color: book.genre ? gc.spine : '#8a7f72',
                          border: book._hasOverride ? `1px dashed ${gc.spine}` : '1px solid transparent',
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          userSelect: 'none',
                        }}
                      >
                        {book._hasOverride && <span style={{ fontSize: 9, opacity: 0.8 }}>✎</span>}
                        {book.genre || '+ genre'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function ShelfPlannerModal({ books, session, onClose, onSaved }) {
  const { theme } = useTheme()
  const fileInputRef = useRef(null)

  // Load saved planner config (if any) to resume where the user left off
  const savedConfig = (() => {
    try { return JSON.parse(localStorage.getItem(PLANNER_CONFIG_KEY) || 'null') }
    catch { return null }
  })()

  // Steps: 'setup' | 'arrange' | 'guide'
  // Skip straight to arrange if there's a saved config
  const [step, setStep] = useState(savedConfig ? 'arrange' : 'setup')

  // Setup state
  const [shelfCount, setShelfCount] = useState(savedConfig?.shelfCount ?? 3)
  const [booksPerShelf, setBooksPerShelf] = useState(savedConfig?.booksPerShelf ?? 30)
  const [customShelfSizes, setCustomShelfSizes] = useState(savedConfig?.customShelfSizes ?? [])
  const [useCustomSizes, setUseCustomSizes] = useState(savedConfig?.useCustomSizes ?? false)

  // Photo analysis state
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [analysisError, setAnalysisError] = useState(null)

  // Arrangement state
  const [sortMethod, setSortMethod] = useState(savedConfig?.sortMethod ?? 'genre-alpha')
  const [activeTab, setActiveTab] = useState('visual') // 'visual' | 'guide'

  // Lightbox state
  const [selectedBook, setSelectedBook] = useState(null)
  const [imgError, setImgError] = useState(false)

  // Persist planner config whenever it changes
  function savePlannerConfig(overrides = {}) {
    const config = {
      shelfCount, booksPerShelf, customShelfSizes, useCustomSizes, sortMethod,
      ...overrides,
    }
    localStorage.setItem(PLANNER_CONFIG_KEY, JSON.stringify(config))
  }

  // Genre overrides (persisted to localStorage, keyed by book_id)
  const [genreOverrides, setGenreOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem(GENRE_OVERRIDES_KEY) || '{}') }
    catch { return {} }
  })

  function setGenreOverride(bookId, genre) {
    const next = { ...genreOverrides }
    if (genre) next[bookId] = genre
    else delete next[bookId]
    setGenreOverrides(next)
    localStorage.setItem(GENRE_OVERRIDES_KEY, JSON.stringify(next))
  }

  // Save to My Shelves state
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function saveToMyShelves() {
    if (saving) return
    setSaving(true)
    try {
      const methodLabel = SORT_METHODS.find(m => m.id === sortMethod)?.label || sortMethod
      for (let i = 0; i < shelvesWithBooks.length; i++) {
        const shelf = shelvesWithBooks[i]
        if (shelf.books.length === 0) continue
        const { data: newShelf, error: shelfErr } = await supabase
          .from('shelves')
          .insert({
            user_id: session.user.id,
            name: `Shelf ${i + 1}`,
            description: `Arranged by ${methodLabel}`,
          })
          .select()
          .single()
        if (shelfErr) throw shelfErr
        const rows = shelf.books.map(b => ({ shelf_id: newShelf.id, book_id: b.id }))
        const { error: booksErr } = await supabase.from('shelf_books').insert(rows)
        if (booksErr) throw booksErr
      }
      setSaved(true)
      setTimeout(() => { onSaved?.() }, 800)
    } catch (err) {
      console.error('Failed to save shelves:', err)
      alert('Failed to save shelves. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Computed — apply overrides before sorting so genre-based sorts use the override
  const shelvesDef = useCustomSizes && customShelfSizes.length
    ? customShelfSizes.map(c => ({ capacity: parseInt(c) || booksPerShelf }))
    : Array.from({ length: shelfCount }, () => ({ capacity: booksPerShelf }))

  const booksWithOverrides = books.filter(b => b.title).map(b => ({
    ...b,
    genre: b.id in genreOverrides ? genreOverrides[b.id] : b.genre,
    _originalGenre: b.genre,
    _hasOverride: b.id in genreOverrides,
  }))
  const sortedBooks = sortBooks(booksWithOverrides, sortMethod)
  const shelvesWithBooks = distributeToShelves(sortedBooks, shelvesDef)

  const shelfColors = ['#b8956a', '#a07850', '#8a6640', '#7a5630', '#6a4620']

  // Resize image to keep base64 payload under edge function limits
  function resizeImage(file, maxDim = 800) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        // Convert to JPEG at 60% quality to stay under edge function body limit (~2MB)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
        const base64 = dataUrl.split(',')[1]
        resolve(base64)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    // Preview
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)

    // Analyze
    setAnalyzing(true)
    setAnalysisError(null)
    setAnalysisResult(null)

    try {
      const base64 = await resizeImage(file)

      console.log('Shelf photo base64 size:', Math.round(base64.length / 1024), 'KB')

      const { data, error } = await supabase.functions.invoke('analyze-shelf', {
        body: { imageBase64: base64, mimeType: 'image/jpeg' },
      })

      console.log('analyze-shelf response:', { data, error })

      if (error || data?.error) {
        console.log('analyze-shelf error detail:', data)
        setAnalysisError(data?.error || error?.message || 'Analysis failed')
      } else {
        setAnalysisResult(data)
        // Auto-configure shelves from analysis
        if (data.shelf_count) setShelfCount(data.shelf_count)
        if (data.books_per_shelf?.length) {
          setBooksPerShelf(Math.round(data.books_per_shelf.reduce((a, b) => a + b, 0) / data.books_per_shelf.length))
          setCustomShelfSizes(data.books_per_shelf.map(String))
          setUseCustomSizes(true)
        }
      }
    } catch (err) {
      setAnalysisError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const s = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    },
    modal: {
      background: theme.bgCard,
      borderRadius: 16,
      width: '100%',
      maxWidth: 900,
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      overflow: 'hidden',
    },
    header: {
      padding: '20px 24px',
      borderBottom: `1px solid ${theme.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
    },
    body: {
      flex: 1,
      overflow: 'auto',
      padding: 24,
    },
    closeBtn: {
      background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
      color: theme.textSubtle, padding: 4,
    },
    sectionLabel: {
      fontSize: 12, fontWeight: 600, color: theme.textSubtle,
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10,
    },
    card: {
      background: theme.bg,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 16,
    },
    input: {
      border: `1px solid ${theme.border}`, borderRadius: 8, padding: '8px 12px',
      fontSize: 14, background: theme.bgCard, color: theme.text, width: '100%',
    },
    btn: {
      background: theme.rust, color: '#fff', border: 'none', borderRadius: 10,
      padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    },
    btnSecondary: {
      background: 'none', border: `1px solid ${theme.border}`, borderRadius: 10,
      padding: '10px 24px', fontSize: 14, color: theme.text, cursor: 'pointer',
    },
    tab: (active) => ({
      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: active ? 600 : 400,
      background: active ? theme.rust + '18' : 'none',
      color: active ? theme.rust : theme.textSubtle,
      border: 'none', cursor: 'pointer',
    }),
    uploadArea: {
      border: `2px dashed ${theme.border}`, borderRadius: 12, padding: 32,
      textAlign: 'center', cursor: 'pointer', color: theme.textSubtle,
      transition: 'border-color 0.2s',
    },
  }

  // ── STEP 1: Setup ──────────────────────────────────────────────────────────
  if (step === 'setup') {
    return (
      <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={s.modal}>
          <div style={s.header}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: theme.text }}>
                📚 Shelf Planner
              </div>
              <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 2 }}>
                Arrange your {books.length} books perfectly
              </div>
            </div>
            <button style={s.closeBtn} onClick={onClose}>✕</button>
          </div>

          <div style={s.body}>
            {/* Photo upload section */}
            <div style={{ marginBottom: 24 }}>
              <div style={s.sectionLabel}>Option 1 — Upload a shelf photo (optional)</div>
              <div style={s.card}>
                {photoPreview ? (
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <img src={photoPreview} alt="Shelf" style={{
                      width: 180, height: 120, objectFit: 'cover', borderRadius: 8,
                    }} />
                    <div style={{ flex: 1 }}>
                      {analyzing && (
                        <div style={{ color: theme.textSubtle, fontSize: 13 }}>
                          🔍 Analyzing your shelf...
                        </div>
                      )}
                      {analysisError && (
                        <div style={{ color: '#c0521e', fontSize: 13 }}>{analysisError}</div>
                      )}
                      {analysisResult && (
                        <div>
                          <div style={{ fontWeight: 600, color: theme.text, marginBottom: 8 }}>
                            ✅ Shelf analysis complete!
                          </div>
                          <div style={{ fontSize: 13, color: theme.textSubtle, lineHeight: 1.8 }}>
                            <div>🗄️ <strong>{analysisResult.shelf_count}</strong> shelves detected</div>
                            <div>📦 Approx. <strong>{analysisResult.total_capacity}</strong> total book capacity</div>
                            {analysisResult.notes && <div style={{ marginTop: 6, fontStyle: 'italic' }}>{analysisResult.notes}</div>}
                            {analysisResult.recognized_books?.length > 0 && (
                              <div style={{ marginTop: 8 }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>Books I spotted:</div>
                                {analysisResult.recognized_books.map((b, i) => (
                                  <div key={i} style={{ fontSize: 12 }}>
                                    • {b.title}{b.author ? ` by ${b.author}` : ''}{b.shelf ? ` (shelf ${b.shelf})` : ''}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => { setPhotoPreview(null); setAnalysisResult(null) }}
                      style={{ ...s.btnSecondary, padding: '6px 12px', fontSize: 12 }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div
                    style={s.uploadArea}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      const file = e.dataTransfer.files[0]
                      if (file?.type.startsWith('image/')) handlePhotoUpload({ target: { files: [file] } })
                    }}
                  >
                    <div style={{ fontSize: 36, marginBottom: 8 }}>📸</div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Drop a photo of your shelf</div>
                    <div style={{ fontSize: 12 }}>AI will count shelves and estimate capacity</div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handlePhotoUpload}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Manual configuration */}
            <div style={{ marginBottom: 24 }}>
              <div style={s.sectionLabel}>Option 2 — Configure shelves manually</div>
              <div style={s.card}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: theme.text }}>
                      Number of shelves
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => setShelfCount(Math.max(1, shelfCount - 1))}
                        style={{ ...s.btnSecondary, padding: '6px 12px' }}>−</button>
                      <span style={{ fontSize: 20, fontWeight: 700, color: theme.text, minWidth: 32, textAlign: 'center' }}>
                        {shelfCount}
                      </span>
                      <button onClick={() => setShelfCount(Math.min(20, shelfCount + 1))}
                        style={{ ...s.btnSecondary, padding: '6px 12px' }}>+</button>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: theme.text }}>
                      Books per shelf (average)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => setBooksPerShelf(Math.max(5, booksPerShelf - 5))}
                        style={{ ...s.btnSecondary, padding: '6px 12px' }}>−</button>
                      <span style={{ fontSize: 20, fontWeight: 700, color: theme.text, minWidth: 32, textAlign: 'center' }}>
                        {booksPerShelf}
                      </span>
                      <button onClick={() => setBooksPerShelf(Math.min(80, booksPerShelf + 5))}
                        style={{ ...s.btnSecondary, padding: '6px 12px' }}>+</button>
                    </div>
                  </div>
                </div>
                <div style={{
                  fontSize: 12, color: theme.textSubtle,
                  background: theme.bgSubtle || theme.bg,
                  borderRadius: 8, padding: '8px 12px',
                }}>
                  {shelfCount} shelves × {booksPerShelf} books = <strong>{shelfCount * booksPerShelf}</strong> total capacity
                  {shelfCount * booksPerShelf < books.length && (
                    <span style={{ color: '#c0521e' }}>
                      {' '}— you need room for <strong>{books.length - shelfCount * booksPerShelf}</strong> more books
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Genre legend */}
            <div style={{ marginBottom: 24 }}>
              <div style={s.sectionLabel}>Genre colour guide</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(GENRE_COLORS).map(([genre, colors]) => (
                  <div key={genre} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 11, color: theme.text,
                  }}>
                    <div style={{ width: 12, height: 20, background: colors.spine, borderRadius: 2 }} />
                    {genre}
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: theme.text }}>
                  <div style={{ width: 12, height: 20, background: DEFAULT_COLOR.spine, borderRadius: 2 }} />
                  Other
                </div>
              </div>
            </div>
          </div>

          <div style={{
            padding: '16px 24px',
            borderTop: `1px solid ${theme.border}`,
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}>
            <button style={s.btnSecondary} onClick={onClose}>Cancel</button>
            <button style={s.btn} onClick={() => { savePlannerConfig(); setStep('arrange') }}>
              Plan my shelves →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── STEP 2 & 3: Arrange + Guide ───────────────────────────────────────────
  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button style={{ ...s.btnSecondary, padding: '6px 10px', fontSize: 12 }}
              onClick={() => setStep('setup')}>
              ← Back
            </button>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: theme.text }}>📚 Shelf Planner</div>
              <div style={{ fontSize: 12, color: theme.textSubtle }}>
                {shelvesWithBooks.length} shelves · {sortedBooks.length} books
              </div>
            </div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Sort method picker */}
        <div style={{
          padding: '12px 24px',
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
          overflowX: 'auto',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textSubtle, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Sort order
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SORT_METHODS.map(m => (
              <button
                key={m.id}
                onClick={() => { setSortMethod(m.id); savePlannerConfig({ sortMethod: m.id }) }}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                  border: `1px solid ${sortMethod === m.id ? theme.rust : theme.border}`,
                  background: sortMethod === m.id ? theme.rust + '15' : 'none',
                  color: sortMethod === m.id ? theme.rust : theme.text,
                  fontWeight: sortMethod === m.id ? 600 : 400,
                }}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* View tabs */}
        <div style={{
          padding: '10px 24px 0',
          borderBottom: `1px solid ${theme.border}`,
          display: 'flex', gap: 4, flexShrink: 0,
        }}>
          <button style={s.tab(activeTab === 'visual')} onClick={() => setActiveTab('visual')}>
            🖼️ Visual Preview
          </button>
          <button style={s.tab(activeTab === 'guide')} onClick={() => setActiveTab('guide')}>
            📋 Arrangement Guide
          </button>
        </div>

        <div style={s.body}>
          {activeTab === 'visual' ? (
            <div>
              {shelvesWithBooks.map((shelf, si) => (
                <ShelfRow
                  key={si}
                  shelfNumber={si + 1}
                  books={shelf.books}
                  shelfColor={shelfColors[si % shelfColors.length]}
                  onBookClick={(b) => { setSelectedBook(b); setImgError(false) }}
                />
              ))}
              <div style={{ fontSize: 12, color: theme.textSubtle, textAlign: 'center', marginTop: 8 }}>
                Click any spine to see its cover · Colors represent genre
              </div>

              {/* Save to My Shelves */}
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <button
                  onClick={saveToMyShelves}
                  disabled={saving || saved}
                  style={{
                    padding: '12px 28px',
                    background: saved ? '#4a7c59' : theme.rust || '#c0521e',
                    color: 'white',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: saving || saved ? 'default' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                    fontFamily: "'DM Sans', sans-serif",
                    transition: 'background 0.2s',
                  }}
                >
                  {saved ? '✓ Saved to My Shelves!' : saving ? 'Saving…' : '📂 Save to My Shelves'}
                </button>
              </div>

              {/* Lightbox */}
              {selectedBook && (
                <div
                  onClick={() => setSelectedBook(null)}
                  style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 2000, padding: 20,
                  }}
                >
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      background: theme.bgCard || '#fff', borderRadius: 16, padding: 28,
                      maxWidth: 340, width: '100%', textAlign: 'center',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                      position: 'relative',
                    }}
                  >
                    <button
                      onClick={() => setSelectedBook(null)}
                      style={{
                        position: 'absolute', top: 12, right: 14,
                        background: 'none', border: 'none', fontSize: 18,
                        cursor: 'pointer', color: theme.textSubtle || '#999', padding: 4,
                      }}
                    >
                      ✕
                    </button>
                    {(() => {
                      const coverUrl = getCoverUrl(selectedBook)
                      return coverUrl && !imgError ? (
                        <img
                          src={coverUrl}
                          alt={selectedBook.title}
                          onError={() => setImgError(true)}
                          style={{
                            width: 180, maxHeight: 270, objectFit: 'contain',
                            borderRadius: 6, marginBottom: 16,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                          }}
                        />
                      ) : (
                        <div style={{
                          width: 180, height: 270, margin: '0 auto 16px',
                          background: getGenreColor(selectedBook.genre).spine,
                          borderRadius: 6, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', padding: 16,
                          color: getGenreColor(selectedBook.genre).text,
                          fontSize: 14, fontWeight: 600, textAlign: 'center',
                        }}>
                          {selectedBook.title}
                        </div>
                      )
                    })()}
                    <div style={{
                      fontFamily: "'Playfair Display', Georgia, serif",
                      fontSize: 18, fontWeight: 700, color: theme.text || '#333',
                      marginBottom: 4, lineHeight: 1.3,
                    }}>
                      {selectedBook.title}
                    </div>
                    {selectedBook.author && (
                      <div style={{ fontSize: 14, color: theme.textMuted || '#888' }}>
                        by {selectedBook.author}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <PrintGuide
              shelves={shelvesWithBooks}
              sortMethod={sortMethod}
              onClose={onClose}
              onGenreChange={setGenreOverride}
            />
          )}
        </div>
      </div>
    </div>
  )
}

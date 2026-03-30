import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'

const STATUS_OPTIONS = [
  { value: 'owned',   label: 'Owned' },
  { value: 'read',    label: 'Read' },
  { value: 'reading', label: 'Reading' },
  { value: 'want',    label: 'Want to Read' },
]

export default function GlobalSearchModal({ session, onClose }) {
  const { theme, isDark } = useTheme()
  const [query, setQuery]               = useState('')
  const [aiMode, setAiMode]             = useState(false)
  const [results, setResults]           = useState([])
  const [loading, setLoading]           = useState(false)
  const [interpretation, setInterp]     = useState('')
  const [addingId, setAddingId]         = useState(null)
  const [addedIds, setAddedIds]         = useState(new Set())
  const [openMenuId, setOpenMenuId]     = useState(null)
  const [hasSearched, setHasSearched]   = useState(false)
  const inputRef  = useRef(null)
  const debounce  = useRef(null)
  const panelRef  = useRef(null)

  // Auto-focus
  useEffect(() => { inputRef.current?.focus() }, [])

  // ESC closes
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Close add-menu on outside click
  useEffect(() => {
    function onClick(e) {
      if (openMenuId && !e.target.closest('[data-addmenu]')) setOpenMenuId(null)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [openMenuId])

  // Debounced search when query changes
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (!q || q.length < 2) {
      setResults([])
      setInterp('')
      setHasSearched(false)
      return
    }
    const delay = aiMode ? 700 : 400
    debounce.current = setTimeout(() => runSearch(q), delay)
    return () => clearTimeout(debounce.current)
  }, [query, aiMode])

  async function runSearch(q) {
    setLoading(true)
    setInterp('')
    setHasSearched(true)

    // Run local DB search and external search independently so neither blocks the other
    const localPromise = supabase
      .from('books')
      .select('id, title, author, cover_image_url, published_year, genre, isbn_13, isbn_10, pages, publisher')
      .ilike('title', `%${q}%`)
      .limit(12)
      .then(async ({ data: byTitle }) => {
        // Also search by author, merge, dedupe
        const { data: byAuthor } = await supabase
          .from('books')
          .select('id, title, author, cover_image_url, published_year, genre, isbn_13, isbn_10, pages, publisher')
          .ilike('author', `%${q}%`)
          .limit(12)
        const seen = new Set()
        const all = [...(byTitle || []), ...(byAuthor || [])].filter(b => {
          if (seen.has(b.id)) return false
          seen.add(b.id); return true
        })
        return all
      })
      .catch(() => [])

    try {
      if (aiMode) {
        const [{ data: aiData, error }, localBooks] = await Promise.all([
          supabase.functions.invoke('ai-book-search', { body: { query: q } }),
          localPromise,
        ])
        if (error) throw error
        setInterp(aiData?.interpretation || '')
        setResults(mergeResults(localBooks, aiData?.books || []))
      } else {
        const [isbndbResult, localBooks] = await Promise.all([
          supabase.functions.invoke('search-books', { body: { q, pageSize: 12 } }),
          localPromise,
        ])
        const externalBooks = (isbndbResult.data?.books || []).map(book => ({
          id:          `isbndb:${book.isbn13 || book.isbn10 || Math.random()}`,
          title:       book.title,
          author:      book.author,
          year:        book.year,
          cover:       book.cover,
          description: book.description,
          isbn13:      book.isbn13,
          isbn10:      book.isbn10,
          categories:  book.categories,
          pageCount:   book.pageCount,
          publisher:   book.publisher,
          avgRating:   null,
        }))
        setResults(mergeResults(localBooks, externalBooks))
      }
    } catch (e) {
      console.error('Search error:', e)
      // Still try to show local results on external failure
      const localBooks = await localPromise
      setResults(mergeResults(localBooks, []))
    }
    setLoading(false)
  }

  // Merge local DB books (shown first) with external, deduplicating by ISBN or title+author
  function mergeResults(localBooks, externalBooks) {
    const seenIsbns = new Set()
    const seenKeys  = new Set()

    const normalize = str => (str || '').toLowerCase().trim()
    const titleAuthorKey = (t, a) => `${normalize(t)}||${normalize(a)}`

    // Normalize local books to result shape, mark them as _inApp
    const local = localBooks.map(b => {
      if (b.isbn_13) seenIsbns.add(b.isbn_13)
      if (b.isbn_10) seenIsbns.add(b.isbn_10)
      seenKeys.add(titleAuthorKey(b.title, b.author))
      return {
        id:         `local:${b.id}`,
        _dbId:      b.id,
        _inApp:     true,
        title:      b.title,
        author:     b.author,
        year:       b.published_year ? String(b.published_year) : null,
        cover:      b.cover_image_url || null,
        description: null,
        isbn13:     b.isbn_13 || null,
        isbn10:     b.isbn_10 || null,
        categories: b.genre ? [b.genre] : [],
        pageCount:  b.pages || null,
        publisher:  b.publisher || null,
        avgRating:  null,
      }
    })

    // Append external books not already covered
    const external = externalBooks.filter(b => {
      if (b.isbn13 && seenIsbns.has(b.isbn13)) return false
      if (b.isbn10 && seenIsbns.has(b.isbn10)) return false
      if (seenKeys.has(titleAuthorKey(b.title, b.author))) return false
      return true
    })

    return [...local, ...external]
  }

  async function addToLibrary(book, status) {
    if (!session) return
    setAddingId(book.id)
    setOpenMenuId(null)
    try {
      let bookId = book._dbId || null

      if (!bookId) {
        // Find by ISBN
        if (book.isbn13 || book.isbn10) {
          const conditions = []
          if (book.isbn13) conditions.push(`isbn_13.eq.${book.isbn13}`)
          if (book.isbn10) conditions.push(`isbn_10.eq.${book.isbn10}`)
          const { data } = await supabase.from('books').select('id').or(conditions.join(',')).maybeSingle()
          if (data) bookId = data.id
        }

        // Find by title + author
        if (!bookId && book.title) {
          const q = supabase.from('books').select('id').ilike('title', book.title)
          if (book.author) q.ilike('author', book.author)
          const { data } = await q.maybeSingle()
          if (data) bookId = data.id
        }

        // Insert new book
        if (!bookId) {
          const { data, error } = await supabase.from('books').insert({
            title:           book.title,
            author:          book.author,
            isbn_13:         book.isbn13 || null,
            isbn_10:         book.isbn10 || null,
            cover_image_url: book.cover  || null,
            published_year:  book.year   ? parseInt(book.year) : null,
            genre:           book.categories?.[0] || null,
            publisher:       book.publisher || null,
            pages:           book.pageCount || null,
          }).select('id').single()
          if (error) throw error
          bookId = data.id
        }
      }

      // Add to collection
      const { error: collErr } = await supabase
        .from('collection_entries')
        .upsert(
          { user_id: session.user.id, book_id: bookId, read_status: status },
          { onConflict: 'user_id,book_id' }
        )
      if (collErr) throw collErr

      setAddedIds(prev => new Set([...prev, book.id]))
      window.dispatchEvent(new Event('exlibris:bookAdded'))
    } catch (e) {
      console.error('Add to library error:', e)
    }
    setAddingId(null)
  }

  const bg      = isDark ? '#1c1610' : '#fdfaf4'
  const card    = isDark ? '#2a2218' : '#ffffff'
  const border  = isDark ? '#3a3028' : '#e8dfc8'
  const text    = isDark ? '#f0e8d8' : '#1a1208'
  const muted   = isDark ? '#9a8f82' : '#8a7f72'
  const accent  = '#c0521e'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex', justifyContent: 'center',
        padding: '48px 16px 32px',
        overflowY: 'auto',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        style={{
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 18,
          width: '100%', maxWidth: 640,
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column',
          alignSelf: 'flex-start',
          overflow: 'hidden',
        }}
      >
        {/* ── Search Bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px',
          borderBottom: `1px solid ${border}`,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={aiMode ? 'Ask anything — "a thriller set in Japan" or "books like Dune"…' : 'Search by title, author, or ISBN…'}
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 17, fontFamily: "'DM Sans', sans-serif",
              color: text,
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]); setHasSearched(false); inputRef.current?.focus() }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, padding: 2, lineHeight: 1 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 7, cursor: 'pointer', color: muted, padding: '4px 10px', fontSize: 12, fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>
            ESC
          </button>
        </div>

        {/* ── AI Mode Toggle ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '11px 20px',
          borderBottom: `1px solid ${border}`,
          background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
        }}>
          <button
            onClick={() => setAiMode(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 12px',
              borderRadius: 20,
              border: aiMode ? 'none' : `1px solid ${border}`,
              background: aiMode
                ? 'linear-gradient(135deg, #7c3aed, #c0521e)'
                : 'transparent',
              color: aiMode ? 'white' : muted,
              cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              transition: 'all 0.2s',
            }}
          >
            <span style={{ fontSize: 15 }}>✨</span>
            AI Search
          </button>
          <span style={{ fontSize: 12, color: muted, fontFamily: "'DM Sans', sans-serif" }}>
            {aiMode
              ? 'Ask in plain English — AI finds the best matches'
              : 'Toggle AI for natural language queries'}
          </span>
        </div>

        {/* ── AI Interpretation Banner ── */}
        {interpretation && (
          <div style={{
            padding: '10px 20px',
            background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(192,82,30,0.08))',
            borderBottom: `1px solid ${border}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>✨</span>
            <span style={{ fontSize: 13, color: text, fontFamily: "'DM Sans', sans-serif", fontStyle: 'italic' }}>
              {interpretation}
            </span>
          </div>
        )}

        {/* ── Results ── */}
        <div style={{ flex: 1 }}>
          {loading && (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <div style={{
                display: 'inline-block', width: 28, height: 28,
                border: `3px solid ${border}`,
                borderTopColor: accent,
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ marginTop: 10, fontSize: 13, color: muted, fontFamily: "'DM Sans', sans-serif" }}>
                {aiMode ? 'AI is finding the best matches…' : 'Searching…'}
              </div>
            </div>
          )}

          {!loading && hasSearched && results.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📚</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: text, fontFamily: 'Georgia, serif' }}>No books found</div>
              <div style={{ fontSize: 13, color: muted, marginTop: 4, fontFamily: "'DM Sans', sans-serif" }}>
                Try different keywords{aiMode ? ' or rephrase your question' : ' or switch on AI Search'}
              </div>
            </div>
          )}

          {!loading && !hasSearched && !query && (
            <div style={{ padding: '36px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: muted, fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6 }}>
                Search millions of books · Add them to your library instantly
                <br />
                <span style={{ opacity: 0.7 }}>Try "Cormac McCarthy" · "978-0-7432-7356-5" · "books about survival"</span>
              </div>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div style={{ padding: '8px 0' }}>
              {results.map((book, i) => (
                <BookResultRow
                  key={book.id}
                  book={book}
                  isDark={isDark}
                  card={card}
                  border={border}
                  text={text}
                  muted={muted}
                  accent={accent}
                  isAdded={addedIds.has(book.id)}
                  isAdding={addingId === book.id}
                  menuOpen={openMenuId === book.id}
                  onToggleMenu={() => setOpenMenuId(prev => prev === book.id ? null : book.id)}
                  onAdd={status => addToLibrary(book, status)}
                  session={session}
                  inApp={!!book._inApp}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {results.length > 0 && (
          <div style={{
            padding: '10px 20px',
            borderTop: `1px solid ${border}`,
            textAlign: 'center',
            fontSize: 11, color: muted,
            fontFamily: "'DM Sans', sans-serif",
          }}>
            Powered by ISBNDB{aiMode ? ' · AI by Gemini' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

function BookResultRow({ book, isDark, card, border, text, muted, accent, isAdded, isAdding, menuOpen, onToggleMenu, onAdd, session, inApp }) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        padding: '12px 20px',
        background: hover ? (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)') : 'transparent',
        borderBottom: `1px solid ${border}`,
        transition: 'background 0.12s',
      }}
    >
      {/* Cover */}
      <div style={{
        width: 52, height: 72, borderRadius: 6, flexShrink: 0,
        background: isDark ? '#2a2218' : '#e8dfc8',
        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        {book.cover
          ? <img src={book.cover} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 22 }}>📖</span>
        }
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: text,
          fontFamily: 'Georgia, serif',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {book.title}
        </div>
        <div style={{ fontSize: 12, color: muted, marginTop: 2, fontFamily: "'DM Sans', sans-serif" }}>
          {[book.author, book.year].filter(Boolean).join(' · ')}
          {book.avgRating && <span> · ⭐ {book.avgRating.toFixed(1)}</span>}
        </div>
        {book.description && (
          <div style={{
            fontSize: 12, color: muted, marginTop: 5, lineHeight: 1.5,
            fontFamily: "'DM Sans', sans-serif",
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {book.description}
          </div>
        )}
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {inApp && (
            <span style={{
              display: 'inline-block', padding: '2px 8px',
              background: isDark ? 'rgba(74,160,80,0.15)' : 'rgba(74,160,80,0.1)',
              color: '#4aa050', borderRadius: 20,
              fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            }}>
              In App
            </span>
          )}
          {book.categories?.length > 0 && (
            <span style={{
              display: 'inline-block', padding: '2px 8px',
              background: isDark ? 'rgba(192,82,30,0.15)' : 'rgba(192,82,30,0.08)',
              color: accent, borderRadius: 20,
              fontSize: 11, fontWeight: 500, fontFamily: "'DM Sans', sans-serif",
            }}>
              {book.categories[0]}
            </span>
          )}
        </div>
      </div>

      {/* Add Button */}
      {session && (
        <div style={{ position: 'relative', flexShrink: 0 }} data-addmenu>
          {isAdded ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 12px', borderRadius: 8,
              background: isDark ? 'rgba(74,160,80,0.15)' : 'rgba(74,160,80,0.1)',
              color: '#4aa050', fontSize: 13, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Added
            </div>
          ) : isAdding ? (
            <div style={{
              padding: '6px 12px', borderRadius: 8,
              background: isDark ? 'rgba(192,82,30,0.15)' : 'rgba(192,82,30,0.08)',
              color: accent, fontSize: 13,
              fontFamily: "'DM Sans', sans-serif",
            }}>
              …
            </div>
          ) : (
            <>
              <button
                onClick={onToggleMenu}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 8,
                  background: menuOpen ? accent : (isDark ? 'rgba(192,82,30,0.15)' : 'rgba(192,82,30,0.08)'),
                  color: menuOpen ? 'white' : accent,
                  border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  fontFamily: "'DM Sans', sans-serif",
                  transition: 'all 0.15s',
                }}
              >
                + Add
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {menuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  background: isDark ? '#1c1610' : '#fdfaf4',
                  border: `1px solid ${border}`,
                  borderRadius: 10, overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                  zIndex: 10, minWidth: 150,
                }}>
                  {STATUS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => onAdd(opt.value)}
                      style={{
                        width: '100%', padding: '9px 14px',
                        background: 'transparent', border: 'none',
                        textAlign: 'left', cursor: 'pointer',
                        fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                        color: text,
                        borderBottom: `1px solid ${border}`,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(192,82,30,0.06)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

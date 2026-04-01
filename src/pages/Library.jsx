import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { extractGenre } from '../lib/genres'
import BookDetail from './BookDetail'
import NavBar from '../components/NavBar'
import SearchModal from '../components/SearchModal'
import GoodreadsImportModal from '../components/GoodreadsImportModal'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'
import { uploadCoverToStorage } from '../lib/enrichBook'
import { useIsMobile } from '../hooks/useIsMobile'

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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const [books, setBooks]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState('all')
  const [sort, setSort]               = useState('added')
  const [showImport, setShowImport]   = useState(false)

  // Sync selected book with ?book=<id> so browser back button works
  const selectedBook = searchParams.get('book') || null
  function openBook(bookId)  { setSearchParams({ book: bookId }) }
  function closeBook()       { setSearchParams({}); fetchCollection() }
  const [listingTarget, setListingTarget] = useState(null)
  const [activeListings, setActiveListings] = useState({})
  const [collectionStats, setCollectionStats] = useState(null)
  const [search, setSearch]             = useState('')
  const [groupBy, setGroupBy]           = useState('none')
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [selectMode, setSelectMode]     = useState(false)
  const [selectedIds, setSelectedIds]   = useState(new Set())
  const [bulkStatus, setBulkStatus]     = useState('')
  const [bulkWorking, setBulkWorking]   = useState(false)
  const [viewMode,  setViewMode]  = useState(() => localStorage.getItem('exlibris-view-mode')  || 'grid')
  const [coverSize, setCoverSize] = useState(() => localStorage.getItem('exlibris-cover-size') || 'md')
  const [selectedTag, setSelectedTag] = useState(null)
  const [tagMap, setTagMap]           = useState({})
  const [allTags, setAllTags]         = useState([])

  function changeViewMode(v)  { setViewMode(v);  localStorage.setItem('exlibris-view-mode',  v) }
  function changeCoverSize(s) { setCoverSize(s); localStorage.setItem('exlibris-cover-size', s) }

  // Redirect new users with empty libraries to onboarding
  useEffect(() => {
    if (!loading && books.length === 0 && !localStorage.getItem('exlibris-onboarded')) {
      navigate('/onboarding')
    }
  }, [loading, books])

  useEffect(() => {
    fetchCollection()
    window.addEventListener('exlibris:bookAdded', fetchCollection)
    window.addEventListener('exlibris:bookRemoved', fetchCollection)
    return () => {
      window.removeEventListener('exlibris:bookAdded', fetchCollection)
      window.removeEventListener('exlibris:bookRemoved', fetchCollection)
    }
  }, [])

  async function fetchActiveListings() {
    const { data } = await supabase
      .from('listings')
      .select('id, book_id, price')
      .eq('seller_id', session.user.id)
      .eq('status', 'active')
    const map = {}
    for (const l of data || []) map[l.book_id] = l
    setActiveListings(map)
  }

  async function fetchCollectionValue(bookIds) {
    const total = bookIds.length
    if (!total) { setCollectionStats({ retailTotal: 0, retailCount: 0, usedTotal: 0, usedCount: 0, total: 0 }); return }
    const { data } = await supabase
      .from('valuations')
      .select('list_price, avg_price')
      .in('book_id', bookIds)
    const rows = data || []
    const retailRows = rows.filter(v => v.list_price != null)
    const usedRows   = rows.filter(v => v.avg_price   != null)
    setCollectionStats({
      retailTotal: retailRows.reduce((sum, v) => sum + Number(v.list_price), 0),
      retailCount: retailRows.length,
      usedTotal:   usedRows.reduce((sum, v) => sum + Number(v.avg_price), 0),
      usedCount:   usedRows.length,
      total,
    })
  }

  async function fetchCollection() {
    setLoading(true)
    fetchActiveListings()
    const { data, error } = await supabase
      .from('collection_entries')
      .select(`
        id, read_status, user_rating, added_at, current_page,
        books ( id, title, author, cover_image_url, isbn_13, isbn_10, genre, published_year, pages )
      `)
      .eq('user_id', session.user.id)
      .order('added_at', { ascending: false })

    if (!error) {
      setBooks(data || [])
      // Mark as onboarded once they've ever had books — prevents accidental redirect
      if (data && data.length > 0) {
        localStorage.setItem('exlibris-onboarded', '1')
      }
      const allBookIds = (data || []).map(e => e.books?.id).filter(Boolean)
      fetchCollectionValue(allBookIds)
      // Backfill genres in the background (once per session)
      if (!sessionStorage.getItem('exlibris-genre-backfill')) {
        sessionStorage.setItem('exlibris-genre-backfill', '1')
        backfillGenres(data || [])
      }
      // Backfill missing/low-quality covers in the background (once per session)
      if (!sessionStorage.getItem('exlibris-cover-backfill-v2')) {
        sessionStorage.setItem('exlibris-cover-backfill-v2', '1')
        backfillCovers(data || [])
      }
      // Backfill missing valuations in the background (once per session)
      if (!sessionStorage.getItem('exlibris-valuation-backfill')) {
        sessionStorage.setItem('exlibris-valuation-backfill', '1')
        backfillValuations(data || [])
      }
    }
    setLoading(false)
    fetchTags()
  }

  async function fetchTags() {
    const { data } = await supabase
      .from('book_tags')
      .select('book_id, tag')
      .eq('user_id', session.user.id)
    const map = {}
    const tagSet = new Set()
    for (const row of data || []) {
      if (!map[row.book_id]) map[row.book_id] = []
      map[row.book_id].push(row.tag)
      tagSet.add(row.tag)
    }
    setTagMap(map)
    setAllTags([...tagSet].sort())
  }

  // Fetch covers from Open Library for books that don't have one
  async function backfillCovers(entries) {
    // Include books with no cover OR only a low-quality placeholder
    function isLowQuality(url) {
      if (!url) return true
      return url.includes('-S.jpg') || url.includes('-M.jpg') || url.includes('zoom=1')
    }

    async function fetchOLCover(isbn, title, author) {
      if (isbn) {
        const r = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=cover_i&limit=1`)
        if (r.ok) {
          const d = await r.json()
          const coverId = d.docs?.[0]?.cover_i
          if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
        }
      }
      // fallback: title + author search
      if (title) {
        const q = encodeURIComponent(`${title} ${author || ''}`.trim())
        const r = await fetch(`https://openlibrary.org/search.json?q=${q}&fields=cover_i&limit=3`)
        if (r.ok) {
          const d = await r.json()
          for (const doc of d.docs || []) {
            if (doc.cover_i) return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
          }
        }
      }
      return null
    }

    const todo = entries.filter(e => isLowQuality(e.books.cover_image_url))
    if (todo.length === 0) return

    const BATCH = 4
    for (let i = 0; i < todo.length; i += BATCH) {
      await Promise.all(todo.slice(i, i + BATCH).map(async entry => {
        const { id, isbn_13, isbn_10, title, author } = entry.books
        const isbn = isbn_13 || isbn_10 || null
        try {
          const raw = await fetchOLCover(isbn, title, author)
          if (raw) {
            const url = await uploadCoverToStorage(raw, id)
            await supabase.from('books').update({ cover_image_url: url }).eq('id', id)
            setBooks(prev => prev.map(e =>
              e.books.id === id ? { ...e, books: { ...e.books, cover_image_url: url } } : e
            ))
          }
        } catch { /* ignore */ }
      }))
      await new Promise(r => setTimeout(r, 600))
    }
  }

  // Fetch retail pricing from Google Books for books with no valuation yet
  async function backfillValuations(entries) {
    const bookIds = entries.map(e => e.books?.id).filter(Boolean)
    if (!bookIds.length) return

    // Find which books already have a valuation (any entry — even a null-price miss)
    // Skip ones fetched in the last 6 hours to avoid hammering the API on every reload
    const { data: existing } = await supabase
      .from('valuations')
      .select('book_id, fetched_at, list_price')
      .in('book_id', bookIds)

    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000
    const skipIds = new Set(
      (existing || [])
        .filter(v => new Date(v.fetched_at).getTime() > sixHoursAgo)
        .map(v => v.book_id)
    )

    const todo = entries.filter(e => e.books?.id && !skipIds.has(e.books.id))
    if (!todo.length) return

    const BATCH = 5
    for (let i = 0; i < todo.length; i += BATCH) {
      await Promise.allSettled(todo.slice(i, i + BATCH).map(async entry => {
        const { id, isbn_13, isbn_10, title, author } = entry.books
        try {
          const { data } = await supabase.functions.invoke('get-book-valuation', {
            body: { isbn: isbn_13 || isbn_10 || null, title, author }
          })
          const row = {
            book_id:             id,
            list_price:          data?.list_price          ?? null,
            list_price_currency: data?.list_price_currency ?? null,
            avg_price:           data?.avg_price           ?? null,
            min_price:           data?.min_price           ?? null,
            max_price:           data?.max_price           ?? null,
            sample_count:        data?.sample_count        ?? null,
            currency:            data?.currency            || 'USD',
            fetched_at:          new Date().toISOString(),
          }
          await supabase.from('valuations').upsert(row, { onConflict: 'book_id' })
          // Refresh the value totals after each batch completes
          if (data?.list_price) {
            const allIds = entries.map(e => e.books?.id).filter(Boolean)
            fetchCollectionValue(allIds)
          }
        } catch { /* ignore individual failures */ }
      }))
      // Small delay between batches to avoid rate-limiting
      await new Promise(r => setTimeout(r, 800))
    }
  }

  // Fetch genres from Open Library for books that don't have one
  async function backfillGenres(entries) {
    const todo = entries.filter(e => !e.books.genre && (e.books.isbn_13 || e.books.isbn_10))
    if (todo.length === 0) return

    const BATCH = 5
    for (let i = 0; i < todo.length; i += BATCH) {
      await Promise.all(todo.slice(i, i + BATCH).map(async entry => {
        const isbn = entry.books.isbn_13 || entry.books.isbn_10
        try {
          const r = await fetch(`https://openlibrary.org/search.json?isbn=${isbn}&fields=subject&limit=1`)
          const data = await r.json()
          const genre = extractGenre(data.docs?.[0]?.subject)
          if (genre) {
            await supabase.from('books').update({ genre }).eq('id', entry.books.id)
            setBooks(prev => prev.map(e =>
              e.books.id === entry.books.id ? { ...e, books: { ...e.books, genre } } : e
            ))
          }
        } catch { /* ignore network errors */ }
      }))
      // Pause between batches to be respectful to OL
      await new Promise(r => setTimeout(r, 600))
    }
  }

  const searchLower = search.trim().toLowerCase()
  const filtered = books
    .filter(e => filter === 'all' || e.read_status === filter)
    .filter(e => !searchLower || e.books.title.toLowerCase().includes(searchLower) || (e.books.author || '').toLowerCase().includes(searchLower))
    .filter(e => !selectedTag || (tagMap[e.books.id] || []).includes(selectedTag))

  function sortEntries(arr) {
    switch (sort) {
      case 'title':  return [...arr].sort((a, b) => a.books.title.localeCompare(b.books.title))
      case 'author': return [...arr].sort((a, b) => (a.books.author||'').localeCompare(b.books.author||''))
      case 'rating': return [...arr].sort((a, b) => (b.user_rating||0) - (a.user_rating||0))
      case 'year':   return [...arr].sort((a, b) => (b.books.published_year||0) - (a.books.published_year||0))
      default:       return arr  // 'added' - already sorted by added_at desc
    }
  }
  const sorted = sortEntries(filtered)

  const STATUS_GROUP_ORDER = ['reading', 'want', 'read', 'owned']

  function groupEntries(entries) {
    if (groupBy === 'none') return [{ label: null, entries }]
    const groups = {}
    for (const entry of entries) {
      let key
      if (groupBy === 'status') {
        key = STATUS_LABELS[entry.read_status] || 'Other'
      } else if (groupBy === 'genre') {
        key = entry.books.genre || 'Uncategorized'
      } else if (groupBy === 'author') {
        key = entry.books.author || 'Unknown Author'
      } else if (groupBy === 'decade') {
        const y = entry.books.published_year
        key = y ? `${Math.floor(y / 10) * 10}s` : 'Unknown'
      }
      if (!groups[key]) groups[key] = []
      groups[key].push(entry)
    }
    const sortedGroups = Object.entries(groups).map(([label, entries]) => ({ label, entries }))
    if (groupBy === 'status') {
      const order = STATUS_GROUP_ORDER.map(k => STATUS_LABELS[k])
      sortedGroups.sort((a, b) => {
        const ai = order.indexOf(a.label), bi = order.indexOf(b.label)
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })
    } else if (groupBy === 'decade') {
      sortedGroups.sort((a, b) => {
        if (a.label === 'Unknown') return 1
        if (b.label === 'Unknown') return -1
        return parseInt(b.label) - parseInt(a.label)
      })
    } else {
      sortedGroups.sort((a, b) => a.label.localeCompare(b.label))
    }
    return sortedGroups
  }

  function toggleGroupCollapse(label) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  function selectAllInGroup(entries) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const e of entries) next.add(e.id)
      return next
    })
  }

  const grouped = groupEntries(sorted)

  const stats = {
    total:   books.length,
    read:    books.filter(b => b.read_status === 'read').length,
    reading: books.filter(b => b.read_status === 'reading').length,
    want:    books.filter(b => b.read_status === 'want').length,
  }

  function toggleSelectMode() {
    setSelectMode(v => !v)
    setSelectedIds(new Set())
    setBulkStatus('')
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function applyBulkStatus() {
    if (!bulkStatus || selectedIds.size === 0) return
    setBulkWorking(true)
    await supabase
      .from('collection_entries')
      .update({ read_status: bulkStatus })
      .in('id', [...selectedIds])
      .eq('user_id', session.user.id)
    setBulkWorking(false)
    setSelectMode(false)
    setSelectedIds(new Set())
    setBulkStatus('')
    fetchCollection()
  }

  async function applyBulkRemove() {
    if (selectedIds.size === 0) return
    const confirmed = window.confirm(`Remove ${selectedIds.size} book${selectedIds.size > 1 ? 's' : ''} from your library?`)
    if (!confirmed) return
    setBulkWorking(true)
    await supabase
      .from('collection_entries')
      .delete()
      .in('id', [...selectedIds])
      .eq('user_id', session.user.id)
    setBulkWorking(false)
    setSelectMode(false)
    setSelectedIds(new Set())
    setBulkStatus('')
    fetchCollection()
  }

  const s = {
    page:           { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    topbar:         { position: 'sticky', top: 0, zIndex: 10, background: theme.bg, backdropFilter: 'blur(8px)', borderBottom: `1px solid ${theme.border}`, padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    logo:           { fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, color: theme.text, cursor: 'pointer' },
    topbarRight:    { display: 'flex', gap: 10, alignItems: 'center' },
    content:        { padding: isMobile ? '16px' : '28px 32px' },
    statsRow:       { display: 'flex', gap: isMobile ? 8 : 14, marginBottom: isMobile ? 16 : 28, flexWrap: isMobile ? 'nowrap' : 'nowrap' },
    statCard:       { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: isMobile ? 10 : 14, padding: isMobile ? '12px 8px' : '18px 22px', flex: 1, transition: 'box-shadow 0.15s', textAlign: 'center' },
    statVal:        { fontFamily: 'Georgia, serif', fontSize: isMobile ? 22 : 28, fontWeight: 700, color: theme.rust },
    statLabel:      { fontSize: isMobile ? 10 : 11, color: theme.textSubtle, marginTop: 4, textTransform: 'uppercase', letterSpacing: isMobile ? 0.3 : 1 },
    filterRow:      { display: 'flex', gap: isMobile ? 6 : 8, marginBottom: 24, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' },
    filterActive:   { padding: '7px 16px', borderRadius: 8, border: 'none', background: theme.rust, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    filterInactive: { padding: '7px 16px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    grid:           { display: 'grid', gridTemplateColumns: isMobile ? ({ sm: 'repeat(4, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(2, 1fr)' }[coverSize]) : ({ sm: 'repeat(auto-fill, minmax(100px, 1fr))', md: 'repeat(auto-fill, minmax(148px, 1fr))', lg: 'repeat(auto-fill, minmax(200px, 1fr))' }[coverSize]), gap: isMobile ? ({ sm: 8, md: 12, lg: 16 }[coverSize]) : ({ sm: 16, md: 24, lg: 28 }[coverSize]) },
    card:           { cursor: 'pointer', transition: 'transform 0.18s, box-shadow 0.18s' },
    cardHover:      { transform: 'translateY(-4px)' },
    coverWrap:      { width: '100%', aspectRatio: '2/3' },
    coverImg:       { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 5, boxShadow: '2px 3px 10px rgba(26,18,8,0.2)' },
    fakeCover:      { width: '100%', height: '100%', borderRadius: 5, display: 'flex', alignItems: 'flex-end', padding: '8px 8px 8px 14px', position: 'relative', overflow: 'hidden', boxShadow: '2px 3px 10px rgba(26,18,8,0.2)' },
    fakeSpine:      { position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, background: 'rgba(0,0,0,0.2)' },
    fakeCoverText:  { fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.5)', lineHeight: 1.3, position: 'relative', zIndex: 1 },
    bookTitle:      { fontSize: 13, fontWeight: 500, lineHeight: 1.3, color: theme.text },
    bookAuthor:     { fontSize: 12, color: theme.textSubtle, marginTop: 2 },
    badge:          { display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 500 },
    menu:           { position: 'absolute', top: '100%', left: 0, marginTop: 4, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 8, zIndex: 20, minWidth: 160, boxShadow: theme.shadow },
    menuItem:       { padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: theme.textMuted },
    empty:          { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 12, color: theme.textSubtle },
    skeleton:       { background: theme.bgSubtle, borderRadius: 5, aspectRatio: '2/3', width: '100%' },
    btnPrimary:     { padding: '8px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:       { padding: '6px 12px', background: 'none', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textMuted },
    navLinkActive:  { padding: '6px 12px', background: 'rgba(192,82,30,0.1)', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.rust, fontWeight: 600 },
    overlay:        { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:          { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 600, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
    modalHeader:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' },
    modalTitle:     { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text },
    closeBtn:       { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4 },
    searchRow:      { display: 'flex', gap: 10, padding: '16px 24px' },
    searchInput:    { flex: 1, padding: '9px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 16, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text },
    results:        { overflowY: 'auto', padding: '0 24px 20px', flex: 1 },
    resultRow:      { display: 'flex', gap: 14, alignItems: 'center', padding: '14px 0', borderBottom: `1px solid ${theme.borderLight}` },
    resultCover:    { width: 36, height: 54, flexShrink: 0, borderRadius: 3, overflow: 'hidden', background: theme.border },
    resultInfo:     { flex: 1 },
    resultTitle:    { fontSize: 14, fontWeight: 500, color: theme.text, lineHeight: 1.3 },
    resultAuthor:   { fontSize: 12, color: theme.textSubtle, marginTop: 2 },
    resultYear:     { fontSize: 11, color: theme.textSubtle, marginTop: 2 },
    resultActions:  { display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'flex-end' },
    addBtnPrimary:  { padding: '6px 14px', fontSize: 12, background: theme.rust, color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 500, whiteSpace: 'nowrap' },
    statusShortcuts:{ display: 'flex', gap: 4 },
    addBtn:         { padding: '4px 8px', fontSize: 11, background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.text, whiteSpace: 'nowrap' },
    addBtnLoading:  { opacity: 0.5, cursor: 'not-allowed' },
    addedConfirm:   { fontSize: 12, color: theme.sage, fontWeight: 500 },

    bellBtn:        { position: 'relative', background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 8, padding: '7px 10px', cursor: 'pointer', color: theme.text, display: 'flex', alignItems: 'center' },
    bellBadge:      { position: 'absolute', top: -6, right: -6, background: theme.rust, color: 'white', borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    reqDropdown:    { position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, minWidth: 320, boxShadow: theme.shadow, zIndex: 100 },
    reqHeader:      { padding: '14px 16px 10px', fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: theme.text, borderBottom: `1px solid ${theme.borderLight}`, display: 'flex', alignItems: 'center', gap: 8 },
    reqCount:       { background: 'rgba(192,82,30,0.1)', color: theme.rust, borderRadius: 20, padding: '1px 8px', fontSize: 12, fontWeight: 600 },
    reqEmpty:       { padding: '20px 16px', fontSize: 13, color: theme.textSubtle, textAlign: 'center' },
    reqRow:         { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${theme.borderLight}` },
    reqAvatar:      { width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, flexShrink: 0 },
    reqUsername:    { fontSize: 14, fontWeight: 600, color: theme.text, cursor: 'pointer' },
    reqSub:         { fontSize: 12, color: theme.textSubtle, marginTop: 1 },
    reqAccept:      { padding: '5px 12px', background: theme.rust, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    reqDecline:     { padding: '5px 12px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

    forSaleBadge:   { position: 'absolute', bottom: 6, right: 6, background: theme.sage, color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, letterSpacing: 0.3 },
    cardSelected:   { outline: `2px solid ${theme.rust}`, borderRadius: 6 },
    bulkBar:        { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50, background: theme.bgCard, borderTop: `1px solid ${theme.border}`, boxShadow: '0 -4px 20px rgba(26,18,8,0.1)', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
    bulkCount:      { fontSize: 14, fontWeight: 600, color: theme.text, marginRight: 4 },
    bulkSelect:     { padding: '7px 10px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", background: theme.bgCard, color: theme.text, cursor: 'pointer', outline: 'none' },
    bulkBtn:        { padding: '7px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    bulkBtnDanger:  { background: theme.bgCard, color: '#c0392b', border: '1px solid #f5c6c6' },
    bulkBtnCancel:  { padding: '7px 14px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textSubtle },
    groupSection:   { marginBottom: 36 },
    groupHeader:    { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer', userSelect: 'none' },
    groupLabel:     { fontFamily: 'Georgia, serif', fontSize: isMobile ? 16 : 18, fontWeight: 700, color: theme.text },
    groupCount:     { fontSize: 12, fontWeight: 600, color: theme.textSubtle, background: theme.bgSubtle, border: `1px solid ${theme.border}`, borderRadius: 20, padding: '1px 9px' },
    groupCollapse:  { fontSize: 11, color: theme.textSubtle, marginLeft: 2 },
    selectAllBtn:   { marginLeft: 'auto', fontSize: 11, color: theme.rust, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, padding: '2px 6px' },
    fieldGroup:     { marginBottom: 18 },
    fieldLabel:     { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    priceInputWrap: { display: 'flex', alignItems: 'center', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', background: theme.bgCard, width: 140 },
    priceDollar:    { padding: '9px 10px 9px 14px', fontSize: 15, color: theme.textSubtle, background: theme.bg, borderRight: `1px solid ${theme.border}` },
    priceInput:     { flex: 1, padding: '9px 12px', border: 'none', outline: 'none', fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: theme.text, background: theme.bgCard },
    condRow:        { display: 'flex', gap: 6, flexWrap: 'wrap' },
    condBtn:        { padding: '6px 12px', fontSize: 12, background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 20, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textMuted },
    condBtnActive:  { background: theme.rust, color: 'white', border: `1px solid ${theme.rust}` },
    textarea:       { width: '100%', padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />

      <div style={s.content}>
        {/* Stats */}
        {isMobile ? (
          <div style={s.statsRow}>
            {[
              ['Total',   stats.total],
              ['Read',    stats.read],
              ['Reading', stats.reading],
              ['Want',    stats.want],
            ].map(([label, val]) => (
              <div key={label} style={s.statCard}>
                <div style={s.statVal}>{val}</div>
                <div style={s.statLabel}>{label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={s.statsRow}>
            {[
              ['Total Books', stats.total,   null,      '📚'],
              ['Read',        stats.read,    '#5a7a5a', '✓'],
              ['Reading',     stats.reading, '#c0521e', '📖'],
              ['Want to Read',stats.want,    '#b8860b', '🔖'],
            ].map(([label, val, color, icon]) => (
              <div key={label} style={s.statCard}>
                <div style={{ ...s.statVal, color: color || theme.text }}>{icon} {val}</div>
                <div style={s.statLabel}>{label}</div>
              </div>
            ))}
            {collectionStats && (
              <>
                <div style={s.statCard}>
                  <div style={{ ...s.statVal, color: '#5a7a5a' }}>
                    💰 {collectionStats.retailCount > 0 ? `$${collectionStats.retailTotal.toFixed(2)}` : '—'}
                  </div>
                  <div style={s.statLabel}>
                    Retail Value
                    <span style={{ display: 'block', fontSize: 10, opacity: 0.7, marginTop: 1 }}>
                      {collectionStats.retailCount}/{collectionStats.total} books priced
                    </span>
                  </div>
                </div>
                <div style={s.statCard}>
                  <div style={{ ...s.statVal, color: '#b8860b' }}>
                    📊 {collectionStats.usedCount > 0 ? `$${collectionStats.usedTotal.toFixed(2)}` : '—'}
                  </div>
                  <div style={s.statLabel}>
                    Used Value
                    <span style={{ display: 'block', fontSize: 10, opacity: 0.7, marginTop: 1 }}>
                      {collectionStats.usedCount}/{collectionStats.total} books priced
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Search bar */}
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: theme.textSubtle, pointerEvents: 'none' }}>🔍</span>
          <input
            type="text"
            placeholder="Search your library…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 36px 10px 36px',
              border: `1px solid ${search ? theme.rust : theme.border}`,
              borderRadius: 10, fontSize: 14,
              fontFamily: "'DM Sans', sans-serif",
              background: theme.bgCard, color: theme.text,
              outline: 'none', transition: 'border-color 0.15s',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: theme.textSubtle, lineHeight: 1, padding: 2 }}
            >×</button>
          )}
        </div>

        {/* Filter pills */}
        <div style={s.filterRow} className={isMobile ? 'chips-scroll' : ''}>
          {['all', 'owned', 'read', 'reading', 'want'].map(f => (
            <button key={f}
              style={filter === f
                ? { ...s.filterActive,   ...(isMobile ? { flexShrink: 0 } : {}) }
                : { ...s.filterInactive, ...(isMobile ? { flexShrink: 0 } : {}) }}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'All Books' : STATUS_LABELS[f]}
            </button>
          ))}
        </div>

        {/* Tag filter row */}
        {allTags.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: theme.textSubtle, fontWeight: 500, flexShrink: 0 }}>🏷️ Tags:</span>
            <button
              style={selectedTag === null ? s.filterActive : s.filterInactive}
              onClick={() => setSelectedTag(null)}
            >
              All
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                style={selectedTag === tag ? s.filterActive : s.filterInactive}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Sort + Select toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          {isMobile ? (
            /* Mobile: compact dropdown */
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <span style={{ fontSize: 12, color: theme.textSubtle, fontWeight: 500, flexShrink: 0 }}>Sort:</span>
              <select
                value={sort}
                onChange={e => setSort(e.target.value)}
                style={{
                  flex: 1, padding: '7px 10px', border: `1px solid ${theme.border}`,
                  borderRadius: 8, fontSize: 13, background: theme.bgCard,
                  color: theme.text, fontFamily: "'DM Sans', sans-serif",
                  outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="added">Date Added</option>
                <option value="title">Title</option>
                <option value="author">Author</option>
                <option value="rating">Rating</option>
                <option value="year">Year</option>
              </select>
            </div>
          ) : (
            /* Desktop: pills */
            <>
              <span style={{ fontSize: 12, color: theme.textSubtle, fontWeight: 500 }}>Sort:</span>
              {[
                { key: 'added',  label: 'Date Added' },
                { key: 'title',  label: 'Title' },
                { key: 'author', label: 'Author' },
                { key: 'rating', label: 'Rating' },
                { key: 'year',   label: 'Year' },
              ].map(opt => (
                <button key={opt.key}
                  style={sort === opt.key ? s.filterActive : s.filterInactive}
                  onClick={() => setSort(opt.key)}>
                  {opt.label}
                </button>
              ))}
            </>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            {/* Group by */}
            {!isMobile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: theme.textSubtle, fontWeight: 500, flexShrink: 0 }}>Group:</span>
                <select
                  value={groupBy}
                  onChange={e => { setGroupBy(e.target.value); setCollapsedGroups(new Set()) }}
                  style={{ padding: '6px 10px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, background: theme.bgCard, color: groupBy !== 'none' ? theme.rust : theme.text, fontFamily: "'DM Sans', sans-serif", outline: 'none', cursor: 'pointer', fontWeight: groupBy !== 'none' ? 600 : 400 }}
                >
                  <option value="none">None</option>
                  <option value="status">Status</option>
                  <option value="genre">Genre</option>
                  <option value="author">Author</option>
                  <option value="decade">Decade</option>
                </select>
              </div>
            )}
            {/* Cover size — grid mode only */}
            {viewMode === 'grid' && (
              <div style={{ display: 'flex', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
                {[['sm','S'],['md','M'],['lg','L']].map(([sz, label], i) => (
                  <button key={sz} onClick={() => changeCoverSize(sz)}
                    title={{ sm: 'Small covers', md: 'Medium covers', lg: 'Large covers' }[sz]}
                    style={{ padding: '5px 10px', border: 'none', borderLeft: i > 0 ? `1px solid ${theme.border}` : 'none', background: coverSize === sz ? theme.rust : 'transparent', color: coverSize === sz ? 'white' : theme.textSubtle, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600 }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {/* View mode toggle */}
            <div style={{ display: 'flex', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <button onClick={() => changeViewMode('grid')} title="Grid view"
                style={{ padding: '5px 10px', border: 'none', background: viewMode === 'grid' ? theme.rust : 'transparent', color: viewMode === 'grid' ? 'white' : theme.textSubtle, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>
                ⊞
              </button>
              <button onClick={() => changeViewMode('list')} title="List view"
                style={{ padding: '5px 10px', border: 'none', borderLeft: `1px solid ${theme.border}`, background: viewMode === 'list' ? theme.rust : 'transparent', color: viewMode === 'list' ? 'white' : theme.textSubtle, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>
                ☰
              </button>
            </div>
            {/* Select mode */}
            <button
              style={selectMode ? s.filterActive : { ...s.filterInactive, borderColor: theme.gold, color: theme.gold }}
              onClick={toggleSelectMode}
            >
              {selectMode ? '✕ Cancel' : '☑ Select'}
            </button>
          </div>
        </div>

        {/* Import / Export buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
          <button style={{ ...s.filterInactive, color: theme.sage, borderColor: theme.sage }} onClick={() => setShowImport(true)}>
            📥 Import from Goodreads
          </button>
          <button style={{ ...s.filterInactive, color: theme.sage, borderColor: theme.sage }} onClick={() => {
            const STATUS_LABELS = { owned: 'In Library', read: 'Read', reading: 'Reading', want: 'Want to Read' }
            const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
            const header = ['Title', 'Author', 'Status', 'Rating', 'Genre', 'Year', 'ISBN', 'Date Added']
            const rows = books.map(b => [
              escape(b.books?.title),
              escape(b.books?.author),
              escape(STATUS_LABELS[b.read_status] ?? b.read_status),
              escape(b.user_rating ?? ''),
              escape(b.books?.genre),
              escape(b.books?.published_year),
              escape(b.books?.isbn_13),
              escape(b.added_at ? new Date(b.added_at).toLocaleDateString() : ''),
            ])
            const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n')
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'my-library.csv'
            a.click()
            URL.revokeObjectURL(url)
          }}>
            📤 Export as CSV
          </button>
        </div>

        {/* Book grid */}
        {loading ? (
          <>
            <style>{`@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}.skeleton-shimmer{background:linear-gradient(90deg,#e8e0d4 25%,#f0e8dc 50%,#e8e0d4 75%);background-size:800px 100%;animation:shimmer 1.4s infinite linear;}`}</style>
            <div style={s.grid}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} style={s.skeleton} className="skeleton-shimmer" />
              ))}
            </div>
          </>
        ) : filtered.length === 0 ? (
          <div style={s.empty}>
            <span style={{ fontSize: 48 }}>📚</span>
            <div>
              {books.length === 0
                ? 'Your library is empty'
                : searchLower
                  ? `No books matching "${search}"`
                  : 'No books with this status yet.'}
            </div>
            {books.length === 0 && (
              <button style={s.btnPrimary} onClick={() => setShowSearch(true)}>
                + Add your first book
              </button>
            )}
          </div>
        ) : (
          <>
            {grouped.map(({ label, entries: groupEntries }) => {
              const isCollapsed = label && collapsedGroups.has(label)
              return (
                <div key={label || 'all'} style={label ? s.groupSection : undefined}>
                  {label && (
                    <div style={s.groupHeader} onClick={() => toggleGroupCollapse(label)}>
                      <span style={s.groupCollapse}>{isCollapsed ? '▶' : '▼'}</span>
                      <span style={s.groupLabel}>{label}</span>
                      <span style={s.groupCount}>{groupEntries.length}</span>
                      {selectMode && !isCollapsed && (
                        <button
                          style={s.selectAllBtn}
                          onClick={e => { e.stopPropagation(); selectAllInGroup(groupEntries) }}
                        >
                          Select all
                        </button>
                      )}
                    </div>
                  )}
                  {!isCollapsed && (
                    viewMode === 'list' ? (
                      <div style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden', background: theme.bgCard }}>
                        {groupEntries.map((entry, idx) => (
                          <ListRow
                            key={entry.id}
                            entry={entry}
                            isLast={idx === groupEntries.length - 1}
                            selectMode={selectMode}
                            isSelected={selectedIds.has(entry.id)}
                            onSelect={() => { if (selectMode) toggleSelect(entry.id); else openBook(entry.books.id) }}
                            theme={theme}
                            isMobile={isMobile}
                          />
                        ))}
                      </div>
                    ) : (
                      <div style={s.grid}>
                        {groupEntries.map(entry => (
                          <BookCard
                            key={entry.id}
                            entry={entry}
                            listing={activeListings[entry.books.id] || null}
                            onUpdate={fetchCollection}
                            onSelect={() => {
                              if (selectMode) toggleSelect(entry.id)
                              else openBook(entry.books.id)
                            }}
                            onListForSale={() => setListingTarget(entry)}
                            selectMode={selectMode}
                            isSelected={selectedIds.has(entry.id)}
                          />
                        ))}
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </>
        )}
      {showImport && (
        <GoodreadsImportModal
          session={session}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); fetchCollection() }}
        />
      )}
      </div>

      {/* List for sale modal */}
      {listingTarget && (
        <ListingModal
          session={session}
          entry={listingTarget}
          onClose={() => setListingTarget(null)}
          onSuccess={() => { setListingTarget(null); navigate('/marketplace') }}
        />
      )}

      {/* Book detail overlay */}
      {selectedBook && (
        <div style={{ position: 'fixed', inset: 0, background: theme.bg, zIndex: 40, overflowY: 'auto', isolation: 'isolate' }}>
          <BookDetail
            bookId={selectedBook}
            session={session}
            onBack={() => closeBook()}
          />
        </div>
      )}

      {/* Bulk action floating bar */}
      {selectMode && (
        <div style={s.bulkBar}>
          <span style={s.bulkCount}>
            {selectedIds.size} {selectedIds.size === 1 ? 'book' : 'books'} selected
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <select
              style={s.bulkSelect}
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
            >
              <option value="">Change status…</option>
              {Object.entries(STATUS_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            <button
              style={{ ...s.bulkBtn, opacity: (!bulkStatus || selectedIds.size === 0 || bulkWorking) ? 0.5 : 1 }}
              onClick={applyBulkStatus}
              disabled={!bulkStatus || selectedIds.size === 0 || bulkWorking}
            >
              Apply →
            </button>
            <button
              style={{ ...s.bulkBtn, ...s.bulkBtnDanger, opacity: (selectedIds.size === 0 || bulkWorking) ? 0.5 : 1 }}
              onClick={applyBulkRemove}
              disabled={selectedIds.size === 0 || bulkWorking}
            >
              Remove selected
            </button>
            <button style={s.bulkBtnCancel} onClick={toggleSelectMode}>
              ✕ Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- LIST ROW ----
function ListRow({ entry, isLast, selectMode, isSelected, onSelect, theme, isMobile }) {
  const book    = entry.books
  const status  = entry.read_status
  const sc      = STATUS_COLORS[status] || {}
  const sl      = STATUS_LABELS[status] || status
  const touchStartY = useRef(0)
  const [hover, setHover]       = useState(false)
  const [imgError, setImgError] = useState(false)
  const coverUrl = getCoverUrl(book)
  const colors   = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const c        = colors[book.title.charCodeAt(0) % colors.length]
  const c2       = colors[(book.title.charCodeAt(0) + 3) % colors.length]

  return (
    <div
      onClick={onSelect}
      onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY }}
      onTouchEnd={(e) => { if (Math.abs(e.changedTouches[0].clientY - touchStartY.current) < 10) onSelect?.() }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: isMobile ? '10px 12px' : '10px 16px',
        background: isSelected ? 'rgba(192,82,30,0.06)' : hover ? theme.bgSubtle : 'transparent',
        cursor: 'pointer', transition: 'background 0.1s',
        borderBottom: isLast ? 'none' : `1px solid ${theme.borderLight}`,
        outline: isSelected ? `2px solid ${theme.rust}` : 'none',
        outlineOffset: -2,
        touchAction: 'manipulation',
      }}
    >
      {/* Select checkbox */}
      {selectMode && (
        <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: isSelected ? theme.rust : 'transparent', border: `2px solid ${isSelected ? theme.rust : theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isSelected && <span style={{ color: 'white', fontSize: 11, fontWeight: 700 }}>✓</span>}
        </div>
      )}
      {/* Thumbnail */}
      <div style={{ width: 38, height: 57, flexShrink: 0, borderRadius: 3, overflow: 'hidden', boxShadow: '1px 2px 6px rgba(26,18,8,0.18)' }}>
        {coverUrl && !imgError
          ? <img src={coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setImgError(true)} />
          : <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg, ${c}, ${c2})` }} />
        }
      </div>
      {/* Title / author / meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: theme.text, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.title}</div>
        <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>{book.author}</div>
        {!isMobile && (book.genre || book.published_year) && (
          <div style={{ fontSize: 11, color: theme.textSubtle, marginTop: 3, opacity: 0.7 }}>
            {[book.genre, book.published_year].filter(Boolean).join(' · ')}
          </div>
        )}
        {status === 'reading' && entry.current_page > 0 && (
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            {book.pages && (
              <div style={{ width: 80, height: 3, background: theme.bgSubtle, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, Math.round((entry.current_page / book.pages) * 100))}%`, background: theme.rust, borderRadius: 2 }} />
              </div>
            )}
            <span style={{ fontSize: 10, color: theme.rust }}>
              {book.pages ? `Pg ${entry.current_page} / ${book.pages}` : `Pg ${entry.current_page}`}
            </span>
          </div>
        )}
      </div>
      {/* Rating */}
      {!isMobile && entry.user_rating > 0 && (
        <div style={{ fontSize: 12, color: '#b8860b', letterSpacing: 1, flexShrink: 0 }}>
          {'★'.repeat(entry.user_rating)}{'☆'.repeat(5 - entry.user_rating)}
        </div>
      )}
      {/* Status badge */}
      <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 500, flexShrink: 0, background: sc.bg, color: sc.color, whiteSpace: 'nowrap' }}>{sl}</span>
    </div>
  )
}

// ---- BOOK CARD ----
function BookCard({ entry, listing, onUpdate, onSelect, onListForSale, selectMode, isSelected }) {
  const { theme } = useTheme()
  const book   = entry.books
  const status = entry.read_status
  const [menuOpen,     setMenuOpen]     = useState(false)
  const touchStartY = useRef(0)
  const [hover,        setHover]        = useState(false)
  const [imgError,     setImgError]     = useState(false)
  const [currentPage,  setCurrentPage]  = useState(entry.current_page || 0)
  const [editingPage,  setEditingPage]  = useState(false)
  const [pageInput,    setPageInput]    = useState('')

  const pct = book.pages && currentPage ? Math.min(100, Math.round((currentPage / book.pages) * 100)) : 0

  async function savePage(val) {
    const p = Math.max(0, parseInt(val) || 0)
    setCurrentPage(p)
    setEditingPage(false)
    await supabase.from('collection_entries').update({ current_page: p || null }).eq('id', entry.id)
  }

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

  const s = {
    card:       { cursor: 'pointer', transition: 'transform 0.18s, box-shadow 0.18s' },
    cardHover:  { transform: 'translateY(-4px)' },
    cardSelected: { outline: `2px solid ${theme.rust}`, borderRadius: 6 },
    coverWrap:  { width: '100%', aspectRatio: '2/3' },
    coverImg:   { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 5, boxShadow: '2px 3px 10px rgba(26,18,8,0.2)' },
    bookTitle:  { fontSize: 13, fontWeight: 500, lineHeight: 1.3, color: theme.text },
    bookAuthor: { fontSize: 12, color: theme.textSubtle, marginTop: 2 },
    badge:      { display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 500 },
    menu:       { position: 'absolute', top: '100%', left: 0, marginTop: 4, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 8, zIndex: 20, minWidth: 160, boxShadow: theme.shadow },
    menuItem:   { padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: theme.textMuted },
    forSaleBadge: { position: 'absolute', bottom: 6, right: 6, background: theme.sage, color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, letterSpacing: 0.3 },
  }

  return (
    <div
      style={{
        ...s.card,
        ...(hover && !selectMode ? s.cardHover : {}),
        ...(isSelected ? s.cardSelected : {}),
        position: 'relative',
        touchAction: 'manipulation',
      }}
      onClick={onSelect}
      onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY }}
      onTouchEnd={(e) => { if (Math.abs(e.changedTouches[0].clientY - touchStartY.current) < 10) onSelect?.() }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Select mode checkbox */}
      {selectMode && (
        <div style={{
          position: 'absolute', top: 6, left: 6, zIndex: 10,
          width: 22, height: 22, borderRadius: '50%',
          background: isSelected ? theme.rust : 'rgba(255,255,255,0.85)',
          border: `2px solid ${isSelected ? theme.rust : theme.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', backdropFilter: 'blur(4px)',
          transition: 'all 0.15s',
        }}>
          {isSelected && <span style={{ color: 'white', fontSize: 12, fontWeight: 700, lineHeight: 1 }}>✓</span>}
        </div>
      )}

      {/* Hover ✕ remove button (top-right, non-select mode) */}
      {!selectMode && hover && (
        <div
          style={{
            position: 'absolute', top: 6, right: 6, zIndex: 10,
            width: 22, height: 22, borderRadius: '50%',
            background: theme.bgCard, border: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 11, color: theme.rust, fontWeight: 700,
            backdropFilter: 'blur(4px)',
          }}
          onClick={e => {
            e.stopPropagation()
            if (window.confirm(`Remove "${book.title}" from your library?`)) removeBook()
          }}
          title="Remove from library"
        >
          ✕
        </div>
      )}

      <div style={{ ...s.coverWrap, position: 'relative' }}>
        {(() => {
          const url = getCoverUrl(book)
          return (url && !imgError)
            ? <img src={url} alt={book.title} style={s.coverImg} onError={() => setImgError(true)} />
            : <FakeCover title={book.title} />
        })()}
        {listing && (
          <div style={s.forSaleBadge}>${Number(listing.price).toFixed(2)}</div>
        )}
        {/* Reading progress bar at bottom of cover */}
        {status === 'reading' && (book.pages || currentPage > 0) && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: 'rgba(255,255,255,0.25)', borderRadius: '0 0 5px 5px', overflow: 'hidden', zIndex: 3 }}
            onClick={e => { e.stopPropagation(); setPageInput(currentPage || ''); setEditingPage(true) }}
          >
            <div style={{ height: '100%', width: `${pct}%`, background: theme.rust, transition: 'width 0.3s' }} />
          </div>
        )}
        {/* Status badge overlaid at bottom of cover */}
        {!selectMode && (
          <div style={{ position: 'absolute', bottom: 6, left: 6, zIndex: 2 }} onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen) }}>
            <span style={{ ...s.badge, ...STATUS_COLORS[status], cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
              {STATUS_LABELS[status]} ▾
            </span>
            {menuOpen && (
              <div style={s.menu}>
                {Object.entries(STATUS_LABELS).map(([val, label]) => (
                  <div key={val} style={{
                    ...s.menuItem,
                    fontWeight: val === status ? 600 : 400,
                    color: val === status ? theme.text : theme.textMuted,
                  }} onClick={e => { e.stopPropagation(); changeStatus(val) }}>
                    {val === status ? '✓ ' : ''}{label}
                  </div>
                ))}
                {entry.read_status === 'owned' && (
                  <div
                    style={{ ...s.menuItem, color: theme.sage, borderTop: `1px solid ${theme.borderLight}`, marginTop: 4 }}
                    onClick={e => { e.stopPropagation(); setMenuOpen(false); onListForSale() }}
                  >
                    List for sale
                  </div>
                )}
                <div
                  style={{ ...s.menuItem, borderTop: `1px solid ${theme.borderLight}`, color: theme.rust, marginTop: 4 }}
                  onClick={e => { e.stopPropagation(); removeBook() }}
                >
                  Remove from library
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={s.bookTitle}>{book.title}</div>
        <div style={s.bookAuthor}>{book.author}</div>
        {status === 'reading' && (
          <div style={{ marginTop: 5 }} onClick={e => e.stopPropagation()}>
            {editingPage ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  min="0"
                  max={book.pages || undefined}
                  autoFocus
                  value={pageInput}
                  onChange={e => setPageInput(e.target.value)}
                  onBlur={() => savePage(pageInput)}
                  onKeyDown={e => { if (e.key === 'Enter') savePage(pageInput); if (e.key === 'Escape') setEditingPage(false) }}
                  style={{ width: 52, padding: '2px 6px', fontSize: 11, border: `1px solid ${theme.rust}`, borderRadius: 4, outline: 'none', fontFamily: "'DM Sans', sans-serif", color: theme.text, background: theme.bgCard }}
                />
                {book.pages && <span style={{ fontSize: 10, color: theme.textSubtle }}>/ {book.pages}</span>}
              </div>
            ) : (
              <div
                style={{ fontSize: 11, color: theme.rust, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                onClick={() => { setPageInput(currentPage || ''); setEditingPage(true) }}
              >
                {currentPage > 0
                  ? (book.pages ? `Pg ${currentPage} / ${book.pages}` : `Pg ${currentPage}`)
                  : '+ Update page'}
              </div>
            )}
          </div>
        )}
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
    <div style={{ position: 'absolute', inset: 0, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '2px 3px 10px rgba(26,18,8,0.2)', background: `linear-gradient(135deg, ${color}, ${color2})` }}>
      {/* spine */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, background: 'rgba(0,0,0,0.2)' }} />
      {/* subtle dark overlay so text pops */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.18)' }} />
      <span style={{
        position: 'relative', zIndex: 1,
        padding: '0 14px',
        fontSize: 11, fontWeight: 700,
        fontFamily: 'Georgia, serif',
        color: 'rgba(255,255,255,0.95)',
        textShadow: '0 1px 4px rgba(0,0,0,0.5)',
        lineHeight: 1.4,
        textAlign: 'center',
        wordBreak: 'break-word',
        display: '-webkit-box',
        WebkitLineClamp: 6,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>{title}</span>
    </div>
  )
}

// ---- LISTING MODAL ----
const CONDITION_OPTIONS = [
  { value: 'like_new',   label: 'Like New' },
  { value: 'very_good',  label: 'Very Good' },
  { value: 'good',       label: 'Good' },
  { value: 'acceptable', label: 'Acceptable' },
  { value: 'poor',       label: 'Poor' },
]

function ListingModal({ session, entry, onClose, onSuccess }) {
  const { theme } = useTheme()
  const book = entry.books
  const [price, setPrice]         = useState('')
  const [condition, setCondition] = useState('good')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState(null)

  async function submit() {
    const p = parseFloat(price)
    if (!price || isNaN(p) || p < 0) { setError('Please enter a valid price.'); return }
    setSubmitting(true)
    setError(null)
    const { error: err } = await supabase
      .from('listings')
      .insert({
        seller_id:   session.user.id,
        book_id:     book.id,
        price:       p,
        condition,
        description: description.trim() || null,
        status:      'active',
      })
    if (err) {
      setError('Could not create listing. Please try again.')
      setSubmitting(false)
    } else {
      onSuccess()
    }
  }

  const s = {
    overlay:        { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:          { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 600, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
    modalHeader:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' },
    modalTitle:     { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text },
    closeBtn:       { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4 },
    fieldGroup:     { marginBottom: 18 },
    fieldLabel:     { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    priceInputWrap: { display: 'flex', alignItems: 'center', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', background: theme.bgCard, width: 140 },
    priceDollar:    { padding: '9px 10px 9px 14px', fontSize: 15, color: theme.textSubtle, background: theme.bg, borderRight: `1px solid ${theme.border}` },
    priceInput:     { flex: 1, padding: '9px 12px', border: 'none', outline: 'none', fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: theme.text, background: theme.bgCard },
    condRow:        { display: 'flex', gap: 6, flexWrap: 'wrap' },
    condBtn:        { padding: '6px 12px', fontSize: 12, background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 20, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textMuted },
    condBtnActive:  { background: theme.rust, color: 'white', border: `1px solid ${theme.rust}` },
    textarea:       { width: '100%', padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    btnPrimary:     { padding: '8px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:       { padding: '6px 12px', background: 'none', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textMuted },
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div>
            <div style={s.modalTitle}>List for Sale</div>
            <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 3 }}>{book.title}</div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 24px 24px' }}>
          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>Price (USD)</label>
            <div style={s.priceInputWrap}>
              <span style={s.priceDollar}>$</span>
              <input
                style={s.priceInput}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={e => setPrice(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>Condition</label>
            <div style={s.condRow}>
              {CONDITION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  style={{
                    ...s.condBtn,
                    ...(condition === opt.value ? s.condBtnActive : {}),
                  }}
                  onClick={() => setCondition(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>Condition Notes (optional)</label>
            <textarea
              style={s.textarea}
              placeholder="Describe any wear, marks, or notable details…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {error && <div style={{ color: theme.rust, fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.btnPrimary} onClick={submit} disabled={submitting}>
              {submitting ? 'Listing…' : 'List for Sale'}
            </button>
            <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

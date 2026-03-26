import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BookDetail from './BookDetail'
import NavBar from '../components/NavBar'
import SearchModal from '../components/SearchModal'
import GoodreadsImportModal from '../components/GoodreadsImportModal'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'

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
  const { theme } = useTheme()
  const [books, setBooks]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState('all')
  const [sort, setSort]               = useState('added')
  const [showImport, setShowImport]   = useState(false)
  const [selectedBook, setSelectedBook] = useState(null)
  const [listingTarget, setListingTarget] = useState(null)
  const [activeListings, setActiveListings] = useState({})
  const [collectionValue, setCollectionValue] = useState(null)
  const [selectMode, setSelectMode]     = useState(false)
  const [selectedIds, setSelectedIds]   = useState(new Set())
  const [bulkStatus, setBulkStatus]     = useState('')
  const [bulkWorking, setBulkWorking]   = useState(false)

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
    if (!bookIds.length) { setCollectionValue(0); return }
    const { data } = await supabase
      .from('valuations')
      .select('avg_price')
      .in('book_id', bookIds)
      .not('avg_price', 'is', null)
    const total = (data || []).reduce((sum, v) => sum + Number(v.avg_price), 0)
    setCollectionValue(total)
  }

  async function fetchCollection() {
    setLoading(true)
    fetchActiveListings()
    const { data, error } = await supabase
      .from('collection_entries')
      .select(`
        id, read_status, user_rating, added_at,
        books ( id, title, author, cover_image_url, isbn_13, isbn_10, genre, published_year )
      `)
      .eq('user_id', session.user.id)
      .order('added_at', { ascending: false })

    if (!error) {
      setBooks(data || [])
      const ownedIds = (data || [])
        .filter(e => e.read_status === 'owned')
        .map(e => e.books.id)
      fetchCollectionValue(ownedIds)
    }
    setLoading(false)
  }

  const filtered = filter === 'all' ? books : books.filter(e => e.read_status === filter)

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
    content:        { padding: '28px 32px' },
    statsRow:       { display: 'flex', gap: 14, marginBottom: 28 },
    statCard:       { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '18px 22px', flex: 1, transition: 'box-shadow 0.15s' },
    statVal:        { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700 },
    statLabel:      { fontSize: 11, color: theme.textSubtle, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
    filterRow:      { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
    filterActive:   { padding: '7px 16px', borderRadius: 8, border: 'none', background: theme.rust, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    filterInactive: { padding: '7px 16px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    grid:           { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 24 },
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
    searchInput:    { flex: 1, padding: '9px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text },
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
        <div style={s.statsRow}>
          {[
            ['Total Books', stats.total,   null,      '📚'],
            ['Read',        stats.read,    '#5a7a5a', '✓'],
            ['Reading',     stats.reading, '#c0521e', '📖'],
            ['Want to Read',stats.want,    '#b8860b', '🔖'],
            ...(collectionValue !== null
              ? [['Est. Value', `$${collectionValue.toFixed(2)}`, '#5a7a5a', '💰']]
              : []),
          ].map(([label, val, color, icon]) => (
            <div key={label} style={s.statCard}>
              <div style={{ ...s.statVal, color: color || theme.text }}>{icon} {val}</div>
              <div style={s.statLabel}>{label}</div>
            </div>
          ))}
        </div>

        {/* Filter pills */}
        <div style={s.filterRow}>
          {['all', 'owned', 'read', 'reading', 'want'].map(f => (
            <button key={f} style={filter === f ? s.filterActive : s.filterInactive}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'All Books' : STATUS_LABELS[f]}
            </button>
          ))}
        </div>

        {/* Sort pills + Select toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
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
          <div style={{ marginLeft: 'auto' }}>
            <button
              style={selectMode ? s.filterActive : { ...s.filterInactive, borderColor: theme.gold, color: theme.gold }}
              onClick={toggleSelectMode}
            >
              {selectMode ? '✕ Cancel Select' : '✓ Select'}
            </button>
          </div>
        </div>

        {/* Import button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button style={{ ...s.filterInactive, color: theme.sage, borderColor: theme.sage }} onClick={() => setShowImport(true)}>
            📥 Import from Goodreads
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
                : 'No books with this status yet.'}
            </div>
            {books.length === 0 && (
              <button style={s.btnPrimary} onClick={() => setShowSearch(true)}>
                + Add your first book
              </button>
            )}
          </div>
        ) : (
          <div style={s.grid}>
            {sorted.map(entry => (
              <BookCard
                key={entry.id}
                entry={entry}
                listing={activeListings[entry.books.id] || null}
                onUpdate={fetchCollection}
                onSelect={() => {
                  if (selectMode) toggleSelect(entry.id)
                  else setSelectedBook(entry.books.id)
                }}
                onListForSale={() => setListingTarget(entry)}
                selectMode={selectMode}
                isSelected={selectedIds.has(entry.id)}
              />
            ))}
          </div>
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
            onBack={() => { setSelectedBook(null); fetchCollection() }}
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

// ---- BOOK CARD ----
function BookCard({ entry, listing, onUpdate, onSelect, onListForSale, selectMode, isSelected }) {
  const { theme } = useTheme()
  const book   = entry.books
  const status = entry.read_status
  const [menuOpen, setMenuOpen] = useState(false)
  const [hover, setHover] = useState(false)

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
      }}
      onClick={onSelect}
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
          return url
            ? <img src={url} alt={book.title} style={s.coverImg} onError={e => e.target.style.display='none'} />
            : <FakeCover title={book.title} />
        })()}
        {listing && (
          <div style={s.forSaleBadge}>${Number(listing.price).toFixed(2)}</div>
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

import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import BookDetail from './BookDetail'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { getCoverUrl } from '../lib/coverUrl'
import { computeStreak } from '../lib/streak'
import { computeBadges, TIER_STYLES, topEarnedByCategory } from '../lib/badges'
import { timeAgo } from '../lib/timeAgo'
import GlobalSearchModal from '../components/GlobalSearchModal'

// ── Grid sizes (out of 12 cols) ──────────────────────────────────────────
const SIZE_COLS = { small: 3, medium: 4, large: 6, wide: 8, full: 12 }
const SIZE_LABEL = { small: 'S', medium: 'M', large: 'L', wide: 'XL', full: 'Full' }
const SIZE_ORDER = ['small', 'medium', 'large', 'wide', 'full']

function effectiveSize(id, sizes) {
  return (sizes && sizes[id]) || WIDGET_BY_ID[id]?.size || 'medium'
}

// Single source of truth — both the rank lookup and atLeast() derive from it
const SIZE_RANK = Object.fromEntries(SIZE_ORDER.map((s, i) => [s, i + 1]))
function atLeast(size, min) { return SIZE_RANK[size] >= SIZE_RANK[min] }
function pickBySize(size, map) { return map[size] }

// Reusable cap maps so callers can `pickBySize(size, CAPS_LIST)` instead of
// allocating a fresh object literal each render.
const CAPS_LIST     = { small: 3, medium: 4, large: 6,  wide: 8,  full: 12 }
const CAPS_FEED     = { small: 3, medium: 5, large: 7,  wide: 9,  full: 12 }
const CAPS_BOOK_ROW = { small: 4, medium: 6, large: 10, wide: 14, full: 20 }

// Drag payload prefixes / sentinels — keep all three in one place so the
// stringly-typed drag protocol can't drift.
const DRAG = {
  MOVE: 'move:', ADD: 'add:',
  END:  '__end__',
}

// ── Widget catalog ───────────────────────────────────────────────────────
// `defaultHidden: true` → not shown until user adds it from the customize panel.
const WIDGETS = [
  { id: 'continue-reading', label: 'Continue Reading',     size: 'large'  },
  { id: 'goal',             label: 'Reading Goal',          size: 'small'  },
  { id: 'stats',            label: 'Stats',                 size: 'small'  },
  { id: 'nightstand',       label: 'On your Nightstand',    size: 'wide'   },
  { id: 'quote',            label: 'Quote of the Day',      size: 'medium' },
  { id: 'dispatches',       label: 'Dispatches (Friends)',  size: 'medium' },
  { id: 'this-week',        label: 'This Week',             size: 'medium' },
  { id: 'rediscover',       label: 'Rediscover',            size: 'medium' },
  { id: 'recently-added',   label: 'Recently Added',        size: 'medium', defaultHidden: true },
  { id: 'top-genres',       label: 'Top Genres',            size: 'medium', defaultHidden: true },
  { id: 'search',           label: 'Search',                size: 'small',  defaultHidden: true },
  { id: 'book-values',      label: 'Book Values',           size: 'small',  defaultHidden: true },
  { id: 'library-count',    label: 'Books in Library',      size: 'small',  defaultHidden: true },
  { id: 'random-book',      label: 'Random Book of the Day', size: 'medium', defaultHidden: true },
  { id: 'want-to-read',     label: 'Want to Read',          size: 'medium', defaultHidden: true },
  { id: 'marketplace',      label: 'Marketplace',           size: 'medium', defaultHidden: true },
  { id: 'loans',            label: 'Loans',                 size: 'medium', defaultHidden: true },
  { id: 'badges',           label: 'Badges',                size: 'medium', defaultHidden: true },
  { id: 'clubs',            label: 'Book Clubs',            size: 'medium', defaultHidden: true },
  { id: 'my-shelves',       label: 'My Shelves',            size: 'medium', defaultHidden: true },
]

const WIDGET_BY_ID = Object.fromEntries(WIDGETS.map(w => [w.id, w]))
const DEFAULT_ORDER  = WIDGETS.filter(w => !w.defaultHidden).map(w => w.id)
const DEFAULT_HIDDEN = WIDGETS.filter(w =>  w.defaultHidden).map(w => w.id)
const STORAGE_KEY = 'exlibris-home-layout-v1'

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN, sizes: {}, heights: {} }
    const parsed = JSON.parse(raw)
    const known = new Set(WIDGETS.map(w => w.id))
    const order  = (parsed.order  || []).filter(id => known.has(id))
    const hidden = (parsed.hidden || []).filter(id => known.has(id))
    const sizes  = {}
    if (parsed.sizes && typeof parsed.sizes === 'object') {
      for (const [id, s] of Object.entries(parsed.sizes)) {
        if (known.has(id) && SIZE_COLS[s]) sizes[id] = s
      }
    }
    const heights = {}
    if (parsed.heights && typeof parsed.heights === 'object') {
      for (const [id, h] of Object.entries(parsed.heights)) {
        if (known.has(id) && Number.isFinite(h) && h > 0) heights[id] = h
      }
    }
    // Backfill any new widgets that didn't exist when the layout was saved
    for (const w of WIDGETS) {
      if (!order.includes(w.id) && !hidden.includes(w.id)) {
        if (w.defaultHidden) hidden.push(w.id)
        else order.push(w.id)
      }
    }
    return { order, hidden, sizes, heights }
  } catch {
    return { order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN, sizes: {}, heights: {} }
  }
}
function saveLayout(layout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)) } catch {}
}

// ── Utils ────────────────────────────────────────────────────────────────
const COVER_GRADIENTS = [
  ['#7b4f3a', '#4a3028'], ['#4a6b8a', '#2c4a6b'], ['#5a7a5a', '#3a5a3a'],
  ['#7b3a4a', '#4a2030'], ['#b8860b', '#8b6508'], ['#3d5a5a', '#1f3328'],
]
function gradientFor(title) {
  const idx = ((title || '').charCodeAt(0) || 0) % COVER_GRADIENTS.length
  return COVER_GRADIENTS[idx]
}

// Centered empty-state pattern reused by Dispatches (no friends), Marketplace
// (no listings), Clubs (no clubs), Shelves (no shelves) — emoji + message + CTA.
function EmptyState({ theme, icon, message, ctaLabel, onCta }) {
  return (
    <div style={{ padding: '14px 0', textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 12, color: theme.textSubtle, marginBottom: ctaLabel ? 10 : 0 }}>{message}</div>
      {ctaLabel && onCta && (
        <button onClick={onCta} style={btnGhostStyle(theme)}>{ctaLabel}</button>
      )}
    </div>
  )
}

// Standard book cover with deterministic gradient fallback. Most card widgets
// render a small thumbnail this way (Nightstand, Recently Added, Want, etc.);
// the decorative tilted Hero stack stays bespoke. Callers should null-check
// `book` themselves — passing null here is undefined behavior.
function BookCover({ book, w, h, radius = 4, shadow, style, children }) {
  const [c, c2] = gradientFor(book.title || '')
  const cover = getCoverUrl(book)
  return (
    <div style={{
      width: w, height: h, borderRadius: radius, overflow: 'hidden', flexShrink: 0,
      background: `linear-gradient(135deg, ${c}, ${c2})`,
      position: 'relative',
      ...(shadow && { boxShadow: shadow }),
      ...style,
    }}>
      {cover && (
        <img src={cover} alt={book.title || ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={e => e.target.style.display = 'none'} />
      )}
      {children}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// MAIN HOME COMPONENT
// ════════════════════════════════════════════════════════════════════════
export default function Home({ session }) {
  const navigate = useNavigate()
  const { theme, isDark } = useTheme()
  const isMobile = useIsMobile()

  const [layout, setLayout] = useState(loadLayout)
  const [editMode, setEditMode] = useState(false)
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [selectedBook, setSelectedBook] = useState(null)
  const [showSearch, setShowSearch] = useState(false)

  // Live drag preview: while a drag is in flight, the layout reorders to show
  // exactly where the dragged widget will land. The dragged widget renders as
  // a ghost at its destination so users can see "this is where it goes."
  const [dragState, setDragState] = useState(null)       // { id, source: 'order' | 'add' }
  const [dropTargetId, setDropTargetId] = useState(null) // a widget id, or DRAG.END
  function startDrag(id, source) { setDragState({ id, source }); setDropTargetId(null) }
  // Functional setter — `dragOver` fires ~60Hz, this skips the React update
  // (and downstream re-render) when the hover target hasn't actually changed.
  function setDragHover(targetId) { setDropTargetId(prev => prev === targetId ? prev : targetId) }
  function endDrag() { setDragState(null); setDropTargetId(null) }

  // Visual order during a drag — DOM order stays as `layout.order`, CSS
  // `order` reshuffles items visually. Memoized so we don't re-allocate on
  // every render of the (often re-rendering) Home component.
  const visualOrder = useMemo(() => {
    if (!dragState?.id || isMobile || !dropTargetId) return layout.order
    const without = layout.order.filter(x => x !== dragState.id)
    if (dropTargetId === DRAG.END || dropTargetId === dragState.id) {
      return [...without, dragState.id]
    }
    const idx = without.indexOf(dropTargetId)
    if (idx < 0) return [...without, dragState.id]
    return [...without.slice(0, idx), dragState.id, ...without.slice(idx)]
  }, [dragState, dropTargetId, layout.order, isMobile])

  const [data, setData] = useState({ loading: true })

  // `persist: false` skips the localStorage write — used during the per-frame
  // resize drag, so we don't stringify+write the whole layout 60×/sec.
  function updateLayout(next, { persist = true } = {}) {
    setLayout(next)
    if (persist) saveLayout(next)
  }
  function hideWidget(id) {
    if (layout.hidden.includes(id)) return
    updateLayout({ ...layout, order: layout.order.filter(x => x !== id), hidden: [...layout.hidden, id] })
  }
  function showWidget(id) {
    if (layout.order.includes(id)) return
    updateLayout({ ...layout, order: [...layout.order, id], hidden: layout.hidden.filter(x => x !== id) })
  }
  function showAllHidden() {
    if (!layout.hidden.length) return
    updateLayout({ ...layout, order: [...layout.order, ...layout.hidden], hidden: [] })
  }
  function moveWidget(fromId, toId) {
    if (!fromId || fromId === toId) return
    const next = [...layout.order]
    const fromIdx = next.indexOf(fromId)
    const toIdx   = next.indexOf(toId)
    if (fromIdx < 0 || toIdx < 0) return
    next.splice(fromIdx, 1)
    next.splice(toIdx, 0, fromId)
    updateLayout({ ...layout, order: next })
  }
  function moveWidgetDir(id, dir) {
    const next = [...layout.order]
    const i = next.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    updateLayout({ ...layout, order: next })
  }
  // Insert a hidden widget at a specific position in the visible order.
  // toId === null → append to the end.
  function addAt(id, toId) {
    if (!layout.hidden.includes(id) || layout.order.includes(id)) return
    const nextOrder = [...layout.order]
    if (toId == null) {
      nextOrder.push(id)
    } else {
      const toIdx = nextOrder.indexOf(toId)
      if (toIdx < 0) nextOrder.push(id)
      else nextOrder.splice(toIdx, 0, id)
    }
    updateLayout({ ...layout, order: nextOrder, hidden: layout.hidden.filter(x => x !== id) })
  }
  function setWidgetSize(id, size) {
    if (!SIZE_COLS[size]) return
    const sizes = { ...(layout.sizes || {}), [id]: size }
    updateLayout({ ...layout, sizes })
  }
  function setWidgetHeight(id, h, options) {
    const heights = { ...(layout.heights || {}) }
    if (h == null) delete heights[id]
    else heights[id] = Math.max(80, Math.round(h))
    updateLayout({ ...layout, heights }, options)
  }
  function resetLayout() {
    updateLayout({ order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN, sizes: {}, heights: {} })
  }

  useEffect(() => { if (session?.user?.id) fetchAll() }, [session?.user?.id])
  useEffect(() => {
    function onChange() { fetchAll() }
    window.addEventListener('exlibris:bookAdded',   onChange)
    window.addEventListener('exlibris:bookRemoved', onChange)
    return () => {
      window.removeEventListener('exlibris:bookAdded',   onChange)
      window.removeEventListener('exlibris:bookRemoved', onChange)
    }
  }, [])

  async function fetchAll() {
    const userId = session.user.id

    // Friend IDs first — many of the parallel queries below are .in(friendIds).
    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    const friendIds = (friendships || [])
      .map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)

    const year = new Date().getFullYear()
    const [
      profileRes, collectionRes, sessionsRes,
      challengeRes, friendsPostsRes, friendsActivityRes,
      friendProfilesRes, quotesRes, borrowsRes, buddyReadsRes,
      myListingsRes, clubsRes, shelvesRes,
    ] = await Promise.all([
      supabase.from('profiles').select('username, avatar_url, level, level_points').eq('id', userId).maybeSingle(),
      supabase.from('collection_entries')
        .select('id, read_status, current_page, added_at, has_read, books(id, title, author, cover_image_url, isbn_13, isbn_10, pages, genre)')
        .eq('user_id', userId)
        .order('added_at', { ascending: false })
        .limit(2000),
      supabase.from('reading_sessions')
        .select('pages_read, started_at, ended_at')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .not('pages_read', 'is', null),
      supabase.from('reading_challenges')
        .select('*')
        .eq('user_id', userId)
        .eq('year', year)
        .is('month', null)
        .eq('challenge_type', 'books_count')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      friendIds.length
        ? supabase.from('reading_posts')
            .select(`id, user_id, content, post_type, created_at,
              books(id, title, author, cover_image_url, isbn_13, isbn_10),
              profiles!reading_posts_user_id_fkey(username, avatar_url)`)
            .in('user_id', friendIds)
            .order('created_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [] }),
      friendIds.length
        ? supabase.from('collection_entries')
            .select('id, user_id, read_status, added_at, books(id, title, author, cover_image_url, isbn_13, isbn_10)')
            .in('user_id', friendIds)
            .order('added_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [] }),
      friendIds.length
        ? supabase.from('profiles').select('id, username, avatar_url').in('id', friendIds)
        : Promise.resolve({ data: [] }),
      supabase.from('book_quotes')
        .select('id, quote_text, page_number, note, books(id, title, author)')
        .eq('user_id', userId).limit(80),
      supabase.from('borrow_requests')
        .select('id, status, due_date, requester_id, owner_id, books(id, title, author, cover_image_url)')
        .or(`requester_id.eq.${userId},owner_id.eq.${userId}`)
        .eq('status', 'active'),
      supabase.from('buddy_read_participants')
        .select('buddy_reads(id, title, target_finish, status, books(id, title, author, cover_image_url))')
        .eq('user_id', userId),
      supabase.from('listings')
        .select('id, price, condition, created_at, books(id, title, author, cover_image_url)')
        .eq('seller_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('book_club_members')
        .select('role, book_clubs(id, name, description, current_book_id, books:current_book_id(id, title, author, cover_image_url), book_club_members(count))')
        .eq('user_id', userId)
        .limit(20),
      supabase.from('shelves')
        .select('id, name, color, shelf_books(count)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    // Valuations is a follow-up query — its filter requires the entries result.
    const entriesData = collectionRes.data || []
    const ownedBookIds = entriesData.filter(e => e.read_status !== 'want' && e.books?.id).map(e => e.books.id)
    const { data: valuationRows = [] } = ownedBookIds.length
      ? await supabase.from('valuations').select('book_id, list_price, avg_price').in('book_id', ownedBookIds)
      : { data: [] }

    const raw = {
      profileRes, collectionRes, sessionsRes, challengeRes,
      friendsPostsRes, friendsActivityRes, friendProfilesRes,
      quotesRes, borrowsRes, buddyReadsRes,
      myListingsRes, clubsRes, shelvesRes,
    }
    setData({ loading: false, ...deriveHomeData(raw, userId, friendIds, valuationRows) })
  }

  if (data.loading) {
    return (
      <div style={{ background: theme.bg, minHeight: '100vh' }}>
        <NavBar session={session} />
        <div style={{ padding: 60, textAlign: 'center', color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}>
          Loading your card catalog…
        </div>
      </div>
    )
  }

  // ── Render widget by id ──
  // Each widget receives `data`, `theme`, and a per-card-type `size`. Common
  // navigation callbacks (onOpen, goLibrary, goStats) are pre-bound so the
  // switch arms only carry what's actually unique to each widget.
  function renderWidgetBody(id) {
    const c = { data, theme, size: effectiveSize(id, layout.sizes) }
    const open = (b) => setSelectedBook(b)
    const goStats = () => navigate('/stats')
    const goLibrary = () => navigate('/')
    switch (id) {
      case 'continue-reading': return <HeroWidget         {...c} onOpen={open} />
      case 'goal':             return <GoalWidget         {...c} onSetGoal={goStats} />
      case 'stats':            return <StatsWidget        {...c} onOpen={goStats} />
      case 'nightstand':       return <NightstandWidget   {...c} onOpen={open} onSeeAll={goLibrary} />
      case 'quote':            return <QuoteWidget        {...c} onOpen={open} />
      case 'dispatches':       return <DispatchesWidget   {...c} onOpen={open} onProfile={(u) => navigate(`/profile/${u}`)} onFeed={() => navigate('/feed')} onFindFriends={() => navigate('/friends')} />
      case 'this-week':        return <ThisWeekWidget     {...c} navigate={navigate} />
      case 'rediscover':       return <RediscoverWidget   {...c} onOpen={open} />
      case 'recently-added':   return <RecentlyAddedWidget {...c} onOpen={open} onSeeAll={goLibrary} />
      case 'top-genres':       return <TopGenresWidget    {...c} onOpen={goStats} />
      case 'search':           return <SearchWidget       theme={theme} size={c.size} onOpen={() => setShowSearch(true)} />
      case 'book-values':      return <BookValuesWidget   {...c} onOpen={goStats} />
      case 'library-count':    return <LibraryCountWidget {...c} onOpen={goLibrary} />
      case 'random-book':      return <RandomBookWidget   {...c} onOpen={open} />
      case 'want-to-read':     return <WantToReadWidget   {...c} onOpen={open} onSeeAll={() => navigate('/?filter=want')} />
      case 'marketplace':      return <MarketplaceWidget  {...c} onOpen={open} onSeeAll={() => navigate('/marketplace')} />
      case 'loans':            return <LoansWidget        {...c} onSeeAll={() => navigate('/loans')} onOpen={open} />
      case 'badges':           return <BadgesWidget       {...c} onSeeAll={goStats} />
      case 'clubs':            return <ClubsWidget        {...c} onSeeAll={() => navigate('/clubs')} onOpen={open} />
      case 'my-shelves':       return <MyShelvesWidget    {...c} onSeeAll={() => navigate('/shelves')} />
      default: return null
    }
  }

  return (
    <div style={{ background: theme.bg, minHeight: '100vh' }}>
      <NavBar session={session} />

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '14px 14px 28px' : '20px 24px 40px' }}>

        {/* Page header / customize toolbar */}
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          padding: '4px 0 14px', marginBottom: 14,
          borderBottom: `1px solid ${theme.borderLight}`, gap: 12, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: isMobile ? 20 : 22, color: theme.text, letterSpacing: '-0.3px', lineHeight: 1.1 }}>
              {greetingForHour(new Date().getHours(), data.profile?.username)}
            </div>
            <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>
              {data.profile?.username ? `${data.profile.username}'s card catalog` : 'Your card catalog'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {editMode && (
              <button
                onClick={() => setShowAddPanel(true)}
                style={btnGhostStyle(theme)}>
                + Add card
              </button>
            )}
            <button
              onClick={() => { setEditMode(v => !v); setShowAddPanel(false) }}
              style={editMode ? btnPrimaryStyle(theme) : btnGhostStyle(theme)}>
              {editMode ? 'Done' : '⚙ Customize'}
            </button>
          </div>
        </div>

        {/* Hidden-widgets panel (only in edit mode and only if user clicks Add) */}
        {editMode && showAddPanel && (
          <AddPanel
            theme={theme}
            hidden={layout.hidden}
            isMobile={isMobile}
            dragState={dragState}
            onAdd={(id) => showWidget(id)}
            onAddAll={() => { showAllHidden(); setShowAddPanel(false) }}
            onReset={() => { resetLayout(); setShowAddPanel(false) }}
            onClose={() => setShowAddPanel(false)}
            onRemove={(id) => hideWidget(id)}
            onDragStartFire={startDrag}
            onDragEndFire={endDrag}
          />
        )}

        {/* The grid — DOM order = layout.order (stable so drag doesn't abort).
            During a drag, CSS `order` is used to shift siblings visually. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(12, 1fr)',
          gridAutoRows: 'auto',
          alignItems: 'stretch',
          gap: 14,
        }}>
          {layout.order.map((id, idx) => {
            const w = WIDGET_BY_ID[id]
            if (!w) return null
            const size = effectiveSize(id, layout.sizes)
            const span = isMobile ? 1 : SIZE_COLS[size]
            const isGhost = dragState?.id === id
            const visualIdx = visualOrder.indexOf(id)
            return (
              <WidgetFrame
                key={id}
                id={id}
                w={w}
                size={size}
                span={span}
                order={visualIdx >= 0 ? visualIdx : idx}
                minHeightPx={layout.heights?.[id]}
                editMode={editMode}
                isMobile={isMobile}
                isFirst={idx === 0}
                isLast={idx === layout.order.length - 1}
                theme={theme}
                ghost={isGhost}
                isDragging={isGhost}
                onMoveUp={() => moveWidgetDir(id, -1)}
                onMoveDown={() => moveWidgetDir(id, +1)}
                onHide={() => hideWidget(id)}
                onSize={(s) => setWidgetSize(id, s)}
                onResize={(h, opts) => setWidgetHeight(id, h, opts)}
                onDragStartFire={startDrag}
                onDragEnterFire={setDragHover}
                onDragEndFire={endDrag}
                onDropOn={(payload) => {
                  if (payload.startsWith(DRAG.ADD)) addAt(payload.slice(DRAG.ADD.length), id)
                  else if (payload.startsWith(DRAG.MOVE)) moveWidget(payload.slice(DRAG.MOVE.length), id)
                }}
              >
                {renderWidgetBody(id)}
              </WidgetFrame>
            )
          })}
          {/* Ghost preview for Add-panel drags. The card isn't in layout.order
              yet, so we render the actual card body at its destination slot
              (reduced opacity + dashed outline) so users see exactly the size
              and content they'll be dropping in. The ghost is itself a drop
              target — when the user hovers a grid card, the ghost slots in
              where that card was, and their cursor ends up over the ghost.
              Without onDrop here, drops on the visual destination would miss. */}
          {dragState?.source === 'add' && dropTargetId && (() => {
            const w = WIDGET_BY_ID[dragState.id]
            if (!w) return null
            const size = effectiveSize(dragState.id, layout.sizes)
            const span = SIZE_COLS[size]
            const visualIdx = visualOrder.indexOf(dragState.id)
            return (
              <div
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  const targetId = dropTargetId === DRAG.END ? null : dropTargetId
                  addAt(dragState.id, targetId)
                  endDrag()
                }}
                style={{
                  gridColumn: `span ${span}`,
                  order: visualIdx >= 0 ? visualIdx : layout.order.length,
                  position: 'relative',
                  borderRadius: 14,
                  outline: `2px dashed ${theme.rust}`,
                  outlineOffset: -2,
                  opacity: 0.6,
                  display: 'flex', flexDirection: 'column', minWidth: 0,
                }}>
                {/* Inner wrapper takes pointer-events:none so dragover events
                    bubble straight to the outer ghost div, not to the inner
                    card body's interactive children. */}
                <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
                  {renderWidgetBody(dragState.id)}
                </div>
                <div style={{
                  position: 'absolute', top: 8, left: 8,
                  padding: '3px 8px', borderRadius: 8,
                  background: theme.rust, color: 'white',
                  fontSize: 10, fontWeight: 700, fontVariant: 'small-caps', letterSpacing: '0.12em',
                  fontFamily: "'DM Sans', sans-serif", boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                  pointerEvents: 'none',
                }}>
                  Drop to add
                </div>
              </div>
            )
          })()}
          {editMode && layout.hidden.length > 0 && !isMobile && (
            <EndDropZone
              theme={theme}
              order={layout.order.length + 100}
              onDragEnterFire={setDragHover}
              onDragEndFire={endDrag}
              onDrop={(payload) => {
                if (payload.startsWith(DRAG.ADD)) addAt(payload.slice(DRAG.ADD.length), null)
              }}
            />
          )}
        </div>

        {layout.order.length === 0 && (
          <div style={{
            background: theme.bgCard, border: `1px dashed ${theme.border}`, borderRadius: 14,
            padding: '32px 20px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 8 }}>
              Your card catalog is empty
            </div>
            <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 14, fontFamily: "'DM Sans', sans-serif" }}>
              Add some cards to fill it up.
            </div>
            <button onClick={() => { setEditMode(true); setShowAddPanel(true) }} style={btnPrimaryStyle(theme)}>+ Add card</button>
          </div>
        )}
      </div>

      {selectedBook && (
        <div style={{ position: 'fixed', inset: 0, background: theme.bg, zIndex: 40, overflowY: 'auto', isolation: 'isolate' }}>
          <BookDetail
            bookId={selectedBook}
            session={session}
            onBack={() => { setSelectedBook(null); fetchAll() }}
          />
        </div>
      )}

      {showSearch && (
        <GlobalSearchModal session={session} onClose={() => setShowSearch(false)} />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// WIDGET FRAME — wraps each widget with edit-mode chrome (drag, hide, ↑↓, resize)
// ════════════════════════════════════════════════════════════════════════
function WidgetFrame({
  id, w, size, span, order, minHeightPx,
  editMode, isMobile, isFirst, isLast, theme,
  ghost, isDragging,
  onMoveUp, onMoveDown, onHide, onSize, onDropOn,
  onResize,
  onDragStartFire, onDragEnterFire, onDragEndFire,
  children,
}) {
  return (
    <div
      style={{
        gridColumn: isMobile ? '1 / -1' : `span ${span}`,
        order: order ?? 0,
        position: 'relative',
        minWidth: 0,
        minHeight: minHeightPx ? `${minHeightPx}px` : undefined,
        display: 'flex', flexDirection: 'column',
        opacity: ghost ? 0.45 : 1,
        outline: ghost ? `2px dashed ${theme.rust}` : 'none',
        outlineOffset: -2,
        borderRadius: 14,
        transition: 'opacity 0.15s ease, outline 0.1s ease',
      }}
      draggable={editMode && !isMobile}
      onDragStart={editMode ? (e) => {
        e.dataTransfer.setData('text/plain', DRAG.MOVE + id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStartFire?.(id, 'order')
      } : undefined}
      onDragOver={editMode ? (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!isDragging) onDragEnterFire?.(id)
      } : undefined}
      onDragEnd={editMode ? () => onDragEndFire?.() : undefined}
      onDrop={editMode ? (e) => {
        e.preventDefault(); e.stopPropagation()
        const payload = e.dataTransfer.getData('text/plain') || ''
        onDropOn(payload.includes(':') ? payload : DRAG.MOVE + payload)
        onDragEndFire?.()
      } : undefined}
    >
      {/* Wrapper forces children to fill the WidgetFrame height so widgets in
          the same row visually match the tallest item's height. */}
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>

      {editMode && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 5,
          display: 'flex', gap: 4,
        }}>
          {isMobile && (
            <>
              <IconBtn theme={theme} disabled={isFirst} onClick={onMoveUp}  title="Move up">↑</IconBtn>
              <IconBtn theme={theme} disabled={isLast}  onClick={onMoveDown} title="Move down">↓</IconBtn>
            </>
          )}
          {!isMobile && <SizeChip theme={theme} size={size} onSize={onSize} />}
          <IconBtn theme={theme} onClick={onHide} title="Hide card" danger>×</IconBtn>
        </div>
      )}
      {editMode && !isMobile && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 5,
          padding: '4px 8px', background: theme.bgCard, border: `1px solid ${theme.border}`,
          borderRadius: 8, fontSize: 11, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif",
          cursor: 'grab', userSelect: 'none',
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
        }}>
          ⋮⋮ {w.label}
        </div>
      )}
      {editMode && isMobile && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 5,
          padding: '3px 8px', background: theme.bgCard, border: `1px solid ${theme.border}`,
          borderRadius: 8, fontSize: 10, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif",
          textTransform: 'uppercase', letterSpacing: 0.4,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {w.label}
          <SizeChip theme={theme} size={size} onSize={onSize} compact />
        </div>
      )}
      {editMode && !isMobile && onResize && (
        <ResizeHandle theme={theme} onResize={onResize} minHeightPx={minHeightPx} />
      )}
    </div>
  )
}

// Drag the south edge of a widget to set its min-height. Because Card and the
// custom containers all flex-fill, growing one widget grows the whole row
// (siblings stretch via the flex chain). During the drag we update React state
// for live feedback but skip the localStorage write — only the final height on
// mouseup is persisted, so we don't stringify+write the layout 60×/sec.
function ResizeHandle({ theme, onResize, minHeightPx }) {
  const [resizing, setResizing] = useState(false)
  const startY = useRef(0)
  const startH = useRef(0)
  const containerRef = useRef(null)
  const activeRef = useRef(null) // { onMove, onUp } when a drag is in flight

  // Cleanup: if we unmount mid-resize (e.g. user toggles edit mode off), we
  // must yank the window listeners we attached in onMouseDown.
  useEffect(() => () => {
    if (activeRef.current) {
      window.removeEventListener('mousemove', activeRef.current.onMove)
      window.removeEventListener('mouseup',   activeRef.current.onUp)
      activeRef.current = null
    }
  }, [])

  function onMouseDown(e) {
    e.preventDefault()
    e.stopPropagation()
    startY.current = e.clientY
    const parent = containerRef.current?.parentElement
    startH.current = minHeightPx || (parent ? parent.getBoundingClientRect().height : 200)
    setResizing(true)

    const onMove = (ev) => {
      onResize(startH.current + (ev.clientY - startY.current), { persist: false })
    }
    const onUp = (ev) => {
      onResize(startH.current + (ev.clientY - startY.current)) // commit + persist
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      activeRef.current = null
    }
    activeRef.current = { onMove, onUp }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }

  function onDoubleClick() { onResize(null) }

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title="Drag to resize · double-click to auto-size"
      style={{
        position: 'absolute', left: '50%', bottom: -4,
        transform: 'translateX(-50%)',
        width: 44, height: 10, cursor: 'ns-resize',
        zIndex: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <div style={{
        width: 36, height: 4, borderRadius: 2,
        background: resizing ? theme.rust : theme.border,
        boxShadow: resizing ? `0 0 0 1px ${theme.rust}40` : 'none',
        transition: 'background 0.1s',
      }} />
    </div>
  )
}

function SizeChip({ theme, size, onSize, compact }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    function onClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Resize"
        style={{
          height: compact ? 20 : 26, padding: compact ? '0 6px' : '0 8px', borderRadius: 7,
          background: theme.bgCard, border: `1px solid ${theme.border}`,
          color: theme.text, fontSize: compact ? 10 : 11, lineHeight: 1, cursor: 'pointer',
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 3,
        }}>
        {SIZE_LABEL[size]} ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 6,
          background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.14)', padding: 4,
          display: 'flex', flexDirection: 'column', gap: 2, minWidth: 90,
        }}>
          {SIZE_ORDER.map(s => (
            <button key={s}
              onClick={() => { onSize(s); setOpen(false) }}
              style={{
                padding: '6px 10px', background: s === size ? theme.bgSubtle : 'transparent',
                border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                fontFamily: "'DM Sans', sans-serif", fontSize: 12,
                color: s === size ? theme.rust : theme.text,
                fontWeight: s === size ? 600 : 400,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}>
              <span>{SIZE_LABEL[s]}</span>
              <span style={{ fontSize: 10, color: theme.textSubtle }}>{SIZE_COLS[s]} cols</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// — End-of-grid drop zone for adding widgets at the end ─────────────────
function EndDropZone({ theme, order, onDrop, onDragEnterFire, onDragEndFire }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true)
        onDragEnterFire?.(DRAG.END)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); setOver(false)
        const payload = e.dataTransfer.getData('text/plain') || ''
        if (payload) onDrop(payload)
        onDragEndFire?.()
      }}
      style={{
        gridColumn: 'span 12',
        order: order ?? 9999,
        minHeight: 70,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `2px dashed ${over ? theme.rust : theme.border}`,
        background: over ? `${theme.rust}10` : 'transparent',
        borderRadius: 14,
        color: over ? theme.rust : theme.textSubtle,
        fontFamily: "'DM Sans', sans-serif", fontSize: 12,
        transition: 'all 0.1s',
      }}>
      Drop a card here to add at the end
    </div>
  )
}

function IconBtn({ children, onClick, title, danger, disabled, theme }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 26, height: 26, borderRadius: 7,
        background: theme.bgCard, border: `1px solid ${theme.border}`,
        color: danger ? theme.rust : theme.text,
        fontSize: 14, lineHeight: 1, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
      }}>
      {children}
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════
// ADD PANEL — re-add hidden widgets, reset layout
// ════════════════════════════════════════════════════════════════════════
function AddPanel({ theme, hidden, isMobile, dragState, onAdd, onAddAll, onReset, onClose, onRemove, onDragStartFire, onDragEndFire }) {
  const hiddenWidgets = hidden.map(id => WIDGET_BY_ID[id]).filter(Boolean)
  // Drag-to-remove: when an existing card is being dragged, the panel itself
  // becomes a drop target. Drop on it to hide the card.
  const acceptsRemove = dragState?.source === 'order'
  const [removeOver, setRemoveOver] = useState(false)
  return (
    <div
      onDragOver={acceptsRemove ? (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setRemoveOver(true)
      } : undefined}
      onDragLeave={acceptsRemove ? () => setRemoveOver(false) : undefined}
      onDrop={acceptsRemove ? (e) => {
        e.preventDefault()
        setRemoveOver(false)
        const payload = e.dataTransfer.getData('text/plain') || ''
        if (payload.startsWith(DRAG.MOVE)) onRemove?.(payload.slice(DRAG.MOVE.length))
        onDragEndFire?.()
      } : undefined}
      style={{
        background: removeOver ? `${theme.rust}10` : theme.bgCard,
        border: removeOver ? `2px dashed ${theme.rust}` : `1px solid ${theme.border}`,
        borderRadius: 14,
        padding: removeOver ? '13px 15px' : '14px 16px', // border 1→2px, compensate so layout doesn't jump
        marginBottom: 14, fontFamily: "'DM Sans', sans-serif",
        transition: 'background 0.1s, border-color 0.1s',
      }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6, gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{
            fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 15,
            color: acceptsRemove ? theme.rust : theme.text,
            transition: 'color 0.1s',
          }}>
            {acceptsRemove ? 'Drop here to remove' : 'Add a card'}
          </div>
          {!isMobile && !acceptsRemove && hiddenWidgets.length > 0 && (
            <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 11, color: theme.textSubtle, marginTop: 2 }}>
              Drag onto the catalog to drop at a spot, or tap to append.
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {hiddenWidgets.length > 1 && onAddAll && (
            <button
              onClick={onAddAll}
              style={{ ...btnPrimaryStyle(theme), padding: '5px 11px', fontSize: 11 }}>
              + Add all {hiddenWidgets.length}
            </button>
          )}
          <button onClick={onReset} style={{ ...btnGhostStyle(theme), padding: '5px 11px', fontSize: 11 }}>Reset to default</button>
          <button onClick={onClose} style={{ ...btnGhostStyle(theme), padding: '5px 11px', fontSize: 11 }}>Close</button>
        </div>
      </div>
      {hiddenWidgets.length === 0 ? (
        <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 8 }}>
          All cards are showing. Hide one with the × button to put it back here.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 8 }}>
          {hiddenWidgets.map(w => (
            <AddPanelChip
              key={w.id} w={w} theme={theme} isMobile={isMobile} onAdd={onAdd}
              onDragStartFire={onDragStartFire}
              onDragEndFire={onDragEndFire}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AddPanelChip({ w, theme, isMobile, onAdd, onDragStartFire, onDragEndFire }) {
  const [dragging, setDragging] = useState(false)
  return (
    <button
      onClick={() => onAdd(w.id)}
      draggable={!isMobile}
      onDragStart={!isMobile ? (e) => {
        e.dataTransfer.setData('text/plain', DRAG.ADD + w.id)
        // 'all' so any drop target's `dropEffect` is acceptable. Browsers can
        // reject a drop when target dropEffect isn't a subset of source
        // effectAllowed, and the various grid targets use different values.
        e.dataTransfer.effectAllowed = 'all'
        setDragging(true)
        onDragStartFire?.(w.id, 'add')
      } : undefined}
      onDragEnd={!isMobile ? () => { setDragging(false); onDragEndFire?.() } : undefined}
      title={isMobile ? 'Add to catalog' : 'Drag onto the catalog, or click to append'}
      style={{
        padding: '10px 12px', background: theme.bgSubtle,
        border: `1px dashed ${theme.border}`,
        borderRadius: 10, cursor: isMobile ? 'pointer' : 'grab', textAlign: 'left',
        fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: theme.text,
        opacity: dragging ? 0.5 : 1,
        display: 'flex', alignItems: 'center', gap: 8,
        minHeight: 52, lineHeight: 1.25,
      }}>
      {!isMobile && <span style={{ color: theme.textSubtle, fontSize: 13, lineHeight: 1, flexShrink: 0 }}>⋮⋮</span>}
      <span>{w.label}</span>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════
// WIDGETS
// ════════════════════════════════════════════════════════════════════════

// — Hero / Continue Reading ─────────────────────────────────────────────
function HeroWidget({ data, theme, size = 'large', onOpen }) {
  const lead = data.reading[0]
  // Stack renders highest index on top (zIndex: 2), so reverse so reading[0]
  // — the lead the title/progress copy refers to — ends up centered in front.
  const stack = (data.reading.slice(0, 3).length ? data.reading.slice(0, 3) : data.want.slice(0, 3))
    .map(e => e.books).filter(Boolean)
    .reverse()
  const total = lead?.books?.pages || 0
  const cur = lead?.current_page || 0
  const pct = total ? Math.min(100, Math.round((cur / total) * 100)) : 0

  const showStack = atLeast(size, 'medium')
  return (
    <div style={{
      background: theme.heroBg, color: '#f5f0e8', borderRadius: 14,
      padding: '20px 22px', position: 'relative', overflow: 'hidden',
      display: 'grid',
      gridTemplateColumns: showStack ? 'auto minmax(0, 1fr)' : '1fr',
      gap: 22, alignItems: 'center',
      boxShadow: theme.shadowCard, minHeight: 200,
      width: '100%', height: '100%', boxSizing: 'border-box',
    }}>
      {/* Background dot pattern */}
      <svg viewBox="0 0 600 220" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, opacity: 0.16, pointerEvents: 'none' }}>
        <defs>
          <pattern id="hero-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="0.9" fill="#f5f0e8" />
          </pattern>
          <radialGradient id="hero-rays" cx="85%" cy="50%" r="55%">
            <stop offset="0%" stopColor={theme.rust} stopOpacity="0.5" />
            <stop offset="100%" stopColor={theme.rust} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="600" height="220" fill="url(#hero-dots)" opacity="0.3" />
        <circle cx="510" cy="110" r="140" fill="url(#hero-rays)" />
      </svg>

      {/* Book stack — hidden at small size to keep the copy readable */}
      {showStack && (
        <div style={{ position: 'relative', width: 130, height: 170, flexShrink: 0 }}>
          <div style={{
            position: 'absolute', left: '50%', top: '-4px', width: 14, height: 50,
            background: `linear-gradient(180deg, ${theme.rust}, #8a3a14)`,
            transform: 'translateX(-50%) translateX(22px) rotate(-2deg)',
            zIndex: 3, boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
          }} />
          {stack.length > 0 ? (
            stack.map((b, i) => (
              <StackBook key={b.id} book={b} index={i} onClick={() => onOpen(b.id)} />
            ))
          ) : (
            <FallbackStack theme={theme} />
          )}
        </div>
      )}

      {/* Copy */}
      <div style={{ minWidth: 0, position: 'relative' }}>
        <div style={{ fontSize: 10, fontVariant: 'small-caps', letterSpacing: '0.2em', color: 'rgba(245,240,232,0.6)', fontWeight: 600, marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>
          {lead ? 'Pick up where you left off' : 'Start something new'}
        </div>
        <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 22, lineHeight: 1.2, marginBottom: 4, letterSpacing: '-0.3px' }}>
          {lead?.books?.title || 'Add a book to get started'}
        </div>
        {lead?.books?.author && (
          <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 12, color: 'rgba(245,240,232,0.65)', marginBottom: 12 }}>
            {lead.books.author}
            {total > 0 && cur > 0 ? <> · {Math.max(0, total - cur)} pages left</> : null}
          </div>
        )}
        {lead && total > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, fontSize: 11, color: 'rgba(245,240,232,0.7)' }}>
              <span style={{ fontVariant: 'small-caps', letterSpacing: '0.15em' }}>page {cur} / {total}</span>
              <b style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 16, letterSpacing: '-0.2px', color: '#f5f0e8' }}>{pct}%</b>
            </div>
            <div style={{ height: 5, background: 'rgba(245,240,232,0.15)', borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${theme.rust}, ${theme.gold})`, borderRadius: 999 }} />
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {lead ? (
            <button onClick={() => onOpen(lead.books.id)} style={btnCreamStyle()}>Continue →</button>
          ) : (
            <button onClick={() => window.dispatchEvent(new Event('exlibris:open-add'))} style={btnCreamStyle()}>+ Add a book</button>
          )}
          {lead && (
            <button onClick={() => onOpen(lead.books.id)} style={btnCreamOutStyle()}>Details</button>
          )}
        </div>
      </div>
    </div>
  )
}

function StackBook({ book, index, onClick }) {
  const [c, c2] = gradientFor(book.title)
  const cover = getCoverUrl(book)
  const transforms = [
    'translate(-50%, -50%) rotate(-9deg) translate(-18px, 10px)',
    'translate(-50%, -50%) rotate(4deg)  translate(14px, 4px)',
    'translate(-50%, -50%) rotate(-2deg) translate(0, -6px)',
  ]
  const bgs = [
    `linear-gradient(135deg, ${c}, ${c2})`,
    `linear-gradient(135deg, #7b3a4a, #4a2030)`,
    `linear-gradient(135deg, ${c}, ${c2})`,
  ]
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute', left: '50%', top: '50%', width: 92, height: 140,
        borderRadius: 3, boxShadow: '4px 8px 18px rgba(0,0,0,0.5)',
        background: bgs[index] || bgs[0], transform: transforms[index] || transforms[0],
        zIndex: index === 2 ? 2 : 1, cursor: 'pointer', overflow: 'hidden',
      }}>
      {cover ? (
        <img src={cover} alt={book.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={e => e.target.style.display = 'none'} />
      ) : (
        <div style={{ position: 'absolute', inset: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'rgba(255,255,255,0.95)', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 10, lineHeight: 1.2 }}>{book.title}</div>
          {book.author && <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 8, color: 'rgba(255,255,255,0.75)', marginTop: 3 }}>{book.author}</div>}
        </div>
      )}
      {/* book spine highlight */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'rgba(0,0,0,0.3)', borderRadius: '3px 0 0 3px' }} />
    </div>
  )
}

function FallbackStack({ theme }) {
  return (
    <>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 92, height: 140, borderRadius: 3, background: 'linear-gradient(135deg, #4a6b8a, #2c4a6b)', transform: 'translate(-50%, -50%) rotate(-9deg) translate(-18px, 10px)', boxShadow: '4px 8px 18px rgba(0,0,0,0.5)' }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 92, height: 140, borderRadius: 3, background: 'linear-gradient(135deg, #7b3a4a, #4a2030)', transform: 'translate(-50%, -50%) rotate(4deg) translate(14px, 4px)', boxShadow: '4px 8px 18px rgba(0,0,0,0.5)' }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 92, height: 140, borderRadius: 3, background: 'linear-gradient(135deg, #7b4f3a, #4a3028)', transform: 'translate(-50%, -50%) rotate(-2deg) translate(0, -6px)', zIndex: 2, boxShadow: '4px 8px 18px rgba(0,0,0,0.5)' }} />
    </>
  )
}

// — Goal ────────────────────────────────────────────────────────────────
function GoalWidget({ data, theme, size = 'small', onSetGoal }) {
  const goal = data.goal
  const yr = new Date().getFullYear()
  if (!goal) {
    return (
      <Card theme={theme}>
        <Eyebrow theme={theme}>{yr} goal</Eyebrow>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
          <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: theme.text, marginBottom: 4 }}>
            Set a reading goal
          </div>
          <div style={{ fontSize: 11, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif", marginBottom: 12 }}>
            Track your progress through the year.
          </div>
          <button onClick={onSetGoal} style={btnPrimaryStyle(theme)}>Set goal →</button>
        </div>
      </Card>
    )
  }
  const target = goal.target
  const current = goal.current
  const pct = Math.min(1, target ? current / target : 0)
  const dayOfYear = Math.floor((Date.now() - new Date(yr, 0, 0).getTime()) / 86400000)
  const expected = Math.round((dayOfYear / 365) * target)
  const ahead = current - expected
  const remaining = Math.max(0, target - current)
  const onPace = dayOfYear > 0 ? Math.round((current / dayOfYear) * 365) : target

  return (
    <Card theme={theme}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <Eyebrow theme={theme}>{yr} goal</Eyebrow>
        <span style={{
          padding: '3px 8px',
          background: ahead >= 0 ? 'rgba(90,122,90,0.15)' : 'rgba(184,134,11,0.15)',
          color: ahead >= 0 ? theme.sage : theme.gold,
          borderRadius: 999, fontSize: 9, fontWeight: 700, fontVariant: 'small-caps', letterSpacing: '0.15em',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {ahead >= 0 ? `+${ahead} ahead` : `${ahead} behind`}
        </span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <RingChart current={current} target={target} pct={pct} theme={theme} />
        <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 13, color: theme.text, marginTop: 8, lineHeight: 1.2, textAlign: 'center' }}>
          On pace for {onPace} books
        </div>
        <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2, fontFamily: "'DM Sans', sans-serif" }}>
          {remaining > 0 ? `${remaining} more by Dec 31` : 'Goal reached 🎉'}
        </div>
      </div>
    </Card>
  )
}

function RingChart({ current, target, pct, theme }) {
  const size = 96
  const r = (size - 12) / 2
  const cx = size / 2, cy = size / 2
  const C = 2 * Math.PI * r
  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id={`goalGrad-${target}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.rust} />
            <stop offset="100%" stopColor={theme.gold} />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={theme.bgHover} strokeWidth="9" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#goalGrad-${target})`} strokeWidth="9"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, color: theme.text, lineHeight: 1 }}>{current}</div>
        <div style={{ fontSize: 9, color: theme.textSubtle, marginTop: 1, fontVariant: 'small-caps', letterSpacing: '0.15em', fontFamily: "'DM Sans', sans-serif" }}>/ {target}</div>
      </div>
    </div>
  )
}

// — Stats Cluster ───────────────────────────────────────────────────────
function StatsWidget({ data, theme, size = 'small', onOpen }) {
  const showExtra = atLeast(size, 'large')
  const yr = new Date().getFullYear()
  return (
    <Card theme={theme} onClick={onOpen} style={{ cursor: 'pointer', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottom: `1px solid ${theme.borderLight}` }}>
        <span style={{ fontSize: 18 }}>🔥</span>
        <div>
          <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 18, color: theme.rust, lineHeight: 1 }}>
            {data.streak} {data.streak === 1 ? 'day' : 'days'}
          </div>
          <div style={{ fontSize: 9, fontVariant: 'small-caps', letterSpacing: '0.15em', color: theme.textSubtle, marginTop: 1, fontFamily: "'DM Sans', sans-serif" }}>
            Reading streak
          </div>
        </div>
      </div>
      <StatRow label="Pages this week" value={data.pagesThisWeek.toLocaleString()} theme={theme} />
      <StatRow
        label="In your library"
        value={<>{data.counts.total}<span style={{ fontSize: 10, fontStyle: 'italic', color: theme.textSubtle, fontWeight: 400, marginLeft: 2, fontFamily: 'Georgia, serif' }}> books</span></>}
        sub={`${data.counts.reading} reading · ${data.counts.want} want · ${data.counts.read} read`}
        theme={theme}
      />
      {showExtra && (
        <StatRow
          label={`Read in ${yr}`}
          value={<>{data.booksReadYear}<span style={{ fontSize: 10, fontStyle: 'italic', color: theme.textSubtle, fontWeight: 400, marginLeft: 2, fontFamily: 'Georgia, serif' }}> books</span></>}
          theme={theme}
        />
      )}
      {showExtra && data.topGenres[0] && (
        <StatRow
          label="Top genre"
          value={<span style={{ fontSize: 16 }}>{data.topGenres[0][0]}</span>}
          sub={`${data.topGenres[0][1]} books`}
          theme={theme}
        />
      )}
    </Card>
  )
}

function StatRow({ label, value, sub, theme }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontVariant: 'small-caps', letterSpacing: '0.15em', color: theme.textSubtle, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
        {label}
      </div>
      <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 22, color: theme.text, letterSpacing: '-0.3px', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: theme.textSubtle, fontStyle: 'italic', fontFamily: 'Georgia, serif', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// — Nightstand Shelf ────────────────────────────────────────────────────
function NightstandWidget({ data, theme, size = 'wide', onOpen, onSeeAll }) {
  const cap = pickBySize(size, { small: 4, medium: 6, large: 9, wide: 12, full: 18 })
  const reading = data.reading.map(e => ({ ...e.books, _pct: e.books?.pages ? Math.min(100, Math.round(((e.current_page || 0) / e.books.pages) * 100)) : 0 })).filter(b => b?.id)
  const want = data.want.slice(0, Math.max(0, cap - reading.length)).map(e => ({ ...e.books, _pct: 0 })).filter(b => b?.id)
  const all = [...reading, ...want].slice(0, cap)

  return (
    <div style={{
      background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14,
      padding: '12px 16px 0', boxShadow: theme.shadowCard, position: 'relative',
      display: 'flex', flexDirection: 'column',
      height: '100%', width: '100%', boxSizing: 'border-box',
    }}>
      <SectionHeader
        title="On your nightstand"
        deck={`${reading.length} in flight · ${want.length} on deck`}
        seeAllLabel={`All ${data.counts.total} →`}
        onSeeAll={onSeeAll}
        theme={theme}
      />
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', paddingBottom: 10, paddingTop: 6, overflowX: 'auto' }}>
        {all.length === 0 && (
          <div style={{ padding: '20px 0', color: theme.textSubtle, fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}>
            Add a book and start reading to fill your nightstand.
          </div>
        )}
        {all.map(b => (
          <ShelfBook key={b.id} book={b} pct={b._pct} theme={theme} onClick={() => onOpen(b.id)} />
        ))}
      </div>
      {all.length > 0 && (
        <div style={{
          height: 9, margin: '0 -16px',
          background: 'linear-gradient(180deg, #6a4f24 0%, #8a6a3a 50%, #5a4020 100%)',
          borderRadius: '0 0 8px 8px', boxShadow: '0 3px 6px rgba(0,0,0,0.12)',
        }} />
      )}
    </div>
  )
}

function ShelfBook({ book, pct, theme, onClick }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 78, cursor: 'pointer' }}>
      <div style={{ position: 'relative' }}>
        <BookCover book={book} w={68} h={102} shadow="0 3px 8px rgba(0,0,0,0.15)" />
        {pct > 0 && (
          <div style={{
            position: 'absolute', top: -6, right: -6,
            background: theme.rust, color: 'white',
            borderRadius: 999, fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 9,
            padding: '2px 6px',
          }}>{pct}%</div>
        )}
      </div>
      <div style={{ textAlign: 'center', maxWidth: 80 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 10, color: theme.text, lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {book.title}
        </div>
        {book.author && (
          <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 9, color: theme.textSubtle, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {book.author}
          </div>
        )}
      </div>
      <div style={{ width: '100%', height: 3, background: theme.bgHover, borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: theme.rust }} />
      </div>
    </div>
  )
}

// — Quote ──────────────────────────────────────────────────────────────
function QuoteWidget({ data, theme, size = 'medium', onOpen }) {
  const q = data.dailyQuote
  if (!q) {
    return (
      <Card theme={theme} style={{ borderLeft: `3px solid ${theme.gold}` }}>
        <Eyebrow theme={theme} color={theme.gold}>Quote of the day</Eyebrow>
        <div style={{ flex: 1, padding: '14px 0', color: theme.textSubtle, fontSize: 13, fontFamily: 'Georgia, serif', fontStyle: 'italic', lineHeight: 1.5 }}>
          "Save a quote on any book and your favorites will surface here daily."
        </div>
      </Card>
    )
  }
  return (
    <div
      onClick={() => q.books?.id && onOpen(q.books.id)}
      style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`,
        borderLeft: `3px solid ${theme.gold}`,
        borderRadius: 12, padding: '14px 16px', boxShadow: theme.shadowCard,
        position: 'relative', cursor: q.books?.id ? 'pointer' : 'default',
        minHeight: 130,
        height: '100%', width: '100%', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
      }}>
      <div style={{
        position: 'absolute', top: -8, right: 8,
        fontFamily: 'Georgia, serif', fontSize: 60, fontWeight: 700,
        color: theme.gold, opacity: 0.18, lineHeight: 1, pointerEvents: 'none',
      }}>"</div>
      <div style={{ fontSize: 10, fontVariant: 'small-caps', letterSpacing: '0.2em', color: theme.gold, fontWeight: 600, marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>
        Quote of the day
      </div>
      <div style={{
        fontFamily: 'Georgia, serif', fontStyle: 'italic',
        fontSize: pickBySize(size, { small: 12, medium: 13, large: 15, wide: 17, full: 19 }),
        lineHeight: 1.45, color: theme.text, marginBottom: 6,
      }}>
        "{q.quote_text}"
      </div>
      {atLeast(size, 'large') && q.note && (
        <div style={{
          fontSize: 11, color: theme.textMuted, marginBottom: 8,
          padding: '6px 10px', background: theme.bgSubtle,
          borderRadius: 6, fontFamily: "'DM Sans', sans-serif",
          borderLeft: `2px solid ${theme.gold}`,
        }}>
          <span style={{ fontStyle: 'italic', color: theme.textSubtle, marginRight: 4 }}>note:</span>
          {q.note}
        </div>
      )}
      <div style={{ fontSize: 10, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif", marginTop: 'auto' }}>
        — <b style={{ color: theme.text, fontWeight: 600 }}>{q.books?.author || 'Unknown'}</b>
        {q.books?.title ? <>, <span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>{q.books.title}</span></> : null}
        {q.page_number ? <> · p.{q.page_number}</> : null}
      </div>
    </div>
  )
}

// — Dispatches (Friends) ───────────────────────────────────────────────
function DispatchesWidget({ data, theme, size = 'medium', onOpen, onProfile, onFeed, onFindFriends }) {
  return (
    <Card theme={theme}>
      <SectionHeader title="Dispatches" deck="From the people you follow" seeAllLabel="Feed →" onSeeAll={onFeed} theme={theme} small />
      {!data.hasFriends ? (
        <EmptyState theme={theme} icon="🫶" message="No friends yet" ctaLabel="Find friends" onCta={onFindFriends} />
      ) : data.dispatches.length === 0 ? (
        <div style={{ padding: '14px 0', color: theme.textSubtle, fontSize: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
          Nothing new from your circle today.
        </div>
      ) : (
        <div>
          {data.dispatches.slice(0, pickBySize(size, CAPS_FEED)).map(it => (
            <FriendRow key={it.id} item={it} theme={theme} onOpen={onOpen} onProfile={onProfile} />
          ))}
        </div>
      )}
    </Card>
  )
}

function FriendRow({ item, theme, onOpen, onProfile }) {
  const username = item.profile?.username || 'Someone'
  const initial = username.charAt(0).toUpperCase()
  const status = item.kind === 'add' ? item.status : (item.post?.post_type || 'post')
  let verb = 'updated'
  let pillLabel = ''
  let pillStyle = { bg: 'rgba(138,127,114,0.15)', color: theme.textSubtle }
  if (item.kind === 'add') {
    if (item.status === 'read')    { verb = 'finished'; pillLabel = 'Read';    pillStyle = { bg: 'rgba(90,122,90,0.15)', color: theme.sage } }
    if (item.status === 'reading') { verb = 'started';  pillLabel = 'Reading'; pillStyle = { bg: 'rgba(192,82,30,0.12)', color: theme.rust } }
    if (item.status === 'want')    { verb = 'wants';    pillLabel = 'Want';    pillStyle = { bg: 'rgba(184,134,11,0.12)', color: theme.gold } }
    if (item.status === 'owned')   { verb = 'added';    pillLabel = 'Owned';   pillStyle = { bg: 'rgba(138,127,114,0.15)', color: theme.textSubtle } }
  } else if (item.post?.post_type === 'quote') {
    verb = 'quoted'; pillLabel = 'Quote'; pillStyle = { bg: 'rgba(184,134,11,0.12)', color: theme.gold }
  } else {
    verb = 'posted'; pillLabel = 'Post';  pillStyle = { bg: 'rgba(138,127,114,0.15)', color: theme.textSubtle }
  }

  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0',
      borderBottom: `1px solid ${theme.borderLight}`, fontFamily: "'DM Sans', sans-serif",
    }}>
      <button
        onClick={() => onProfile(username)}
        style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: `linear-gradient(135deg, ${theme.rust}, ${theme.gold})`,
          color: 'white', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', padding: 0, cursor: 'pointer', overflow: 'hidden',
        }}>
        {item.profile?.avatar_url
          ? <img src={item.profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initial}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: theme.textMuted }}>
          <b style={{ color: theme.text, fontWeight: 600, cursor: 'pointer' }} onClick={() => onProfile(username)}>{username}</b> {verb}
          <span style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 999, fontSize: 9, fontWeight: 600,
            fontVariant: 'small-caps', letterSpacing: '0.12em', marginLeft: 4, verticalAlign: 1,
            background: pillStyle.bg, color: pillStyle.color,
          }}>
            {pillLabel}
          </span>
        </div>
        <div
          onClick={() => item.book?.id && onOpen(item.book.id)}
          style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 12, color: theme.text, lineHeight: 1.2, marginTop: 1, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.book?.title}
        </div>
      </div>
      <div style={{ fontSize: 10, color: theme.textSubtle, whiteSpace: 'nowrap' }}>{timeAgo(item.date)}</div>
    </div>
  )
}

// — This Week (Agenda) ─────────────────────────────────────────────────
function ThisWeekWidget({ data, theme, size = 'medium', navigate }) {
  return (
    <Card theme={theme}>
      <SectionHeader
        title="This week"
        deck="Loans, buddy reads, returns"
        seeAllLabel="All →"
        onSeeAll={() => navigate('/loans')}
        theme={theme}
        small
      />
      {data.agenda.length === 0 ? (
        <div style={{ padding: '14px 0', color: theme.textSubtle, fontSize: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
          No upcoming returns or buddy-read targets.
        </div>
      ) : (
        <div>
          {data.agenda.slice(0, pickBySize(size, CAPS_FEED)).map((it, i, arr) => (
            <div
              key={i}
              onClick={() => it.link && navigate(it.link)}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0',
                borderBottom: i === arr.length - 1 ? 'none' : `1px solid ${theme.borderLight}`,
                cursor: it.link ? 'pointer' : 'default',
              }}>
              <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 11, color: theme.rust, width: 50, flexShrink: 0, fontVariant: 'small-caps', letterSpacing: '0.08em', paddingTop: 1 }}>
                {it.label}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: theme.text, lineHeight: 1.35, fontFamily: "'DM Sans', sans-serif" }}>
                  {it.title}
                </div>
                <div style={{ fontSize: 9, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}>
                  {it.meta}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// — Rediscover ─────────────────────────────────────────────────────────
function RediscoverWidget({ data, theme, size = 'medium', onOpen }) {
  const r = data.rediscover
  if (!r?.books) {
    return (
      <Card theme={theme}>
        <Eyebrow theme={theme}>Rediscover</Eyebrow>
        <div style={{ flex: 1, padding: '14px 0', color: theme.textSubtle, fontSize: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic', lineHeight: 1.5 }}>
          Once you've finished a few books, we'll surface old favorites here.
        </div>
      </Card>
    )
  }
  const yearsAgo = Math.max(1, Math.floor((Date.now() - new Date(r.added_at).getTime()) / (365 * 86400000)))
  return (
    <div
      onClick={() => onOpen(r.books.id)}
      style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`,
        borderLeft: `3px solid ${theme.sage}`,
        borderRadius: 12, padding: '14px 16px', boxShadow: theme.shadowCard,
        cursor: 'pointer', display: 'flex', flexDirection: 'column', minHeight: 130,
        height: '100%', width: '100%', boxSizing: 'border-box',
      }}>
      <SectionHeader title="Rediscover" deck="Worth a second look" theme={theme} small noBorder />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
        <BookCover book={r.books} w={48} h={72} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 13, color: theme.text, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {r.books.title}
          </div>
          {r.books.author && (
            <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
              {r.books.author}
            </div>
          )}
          <div style={{ fontSize: 10, color: theme.sage, fontWeight: 600, marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>
            Read {yearsAgo === 1 ? 'a year' : `${yearsAgo} years`} ago
          </div>
        </div>
      </div>
    </div>
  )
}

// — Recently Added ─────────────────────────────────────────────────────
function RecentlyAddedWidget({ data, theme, size = 'medium', onOpen, onSeeAll }) {
  return (
    <Card theme={theme}>
      <SectionHeader title="Recently added" seeAllLabel="Library →" onSeeAll={onSeeAll} theme={theme} small />
      {data.recentlyAdded.length === 0 ? (
        <div style={{ padding: '14px 0', color: theme.textSubtle, fontSize: 12 }}>Nothing yet — add some books.</div>
      ) : (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingTop: 6, paddingBottom: 4 }}>
          {data.recentlyAdded.slice(0, pickBySize(size, CAPS_BOOK_ROW)).map(e => {
            if (!e.books) return null
            return (
              <div key={e.id} onClick={() => onOpen(e.books.id)} style={{ minWidth: 56, cursor: 'pointer' }}>
                <BookCover book={e.books} w={56} h={84} />
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 9, fontWeight: 700, color: theme.text, marginTop: 4, lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', maxWidth: 56 }}>
                  {e.books.title}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// — Top Genres ──────────────────────────────────────────────────────────
function TopGenresWidget({ data, theme, size = 'medium', onOpen }) {
  const cap = pickBySize(size, { small: 3, medium: 5, large: 8, wide: 10, full: 12 })
  const genres = data.topGenres.slice(0, cap)
  const max = genres[0]?.[1] || 1
  return (
    <Card theme={theme} onClick={onOpen} style={{ cursor: 'pointer' }}>
      <SectionHeader title="Top genres" deck="What you read most" theme={theme} small />
      {genres.length === 0 ? (
        <div style={{ padding: '14px 0', color: theme.textSubtle, fontSize: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
          Read a few books to see your genre breakdown.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {genres.map(([g, count]) => (
            <div key={g}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: theme.text, fontFamily: "'DM Sans', sans-serif", marginBottom: 2 }}>
                <span style={{ fontWeight: 600 }}>{g}</span>
                <span style={{ color: theme.textSubtle }}>{count}</span>
              </div>
              <div style={{ height: 4, background: theme.bgHover, borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(count / max) * 100}%`, background: theme.rust, borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// — Search ──────────────────────────────────────────────────────────────
function SearchWidget({ theme, size = 'small', onOpen }) {
  return (
    <Card theme={theme} style={{ justifyContent: 'center' }}>
      <Eyebrow theme={theme}>Search</Eyebrow>
      <button
        onClick={onOpen}
        style={{
          marginTop: 8,
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '10px 12px', borderRadius: 10,
          background: theme.bgSubtle, border: `1px solid ${theme.border}`,
          cursor: 'pointer', textAlign: 'left',
          fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: theme.textSubtle,
        }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Search your library and beyond…
      </button>
      <div style={{ marginTop: 8, fontSize: 10, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}>
        ⌘K from anywhere
      </div>
    </Card>
  )
}

// — Book Values ─────────────────────────────────────────────────────────
function BookValuesWidget({ data, theme, size = 'small', onOpen }) {
  const { retailTotal, retailCount, marketTotal, marketCount } = data.bookValues
  function fmt(n) { return '$' + Math.round(n).toLocaleString('en-US') }
  return (
    <Card theme={theme} onClick={onOpen} style={{ cursor: 'pointer' }}>
      <SectionHeader title="Book Values" deck="Owned books only" theme={theme} small />
      {retailCount === 0 ? (
        <div style={{ padding: '14px 0', color: theme.textSubtle, fontSize: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
          Valuations will appear once we price your books.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
          <StatRow label="Retail value" value={fmt(retailTotal)} sub={`${retailCount} books`} theme={theme} />
          <StatRow label="Market (used)" value={fmt(marketTotal)} sub={marketCount ? `${marketCount} priced` : 'estimated'} theme={theme} />
        </div>
      )}
    </Card>
  )
}

// — Books in Library ───────────────────────────────────────────────────
function LibraryCountWidget({ data, theme, size = 'small', onOpen }) {
  const { total, reading, want, read } = data.counts
  const owned = total - want
  return (
    <Card theme={theme} onClick={onOpen} style={{ cursor: 'pointer' }}>
      <SectionHeader title="Books in Library" theme={theme} small />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 36, color: theme.text, lineHeight: 1, letterSpacing: '-0.5px' }}>
          {total}
        </div>
        <div style={{ fontSize: 11, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}>
          books total
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
        <CountRow label="Reading" value={reading} color={theme.rust}        theme={theme} />
        <CountRow label="Read"    value={read}    color={theme.sage}        theme={theme} />
        <CountRow label="Want"    value={want}    color={theme.gold}        theme={theme} />
        <CountRow label="Owned"   value={owned}   color={theme.textSubtle}  theme={theme} />
      </div>
    </Card>
  )
}

function CountRow({ label, value, color, theme }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontFamily: "'DM Sans', sans-serif" }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
        <span style={{ color: theme.textMuted }}>{label}</span>
      </span>
      <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, color: theme.text }}>{value}</span>
    </div>
  )
}

// — Random Book of the Day ─────────────────────────────────────────────
function RandomBookWidget({ data, theme, size = 'medium', onOpen }) {
  const b = data.randomBook
  if (!b) {
    return (
      <Card theme={theme}>
        <SectionHeader title="Random Book" deck="One a day from your shelves" theme={theme} small />
        <div style={{ padding: '14px 0', color: theme.textSubtle, fontSize: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
          Add some books and we'll surface one a day.
        </div>
      </Card>
    )
  }
  return (
    <div
      onClick={() => onOpen(b.id)}
      style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`,
        borderLeft: `3px solid ${theme.rust}`,
        borderRadius: 12, padding: '14px 16px', boxShadow: theme.shadowCard,
        cursor: 'pointer', display: 'flex', flexDirection: 'column', minHeight: 130,
        height: '100%', width: '100%', boxSizing: 'border-box',
      }}>
      <SectionHeader title="🎲 Random Book of the Day" theme={theme} small noBorder />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
        <BookCover book={b} w={56} h={84} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 13, color: theme.text, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {b.title}
          </div>
          {b.author && (
            <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
              {b.author}
            </div>
          )}
          <div style={{ fontSize: 10, color: theme.rust, fontWeight: 600, marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>
            Today's pick →
          </div>
        </div>
      </div>
    </div>
  )
}

// — Want to Read ────────────────────────────────────────────────────────
function WantToReadWidget({ data, theme, size = 'medium', onOpen, onSeeAll }) {
  const want = data.want.slice(0, pickBySize(size, CAPS_BOOK_ROW))
  return (
    <Card theme={theme}>
      <SectionHeader title="Want to Read" deck={`${data.counts.want} on your wishlist`} seeAllLabel="All →" onSeeAll={onSeeAll} theme={theme} small />
      {want.length === 0 ? (
        <div style={{ padding: '14px 0', color: theme.textSubtle, fontSize: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
          Books you mark "Want to read" land here.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingTop: 6, paddingBottom: 4 }}>
          {want.map(e => {
            if (!e.books) return null
            return (
              <div key={e.id} onClick={() => onOpen(e.books.id)} style={{ minWidth: 56, cursor: 'pointer' }}>
                <BookCover book={e.books} w={56} h={84} shadow="0 2px 6px rgba(0,0,0,0.1)" />
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 9, fontWeight: 700, color: theme.text, marginTop: 4, lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', maxWidth: 56 }}>
                  {e.books.title}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// — Marketplace (your active listings) ─────────────────────────────────
function MarketplaceWidget({ data, theme, size = 'medium', onOpen, onSeeAll }) {
  const listings = data.myListings
  return (
    <Card theme={theme}>
      <SectionHeader title="🏪 Marketplace" deck={listings.length ? `${listings.length} active listing${listings.length !== 1 ? 's' : ''}` : 'Your listings'} seeAllLabel="Open →" onSeeAll={onSeeAll} theme={theme} small />
      {listings.length === 0 ? (
        <EmptyState theme={theme} icon="🏪" message="No active listings" ctaLabel="List a book" onCta={onSeeAll} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {listings.slice(0, pickBySize(size, CAPS_LIST)).map(l => (
            <div key={l.id}
              onClick={() => l.books?.id && onOpen(l.books.id)}
              style={{
                display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0',
                borderBottom: `1px solid ${theme.borderLight}`,
                cursor: l.books?.id ? 'pointer' : 'default', fontFamily: "'DM Sans', sans-serif",
              }}>
              <ListingCover book={l.books} theme={theme} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 12, color: theme.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.books?.title || 'Untitled'}
                </div>
                {l.condition && (
                  <div style={{ fontSize: 10, color: theme.textSubtle, fontStyle: 'italic', fontFamily: 'Georgia, serif', marginTop: 1, textTransform: 'capitalize' }}>
                    {l.condition}
                  </div>
                )}
              </div>
              <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 13, color: theme.gold, whiteSpace: 'nowrap' }}>
                ${Number(l.price).toFixed(0)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function ListingCover({ book, theme }) {
  if (!book) return <div style={{ width: 28, height: 42, borderRadius: 3, background: theme.bgSubtle, flexShrink: 0 }} />
  return <BookCover book={book} w={28} h={42} radius={3} />
}

// — Loans ──────────────────────────────────────────────────────────────
function LoansWidget({ data, theme, size = 'medium', onSeeAll, onOpen }) {
  const borrowing = data.loans.borrowing
  const lending   = data.loans.lending
  const all = [...borrowing.map(l => ({ ...l, _kind: 'borrow' })), ...lending.map(l => ({ ...l, _kind: 'lend' }))]
  return (
    <Card theme={theme}>
      <SectionHeader title="🤝 Loans" deck={all.length ? `${borrowing.length} borrowing · ${lending.length} lending` : 'Books in flight'} seeAllLabel="Open →" onSeeAll={onSeeAll} theme={theme} small />
      {all.length === 0 ? (
        <div style={{ padding: '14px 0', color: theme.textSubtle, fontSize: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
          No active loans right now.
        </div>
      ) : (
        <div>
          {all.slice(0, pickBySize(size, CAPS_LIST)).map(l => {
            const due = l.due_date ? new Date(l.due_date) : null
            const dueStr = due ? dayLabel(due) : '—'
            const overdue = due && due < new Date()
            return (
              <div key={l.id}
                onClick={() => l.books?.id && onOpen(l.books.id)}
                style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${theme.borderLight}`, cursor: l.books?.id ? 'pointer' : 'default', fontFamily: "'DM Sans', sans-serif" }}>
                <ListingCover book={l.books} theme={theme} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: l._kind === 'borrow' ? theme.rust : theme.sage, fontVariant: 'small-caps', letterSpacing: '0.12em', fontWeight: 600 }}>
                    {l._kind === 'borrow' ? 'Borrowing' : 'Lending'}
                  </div>
                  <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 12, color: theme.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.books?.title || 'A book'}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: overdue ? theme.rust : theme.textSubtle, whiteSpace: 'nowrap', fontWeight: overdue ? 600 : 400 }}>
                  {due ? (overdue ? 'overdue' : `due ${dueStr}`) : 'open'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// — Badges ─────────────────────────────────────────────────────────────
function BadgesWidget({ data, theme, size = 'medium', onSeeAll }) {
  const cols = pickBySize(size, { small: 2, medium: 3, large: 4, wide: 5, full: 6 })
  const rows = pickBySize(size, { small: 2, medium: 2, large: 3, wide: 3, full: 4 })
  const earned = data.earnedTopByCategory.slice(0, cols * rows)
  const total = data.badges.filter(b => b.earned).length
  return (
    <Card theme={theme}>
      <SectionHeader title="🏅 Badges" deck={`${total} earned`} seeAllLabel="All →" onSeeAll={onSeeAll} theme={theme} small />
      {earned.length === 0 ? (
        <div style={{ padding: '14px 0', color: theme.textSubtle, fontSize: 12, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
          Read more books to start collecting badges.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, marginTop: 4 }}>
          {earned.map(b => {
            const tier = TIER_STYLES[b.tier] || TIER_STYLES.bronze
            return (
              <div key={b.id} title={`${b.name} · ${tier.label}`}
                onClick={onSeeAll}
                style={{
                  background: tier.bg, border: `1px solid ${tier.border}`,
                  borderRadius: 10, padding: '10px 6px', textAlign: 'center', cursor: 'pointer',
                }}>
                <div style={{ fontSize: 22, lineHeight: 1, marginBottom: 4 }}>{b.emoji}</div>
                <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 10, color: theme.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </div>
                <div style={{ fontSize: 8, color: tier.text, fontVariant: 'small-caps', letterSpacing: '0.12em', fontWeight: 700, marginTop: 2, fontFamily: "'DM Sans', sans-serif" }}>
                  {tier.label}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// — Book Clubs ─────────────────────────────────────────────────────────
function ClubsWidget({ data, theme, size = 'medium', onSeeAll, onOpen }) {
  const clubs = data.clubs
  return (
    <Card theme={theme}>
      <SectionHeader title="💬 Book Clubs" deck={clubs.length ? `${clubs.length} club${clubs.length !== 1 ? 's' : ''}` : 'Read together'} seeAllLabel="All →" onSeeAll={onSeeAll} theme={theme} small />
      {clubs.length === 0 ? (
        <EmptyState theme={theme} icon="💬" message="No clubs yet" ctaLabel="Find a club" onCta={onSeeAll} />
      ) : (
        <div>
          {clubs.slice(0, pickBySize(size, CAPS_LIST)).map(c => {
            const memberCount = c.book_club_members?.[0]?.count ?? 0
            const currentBook = c.books
            return (
              <div key={c.id}
                onClick={() => currentBook?.id ? onOpen(currentBook.id) : onSeeAll()}
                style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${theme.borderLight}`, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                <ListingCover book={currentBook} theme={theme} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 12, color: theme.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 10, color: theme.textSubtle, fontStyle: 'italic', fontFamily: 'Georgia, serif', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {currentBook?.title ? <>Reading: {currentBook.title}</> : <>{memberCount} member{memberCount !== 1 ? 's' : ''}</>}
                  </div>
                </div>
                {c._myRole === 'admin' && (
                  <span style={{
                    fontSize: 9, fontVariant: 'small-caps', letterSpacing: '0.12em',
                    color: theme.rust, fontWeight: 700,
                  }}>
                    Admin
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// — My Shelves ─────────────────────────────────────────────────────────
function MyShelvesWidget({ data, theme, size = 'medium', onSeeAll }) {
  const shelves = data.shelves
  return (
    <Card theme={theme}>
      <SectionHeader title="📂 My Shelves" deck={shelves.length ? `${shelves.length} shelf${shelves.length !== 1 ? 'ves' : ''}` : 'Custom collections'} seeAllLabel="All →" onSeeAll={onSeeAll} theme={theme} small />
      {shelves.length === 0 ? (
        <EmptyState theme={theme} icon="📂" message="No shelves yet" ctaLabel="Create one" onCta={onSeeAll} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {shelves.slice(0, pickBySize(size, { small: 4, medium: 5, large: 8, wide: 12, full: 16 })).map(s => (
            <div key={s.id}
              onClick={onSeeAll}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${theme.borderLight}`, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              <div style={{ width: 8, height: 26, borderRadius: 2, background: s.color || theme.gold, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 12, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </div>
              <div style={{ fontSize: 10, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}>
                {s._bookCount} book{s._bookCount !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ════════════════════════════════════════════════════════════════════════
// SHARED PRIMITIVES
// ════════════════════════════════════════════════════════════════════════
function Card({ theme, children, style, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`,
        borderRadius: 14, padding: '14px 16px',
        boxShadow: theme.shadowCard,
        display: 'flex', flexDirection: 'column',
        flex: '1 1 auto', minHeight: 0, width: '100%',
        boxSizing: 'border-box',
        ...style,
      }}>
      {children}
    </div>
  )
}

function Eyebrow({ theme, children, color }) {
  return (
    <div style={{
      fontSize: 10, fontVariant: 'small-caps', letterSpacing: '0.2em',
      color: color || theme.textSubtle, fontWeight: 600,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {children}
    </div>
  )
}

function SectionHeader({ title, deck, seeAllLabel, onSeeAll, theme, small, noBorder }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 10, marginBottom: small ? 8 : 10,
      paddingBottom: noBorder ? 0 : (small ? 8 : 0),
      borderBottom: noBorder ? 'none' : `${small ? 1 : 0}px solid ${theme.borderLight}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <h3 style={{
          fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: small ? 14 : 16,
          margin: 0, letterSpacing: '-0.2px', color: theme.text, lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {title}
        </h3>
        {deck && (
          <span style={{
            fontFamily: 'Georgia, serif', fontStyle: 'italic',
            fontSize: small ? 10 : 11, color: theme.textSubtle,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {deck}
          </span>
        )}
      </div>
      {seeAllLabel && onSeeAll && (
        <a
          onClick={(e) => { e.preventDefault(); onSeeAll() }}
          href="#"
          style={{
            color: theme.rust, fontSize: 11, fontWeight: 600, textDecoration: 'none',
            fontVariant: 'small-caps', letterSpacing: '0.15em', flexShrink: 0,
            fontFamily: "'DM Sans', sans-serif",
          }}>
          {seeAllLabel}
        </a>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

// Pure transform from raw Supabase query results → the data object the
// widgets render against. Kept module-scoped (and free of `session` /
// `theme` / setState) so the shape of fetchAll stays "fetch then derive."
function deriveHomeData(raw, userId, friendIds, valuationRows) {
  const {
    profileRes, collectionRes, sessionsRes, challengeRes,
    friendsPostsRes, friendsActivityRes, friendProfilesRes,
    quotesRes, borrowsRes, buddyReadsRes,
    myListingsRes, clubsRes, shelvesRes,
  } = raw
  const now = new Date()
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7)
  const weekAhead = new Date(); weekAhead.setDate(weekAhead.getDate() + 7)

  const profile = profileRes.data
  const entries = collectionRes.data || []
  const sessions = sessionsRes.data || []
  const reading = entries.filter(e => e.read_status === 'reading')
  const want = entries.filter(e => e.read_status === 'want')
    .sort((a, b) => new Date(a.added_at) - new Date(b.added_at))

  const readEntries = entries.filter(e => e.read_status === 'read' || e.has_read)
  const pagesThisWeek = sessions
    .filter(s => s.ended_at && new Date(s.ended_at) >= weekStart)
    .reduce((sum, x) => sum + (x.pages_read || 0), 0)
  const dates = sessions.map(s => s.ended_at?.slice(0, 10)).filter(Boolean)
  const { current: streak } = computeStreak(dates)
  const booksReadYear = readEntries.filter(e => new Date(e.added_at) >= yearStart).length
  const counts = {
    total: entries.length,
    reading: reading.length,
    want: want.length,
    read: readEntries.length,
  }
  const genreCounts = {}
  for (const e of readEntries) {
    const g = e.books?.genre
    if (g) genreCounts[g] = (genreCounts[g] || 0) + 1
  }
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 16)

  const challenge = challengeRes.data
  const goal = challenge ? { target: challenge.target_value, current: booksReadYear } : null

  // Dispatches: posts + collection adds from friends, merged + date-sorted.
  const profileMap = Object.fromEntries((friendProfilesRes.data || []).map(p => [p.id, p]))
  const fpost = (friendsPostsRes.data || []).map(p => ({
    kind: 'post', id: `p-${p.id}`, date: p.created_at,
    profile: p.profiles || profileMap[p.user_id], post: p, book: p.books,
    status: p.post_type === 'quote' ? 'quote' : 'post',
  }))
  const fact = (friendsActivityRes.data || []).map(a => ({
    kind: 'add', id: `a-${a.id}`, date: a.added_at,
    profile: profileMap[a.user_id], status: a.read_status, book: a.books,
  }))
  const dispatches = [...fpost, ...fact]
    .filter(x => x.book)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 16)

  // Daily quote — deterministic per calendar day
  const quotes = (quotesRes.data || []).filter(q => q.books)
  const dayKey = now.toISOString().slice(0, 10)
  const daySeed = dayKey.split('-').reduce((a, b) => a + parseInt(b), 0)
  const dailyQuote = quotes.length ? quotes[daySeed % quotes.length] : null

  // Rediscover: random read book from 1+ year ago, fallback to any read book
  const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const oldReads = readEntries.filter(e => new Date(e.added_at) < oneYearAgo && e.books)
  const pool = oldReads.length ? oldReads : readEntries.filter(e => e.books)
  const rediscover = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null

  // Agenda: borrow due dates + buddy-read targets within the next 7 days
  const agenda = []
  for (const b of (borrowsRes.data || [])) {
    if (!b.due_date) continue
    const due = new Date(b.due_date)
    if (due >= now && due <= weekAhead) {
      agenda.push({
        when: due, label: dayLabel(due),
        title: <>Return <i>{b.books?.title || 'a book'}</i></>,
        meta: 'loan due', link: '/loans',
      })
    }
  }
  for (const p of (buddyReadsRes.data || [])) {
    const br = p.buddy_reads
    if (!br || br.status !== 'active' || !br.target_finish) continue
    const tf = new Date(br.target_finish)
    if (tf >= now && tf <= weekAhead) {
      agenda.push({
        when: tf, label: dayLabel(tf),
        title: <>Buddy read · <i>{br.books?.title || br.title}</i></>,
        meta: 'target finish', link: `/buddy-reads/${br.id}`,
      })
    }
  }
  agenda.sort((a, b) => a.when - b.when)

  // Book values: aggregate from valuations, splitting retail vs market (used)
  const USED_FACTOR = 0.35
  const bookValues = { retailTotal: 0, retailCount: 0, marketTotal: 0, marketCount: 0 }
  for (const v of valuationRows || []) {
    if (v.list_price != null) { bookValues.retailTotal += Number(v.list_price); bookValues.retailCount++ }
    if (v.avg_price   != null) { bookValues.marketTotal += Number(v.avg_price);   bookValues.marketCount++ }
    else if (v.list_price != null) { bookValues.marketTotal += Number(v.list_price) * USED_FACTOR }
  }

  const loans = {
    borrowing: (borrowsRes.data || []).filter(b => b.requester_id === userId),
    lending:   (borrowsRes.data || []).filter(b => b.owner_id === userId),
  }

  const badges = computeBadges(entries, friendIds.length)
  const earnedTopByCategory = topEarnedByCategory(badges)

  const clubs = (clubsRes.data || [])
    .map(m => ({ ...m.book_clubs, _myRole: m.role }))
    .filter(c => c?.id)

  const shelves = (shelvesRes.data || []).map(s => ({
    ...s, _bookCount: s.shelf_books?.[0]?.count ?? 0,
  }))

  // Random book of the day — same dayKey/seed as daily quote for stability
  const allBooks = entries.filter(e => e.books).map(e => e.books)
  const randomBook = allBooks.length ? allBooks[daySeed % allBooks.length] : null

  return {
    profile, entries, reading, want, readEntries,
    pagesThisWeek, streak, booksReadYear, counts, topGenres,
    goal, dispatches, hasFriends: friendIds.length > 0,
    dailyQuote, rediscover, agenda, recentlyAdded: entries.slice(0, 20),
    bookValues, myListings: myListingsRes.data || [],
    loans, badges, earnedTopByCategory, clubs, shelves, randomBook,
  }
}

function greetingForHour(hour, name) {
  const display = name ? `, ${name}` : ''
  if (hour < 5)  return `Reading late${display}?`
  if (hour < 12) return `Good morning${display}`
  if (hour < 17) return `Good afternoon${display}`
  if (hour < 21) return `Good evening${display}`
  return `Good night${display}`
}

function dayLabel(date) {
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(date); d.setHours(0,0,0,0)
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff > 0 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function btnPrimaryStyle(theme) {
  return {
    padding: '7px 14px', background: theme.rust, color: 'white', border: 'none',
    borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  }
}
function btnGhostStyle(theme) {
  return {
    padding: '7px 12px', background: 'transparent', color: theme.text,
    border: `1px solid ${theme.border}`, borderRadius: 8,
    fontSize: 12, fontWeight: 500, cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  }
}
function btnCreamStyle() {
  return {
    padding: '7px 12px', background: '#f5f0e8', color: '#1a1208', border: 'none',
    borderRadius: 6, fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 11,
    cursor: 'pointer',
  }
}
function btnCreamOutStyle() {
  return {
    padding: '7px 12px', background: 'transparent', color: '#f5f0e8',
    border: '1px solid rgba(245,240,232,0.3)', borderRadius: 6,
    fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 11, cursor: 'pointer',
  }
}

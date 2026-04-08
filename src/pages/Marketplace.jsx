import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'

const CONDITION_META = {
  like_new:   { label: 'Like New',   color: '#5a7a5a', bg: 'rgba(90,122,90,0.12)' },
  very_good:  { label: 'Very Good',  color: '#2e7d4f', bg: 'rgba(46,125,79,0.10)' },
  good:       { label: 'Good',       color: '#b8860b', bg: 'rgba(184,134,11,0.12)' },
  acceptable: { label: 'Acceptable', color: '#c0521e', bg: 'rgba(192,82,30,0.10)' },
  poor:       { label: 'Poor',       color: '#8a7f72', bg: 'rgba(138,127,114,0.12)' },
}

const ORDER_STATUS_META = {
  pending:   { label: 'Pending',   color: '#b8860b', bg: 'rgba(184,134,11,0.12)' },
  confirmed: { label: 'Confirmed', color: '#5a7a5a', bg: 'rgba(90,122,90,0.12)' },
  shipped:   { label: 'Shipped',   color: '#c0521e', bg: 'rgba(192,82,30,0.10)' },
  completed: { label: 'Completed', color: '#2e7d4f', bg: 'rgba(46,125,79,0.12)' },
  cancelled: { label: 'Cancelled', color: '#8a7f72', bg: 'rgba(138,127,114,0.12)' },
  declined:  { label: 'Declined',  color: '#8a7f72', bg: 'rgba(138,127,114,0.12)' },
}

// ---- MAIN COMPONENT ----
export default function Marketplace({ session }) {
  const { theme } = useTheme()
  const isMobile  = useIsMobile()
  const navigate  = useNavigate()

  const [tab, setTab]                   = useState('browse')
  const [listings, setListings]         = useState([])
  const [myListings, setMyListings]     = useState([])
  const [purchases, setPurchases]       = useState([])
  const [sellingOrders, setSellingOrders] = useState([])
  const [myProfile, setMyProfile]       = useState({})
  const [loading, setLoading]           = useState(true)

  // Browse filters
  const [search, setSearch]             = useState('')
  const [condFilter, setCondFilter]     = useState('all')
  const [minPrice, setMinPrice]         = useState('')
  const [maxPrice, setMaxPrice]         = useState('')

  // Shop online
  const [shopSearch, setShopSearch]     = useState('')
  const [shopResults, setShopResults]   = useState([])
  const [shopLoading, setShopLoading]   = useState(false)

  // Modals
  const [selectedListing, setSelectedListing] = useState(null) // ListingDetailModal
  const [buyListing, setBuyListing]           = useState(null) // BuyModal

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [
      { data: all },
      { data: mine },
      { data: myPurchases },
      { data: incomingOrders },
      { data: ownProfile },
    ] = await Promise.all([
      supabase
        .from('listings')
        .select(`
          id, price, condition, description, created_at,
          books ( id, title, author, cover_image_url ),
          profiles!listings_seller_id_fkey ( id, username, paypal_handle, venmo_handle )
        `)
        .eq('status', 'active')
        .neq('seller_id', session.user.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('listings')
        .select(`
          id, price, condition, description, status, created_at,
          books ( id, title, author, cover_image_url )
        `)
        .eq('seller_id', session.user.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('orders')
        .select(`
          id, price, status, buyer_message, shipping_address, created_at, updated_at,
          listing_id, seller_id,
          listings ( id, condition, books ( title, author, cover_image_url ) )
        `)
        .eq('buyer_id', session.user.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('orders')
        .select(`
          id, price, status, buyer_message, shipping_address, created_at, updated_at,
          listing_id, buyer_id,
          listings ( id, condition, books ( title, author, cover_image_url ) )
        `)
        .eq('seller_id', session.user.id)
        .in('status', ['pending', 'confirmed', 'shipped'])
        .order('created_at', { ascending: false }),

      supabase
        .from('profiles')
        .select('id, paypal_handle, venmo_handle')
        .eq('id', session.user.id)
        .single(),
    ])

    // Resolve usernames + payment handles (orders references auth.users, not profiles)
    const allOrderUserIds = [
      ...(myPurchases    || []).map(o => o.seller_id),
      ...(incomingOrders || []).map(o => o.buyer_id),
    ].filter(Boolean)
    let orderProfileMap = {}
    if (allOrderUserIds.length) {
      const { data: ops } = await supabase
        .from('profiles')
        .select('id, username, paypal_handle, venmo_handle')
        .in('id', [...new Set(allOrderUserIds)])
      orderProfileMap = Object.fromEntries((ops || []).map(p => [p.id, p]))
    }

    setListings(all || [])
    setMyListings(mine || [])
    setMyProfile(ownProfile || {})
    setPurchases((myPurchases    || []).map(o => ({ ...o, profiles: orderProfileMap[o.seller_id] || {} })))
    setSellingOrders((incomingOrders || []).map(o => ({ ...o, profiles: orderProfileMap[o.buyer_id] || {} })))
    setLoading(false)
  }, [session.user.id])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function removeListing(id) {
    await supabase.from('listings').update({ status: 'removed' }).eq('id', id)
    fetchAll()
  }

  async function markSold(id) {
    await supabase.from('listings').update({ status: 'sold' }).eq('id', id)
    fetchAll()
  }

  // Seller actions on orders
  async function confirmOrder(orderId, listingId) {
    await Promise.all([
      supabase.from('orders').update({ status: 'confirmed', updated_at: new Date().toISOString() }).eq('id', orderId),
      supabase.from('listings').update({ status: 'sold' }).eq('id', listingId),
    ])
    fetchAll()
  }

  async function declineOrder(orderId) {
    await supabase.from('orders').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', orderId)
    fetchAll()
  }

  async function markShipped(orderId) {
    await supabase.from('orders').update({ status: 'shipped', updated_at: new Date().toISOString() }).eq('id', orderId)
    fetchAll()
  }

  // Buyer actions
  async function cancelOrder(orderId) {
    await supabase.from('orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', orderId)
    fetchAll()
  }

  async function markReceived(orderId) {
    await supabase.from('orders').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', orderId)
    fetchAll()
  }

  // Filtered browse listings
  const filtered = listings.filter(l => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      l.books?.title?.toLowerCase().includes(q) ||
      l.books?.author?.toLowerCase().includes(q) ||
      l.profiles?.username?.toLowerCase().includes(q)
    const matchCond  = condFilter === 'all' || l.condition === condFilter
    const price      = Number(l.price)
    const matchMin   = !minPrice || price >= Number(minPrice)
    const matchMax   = !maxPrice || price <= Number(maxPrice)
    return matchSearch && matchCond && matchMin && matchMax
  })

  // Count pending orders per listing (for badge)
  const pendingByListing = {}
  sellingOrders.forEach(o => {
    if (o.status === 'pending') {
      pendingByListing[o.listing_id] = (pendingByListing[o.listing_id] || 0) + 1
    }
  })

  const activeListings  = myListings.filter(l => l.status === 'active')
  const historyListings = myListings.filter(l => l.status !== 'active')

  const pendingPurchases  = purchases.filter(o => ['pending', 'confirmed', 'shipped'].includes(o.status))
  const completedPurchases = purchases.filter(o => ['completed', 'cancelled', 'declined'].includes(o.status))

  const s = makeStyles(theme, isMobile)

  return (
    <div style={s.page}>
      <NavBar session={session} />

      <div style={s.content}>
        <div style={s.pageHeader}>
          <h1 style={s.pageTitle}>Marketplace</h1>
          <p style={s.pageSubtitle}>Buy and sell books with the Ex Libris community</p>
        </div>

        <div style={s.tabRow}>
          {[
            { key: 'browse',    label: 'Browse' },
            { key: 'shop',      label: 'Shop Online' },
            { key: 'selling',   label: `Selling${activeListings.length ? ` (${activeListings.length})` : ''}` },
            { key: 'purchases', label: `Purchases${pendingPurchases.length ? ` (${pendingPurchases.length})` : ''}` },
          ].map(t => (
            <button key={t.key}
              style={tab === t.key ? s.tabActive : s.tabInactive}
              onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'browse' && (
          <BrowseTab
            listings={filtered}
            loading={loading}
            search={search}
            onSearch={setSearch}
            condFilter={condFilter}
            onCondFilter={setCondFilter}
            minPrice={minPrice}
            maxPrice={maxPrice}
            onMinPrice={setMinPrice}
            onMaxPrice={setMaxPrice}
            onSelectListing={setSelectedListing}
            s={s}
            theme={theme}
          />
        )}

        {tab === 'shop' && (
          <ShopOnlineTab
            search={shopSearch}
            onSearch={setShopSearch}
            results={shopResults}
            setResults={setShopResults}
            loading={shopLoading}
            setLoading={setShopLoading}
            s={s}
            theme={theme}
          />
        )}

        {tab === 'selling' && (
          <SellingTab
            activeListings={activeListings}
            historyListings={historyListings}
            sellingOrders={sellingOrders}
            pendingByListing={pendingByListing}
            myProfile={myProfile}
            loading={loading}
            onRemove={removeListing}
            onMarkSold={markSold}
            onConfirmOrder={confirmOrder}
            onDeclineOrder={declineOrder}
            onMarkShipped={markShipped}
            navigate={navigate}
            s={s}
            theme={theme}
          />
        )}

        {tab === 'purchases' && (
          <PurchasesTab
            pendingPurchases={pendingPurchases}
            completedPurchases={completedPurchases}
            loading={loading}
            onCancel={cancelOrder}
            onMarkReceived={markReceived}
            navigate={navigate}
            s={s}
            theme={theme}
          />
        )}
      </div>

      {/* Listing Detail Modal */}
      {selectedListing && (
        <ListingDetailModal
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          onBuyNow={listing => { setSelectedListing(null); setBuyListing(listing) }}
          navigate={navigate}
          s={s}
          theme={theme}
          isMobile={isMobile}
        />
      )}

      {/* Buy Modal */}
      {buyListing && (
        <BuyModal
          listing={buyListing}
          session={session}
          onClose={() => setBuyListing(null)}
          onSuccess={() => { setBuyListing(null); fetchAll() }}
          s={s}
          theme={theme}
          isMobile={isMobile}
        />
      )}
    </div>
  )
}

// ---- STYLES FACTORY ----
function makeStyles(theme, isMobile) {
  return {
    page:           { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content:        { padding: isMobile ? '24px 16px' : '32px 32px', maxWidth: 1100, margin: '0 auto' },
    pageHeader:     { marginBottom: 28 },
    pageTitle:      { fontFamily: 'Georgia, serif', fontSize: isMobile ? 26 : 32, fontWeight: 700, color: theme.text, margin: '0 0 6px' },
    pageSubtitle:   { fontSize: 14, color: theme.textSubtle, margin: 0 },
    tabRow:         { display: 'flex', gap: 0, marginBottom: 28, borderBottom: `1px solid ${theme.border}` },
    tabActive:      { padding: isMobile ? '8px 14px' : '10px 20px', background: theme.rust, color: 'white', border: 'none', borderBottom: `2px solid ${theme.rust}`, marginBottom: -1, fontSize: isMobile ? 13 : 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    tabInactive:    { padding: isMobile ? '8px 14px' : '10px 20px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: isMobile ? 13 : 14, color: theme.textSubtle, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

    // Browse
    searchRow:      { marginBottom: 14 },
    searchInput:    { width: '100%', maxWidth: 400, padding: '9px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    priceRow:       { display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' },
    priceInput:     { width: 90, padding: '7px 10px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text },
    priceSep:       { fontSize: 13, color: theme.textSubtle },
    filterRow:      { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
    filterActive:   { padding: '6px 14px', borderRadius: 8, border: 'none', background: theme.rust, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    filterInactive: { padding: '6px 14px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    grid:           { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(160px, 1fr))' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20 },

    // Listing card (browse)
    listingCard:    { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: theme.shadowCard, transition: 'box-shadow 0.15s', cursor: 'pointer' },
    listingCover:   { width: '100%', aspectRatio: '3/2', background: theme.bgSubtle },
    listingInfo:    { padding: '14px' },
    listingTitle:   { fontSize: 14, fontWeight: 600, color: theme.text, lineHeight: 1.3, marginBottom: 2 },
    listingAuthor:  { fontSize: 12, color: theme.textSubtle },
    listingDesc:    { fontSize: 12, color: theme.textMuted, marginTop: 6, lineHeight: 1.5 },
    listingFooter:  { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10 },
    listingPrice:   { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text },
    listingSeller:  { fontSize: 12, color: theme.textSubtle },
    sellerLink:     { color: theme.rust, cursor: 'pointer', fontWeight: 500 },
    condBadge:      { display: 'inline-block', fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 500 },
    contactBtn:     { marginTop: 12, width: '100%', padding: '8px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

    // Selling / My listings
    sectionTitle:   { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, color: theme.text },
    sectionCount:   { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(192,82,30,0.1)', color: theme.rust, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 },
    myListingList:  { display: 'flex', flexDirection: 'column', gap: 12 },
    myListingCard:  { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '16px', display: 'flex', gap: 14, alignItems: 'flex-start' },
    myListingCover: { width: 52, height: 78, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: theme.bgSubtle },
    myListingInfo:  { flex: 1 },
    myListingRight: { flexShrink: 0, textAlign: 'right' },

    // Orders
    orderCard:      { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '16px', display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 10 },
    orderCover:     { width: 44, height: 66, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: theme.bgSubtle },
    orderInfo:      { flex: 1, minWidth: 0 },
    orderRight:     { flexShrink: 0, textAlign: 'right' },
    orderMeta:      { fontSize: 12, color: theme.textSubtle, marginTop: 3 },
    orderMsg:       { fontSize: 12, color: theme.textMuted, marginTop: 6, fontStyle: 'italic', borderLeft: `2px solid ${theme.border}`, paddingLeft: 8 },
    orderAddr:      { fontSize: 12, color: theme.textSubtle, marginTop: 4 },

    // Buttons
    btnPrimary:     { padding: '8px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:       { padding: '6px 12px', background: 'none', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.text },
    btnSold:        { padding: '5px 12px', background: theme.sage, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnRemove:      { padding: '5px 12px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnConfirm:     { padding: '5px 12px', background: theme.sage, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnDecline:     { padding: '5px 12px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnShip:        { padding: '5px 12px', background: theme.rust, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnCancel:      { padding: '5px 12px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnReceived:    { padding: '5px 12px', background: theme.sage, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    offerBadge:     { display: 'inline-flex', alignItems: 'center', background: 'rgba(192,82,30,0.12)', color: theme.rust, borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 600 },

    // Empty / misc
    empty:          { color: theme.textSubtle, fontSize: 14, padding: '60px 0', textAlign: 'center' },
    emptyState:     { textAlign: 'center', padding: '60px 0' },
    emptyIcon:      { fontSize: 48, marginBottom: 16 },
    emptyTitle:     { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, marginBottom: 8 },
    emptySub:       { fontSize: 14, color: theme.textSubtle, marginBottom: 20 },

    // Modal overlay
    overlay:        { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  }
}

// ---- BROWSE TAB ----
function BrowseTab({ listings, loading, search, onSearch, condFilter, onCondFilter, minPrice, maxPrice, onMinPrice, onMaxPrice, onSelectListing, s, theme }) {
  return (
    <>
      <div style={s.searchRow}>
        <input
          style={s.searchInput}
          placeholder="Search by title, author, or seller…"
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
      </div>

      <div style={s.priceRow}>
        <span style={{ fontSize: 13, color: theme.textSubtle }}>Price:</span>
        <input
          style={s.priceInput}
          type="number"
          min="0"
          placeholder="Min $"
          value={minPrice}
          onChange={e => onMinPrice(e.target.value)}
        />
        <span style={s.priceSep}>–</span>
        <input
          style={s.priceInput}
          type="number"
          min="0"
          placeholder="Max $"
          value={maxPrice}
          onChange={e => onMaxPrice(e.target.value)}
        />
      </div>

      <div style={s.filterRow}>
        {[['all', 'All Conditions'], ...Object.entries(CONDITION_META).map(([k, v]) => [k, v.label])].map(([key, label]) => (
          <button key={key}
            style={condFilter === key ? s.filterActive : s.filterInactive}
            onClick={() => onCondFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={s.empty}>Loading listings…</div>
      ) : listings.length === 0 ? (
        <div style={s.emptyState}>
          <div style={s.emptyIcon}>🏪</div>
          <div style={s.emptyTitle}>{search ? 'No listings match your search' : 'No listings yet'}</div>
          <div style={s.emptySub}>
            {search ? 'Try a different search term or adjust filters.' : 'Be the first to list a book — use "List for sale" from your Library.'}
          </div>
        </div>
      ) : (
        <div style={s.grid}>
          {listings.map(l => (
            <ListingCard key={l.id} listing={l} onSelect={onSelectListing} s={s} />
          ))}
        </div>
      )}
    </>
  )
}

// ---- SHOP ONLINE TAB ----
function ShopOnlineTab({ search, onSearch, results, setResults, loading, setLoading, s, theme }) {
  async function handleSearch() {
    if (!search.trim()) return
    setLoading(true)
    try {
      const q = encodeURIComponent(search.trim())
      const res = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=20&fields=key,title,author_name,isbn,cover_i,first_publish_year`)
      const data = await res.json()
      setResults((data.docs || []).map(d => ({
        key: d.key,
        title: d.title,
        author: d.author_name?.[0] || '',
        year: d.first_publish_year,
        isbn: d.isbn?.[0] || null,
        coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      })))
    } catch { setResults([]) }
    setLoading(false)
  }
  return (
    <>
      <div style={{ marginBottom: 8, fontSize: 14, color: theme.textSubtle }}>
        Search for books and find them on popular bookstores
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          style={{ ...s.searchInput, flex: 1 }}
          placeholder="Search by title, author, or ISBN…"
          value={search}
          onChange={e => onSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button onClick={handleSearch} disabled={loading || !search.trim()} style={{ ...s.btnPrimary, opacity: loading || !search.trim() ? 0.6 : 1 }}>
          {loading ? '…' : 'Search'}
        </button>
      </div>
      {loading ? (
        <div style={s.empty}>Searching…</div>
      ) : results.length === 0 && search.trim() ? (
        <div style={s.emptyState}>
          <div style={s.emptyIcon}>🔍</div>
          <div style={s.emptyTitle}>No results found</div>
          <div style={s.emptySub}>Try a different search term.</div>
        </div>
      ) : results.length === 0 ? (
        <div style={s.emptyState}>
          <div style={s.emptyIcon}>🛒</div>
          <div style={s.emptyTitle}>Find books from online bookstores</div>
          <div style={s.emptySub}>Search for a book to see where you can buy it from Bookshop.org, ThriftBooks, AbeBooks, and more.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {results.map(book => (
            <div key={book.key} style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ width: 60, height: 90, borderRadius: 6, overflow: 'hidden', background: '#d4c9b0', flexShrink: 0 }}>
                {book.coverUrl ? (
                  <img src={book.coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'rgba(255,255,255,0.8)', fontFamily: 'Georgia, serif', textAlign: 'center', padding: 4 }}>{book.title?.slice(0, 30)}</div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 15, color: theme.text, marginBottom: 2 }}>{book.title}</div>
                <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 2 }}>{book.author}{book.year ? ` · ${book.year}` : ''}</div>
                {book.isbn && <div style={{ fontSize: 12, color: theme.textSubtle, fontFamily: 'monospace', marginBottom: 8 }}>ISBN: {book.isbn}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a
                    href={book.isbn ? `https://bookshop.org/a/122832/${book.isbn}` : `https://bookshop.org/search?keywords=${encodeURIComponent(book.title)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(90,122,90,0.1)', border: '1px solid rgba(90,122,90,0.2)', fontSize: 12, color: '#5a7a5a', textDecoration: 'none', fontWeight: 600 }}
                  >Bookshop.org →</a>
                  <a
                    href={`https://www.thriftbooks.com/browse/?b.search=${encodeURIComponent(book.isbn || book.title)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(192,82,30,0.08)', border: '1px solid rgba(192,82,30,0.15)', fontSize: 12, color: '#c0521e', textDecoration: 'none', fontWeight: 600 }}
                  >ThriftBooks →</a>
                  <a
                    href={book.isbn ? `https://www.abebooks.com/servlet/SearchResults?isbn=${book.isbn}` : `https://www.abebooks.com/servlet/SearchResults?tn=${encodeURIComponent(book.title)}&an=${encodeURIComponent(book.author || '')}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(184,134,11,0.08)', border: '1px solid rgba(184,134,11,0.2)', fontSize: 12, color: '#9a7200', textDecoration: 'none', fontWeight: 600 }}
                  >AbeBooks →</a>
                  <a
                    href={book.isbn ? `https://www.amazon.com/s?k=${book.isbn}` : `https://www.amazon.com/s?k=${encodeURIComponent(book.title + ' ' + (book.author || ''))}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ padding: '6px 14px', borderRadius: 8, background: theme.bgCard, border: `1px solid ${theme.border}`, fontSize: 12, color: theme.text, textDecoration: 'none', fontWeight: 600 }}
                  >Amazon →</a>
                  {book.isbn && (
                    <a
                      href={`https://openlibrary.org/isbn/${book.isbn}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ padding: '6px 14px', borderRadius: 8, background: theme.bgCard, border: `1px solid ${theme.border}`, fontSize: 12, color: theme.textSubtle, textDecoration: 'none', fontWeight: 600 }}
                    >Open Library →</a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ---- SELLING TAB ----
function SellingTab({ activeListings, historyListings, sellingOrders, pendingByListing, myProfile, loading, onRemove, onMarkSold, onConfirmOrder, onDeclineOrder, onMarkShipped, navigate, s, theme }) {
  if (loading) return <div style={s.empty}>Loading…</div>

  if (!activeListings.length && !historyListings.length) {
    return (
      <div style={s.emptyState}>
        <div style={s.emptyIcon}>📦</div>
        <div style={s.emptyTitle}>Nothing listed yet</div>
        <div style={s.emptySub}>Go to your Library, open a book's status menu, and choose "List for sale".</div>
        <button style={s.btnPrimary} onClick={() => navigate('/')}>Go to Library</button>
      </div>
    )
  }

  return (
    <>
      {activeListings.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={s.sectionTitle}>
            Active Listings <span style={s.sectionCount}>{activeListings.length}</span>
          </div>
          <div style={s.myListingList}>
            {activeListings.map(l => (
              <MyListingCard
                key={l.id}
                listing={l}
                pendingCount={pendingByListing[l.id] || 0}
                onRemove={onRemove}
                onMarkSold={onMarkSold}
                s={s}
                theme={theme}
              />
            ))}
          </div>
        </div>
      )}

      {sellingOrders.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={s.sectionTitle}>
            Incoming Orders <span style={s.sectionCount}>{sellingOrders.length}</span>
          </div>
          <div>
            {sellingOrders.map(order => (
              <SellerOrderRow
                key={order.id}
                order={order}
                myProfile={myProfile}
                onConfirm={onConfirmOrder}
                onDecline={onDeclineOrder}
                onMarkShipped={onMarkShipped}
                s={s}
                theme={theme}
              />
            ))}
          </div>
        </div>
      )}

      {historyListings.length > 0 && (
        <div>
          <div style={{ ...s.sectionTitle, color: theme.textSubtle }}>
            History <span style={s.sectionCount}>{historyListings.length}</span>
          </div>
          <div style={s.myListingList}>
            {historyListings.map(l => (
              <MyListingCard
                key={l.id}
                listing={l}
                pendingCount={0}
                onRemove={onRemove}
                onMarkSold={onMarkSold}
                s={s}
                theme={theme}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ---- PURCHASES TAB ----
function PurchasesTab({ pendingPurchases, completedPurchases, loading, onCancel, onMarkReceived, navigate, s, theme }) {
  if (loading) return <div style={s.empty}>Loading…</div>

  if (!pendingPurchases.length && !completedPurchases.length) {
    return (
      <div style={s.emptyState}>
        <div style={s.emptyIcon}>🛒</div>
        <div style={s.emptyTitle}>No purchases yet</div>
        <div style={s.emptySub}>Browse the marketplace and place your first order.</div>
      </div>
    )
  }

  return (
    <>
      {pendingPurchases.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={s.sectionTitle}>
            Active Orders <span style={s.sectionCount}>{pendingPurchases.length}</span>
          </div>
          {pendingPurchases.map(order => (
            <BuyerOrderRow
              key={order.id}
              order={order}
              onCancel={onCancel}
              onMarkReceived={onMarkReceived}
              navigate={navigate}
              s={s}
              theme={theme}
            />
          ))}
        </div>
      )}

      {completedPurchases.length > 0 && (
        <div>
          <div style={{ ...s.sectionTitle, color: theme.textSubtle }}>
            Order History <span style={s.sectionCount}>{completedPurchases.length}</span>
          </div>
          {completedPurchases.map(order => (
            <BuyerOrderRow
              key={order.id}
              order={order}
              onCancel={onCancel}
              onMarkReceived={onMarkReceived}
              navigate={navigate}
              s={s}
              theme={theme}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ---- LISTING CARD (browse grid) ----
function ListingCard({ listing, onSelect, s }) {
  const book   = listing.books
  const seller = listing.profiles
  const cond   = CONDITION_META[listing.condition] || CONDITION_META.good

  return (
    <div style={s.listingCard} onClick={() => onSelect(listing)}>
      <div style={s.listingCover}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <FakeCover title={book.title} />
        }
      </div>
      <div style={s.listingInfo}>
        <div style={s.listingTitle}>{book.title}</div>
        <div style={s.listingAuthor}>{book.author}</div>
        <div style={{ marginTop: 8 }}>
          <span style={{ ...s.condBadge, background: cond.bg, color: cond.color }}>{cond.label}</span>
        </div>
        <div style={s.listingFooter}>
          <div style={s.listingPrice}>${Number(listing.price).toFixed(2)}</div>
          <div style={s.listingSeller}>by {seller?.username}</div>
        </div>
      </div>
    </div>
  )
}

// ---- MY LISTING CARD (selling) ----
function MyListingCard({ listing, pendingCount, onRemove, onMarkSold, s, theme }) {
  const book  = listing.books
  const cond  = CONDITION_META[listing.condition] || CONDITION_META.good
  const [acting, setActing] = useState(false)

  const statusMeta = {
    active:  { label: 'Active',  bg: 'rgba(90,122,90,0.15)',   color: theme.sage },
    sold:    { label: 'Sold',    bg: 'rgba(138,127,114,0.15)', color: theme.textSubtle },
    removed: { label: 'Removed', bg: 'rgba(192,82,30,0.10)',   color: theme.rust },
  }
  const sm = statusMeta[listing.status] || statusMeta.active

  async function act(fn, id) {
    setActing(true)
    await fn(id)
    setActing(false)
  }

  return (
    <div style={s.myListingCard}>
      <div style={s.myListingCover}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
          : <MiniCover title={book.title} />
        }
      </div>
      <div style={s.myListingInfo}>
        <div style={s.listingTitle}>{book.title}</div>
        <div style={s.listingAuthor}>{book.author}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ ...s.condBadge, background: cond.bg, color: cond.color }}>{cond.label}</span>
          <span style={{ ...s.condBadge, background: sm.bg, color: sm.color }}>{sm.label}</span>
          {pendingCount > 0 && (
            <span style={s.offerBadge}>{pendingCount} offer{pendingCount > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      <div style={s.myListingRight}>
        <div style={s.listingPrice}>${Number(listing.price).toFixed(2)}</div>
        {listing.status === 'active' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button style={s.btnSold} onClick={() => act(onMarkSold, listing.id)} disabled={acting}>
              {acting ? '…' : 'Mark Sold'}
            </button>
            <button style={s.btnRemove} onClick={() => act(onRemove, listing.id)} disabled={acting}>
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- SELLER ORDER ROW ----
function SellerOrderRow({ order, myProfile, onConfirm, onDecline, onMarkShipped, s, theme }) {
  const [acting, setActing] = useState(false)
  const book    = order.listings?.books
  const buyer   = order.profiles
  const cond    = CONDITION_META[order.listings?.condition] || CONDITION_META.good
  const smeta   = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.pending

  async function act(fn) {
    setActing(true)
    await fn()
    setActing(false)
  }

  return (
    <div style={s.orderCard}>
      <div style={s.orderCover}>
        {book?.cover_image_url
          ? <img src={book.cover_image_url} alt={book?.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
          : <MiniCover title={book?.title || '?'} />
        }
      </div>
      <div style={s.orderInfo}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{book?.title}</div>
        <div style={{ fontSize: 12, color: theme.textSubtle }}>{book?.author}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
          <span style={{ ...s.condBadge, background: cond.bg, color: cond.color }}>{cond.label}</span>
          <span style={{ ...s.condBadge, background: smeta.bg, color: smeta.color }}>{smeta.label}</span>
        </div>
        <div style={s.orderMeta}>From: <strong>{buyer?.username}</strong></div>
        {order.buyer_message && (
          <div style={s.orderMsg}>{order.buyer_message}</div>
        )}
        {order.shipping_address && (
          <div style={s.orderAddr}>Ship to: {order.shipping_address}</div>
        )}
      </div>
      <div style={s.orderRight}>
        <div style={{ ...s.listingPrice, fontSize: 18 }}>${Number(order.price).toFixed(2)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, alignItems: 'flex-end' }}>
          {order.status === 'pending' && (
            <>
              <button style={s.btnConfirm} disabled={acting} onClick={() => act(() => onConfirm(order.id, order.listing_id))}>
                {acting ? '…' : 'Confirm'}
              </button>
              <button style={s.btnDecline} disabled={acting} onClick={() => act(() => onDecline(order.id))}>
                Decline
              </button>
            </>
          )}
          {order.status === 'confirmed' && (
            <>
              {(myProfile.paypal_handle || myProfile.venmo_handle) ? (
                <div style={{ fontSize: 11, color: theme.textSubtle, textAlign: 'right', marginBottom: 6, lineHeight: 1.4 }}>
                  Waiting for payment via{' '}
                  {[myProfile.paypal_handle && 'PayPal', myProfile.venmo_handle && 'Venmo'].filter(Boolean).join(' or ')}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: theme.rust, textAlign: 'right', marginBottom: 6, lineHeight: 1.4 }}>
                  Add PayPal/Venmo in your profile so buyers can pay you.
                </div>
              )}
              <button style={s.btnShip} disabled={acting} onClick={() => act(() => onMarkShipped(order.id))}>
                {acting ? '…' : 'Mark Shipped'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- BUYER ORDER ROW ----
function BuyerOrderRow({ order, onCancel, onMarkReceived, navigate, s, theme }) {
  const [acting, setActing] = useState(false)
  const book   = order.listings?.books
  const seller = order.profiles
  const cond   = CONDITION_META[order.listings?.condition] || CONDITION_META.good
  const smeta  = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.pending

  async function act(fn) {
    setActing(true)
    await fn()
    setActing(false)
  }

  return (
    <div style={s.orderCard}>
      <div style={s.orderCover}>
        {book?.cover_image_url
          ? <img src={book.cover_image_url} alt={book?.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
          : <MiniCover title={book?.title || '?'} />
        }
      </div>
      <div style={s.orderInfo}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{book?.title}</div>
        <div style={{ fontSize: 12, color: theme.textSubtle }}>{book?.author}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
          <span style={{ ...s.condBadge, background: cond.bg, color: cond.color }}>{cond.label}</span>
          <span style={{ ...s.condBadge, background: smeta.bg, color: smeta.color }}>{smeta.label}</span>
        </div>
        <div style={s.orderMeta}>
          Seller:{' '}
          <span
            style={{ color: theme.rust, cursor: 'pointer', fontWeight: 500 }}
            onClick={() => navigate(`/profile/${seller?.username}`)}>
            {seller?.username}
          </span>
        </div>
        {order.buyer_message && (
          <div style={s.orderMsg}>Your note: {order.buyer_message}</div>
        )}
        {order.shipping_address && (
          <div style={s.orderAddr}>Ship to: {order.shipping_address}</div>
        )}
      </div>
      <div style={s.orderRight}>
        <div style={{ ...s.listingPrice, fontSize: 18 }}>${Number(order.price).toFixed(2)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, alignItems: 'flex-end' }}>
          {order.status === 'confirmed' && (
            <PaymentButtons seller={seller} amount={order.price} book={book} theme={theme} />
          )}
          {(order.status === 'pending' || order.status === 'confirmed') && (
            <button style={s.btnCancel} disabled={acting} onClick={() => act(() => onCancel(order.id))}>
              {acting ? '…' : 'Cancel'}
            </button>
          )}
          {order.status === 'shipped' && (
            <button style={s.btnReceived} disabled={acting} onClick={() => act(() => onMarkReceived(order.id))}>
              {acting ? '…' : 'Mark Received'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- PAYMENT BUTTONS ----
function PaymentButtons({ seller, amount, book, theme }) {
  if (!seller?.paypal_handle && !seller?.venmo_handle) {
    return (
      <div style={{ fontSize: 11, color: theme.textSubtle, textAlign: 'right', lineHeight: 1.4 }}>
        Seller hasn't added payment info yet. Contact them to arrange payment.
      </div>
    )
  }
  const note  = encodeURIComponent(`Book: ${book?.title || 'purchase'}`)
  const amt   = Number(amount).toFixed(2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: theme.textSubtle, textAlign: 'right' }}>
        Pay seller now:
      </div>
      {seller.paypal_handle && (
        <a
          href={`https://paypal.me/${seller.paypal_handle}/${amt}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, textDecoration: 'none',
            background: '#003087', color: 'white',
            fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <span style={{ fontSize: 14 }}>𝐏</span> PayPal ${amt}
        </a>
      )}
      {seller.venmo_handle && (
        <a
          href={`https://venmo.com/${seller.venmo_handle}?txn=pay&amount=${amt}&note=${note}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, textDecoration: 'none',
            background: '#008CFF', color: 'white',
            fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <span style={{ fontSize: 14 }}>✌</span> Venmo ${amt}
        </a>
      )}
    </div>
  )
}

// ---- LISTING DETAIL MODAL ----
function ListingDetailModal({ listing, onClose, onBuyNow, navigate, s, theme, isMobile }) {
  const book   = listing.books
  const seller = listing.profiles
  const cond   = CONDITION_META[listing.condition] || CONDITION_META.good

  // Close on overlay click
  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div style={s.overlay} onClick={handleOverlayClick}>
      <div style={{
        background: theme.bgCard,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        width: '100%',
        maxWidth: isMobile ? '100%' : 740,
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        position: 'relative',
      }}>
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 14, right: 14, zIndex: 10,
            background: theme.bgSubtle, border: 'none', borderRadius: '50%',
            width: 32, height: 32, fontSize: 18, lineHeight: '32px', textAlign: 'center',
            cursor: 'pointer', color: theme.textSubtle, padding: 0,
          }}>
          ×
        </button>

        {/* Cover */}
        <div style={{
          width: isMobile ? '100%' : 280,
          minHeight: isMobile ? 220 : 'auto',
          flexShrink: 0,
          background: theme.bgSubtle,
          borderRadius: isMobile ? '16px 16px 0 0' : '16px 0 0 16px',
          overflow: 'hidden',
        }}>
          {book.cover_image_url
            ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <FakeCover title={book.title} />
          }
        </div>

        {/* Details */}
        <div style={{ flex: 1, padding: isMobile ? '24px 20px' : '32px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: theme.text, margin: '0 0 4px', paddingRight: 36 }}>
              {book.title}
            </h2>
            <div style={{ fontSize: 15, color: theme.textSubtle }}>{book.author}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...s.condBadge, background: cond.bg, color: cond.color, fontSize: 12 }}>{cond.label}</span>
          </div>

          {listing.description && (
            <p style={{ fontSize: 14, color: theme.textMuted, lineHeight: 1.6, margin: 0 }}>
              {listing.description}
            </p>
          )}

          <div style={{ fontFamily: 'Georgia, serif', fontSize: 34, fontWeight: 700, color: theme.text, margin: '4px 0' }}>
            ${Number(listing.price).toFixed(2)}
          </div>

          <div style={{ fontSize: 14, color: theme.textSubtle }}>
            Sold by{' '}
            <span
              style={{ color: theme.rust, cursor: 'pointer', fontWeight: 600 }}
              onClick={() => { onClose(); navigate(`/profile/${seller?.username}`) }}>
              {seller?.username}
            </span>
          </div>

          {(seller?.paypal_handle || seller?.venmo_handle) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: theme.textSubtle }}>Accepts:</span>
              {seller.paypal_handle && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(0,48,135,0.12)', color: '#003087' }}>
                  💳 PayPal
                </span>
              )}
              {seller.venmo_handle && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(0,140,255,0.12)', color: '#0070e0' }}>
                  ✌ Venmo
                </span>
              )}
            </div>
          )}

          <button
            style={{ ...s.btnPrimary, fontSize: 15, padding: '12px 24px', marginTop: 8, alignSelf: 'flex-start' }}
            onClick={() => onBuyNow(listing)}>
            Buy Now
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- BUY MODAL ----
function BuyModal({ listing, session, onClose, onSuccess, s, theme, isMobile }) {
  const book = listing.books
  const [message, setMessage]   = useState('')
  const [address, setAddress]   = useState('')
  const [placing, setPlacing]   = useState(false)
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState('')

  async function placeOrder() {
    if (!address.trim()) { setError('Please enter a shipping address.'); return }
    setPlacing(true)
    setError('')
    const { error: err } = await supabase.from('orders').insert({
      listing_id:       listing.id,
      buyer_id:         session.user.id,
      seller_id:        listing.profiles?.id,
      price:            listing.price,
      status:           'pending',
      buyer_message:    message.trim() || null,
      shipping_address: address.trim(),
    })
    setPlacing(false)
    if (err) { setError(err.message); return }
    setDone(true)
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    background: theme.bgSubtle,
    color: theme.text,
    boxSizing: 'border-box',
    resize: 'vertical',
  }

  return (
    <div style={s.overlay} onClick={handleOverlayClick}>
      <div style={{
        background: theme.bgCard,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        width: '100%',
        maxWidth: 480,
        padding: isMobile ? '24px 20px' : '32px 32px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
        position: 'relative',
      }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 14, right: 14,
            background: theme.bgSubtle, border: 'none', borderRadius: '50%',
            width: 32, height: 32, fontSize: 18, lineHeight: '32px', textAlign: 'center',
            cursor: 'pointer', color: theme.textSubtle, padding: 0,
          }}>
          ×
        </button>

        {done ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, margin: '0 0 8px' }}>
              Order Placed!
            </h3>
            <p style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 24 }}>
              Your order for <em>{book.title}</em> has been sent to the seller. You'll see it in your Purchases tab.
            </p>
            <button style={{ ...s.btnPrimary, fontSize: 14, padding: '10px 24px' }} onClick={onSuccess}>
              Done
            </button>
          </div>
        ) : (
          <>
            <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, margin: '0 0 4px', paddingRight: 36 }}>
              Place Order
            </h3>
            <p style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 20 }}>
              {book.title} — <strong style={{ fontFamily: 'Georgia, serif', color: theme.text }}>${Number(listing.price).toFixed(2)}</strong>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: theme.text, display: 'block', marginBottom: 6 }}>
                  Shipping Address <span style={{ color: theme.rust }}>*</span>
                </label>
                <textarea
                  style={{ ...inputStyle, minHeight: 72 }}
                  placeholder="Street, City, State, ZIP, Country"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: theme.text, display: 'block', marginBottom: 6 }}>
                  Message to Seller <span style={{ color: theme.textSubtle, fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  style={{ ...inputStyle, minHeight: 72 }}
                  placeholder="Any notes for the seller…"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                />
              </div>

              {error && (
                <div style={{ fontSize: 13, color: theme.rust, background: 'rgba(192,82,30,0.08)', padding: '8px 12px', borderRadius: 8 }}>
                  {error}
                </div>
              )}

              <button
                style={{ ...s.btnPrimary, fontSize: 15, padding: '12px', width: '100%' }}
                onClick={placeOrder}
                disabled={placing}>
                {placing ? 'Placing Order…' : 'Place Order'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---- FAKE COVERS ----
function FakeCover({ title }) {
  const colors = ['#7b4f3a', '#4a6b8a', '#5a7a5a', '#2c3e50', '#8b2500', '#b8860b', '#3d5a5a', '#c0521e']
  const c  = colors[title.charCodeAt(0) % colors.length]
  const c2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return (
    <div style={{ width: '100%', height: '100%', borderRadius: 6, background: `linear-gradient(135deg, ${c}, ${c2})`, display: 'flex', alignItems: 'flex-end', padding: '8px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: 'rgba(0,0,0,0.2)' }} />
      <span style={{ fontSize: 8, fontWeight: 500, color: 'rgba(255,255,255,0.9)', lineHeight: 1.3, position: 'relative', zIndex: 1 }}>{title}</span>
    </div>
  )
}

function MiniCover({ title }) {
  const colors = ['#7b4f3a', '#4a6b8a', '#5a7a5a', '#2c3e50', '#8b2500', '#b8860b', '#3d5a5a', '#c0521e']
  const c  = colors[title.charCodeAt(0) % colors.length]
  const c2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return <div style={{ width: '100%', height: '100%', borderRadius: 4, background: `linear-gradient(135deg, ${c}, ${c2})` }} />
}

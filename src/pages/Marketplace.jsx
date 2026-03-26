import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'

const CONDITION_META = {
  like_new:   { label: 'Like New',   color: '#5a7a5a', bg: 'rgba(90,122,90,0.12)' },
  very_good:  { label: 'Very Good',  color: '#2e7d4f', bg: 'rgba(46,125,79,0.10)' },
  good:       { label: 'Good',       color: '#b8860b', bg: 'rgba(184,134,11,0.12)' },
  acceptable: { label: 'Acceptable', color: '#c0521e', bg: 'rgba(192,82,30,0.10)' },
  poor:       { label: 'Poor',       color: '#8a7f72', bg: 'rgba(138,127,114,0.12)' },
}

export default function Marketplace({ session }) {
  const { theme } = useTheme()
  const navigate  = useNavigate()
  const [tab, setTab]           = useState('browse')
  const [listings, setListings] = useState([])
  const [myListings, setMyListings] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [condFilter, setCondFilter] = useState('all')
  useEffect(() => {
    fetchListings()
  }, [])

  async function fetchListings() {
    setLoading(true)
    const [{ data: all }, { data: mine }] = await Promise.all([
      supabase
        .from('listings')
        .select(`
          id, price, condition, description, created_at,
          books ( id, title, author, cover_image_url ),
          profiles!listings_seller_id_fkey ( id, username )
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
    ])
    setListings(all || [])
    setMyListings(mine || [])
    setLoading(false)
  }

  async function removeListing(id) {
    await supabase.from('listings').update({ status: 'removed' }).eq('id', id)
    fetchListings()
  }

  async function markSold(id) {
    await supabase.from('listings').update({ status: 'sold' }).eq('id', id)
    fetchListings()
  }

  const filtered = listings.filter(l => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      l.books?.title?.toLowerCase().includes(q) ||
      l.books?.author?.toLowerCase().includes(q) ||
      l.profiles?.username?.toLowerCase().includes(q)
    const matchCond = condFilter === 'all' || l.condition === condFilter
    return matchSearch && matchCond
  })

  const s = {
    page:          { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    btnPrimary:    { padding: '8px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:      { padding: '6px 12px', background: 'none', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.text },
    btnSold:       { padding: '5px 12px', background: theme.sage, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnRemove:     { padding: '5px 12px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    content:       { padding: '32px 32px', maxWidth: 1100, margin: '0 auto' },
    pageHeader:    { marginBottom: 28 },
    pageTitle:     { fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 700, color: theme.text, margin: '0 0 6px' },
    pageSubtitle:  { fontSize: 14, color: theme.textSubtle, margin: 0 },
    tabRow:        { display: 'flex', gap: 0, marginBottom: 28, borderBottom: `1px solid ${theme.border}` },
    tabActive:     { padding: '10px 20px', background: theme.rust, color: 'white', border: 'none', borderBottom: `2px solid ${theme.rust}`, marginBottom: -1, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    tabInactive:   { padding: '10px 20px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: 14, color: theme.textSubtle, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    searchRow:     { marginBottom: 14 },
    searchInput:   { width: '100%', maxWidth: 400, padding: '9px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    filterRow:     { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
    filterActive:  { padding: '6px 14px', borderRadius: 8, border: 'none', background: theme.rust, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    filterInactive:{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    grid:          { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20 },
    listingCard:   { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: theme.shadowCard, transition: 'box-shadow 0.15s' },
    listingCover:  { width: '100%', aspectRatio: '3/2', background: theme.bgSubtle },
    listingInfo:   { padding: '14px' },
    listingTitle:  { fontSize: 14, fontWeight: 600, color: theme.text, lineHeight: 1.3, marginBottom: 2 },
    listingAuthor: { fontSize: 12, color: theme.textSubtle },
    listingDesc:   { fontSize: 12, color: theme.textMuted, marginTop: 6, lineHeight: 1.5 },
    listingFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10 },
    listingPrice:  { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text },
    listingSeller: { fontSize: 12, color: theme.textSubtle },
    sellerLink:    { color: theme.rust, cursor: 'pointer', fontWeight: 500 },
    condBadge:     { display: 'inline-block', fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 500 },
    contactBtn:    { marginTop: 12, width: '100%', padding: '8px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    sectionTitle:  { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, color: theme.text },
    sectionCount:  { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(192,82,30,0.1)', color: theme.rust, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 },
    myListingList: { display: 'flex', flexDirection: 'column', gap: 12 },
    myListingCard: { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '16px', display: 'flex', gap: 14, alignItems: 'flex-start' },
    myListingCover:{ width: 52, height: 78, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: theme.bgSubtle },
    myListingInfo: { flex: 1 },
    myListingRight:{ flexShrink: 0, textAlign: 'right' },
    externalBox:   { textAlign: 'center', padding: '80px 0' },
    externalIcon:  { fontSize: 56, marginBottom: 20 },
    comingSoonBadge: { display: 'inline-block', background: 'rgba(184,134,11,0.12)', color: theme.gold, border: '1px solid rgba(184,134,11,0.3)', borderRadius: 20, padding: '6px 20px', fontSize: 13, fontWeight: 600 },
    empty:         { color: theme.textSubtle, fontSize: 14, padding: '60px 0', textAlign: 'center' },
    emptyState:    { textAlign: 'center', padding: '60px 0' },
    emptyIcon:     { fontSize: 48, marginBottom: 16 },
    emptyTitle:    { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, marginBottom: 8 },
    emptySub:      { fontSize: 14, color: theme.textSubtle, marginBottom: 20 },
  }

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
            { key: 'browse',   label: 'Browse' },
            { key: 'selling',  label: `My Listings${myListings.filter(l => l.status === 'active').length ? ` (${myListings.filter(l => l.status === 'active').length})` : ''}` },
            { key: 'external', label: 'External' },
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
            navigate={navigate}
            s={s}
          />
        )}
        {tab === 'selling' && (
          <SellingTab
            listings={myListings}
            loading={loading}
            onRemove={removeListing}
            onMarkSold={markSold}
            navigate={navigate}
            s={s}
            theme={theme}
          />
        )}
        {tab === 'external' && <ExternalTab s={s} theme={theme} />}
      </div>
    </div>
  )
}

// ---- BROWSE TAB ----
function BrowseTab({ listings, loading, search, onSearch, condFilter, onCondFilter, navigate, s }) {
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
            {search ? 'Try a different search term.' : 'Be the first to list a book — use "List for sale" from your Library.'}
          </div>
        </div>
      ) : (
        <div style={s.grid}>
          {listings.map(l => (
            <ListingCard key={l.id} listing={l} navigate={navigate} s={s} />
          ))}
        </div>
      )}
    </>
  )
}

// ---- SELLING TAB ----
function SellingTab({ listings, loading, onRemove, onMarkSold, navigate, s, theme }) {
  const active  = listings.filter(l => l.status === 'active')
  const history = listings.filter(l => l.status !== 'active')

  if (loading) return <div style={s.empty}>Loading…</div>

  if (!listings.length) {
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
      {active.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={s.sectionTitle}>
            Active Listings <span style={s.sectionCount}>{active.length}</span>
          </div>
          <div style={s.myListingList}>
            {active.map(l => (
              <MyListingCard key={l.id} listing={l} onRemove={onRemove} onMarkSold={onMarkSold} s={s} theme={theme} />
            ))}
          </div>
        </div>
      )}
      {history.length > 0 && (
        <div>
          <div style={{ ...s.sectionTitle, color: theme.textSubtle }}>
            History <span style={s.sectionCount}>{history.length}</span>
          </div>
          <div style={s.myListingList}>
            {history.map(l => (
              <MyListingCard key={l.id} listing={l} onRemove={onRemove} onMarkSold={onMarkSold} s={s} theme={theme} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ---- EXTERNAL TAB ----
function ExternalTab({ s, theme }) {
  return (
    <div style={s.externalBox}>
      <div style={s.externalIcon}>🔗</div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, marginBottom: 8 }}>
        External Marketplace
      </div>
      <div style={{ fontSize: 14, color: theme.textSubtle, maxWidth: 420, lineHeight: 1.7, marginBottom: 24 }}>
        Search eBay, AbeBooks, and other platforms for books not listed on Ex Libris.
        This feature is coming soon — we'll show sold prices to help you find fair deals.
      </div>
      <div style={s.comingSoonBadge}>Coming Soon</div>
    </div>
  )
}

// ---- LISTING CARD (browse) ----
function ListingCard({ listing, navigate, s }) {
  const book  = listing.books
  const seller = listing.profiles
  const cond  = CONDITION_META[listing.condition] || CONDITION_META.good

  return (
    <div style={s.listingCard}>
      <div style={s.listingCover}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
          : <FakeCover title={book.title} />
        }
      </div>
      <div style={s.listingInfo}>
        <div style={s.listingTitle}>{book.title}</div>
        <div style={s.listingAuthor}>{book.author}</div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...s.condBadge, background: cond.bg, color: cond.color }}>{cond.label}</span>
        </div>
        {listing.description && (
          <div style={s.listingDesc}>{listing.description}</div>
        )}
        <div style={s.listingFooter}>
          <div style={s.listingPrice}>${Number(listing.price).toFixed(2)}</div>
          <div style={s.listingSeller}>
            by{' '}
            <span style={s.sellerLink} onClick={() => navigate(`/profile/${seller?.username}`)}>
              {seller?.username}
            </span>
          </div>
        </div>
        <button style={s.contactBtn} onClick={() => navigate(`/profile/${seller?.username}`)}>
          View Seller
        </button>
      </div>
    </div>
  )
}

// ---- MY LISTING CARD ----
function MyListingCard({ listing, onRemove, onMarkSold, s, theme }) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{ ...s.condBadge, background: cond.bg, color: cond.color }}>{cond.label}</span>
          <span style={{ ...s.condBadge, background: sm.bg, color: sm.color }}>{sm.label}</span>
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

// ---- FAKE COVERS ----
function FakeCover({ title }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
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
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const c  = colors[title.charCodeAt(0) % colors.length]
  const c2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return <div style={{ width: '100%', height: '100%', borderRadius: 4, background: `linear-gradient(135deg, ${c}, ${c2})` }} />
}

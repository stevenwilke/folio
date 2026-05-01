import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SearchModal from './SearchModal'
import GlobalSearchModal from './GlobalSearchModal'
import GoodreadsImportModal from './GoodreadsImportModal'
import { triggerTutorial } from './TutorialOverlay'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import LevelAvatar from './LevelAvatar'
import { notify } from '../lib/notify'
import { NOTIF_ICONS, LEGACY_INAPP_FILTER } from '../lib/notifTypes'
import { clearCachedUsername } from '../lib/currentUser'

const NAV_ITEMS = [
  { label: 'Library',     path: '/' },
  { label: 'Catalog',     path: '/catalog' },
  { label: 'Discover',    path: '/discover' },
  { label: 'Feed',        path: '/feed' },
  { label: 'Friends',     path: '/friends' },
  { label: 'Loans',       path: '/loans' },
  { label: 'Marketplace', path: '/marketplace' },
  { label: 'Nearby',      path: '/nearby' },
  { label: 'Clubs',       path: '/clubs' },
]

// Module-level cache — survives React navigation without re-fetching
let _cachedId       = null
let _cachedProfile  = null  // { username, avatar_url }

export default function NavBar({ session, extra }) {
  const navigate    = useNavigate()
  const location    = useLocation()
  const dropdownRef = useRef(null)
  const { theme, isDark, toggleTheme } = useTheme()
  const isMobile    = useIsMobile()

  const [profile, setProfile] = useState(
    session?.user?.id === _cachedId ? _cachedProfile : null
  )
  const [showSearch,       setShowSearch]       = useState(false)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [showBell,         setShowBell]         = useState(false)
  const [showMenu,     setShowMenu]     = useState(false)
  const [showAvatar,   setShowAvatar]   = useState(false)
  const [showImport,   setShowImport]   = useState(false)
  const [friendReqs,   setFriendReqs]   = useState([])
  const [borrowNotifs, setBorrowNotifs] = useState([])
  const [orderNotifs,  setOrderNotifs]  = useState([])
  const [unifiedNotifs, setUnifiedNotifs] = useState([])
  const avatarRef = useRef(null)
  const goodreadsImported = !!localStorage.getItem('exlibris-goodreads-imported')

  // Close mobile menu when route changes
  useEffect(() => { setShowMenu(false) }, [location.pathname])

  useEffect(() => {
    function onAdd() { setShowSearch(true) }
    window.addEventListener('exlibris:open-add', onAdd)
    return () => window.removeEventListener('exlibris:open-add', onAdd)
  }, [])
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowGlobalSearch(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Fetch + cache profile (username + avatar + admin flag)
  useEffect(() => {
    if (!session) return
    if (session.user.id === _cachedId && _cachedProfile) return
    Promise.all([
      supabase.from('profiles').select('username, avatar_url, is_admin, level, level_points')
        .eq('id', session.user.id).maybeSingle(),
      supabase.from('authors').select('id', { head: false, count: 'exact' })
        .eq('claimed_by', session.user.id).eq('is_verified', true).limit(1),
    ]).then(([{ data }, { data: claimed }]) => {
      _cachedId      = session.user.id
      _cachedProfile = data ? {
        username: data.username,
        avatar_url: data.avatar_url,
        is_admin: !!data.is_admin,
        level: data.level ?? 1,
        level_points: data.level_points ?? 0,
        is_author: !!(claimed && claimed.length > 0),
      } : null
      setProfile(_cachedProfile)
    })
  }, [session?.user?.id])

  // Fetch notifications
  useEffect(() => {
    if (!session) return
    fetchNotifications()
    // Refresh every 60 seconds
    const interval = setInterval(fetchNotifications, 60_000)
    return () => clearInterval(interval)
  }, [session?.user?.id])

  async function fetchNotifications() {
    const [{ data: friendsRaw }, { data: borrows }, { data: orderRows }] = await Promise.all([
      supabase
        .from('friendships')
        .select('id, requester_id, created_at')
        .eq('addressee_id', session.user.id)
        .eq('status', 'pending'),
      supabase
        .from('borrow_requests')
        .select('id, requester_id, created_at, books(title)')
        .eq('owner_id', session.user.id)
        .eq('status', 'pending'),
      supabase
        .from('orders')
        .select('id, price, created_at, buyer_id, listings(books(title))')
        .eq('seller_id', session.user.id)
        .eq('status', 'pending'),
    ])

    // Resolve friend requester usernames separately
    let friends = friendsRaw || []
    if (friends.length) {
      const requesterIds = friends.map(f => f.requester_id)
      const { data: fps } = await supabase.from('profiles').select('id, username').in('id', requesterIds)
      const fProfileMap = Object.fromEntries((fps || []).map(p => [p.id, p]))
      friends = friends.map(f => ({ ...f, profiles: fProfileMap[f.requester_id] || null }))
    }

    // Resolve borrow requester usernames separately
    let enrichedBorrows = borrows || []
    if (enrichedBorrows.length) {
      const borrowerIds = enrichedBorrows.map(r => r.requester_id)
      const { data: bps } = await supabase.from('profiles').select('id, username').in('id', borrowerIds)
      const bProfileMap = Object.fromEntries((bps || []).map(p => [p.id, p]))
      enrichedBorrows = enrichedBorrows.map(r => ({ ...r, profiles: bProfileMap[r.requester_id] || null }))
    }

    // Resolve buyer usernames separately (orders.buyer_id references auth.users, not profiles)
    let orders = orderRows || []
    if (orders.length) {
      const buyerIds = [...new Set(orders.map(o => o.buyer_id).filter(Boolean))]
      const { data: buyerProfiles } = await supabase
        .from('profiles').select('id, username').in('id', buyerIds)
      const profileMap = Object.fromEntries((buyerProfiles || []).map(p => [p.id, p.username]))
      orders = orders.map(o => ({ ...o, profiles: { username: profileMap[o.buyer_id] } }))
    }

    setFriendReqs(friends)
    setBorrowNotifs(enrichedBorrows)
    setOrderNotifs(orders)

    const { data: unified } = await supabase
      .from('notifications')
      .select('id, type, title, body, link, is_read, created_at')
      .eq('user_id', session.user.id)
      .eq('is_read', false)
      .not('type', 'in', LEGACY_INAPP_FILTER)
      .order('created_at', { ascending: false })
      .limit(20)
    setUnifiedNotifs(unified || [])
  }

  async function respondToFriend(id, accept) {
    if (accept) {
      await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
      const { data: row } = await supabase.from('friendships').select('requester_id').eq('id', id).maybeSingle()
      if (row?.requester_id) {
        const fromUsername = profile?.username || 'Someone'
        notify(row.requester_id, 'friend_accepted', {
          title: 'Friend request accepted',
          body: `${fromUsername} accepted your friend request`,
          link: `/profile/${fromUsername}`,
          metadata: { friendship_id: id },
        })
      }
    } else {
      await supabase.from('friendships').delete().eq('id', id)
    }
    fetchNotifications()
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowBell(false)
      if (avatarRef.current && !avatarRef.current.contains(e.target)) setShowAvatar(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const path      = location.pathname
  const bellCount = friendReqs.length + borrowNotifs.length + orderNotifs.length + unifiedNotifs.length

  function isActive(item) {
    if (item.path === '/') return path === '/'
    return path.startsWith(item.path)
  }

  function handleNavClick(itemPath) {
    setShowMenu(false)
    navigate(itemPath)
  }

  return (
    <>
      <div style={{ ...s.topbar, background: theme.navBg, padding: isMobile ? '12px 16px' : '12px 32px' }}>
        {/* Logo */}
        <div style={{ ...s.logo, color: theme.navText, fontSize: isMobile ? 18 : 22 }} onClick={() => navigate('/')} role="button" tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && navigate('/')}>
          Ex Libris
        </div>

        {isMobile ? (
          /* ── MOBILE TOPBAR ── */
          <div style={s.right}>
            {!session ? (
              <button style={s.addBtn} onClick={() => navigate('/auth')}>Sign In</button>
            ) : (
              <>
                {/* Global Search icon */}
                <button
                  data-tour="search"
                  onClick={() => setShowGlobalSearch(true)}
                  title="Search books"
                  style={{ ...s.bellBtn, color: theme.navText, borderColor: theme.border }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </button>
                {/* Add Book button */}
                <button data-tour="add-book" style={s.addBtn} onClick={() => setShowSearch(true)}>+ Add Book</button>

                {/* Notification bell */}
                <div style={{ position: 'relative' }} ref={dropdownRef}>
                  <button style={{ ...s.bellBtn, color: theme.navText, borderColor: theme.border }} onClick={() => setShowBell(v => !v)}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                    {bellCount > 0 && <span style={s.bellBadge}>{bellCount}</span>}
                  </button>
                  {showBell && (
                    <NotificationsDropdown
                      friendReqs={friendReqs}
                      borrowNotifs={borrowNotifs}
                      orderNotifs={orderNotifs}
                      unifiedNotifs={unifiedNotifs}
                      onRespondFriend={respondToFriend}
                      onViewLoans={() => { setShowBell(false); navigate('/loans') }}
                      onViewMarketplace={() => { setShowBell(false); navigate('/marketplace') }}
                      onNavigate={username => { setShowBell(false); navigate(`/profile/${username}`) }}
                      onUnifiedClick={(n) => {
                        setShowBell(false)
                        supabase.from('notifications').update({ is_read: true }).eq('id', n.id).then(() => {})
                        if (n.link) navigate(n.link)
                      }}
                      onClose={() => setShowBell(false)}
                      onViewAll={() => { setShowBell(false); navigate('/notifications') }}
                    />
                  )}
                </div>

                {/* Avatar — taps straight through to the profile page */}
                {profile?.username && (
                  <button
                    onClick={() => navigate(`/profile/${profile.username}`)}
                    title={profile.username}
                    style={{
                      background: 'transparent', border: 'none', padding: 0, marginLeft: 4,
                      cursor: 'pointer', flexShrink: 0, borderRadius: '50%',
                      outline: path.startsWith('/profile') ? '2px solid #c0521e' : 'none',
                      outlineOffset: 2,
                    }}
                  >
                    <LevelAvatar
                      src={profile.avatar_url}
                      name={profile.username}
                      size={28}
                      level={profile.level}
                      points={profile.level_points}
                    />
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          /* ── DESKTOP TOPBAR ── */
          <div style={s.right}>
            {!session ? (
              <button style={s.addBtn} onClick={() => navigate('/auth')}>Sign In</button>
            ) : (
              <>
                {NAV_ITEMS.map(item => (
                  <button key={item.path}
                    style={isActive(item)
                      ? { ...s.active, color: theme.rust, background: theme.bg, boxShadow: `0 0 0 1px ${theme.rust}40` }
                      : { ...s.ghost, color: theme.navText }}
                    onClick={() => navigate(item.path)}>
                    {item.label}
                  </button>
                ))}

                {/* Global Search icon */}
                <button
                  data-tour="search"
                  onClick={() => setShowGlobalSearch(true)}
                  title="Search books (⌘K)"
                  style={{ ...s.bellBtn, color: theme.navText, borderColor: theme.border, marginLeft: 4 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </button>

                <button data-tour="add-book" style={s.addBtn} onClick={() => setShowSearch(true)}>+ Add Book</button>

                {/* Slot for page-specific extras */}
                {extra}

            {/* Notification bell */}
            <div style={{ position: 'relative' }} ref={dropdownRef}>
              <button style={{ ...s.bellBtn, color: theme.navText, borderColor: theme.border }} onClick={() => setShowBell(v => !v)}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {bellCount > 0 && <span style={s.bellBadge}>{bellCount}</span>}
              </button>
              {showBell && (
                <NotificationsDropdown
                  friendReqs={friendReqs}
                  borrowNotifs={borrowNotifs}
                  orderNotifs={orderNotifs}
                  unifiedNotifs={unifiedNotifs}
                  onRespondFriend={respondToFriend}
                  onViewLoans={() => { setShowBell(false); navigate('/loans') }}
                  onViewMarketplace={() => { setShowBell(false); navigate('/marketplace') }}
                  onNavigate={username => { setShowBell(false); navigate(`/profile/${username}`) }}
                  onUnifiedClick={(n) => {
                    setShowBell(false)
                    supabase.from('notifications').update({ is_read: true }).eq('id', n.id).then(() => {})
                    if (n.link) navigate(n.link)
                  }}
                  onClose={() => setShowBell(false)}
                  onViewAll={() => { setShowBell(false); navigate('/notifications') }}
                />
              )}
            </div>

            {/* Avatar dropdown */}
            {profile?.username && (
              <div style={{ position: 'relative' }} ref={avatarRef}>
                <button
                  style={{
                    background: 'transparent', border: 'none', padding: 0, marginLeft: 6,
                    cursor: 'pointer', flexShrink: 0, borderRadius: '50%',
                    outline: (showAvatar || path.startsWith('/profile')) ? '2px solid #c0521e' : 'none',
                    outlineOffset: 2,
                  }}
                  onClick={() => setShowAvatar(v => !v)}
                  title={profile.username}
                >
                  <LevelAvatar
                    src={profile.avatar_url}
                    name={profile.username}
                    size={28}
                    level={profile.level}
                    points={profile.level_points}
                  />
                </button>
                {showAvatar && (
                  <AvatarDropdown
                    profile={profile}
                    isDark={isDark}
                    toggleTheme={toggleTheme}
                    goodreadsImported={goodreadsImported}
                    isAdmin={profile?.is_admin}
                    isAuthor={profile?.is_author}
                    onProfile={() => { setShowAvatar(false); navigate(`/profile/${profile.username}`) }}
                    onImport={() => { setShowAvatar(false); setShowImport(true) }}
                    onSignOut={async () => { setShowAvatar(false); clearCachedUsername(); await supabase.auth.signOut() }}
                    onNavigate={path => { setShowAvatar(false); navigate(path) }}
                  />
                )}
              </div>
            )}
              </>
            )}
          </div>
        )}
      </div>

      {showSearch && (
        <SearchModal
          session={session}
          onClose={() => setShowSearch(false)}
          onAdded={() => setShowSearch(false)}
        />
      )}
      {showGlobalSearch && (
        <GlobalSearchModal
          session={session}
          onClose={() => setShowGlobalSearch(false)}
        />
      )}
      {showImport && (
        <GoodreadsImportModal
          session={session}
          onClose={() => setShowImport(false)}
          onImported={() => {
            localStorage.setItem('exlibris-goodreads-imported', '1')
            localStorage.setItem('exlibris-onboarded', '1')
            setShowImport(false)
            window.dispatchEvent(new Event('exlibris:bookAdded'))
            navigate('/')
          }}
        />
      )}
    </>
  )
}

// ---- AVATAR DROPDOWN ----
function AvatarDropdown({ profile, isDark, toggleTheme, goodreadsImported, onProfile, onImport, onSignOut, onNavigate, isAdmin, isAuthor }) {
  return (
    <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 14, minWidth: 230, boxShadow: '0 8px 24px rgba(26,18,8,0.14)', zIndex: 200, overflow: 'hidden' }}>
      {/* Profile header */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #e8dfc8', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={onProfile}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt={profile.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 15, color: 'white' }}>{profile.username.charAt(0).toUpperCase()}</span>
          }
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1208', fontFamily: "'DM Sans', sans-serif" }}>{profile.username}</div>
          <div style={{ fontSize: 11, color: '#8a7f72', fontFamily: "'DM Sans', sans-serif" }}>View profile →</div>
        </div>
      </div>
      {/* Menu items */}
      <div style={{ padding: '6px 0' }}>
        <MenuItem icon="📊" label="Reading Stats"       onClick={() => onNavigate('/stats')} />
        <MenuItem icon="🗂️"  label="My Shelves"         onClick={() => onNavigate('/shelves')} />
        <MenuItem icon="👯" label="Buddy Reads"          onClick={() => onNavigate('/buddy-reads')} />
        <div style={{ height: 1, background: '#e8dfc8', margin: '6px 0' }} />
        <MenuItem icon="🎓" label="Take the tour" onClick={() => triggerTutorial(onNavigate)} />
        <MenuItem icon="❓" label="Help & FAQ"      onClick={() => onNavigate('/help')} />
        <div style={{ height: 1, background: '#e8dfc8', margin: '6px 0' }} />
        <MenuItem icon={isDark ? '☀️' : '🌙'} label={isDark ? 'Light mode' : 'Dark mode'} onClick={toggleTheme} />
        {!goodreadsImported && (
          <MenuItem icon="📥" label="Import from Goodreads" onClick={onImport} />
        )}
        <div style={{ height: 1, background: '#e8dfc8', margin: '6px 0' }} />
        <MenuItem icon="⚙️" label="Account Settings" onClick={() => onNavigate(`/profile/${profile.username}`)} />
        <MenuItem icon="🔔" label="Notification Settings" onClick={() => onNavigate('/settings/notifications')} />
        {isAuthor && (
          <MenuItem icon="📚" label="Author Dashboard" onClick={() => onNavigate('/author-dashboard')} />
        )}
        {isAdmin && (
          <>
            <div style={{ height: 1, background: '#e8dfc8', margin: '6px 0' }} />
            <MenuItem icon="🛡️" label="Admin Dashboard" onClick={() => onNavigate('/admin')} />
          </>
        )}
        <div style={{ height: 1, background: '#e8dfc8', margin: '6px 0' }} />
        <MenuItem icon="🚪" label="Sign out" onClick={onSignOut} danger />
      </div>
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: hover ? 'rgba(192,82,30,0.06)' : 'transparent', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: danger ? '#c0521e' : '#1a1208', textAlign: 'left' }}
    >
      <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{icon}</span>
      {label}
    </button>
  )
}

// ---- NOTIFICATIONS DROPDOWN ----
function NotificationsDropdown({ friendReqs, borrowNotifs, orderNotifs, unifiedNotifs, onRespondFriend, onViewLoans, onViewMarketplace, onNavigate, onUnifiedClick, onViewAll }) {
  const unified = unifiedNotifs || []
  const total = friendReqs.length + borrowNotifs.length + (orderNotifs || []).length + unified.length
  return (
    <div style={s.dropdown}>
      <div style={s.dropHead}>
        Notifications
        {total > 0 && <span style={s.dropCount}>{total}</span>}
      </div>
      {total === 0 ? (
        <div style={s.dropEmpty}>No new notifications</div>
      ) : (
        <>
          {friendReqs.map(req => (
            <div key={`f-${req.id}`} style={s.dropRow}>
              <div style={s.dropAvatar}>
                {req.profiles?.username?.charAt(0).toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1 }}>
                <span style={s.dropName} onClick={() => onNavigate(req.profiles?.username)}>
                  {req.profiles?.username}
                </span>
                <div style={s.dropSub}>wants to be friends</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={s.dropAccept} onClick={() => onRespondFriend(req.id, true)}>Accept</button>
                <button style={s.dropDecline} onClick={() => onRespondFriend(req.id, false)}>Decline</button>
              </div>
            </div>
          ))}
          {borrowNotifs.map(req => (
            <div key={`b-${req.id}`} style={s.dropRow}>
              <div style={{ ...s.dropAvatar, background: 'linear-gradient(135deg, #5a7a5a, #b8860b)' }}>
                {req.profiles?.username?.charAt(0).toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1 }}>
                <span style={s.dropName} onClick={() => onNavigate(req.profiles?.username)}>
                  {req.profiles?.username}
                </span>
                <div style={s.dropSub}>wants to borrow "{req.books?.title}"</div>
              </div>
              <button style={{ ...s.dropAccept, background: '#5a7a5a' }} onClick={onViewLoans}>
                View
              </button>
            </div>
          ))}
          {(orderNotifs || []).map(order => (
            <div key={`o-${order.id}`} style={s.dropRow}>
              <div style={{ ...s.dropAvatar, background: 'linear-gradient(135deg, #b8860b, #c0521e)' }}>
                🏪
              </div>
              <div style={{ flex: 1 }}>
                <span style={s.dropName} onClick={() => onNavigate(order.profiles?.username)}>
                  {order.profiles?.username}
                </span>
                <div style={s.dropSub}>wants to buy "{order.listings?.books?.title}" · ${Number(order.price).toFixed(2)}</div>
              </div>
              <button style={{ ...s.dropAccept, background: '#b8860b' }} onClick={onViewMarketplace}>
                View
              </button>
            </div>
          ))}
          {unified.map(n => (
            <div key={`u-${n.id}`} style={{ ...s.dropRow, cursor: 'pointer' }} onClick={() => onUnifiedClick && onUnifiedClick(n)}>
              <div style={{ ...s.dropAvatar, background: 'linear-gradient(135deg, #6a5b4a, #b8860b)' }}>
                {NOTIF_ICONS[n.type] || '🔔'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...s.dropName, cursor: 'pointer' }}>{n.title}</div>
                {n.body && <div style={s.dropSub}>{n.body}</div>}
              </div>
            </div>
          ))}
        </>
      )}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #e8dfc8', textAlign: 'center' }}>
        <span style={{ fontSize: 12, color: '#c0521e', cursor: 'pointer', fontWeight: 500 }} onClick={onViewAll}>
          View all notifications →
        </span>
      </div>
    </div>
  )
}

const s = {
  topbar: {
    position: 'sticky', top: 0, zIndex: 10,
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(245,240,232,0.95)', backdropFilter: 'blur(8px)',
    borderBottom: '1px solid #d4c9b0',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  logo: {
    fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700,
    color: '#1a1208', cursor: 'pointer', userSelect: 'none', letterSpacing: '-0.3px',
  },
  right: { display: 'flex', gap: 2, alignItems: 'center' },
  ghost: {
    padding: '6px 11px', background: 'none', border: 'none', borderRadius: 6,
    fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    color: '#3a3028', transition: 'background 0.12s',
  },
  active: {
    padding: '6px 11px', background: 'rgba(192,82,30,0.1)', border: 'none',
    borderRadius: 6, fontSize: 14, cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif", color: '#c0521e', fontWeight: 600,
  },
  addBtn: {
    padding: '6px 14px', background: '#c0521e', color: 'white', border: 'none',
    borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif", marginLeft: 6,
  },

  // Hamburger button
  hamburger: {
    background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
    padding: '4px 8px', color: '#1a1208', lineHeight: 1, marginLeft: 4,
  },

  // Mobile dropdown menu
  mobileMenu: {
    position: 'sticky', top: 49, zIndex: 9,
    display: 'flex', flexDirection: 'column',
    backdropFilter: 'blur(8px)',
  },
  mobileNavItem: {
    padding: '13px 20px', background: 'none', border: 'none',
    fontSize: 15, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    textAlign: 'left', borderBottom: '1px solid rgba(212,201,176,0.3)',
    transition: 'background 0.1s',
  },
  mobileMenuDivider: {
    height: 1, background: 'rgba(212,201,176,0.5)', margin: '4px 0',
  },
  mobileAddBtn: {
    margin: '8px 16px', padding: '10px 14px', background: '#c0521e', color: 'white',
    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif", textAlign: 'center',
  },
  mobileThemeBtn: {
    margin: '4px 16px 12px', padding: '10px 14px', background: 'none',
    border: '1px solid rgba(212,201,176,0.5)', borderRadius: 8, fontSize: 14,
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    color: '#3a3028', textAlign: 'left',
  },

  // Bell
  bellBtn: {
    position: 'relative', background: 'transparent', border: '1px solid #d4c9b0',
    borderRadius: 8, padding: '6px 9px', cursor: 'pointer', color: '#1a1208',
    display: 'flex', alignItems: 'center', marginLeft: 4,
  },
  bellBadge: {
    position: 'absolute', top: -5, right: -5, background: '#c0521e', color: 'white',
    borderRadius: '50%', width: 16, height: 16, fontSize: 9, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  // Dropdown
  dropdown:  { position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 12, minWidth: 320, boxShadow: '0 8px 24px rgba(26,18,8,0.12)', zIndex: 100 },
  dropHead:  { padding: '14px 16px 10px', fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: '#1a1208', borderBottom: '1px solid #e8dfc8', display: 'flex', alignItems: 'center', gap: 8 },
  dropCount: { background: 'rgba(192,82,30,0.1)', color: '#c0521e', borderRadius: 20, padding: '1px 8px', fontSize: 12, fontWeight: 600 },
  dropEmpty: { padding: '20px 16px', fontSize: 13, color: '#8a7f72', textAlign: 'center' },
  dropRow:   { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #f0e8d8' },
  dropAvatar:{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, flexShrink: 0 },
  dropName:  { fontSize: 14, fontWeight: 600, color: '#1a1208', cursor: 'pointer' },
  dropSub:   { fontSize: 12, color: '#8a7f72', marginTop: 1 },
  dropAccept: { padding: '5px 12px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  dropDecline:{ padding: '5px 12px', background: 'transparent', color: '#8a7f72', border: '1px solid #d4c9b0', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
}

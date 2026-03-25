import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SearchModal from './SearchModal'

const NAV_ITEMS = [
  { label: 'Library',     path: '/' },
  { label: 'Discover',    path: '/discover' },
  { label: 'Feed',        path: '/feed' },
  { label: 'Friends',     path: '/friends' },
  { label: 'Loans',       path: '/loans' },
  { label: 'Marketplace', path: '/marketplace' },
]

// Module-level cache — survives React navigation without re-fetching
let _cachedId       = null
let _cachedProfile  = null  // { username, avatar_url }

export default function NavBar({ session, extra }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const dropdownRef = useRef(null)

  const [profile, setProfile] = useState(
    session?.user?.id === _cachedId ? _cachedProfile : null
  )
  const [showSearch,   setShowSearch]   = useState(false)
  const [showBell,     setShowBell]     = useState(false)
  const [friendReqs,   setFriendReqs]   = useState([])
  const [borrowNotifs, setBorrowNotifs] = useState([])

  // Fetch + cache profile (username + avatar)
  useEffect(() => {
    if (!session) return
    if (session.user.id === _cachedId && _cachedProfile) return
    supabase.from('profiles').select('username, avatar_url')
      .eq('id', session.user.id).maybeSingle()
      .then(({ data }) => {
        _cachedId      = session.user.id
        _cachedProfile = data ? { username: data.username, avatar_url: data.avatar_url } : null
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
    const [{ data: friends }, { data: borrows }] = await Promise.all([
      supabase
        .from('friendships')
        .select('id, requester_id, created_at, profiles!friendships_requester_id_fkey(username)')
        .eq('addressee_id', session.user.id)
        .eq('status', 'pending'),
      supabase
        .from('borrow_requests')
        .select('id, requester_id, created_at, books(title), profiles!borrow_requests_requester_id_fkey(username)')
        .eq('owner_id', session.user.id)
        .eq('status', 'pending'),
    ])
    setFriendReqs(friends || [])
    setBorrowNotifs(borrows || [])
  }

  async function respondToFriend(id, accept) {
    if (accept) {
      await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    } else {
      await supabase.from('friendships').delete().eq('id', id)
    }
    fetchNotifications()
  }

  // Close bell dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowBell(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const path      = location.pathname
  const bellCount = friendReqs.length + borrowNotifs.length

  function isActive(item) {
    if (item.path === '/') return path === '/'
    return path.startsWith(item.path)
  }

  return (
    <>
      <div style={s.topbar}>
        <div style={s.logo} onClick={() => navigate('/')} role="button" tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && navigate('/')}>
          Folio
        </div>

        <div style={s.right}>
          {NAV_ITEMS.map(item => (
            <button key={item.path}
              style={isActive(item) ? s.active : s.ghost}
              onClick={() => navigate(item.path)}>
              {item.label}
            </button>
          ))}

          <button style={s.addBtn} onClick={() => setShowSearch(true)}>+ Add Book</button>

          {/* Slot for page-specific extras */}
          {extra}

          {/* Notification bell */}
          <div style={{ position: 'relative' }} ref={dropdownRef}>
            <button style={s.bellBtn} onClick={() => setShowBell(v => !v)}>
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
                onRespondFriend={respondToFriend}
                onViewLoans={() => { setShowBell(false); navigate('/loans') }}
                onNavigate={username => { setShowBell(false); navigate(`/profile/${username}`) }}
                onClose={() => setShowBell(false)}
              />
            )}
          </div>

          {/* Avatar — furthest right, navigates to profile */}
          {profile?.username && (
            <button
              style={{ ...s.avatarBtn, ...(path.startsWith('/profile') ? s.avatarBtnActive : {}) }}
              onClick={() => navigate(`/profile/${profile.username}`)}
              title={`My Profile (${profile.username})`}
            >
              {profile.avatar_url
                ? <img src={profile.avatar_url} alt={profile.username} style={s.avatarImg} />
                : <span style={s.avatarInitial}>{profile.username.charAt(0).toUpperCase()}</span>
              }
            </button>
          )}
        </div>
      </div>

      {showSearch && (
        <SearchModal
          session={session}
          onClose={() => setShowSearch(false)}
          onAdded={() => setShowSearch(false)}
        />
      )}
    </>
  )
}

// ---- NOTIFICATIONS DROPDOWN ----
function NotificationsDropdown({ friendReqs, borrowNotifs, onRespondFriend, onViewLoans, onNavigate }) {
  const total = friendReqs.length + borrowNotifs.length
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
        </>
      )}
    </div>
  )
}

const s = {
  topbar: {
    position: 'sticky', top: 0, zIndex: 10,
    background: 'rgba(245,240,232,0.95)', backdropFilter: 'blur(8px)',
    borderBottom: '1px solid #d4c9b0', padding: '12px 32px',
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

  // Avatar button
  avatarBtn: {
    width: 32, height: 32, borderRadius: '50%', border: '2px solid transparent',
    background: 'linear-gradient(135deg, #c0521e, #b8860b)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', padding: 0, marginLeft: 6, flexShrink: 0,
    transition: 'border-color 0.15s',
  },
  avatarBtnActive: {
    borderColor: '#c0521e',
  },
  avatarImg: {
    width: '100%', height: '100%', objectFit: 'cover',
  },
  avatarInitial: {
    fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 13, color: 'white',
    lineHeight: 1,
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

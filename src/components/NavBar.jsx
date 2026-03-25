import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const NAV_ITEMS = [
  { label: 'Library',     path: '/' },
  { label: 'Discover',    path: '/discover' },
  { label: 'Feed',        path: '/feed' },
  { label: 'Loans',       path: '/loans' },
  { label: 'Marketplace', path: '/marketplace' },
]

// Module-level cache — survives React navigation without re-fetching
let _cachedId       = null
let _cachedUsername = null

export default function NavBar({ session, extra }) {
  const navigate  = useNavigate()
  const location  = useLocation()

  // Initialise from cache immediately so button appears without a flash
  const [username, setUsername] = useState(
    session?.user?.id === _cachedId ? _cachedUsername : null
  )

  useEffect(() => {
    if (!session) return
    // Already cached for this user — nothing to do
    if (session.user.id === _cachedId && _cachedUsername) return
    supabase.from('profiles').select('username')
      .eq('id', session.user.id).maybeSingle()
      .then(({ data }) => {
        _cachedId       = session.user.id
        _cachedUsername = data?.username ?? null
        setUsername(_cachedUsername)
      })
  }, [session?.user?.id])

  const path = location.pathname

  function isActive(item) {
    if (item.path === '/') return path === '/'
    return path.startsWith(item.path)
  }

  return (
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

        {username && (
          <button
            style={path.startsWith('/profile') ? s.active : s.ghost}
            onClick={() => navigate(`/profile/${username}`)}>
            My Profile
          </button>
        )}

        {/* Slot for page-specific extras (e.g. notification bell) */}
        {extra}
      </div>
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
}

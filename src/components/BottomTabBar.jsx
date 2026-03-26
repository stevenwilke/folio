import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'

const TABS = [
  { path: '/',         icon: '📚', label: 'Library'  },
  { path: '/discover', icon: '🔍', label: 'Discover' },
  { path: '/feed',     icon: '📖', label: 'Feed'     },
  { path: '/loans',    icon: '🤝', label: 'Loans'    },
  { path: '/profile',  icon: '👤', label: 'Profile'  },
]

// Module-level cache shared with NavBar
let _cachedId      = null
let _cachedProfile = null

export default function BottomTabBar({ session }) {
  const isMobile = useIsMobile()
  const navigate  = useNavigate()
  const location  = useLocation()
  const { theme } = useTheme()

  const [profile, setProfile] = useState(
    session?.user?.id === _cachedId ? _cachedProfile : null
  )

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

  if (!isMobile) return null

  const path = location.pathname

  function isActive(tab) {
    if (tab.path === '/') return path === '/'
    if (tab.path === '/profile') return path.startsWith('/profile')
    return path.startsWith(tab.path)
  }

  function handleTabPress(tab) {
    if (tab.path === '/profile') {
      navigate(profile?.username ? `/profile/${profile.username}` : '/profile')
    } else {
      navigate(tab.path)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      background: theme.navBg,
      borderTop: `1px solid ${theme.border}`,
      display: 'flex',
      alignItems: 'stretch',
      height: 60,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      boxSizing: 'content-box',
    }}>
      {TABS.map(tab => {
        const active = isActive(tab)
        return (
          <button
            key={tab.path}
            onClick={() => handleTabPress(tab)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '6px 0 4px',
              position: 'relative',
              gap: 2,
            }}
          >
            {/* Active indicator dot above icon */}
            <div style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: active ? theme.rust : 'transparent',
              marginBottom: 2,
            }} />
            <span style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{
              fontSize: 10,
              fontFamily: "'DM Sans', sans-serif",
              color: active ? theme.rust : theme.textSubtle,
              fontWeight: active ? 600 : 400,
              lineHeight: 1,
            }}>
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

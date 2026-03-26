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
]

const MORE_ITEMS = [
  { path: '/friends',     icon: '👥', label: 'Friends'     },
  { path: '/marketplace', icon: '🏪', label: 'Marketplace' },
  { path: '/shelves',     icon: '📂', label: 'Shelves'     },
  { path: '/clubs',       icon: '💬', label: 'Book Clubs'  },
  { path: '/polls',       icon: '📊', label: 'Polls'       },
  { path: '/stats',       icon: '📈', label: 'Stats'       },
]

// Module-level cache shared with NavBar
let _cachedId      = null
let _cachedProfile = null

export default function BottomTabBar({ session }) {
  const isMobile  = useIsMobile()
  const navigate  = useNavigate()
  const location  = useLocation()
  const { theme, isDark, toggleTheme } = useTheme()
  const [showMore, setShowMore] = useState(false)

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

  // Close More drawer on route change
  useEffect(() => { setShowMore(false) }, [location.pathname])

  if (!isMobile) return null

  const path = location.pathname

  function isActive(tab) {
    if (tab.path === '/') return path === '/'
    return path.startsWith(tab.path)
  }

  const moreActive = MORE_ITEMS.some(i => path.startsWith(i.path)) ||
    path.startsWith('/profile') || showMore

  function goTo(dest) {
    setShowMore(false)
    navigate(dest)
  }

  return (
    <>
      {/* More drawer overlay */}
      {showMore && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 98,
            background: 'rgba(26,18,8,0.45)',
          }}
          onClick={() => setShowMore(false)}
        />
      )}

      {/* More drawer sheet */}
      <div style={{
        position: 'fixed',
        left: 0, right: 0,
        bottom: showMore ? 60 : '-100%',
        zIndex: 99,
        background: theme.bgCard,
        borderTop: `1px solid ${theme.border}`,
        borderRadius: '16px 16px 0 0',
        transition: 'bottom 0.28s cubic-bezier(0.32,0.72,0,1)',
        padding: '12px 0 8px',
        boxShadow: '0 -4px 24px rgba(26,18,8,0.15)',
      }}>
        {/* Handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: theme.border, margin: '0 auto 16px',
        }} />

        {/* Profile link at top */}
        <button
          onClick={() => goTo(profile?.username ? `/profile/${profile.username}` : '/profile')}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 24px', background: 'none', border: 'none',
            borderBottom: `1px solid ${theme.borderLight}`, cursor: 'pointer',
            marginBottom: 8,
          }}
        >
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: `linear-gradient(135deg, ${theme.rust}, ${theme.gold})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ color: 'white', fontWeight: 700, fontSize: 16, fontFamily: 'Georgia, serif' }}>
                  {profile?.username?.[0]?.toUpperCase() || '?'}
                </span>
            }
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: theme.text, fontFamily: "'DM Sans', sans-serif" }}>
              {profile?.username || 'My Profile'}
            </div>
            <div style={{ fontSize: 12, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}>
              View profile
            </div>
          </div>
        </button>

        {/* Grid of more items */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 4, padding: '4px 12px 8px',
        }}>
          {MORE_ITEMS.map(item => (
            <button
              key={item.path}
              onClick={() => goTo(item.path)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 5, padding: '14px 8px', background: 'none', border: 'none',
                borderRadius: 12, cursor: 'pointer',
                background: path.startsWith(item.path) ? `${theme.rust}15` : 'transparent',
              }}
            >
              <span style={{ fontSize: 26 }}>{item.icon}</span>
              <span style={{
                fontSize: 11, fontFamily: "'DM Sans', sans-serif",
                color: path.startsWith(item.path) ? theme.rust : theme.text,
                fontWeight: path.startsWith(item.path) ? 600 : 400,
              }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>

        {/* Dark mode toggle */}
        <div style={{
          margin: '4px 16px 4px',
          borderTop: `1px solid ${theme.borderLight}`,
          paddingTop: 12,
        }}>
          <button
            onClick={toggleTheme}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 8px', background: 'none', border: 'none',
              borderRadius: 10, cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 20 }}>{isDark ? '☀️' : '🌙'}</span>
            <span style={{ fontSize: 14, color: theme.text, fontFamily: "'DM Sans', sans-serif" }}>
              {isDark ? 'Light Mode' : 'Dark Mode'}
            </span>
          </button>
        </div>
      </div>

      {/* Bottom tab bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: theme.navBg, borderTop: `1px solid ${theme.border}`,
        display: 'flex', alignItems: 'stretch',
        height: 60, paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxSizing: 'content-box',
      }}>
        {TABS.map(tab => {
          const active = isActive(tab)
          return (
            <button
              key={tab.path}
              onClick={() => goTo(tab.path)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '6px 0 4px', position: 'relative', gap: 2,
              }}
            >
              <div style={{
                width: 4, height: 4, borderRadius: '50%',
                background: active ? theme.rust : 'transparent', marginBottom: 2,
              }} />
              <span style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</span>
              <span style={{
                fontSize: 10, fontFamily: "'DM Sans', sans-serif",
                color: active ? theme.rust : theme.textSubtle,
                fontWeight: active ? 600 : 400, lineHeight: 1,
              }}>
                {tab.label}
              </span>
            </button>
          )
        })}

        {/* More tab */}
        <button
          onClick={() => setShowMore(v => !v)}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 0 4px', gap: 2,
          }}
        >
          <div style={{
            width: 4, height: 4, borderRadius: '50%',
            background: moreActive ? theme.rust : 'transparent', marginBottom: 2,
          }} />
          <span style={{ fontSize: 22, lineHeight: 1 }}>☰</span>
          <span style={{
            fontSize: 10, fontFamily: "'DM Sans', sans-serif",
            color: moreActive ? theme.rust : theme.textSubtle,
            fontWeight: moreActive ? 600 : 400, lineHeight: 1,
          }}>
            More
          </span>
        </button>
      </div>
    </>
  )
}

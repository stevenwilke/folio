import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'

/**
 * Lightweight checklist surfaced on the Library page for new-ish users.
 * Hides itself once everything's done OR the user dismisses it (per-user
 * localStorage flag).
 *
 * Items checked:
 *   - At least one bio character on profile
 *   - A reading goal set for the current year
 *   - At least one accepted friendship
 *   - At least 5 books in library
 */
export default function OnboardingChecklist({ session, bookCount }) {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const [profile, setProfile]   = useState(null)
  const [hasGoal, setHasGoal]   = useState(false)
  const [friendCount, setFriendCount] = useState(0)
  const [loading, setLoading]   = useState(true)
  const dismissKey = `exlibris-onboarding-dismissed-${session?.user?.id}`
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(dismissKey))

  useEffect(() => {
    if (!session || dismissed) return
    setLoading(true)
    fetchAll()
  }, [session?.user?.id, dismissed])

  async function fetchAll() {
    const [{ data: prof }, { data: goalRow }, { count: fc }] = await Promise.all([
      supabase.from('profiles').select('bio, username').eq('id', session.user.id).maybeSingle(),
      supabase.from('reading_challenges').select('id').eq('user_id', session.user.id).eq('year', new Date().getFullYear()).limit(1).maybeSingle(),
      supabase.from('friendships').select('id', { count: 'exact', head: true })
        .eq('status', 'accepted')
        .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`),
    ])
    setProfile(prof)
    setHasGoal(!!goalRow)
    setFriendCount(fc ?? 0)
    setLoading(false)
  }

  if (loading || dismissed) return null

  const items = [
    {
      key: 'books',
      done: bookCount >= 5,
      label: bookCount >= 5 ? 'Add 5 books to your library' : `Add ${5 - bookCount} more book${5 - bookCount === 1 ? '' : 's'} to your library`,
      action: 'Add a book',
      onClick: () => window.dispatchEvent(new CustomEvent('exlibris:open-add')),
    },
    {
      key: 'bio',
      done: !!profile?.bio?.trim(),
      label: 'Add a short bio',
      action: 'Edit profile',
      onClick: () => profile?.username && navigate(`/profile/${profile.username}`),
    },
    {
      key: 'goal',
      done: hasGoal,
      label: 'Set a reading goal for this year',
      action: 'Set a goal',
      onClick: () => navigate('/stats'),
    },
    {
      key: 'friends',
      done: friendCount > 0,
      label: 'Follow a friend (or two)',
      action: 'Find friends',
      onClick: () => navigate('/friends'),
    },
  ]

  const completed = items.filter(i => i.done).length
  if (completed === items.length) return null

  function dismiss() {
    localStorage.setItem(dismissKey, '1')
    setDismissed(true)
  }

  return (
    <div style={{
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 14,
      padding: '16px 18px',
      marginBottom: 18,
      boxShadow: theme.shadowCard,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>👋 Get the most out of Ex Libris</span>
          <span style={{ fontSize: 11, color: theme.textSubtle }}>{completed} of {items.length}</span>
        </div>
        <button onClick={dismiss} style={{ background: 'transparent', border: 'none', color: theme.textSubtle, cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
          Dismiss
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(item => (
          <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 18, height: 18, borderRadius: '50%',
              border: `1.5px solid ${item.done ? '#5a7a5a' : theme.border}`,
              background: item.done ? '#5a7a5a' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              fontSize: 11, color: '#fff',
            }}>
              {item.done ? '✓' : ''}
            </div>
            <div style={{
              flex: 1,
              fontSize: 13,
              color: item.done ? theme.textSubtle : theme.text,
              textDecoration: item.done ? 'line-through' : 'none',
            }}>
              {item.label}
            </div>
            {!item.done && (
              <button onClick={item.onClick} style={{ background: 'transparent', border: 'none', color: theme.rust, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                {item.action} →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

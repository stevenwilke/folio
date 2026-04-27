import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { getCoverUrl } from '../lib/coverUrl'

export default function BuddyReads({ session }) {
  const navigate  = useNavigate()
  const { theme } = useTheme()
  const isMobile  = useIsMobile()

  const [tab, setTab]         = useState('active')   // active | invited | finished
  const [reads, setReads]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) { navigate('/'); return }
    fetchAll()
  }, [session?.user?.id])

  async function fetchAll() {
    setLoading(true)
    // Buddy reads I own + ones I'm a participant in.
    const [{ data: owned }, { data: parts }] = await Promise.all([
      supabase.from('buddy_reads')
        .select('id, book_id, title, target_finish, status, owner_id, created_at, books(id, title, author, cover_image_url)')
        .eq('owner_id', session.user.id),
      supabase.from('buddy_read_participants')
        .select('buddy_read_id, status, current_page, buddy_reads(id, book_id, title, target_finish, status, owner_id, created_at, books(id, title, author, cover_image_url))')
        .eq('user_id', session.user.id),
    ])
    const ownedRows = (owned || []).map(r => ({ ...r, _myStatus: 'owner' }))
    const partRows  = (parts || [])
      .filter(p => p.buddy_reads)
      .map(p => ({ ...p.buddy_reads, _myStatus: p.status, _myCurrentPage: p.current_page }))
    // Dedupe — owner rows take priority.
    const map = new Map()
    for (const r of [...ownedRows, ...partRows]) {
      if (!map.has(r.id)) map.set(r.id, r)
    }
    setReads([...map.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
    setLoading(false)
  }

  const filtered = reads.filter(r => {
    if (tab === 'active')   return r.status === 'active'   && r._myStatus !== 'invited' && r._myStatus !== 'declined'
    if (tab === 'invited')  return r._myStatus === 'invited'
    if (tab === 'finished') return r.status === 'completed' || r._myStatus === 'finished'
    return true
  })
  const invitedCount = reads.filter(r => r._myStatus === 'invited').length

  const s = {
    page:   { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    inner:  { maxWidth: 800, margin: '0 auto', padding: isMobile ? '24px 16px 80px' : '40px 32px 80px' },
    h1:     { fontFamily: 'Georgia, serif', fontSize: isMobile ? 26 : 32, fontWeight: 700, color: theme.text, marginBottom: 6 },
    sub:    { fontSize: 14, color: theme.textSubtle, marginBottom: 24, lineHeight: 1.5 },
    tabs:   { display: 'flex', gap: 6, marginBottom: 20, borderBottom: `1px solid ${theme.border}` },
    tabBtn: (active) => ({ padding: '10px 16px', fontSize: 14, fontWeight: active ? 700 : 500, color: active ? theme.rust : theme.textSubtle, background: 'none', border: 'none', borderBottom: active ? `2px solid ${theme.rust}` : '2px solid transparent', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: -1 }),
    card:   { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 14, marginBottom: 12, cursor: 'pointer', boxShadow: theme.shadowCard },
    cover:  { width: 56, height: 84, borderRadius: 4, objectFit: 'cover', flexShrink: 0, boxShadow: '0 2px 6px rgba(0,0,0,0.2)' },
    coverPlaceholder: { width: 56, height: 84, borderRadius: 4, background: theme.bgSubtle, flexShrink: 0 },
    title:  { fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 2 },
    author: { fontSize: 13, color: theme.textSubtle, marginBottom: 6 },
    meta:   { fontSize: 12, color: theme.textSubtle },
    badge:  (color) => ({ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: `${color}22`, color, letterSpacing: 0.4, textTransform: 'uppercase', marginRight: 6 }),
    empty:  { padding: '40px 20px', textAlign: 'center', color: theme.textSubtle, fontSize: 14 },
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.inner}>
        <h1 style={s.h1}>Buddy Reads</h1>
        <p style={s.sub}>Read together with friends — track each other's progress and chat as you go.</p>

        <div style={s.tabs}>
          <button style={s.tabBtn(tab === 'active')}   onClick={() => setTab('active')}>Active</button>
          <button style={s.tabBtn(tab === 'invited')}  onClick={() => setTab('invited')}>Invited {invitedCount > 0 ? `(${invitedCount})` : ''}</button>
          <button style={s.tabBtn(tab === 'finished')} onClick={() => setTab('finished')}>Finished</button>
        </div>

        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={s.empty}>
            {tab === 'active'   && 'No active buddy reads. Open any book and tap "Start a buddy read" to begin.'}
            {tab === 'invited'  && 'No pending invites.'}
            {tab === 'finished' && 'No finished buddy reads yet.'}
          </div>
        ) : filtered.map(r => {
          const cover = getCoverUrl(r.books)
          return (
            <div key={r.id} style={s.card} onClick={() => navigate(`/buddy-reads/${r.id}`)}>
              {cover ? <img src={cover} alt={r.books?.title} style={s.cover} /> : <div style={s.coverPlaceholder} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.title}>{r.title || r.books?.title}</div>
                <div style={s.author}>{r.books?.author}</div>
                <div style={s.meta}>
                  {r._myStatus === 'owner'     && <span style={s.badge(theme.rust)}>Owner</span>}
                  {r._myStatus === 'invited'   && <span style={s.badge('#b8860b')}>Invited</span>}
                  {r._myStatus === 'joined'    && <span style={s.badge('#5a7a5a')}>Joined</span>}
                  {r._myStatus === 'finished'  && <span style={s.badge('#5a7a5a')}>Finished</span>}
                  {r.target_finish && <>Finish by {new Date(r.target_finish).toLocaleDateString()} · </>}
                  {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

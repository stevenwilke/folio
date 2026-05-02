import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { getCoverUrl } from '../lib/coverUrl'
import { notify } from '../lib/notify'
import { getMyUsername } from '../lib/currentUser'

export default function BuddyReads({ session }) {
  const navigate  = useNavigate()
  const { theme } = useTheme()
  const isMobile  = useIsMobile()

  const [tab, setTab]         = useState('active')   // active | invited | finished
  const [reads, setReads]     = useState([])
  const [loading, setLoading] = useState(true)
  const [showStart, setShowStart] = useState(false)

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
    headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 },
    startBtn:  { background: theme.rust, color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.inner}>
        <div style={s.headerRow}>
          <h1 style={s.h1}>Buddy Reads</h1>
          <button style={s.startBtn} onClick={() => setShowStart(true)}>👯 Start a buddy read</button>
        </div>
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
            {tab === 'active'   && 'No active buddy reads. Open any book, switch to the Actions tab, and tap "Start a buddy read" to begin — or use the button above.'}
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

      {showStart && (
        <StartBuddyReadModal
          session={session}
          theme={theme}
          onClose={() => setShowStart(false)}
          onCreated={(id) => { setShowStart(false); navigate(`/buddy-reads/${id}`) }}
        />
      )}
    </div>
  )
}

// ---- START BUDDY READ MODAL (book search + friend picker) ----
function StartBuddyReadModal({ session, theme, onClose, onCreated }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [book, setBook]       = useState(null)
  const [title, setTitle]     = useState('')
  const [target, setTarget]   = useState('')
  const [friends, setFriends] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [creating, setCreating] = useState(false)
  const [error, setError]     = useState('')
  const debounceRef = useRef(null)

  // Load friends once
  useEffect(() => {
    if (!session) return
    ;(async () => {
      const { data: fs } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
      const friendIds = (fs || []).map(f =>
        f.requester_id === session.user.id ? f.addressee_id : f.requester_id
      )
      if (!friendIds.length) return
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', friendIds)
        .order('username')
      setFriends(profiles || [])
    })()
  }, [session?.user?.id])

  // Debounced book search across the catalog
  useEffect(() => {
    if (book) return  // already picked
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const q = query.trim()
      const { data } = await supabase
        .from('books')
        .select('id, title, author, cover_image_url, isbn_13, isbn_10')
        .or(`title.ilike.%${q}%,author.ilike.%${q}%`)
        .limit(20)
      setResults(data || [])
      setSearching(false)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, book])

  function toggleFriend(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function create() {
    if (!session || !book) { setError('Pick a book first.'); return }
    setCreating(true); setError('')
    const { data, error: err } = await supabase
      .from('buddy_reads')
      .insert({
        book_id:        book.id,
        owner_id:       session.user.id,
        title:          title.trim() || null,
        target_finish:  target || null,
      })
      .select('id')
      .single()
    if (err || !data) {
      setError(err?.message || 'Could not create buddy read.')
      setCreating(false)
      return
    }
    await supabase.from('buddy_read_participants').insert({
      buddy_read_id: data.id, user_id: session.user.id, status: 'joined', joined_at: new Date().toISOString(),
    })
    if (selected.size > 0) {
      const invites = [...selected].map(uid => ({
        buddy_read_id: data.id, user_id: uid, status: 'invited',
      }))
      await supabase.from('buddy_read_participants').insert(invites)
      const fromUsername = (await getMyUsername(session.user.id)) || 'A friend'
      for (const uid of selected) {
        notify(uid, 'buddy_read_invite', {
          title: 'Buddy read invite',
          body: `${fromUsername} invited you to read "${book.title}" together`,
          link: `/buddy-reads/${data.id}`,
          metadata: { buddy_read_id: data.id },
        })
      }
    }
    onCreated(data.id)
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
  const box     = { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 460, maxWidth: '95vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
  const head    = { padding: '18px 20px 14px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
  const bd      = { padding: '20px 20px 24px', overflowY: 'auto' }
  const lbl     = { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSubtle, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }
  const inp     = { width: '100%', padding: 10, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: theme.bg, color: theme.text, boxSizing: 'border-box' }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={head}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text }}>👯 Start a buddy read</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle }}>✕</button>
        </div>
        <div style={bd}>
          {!book ? (
            <>
              <label style={lbl}>Pick a book</label>
              <input
                type="text"
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by title or author…"
                style={inp}
              />
              {searching && <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 10 }}>Searching…</div>}
              {!searching && query.trim() && results.length === 0 && (
                <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 10 }}>No books match "{query}". Try adding the book to your library first.</div>
              )}
              {results.length > 0 && (
                <div style={{ marginTop: 10, maxHeight: 280, overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: 8 }}>
                  {results.map(b => {
                    const cover = getCoverUrl(b)
                    return (
                      <button
                        key={b.id}
                        onClick={() => setBook(b)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${theme.border}`, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        {cover
                          ? <img src={cover} alt="" style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} onError={e => e.target.style.display='none'} />
                          : <div style={{ width: 32, height: 48, background: theme.bgSubtle, borderRadius: 3, flexShrink: 0 }} />}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
                          <div style={{ fontSize: 12, color: theme.textSubtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, border: `1px solid ${theme.border}`, borderRadius: 8, marginBottom: 14 }}>
                {getCoverUrl(book)
                  ? <img src={getCoverUrl(book)} alt="" style={{ width: 36, height: 54, objectFit: 'cover', borderRadius: 3 }} onError={e => e.target.style.display='none'} />
                  : <div style={{ width: 36, height: 54, background: theme.bgSubtle, borderRadius: 3 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{book.title}</div>
                  <div style={{ fontSize: 12, color: theme.textSubtle }}>{book.author}</div>
                </div>
                <button onClick={() => { setBook(null); setQuery('') }} style={{ background: 'none', border: 'none', color: theme.rust, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>Change</button>
              </div>

              <label style={lbl}>Name (optional)</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder={`${book.title} buddy read`} style={inp} />
              <div style={{ marginTop: 14 }}>
                <label style={lbl}>Target finish date (optional)</label>
                <input type="date" value={target} onChange={e => setTarget(e.target.value)} style={inp} />
              </div>
              <div style={{ marginTop: 14 }}>
                <label style={lbl}>Invite friends (optional)</label>
                {friends.length === 0 ? (
                  <div style={{ fontSize: 12, color: theme.textSubtle, padding: '8px 0' }}>
                    No friends yet — you can invite people from the buddy read page after creating it.
                  </div>
                ) : (
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: 8, padding: 4 }}>
                    {friends.map(f => {
                      const checked = selected.has(f.id)
                      return (
                        <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? 'rgba(192,82,30,0.08)' : 'transparent' }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleFriend(f.id)} style={{ accentColor: theme.rust, cursor: 'pointer' }} />
                          <span style={{ fontSize: 13, color: theme.text }}>{f.username}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
                {selected.size > 0 && (
                  <div style={{ fontSize: 11, color: theme.textSubtle, marginTop: 6 }}>
                    {selected.size} friend{selected.size === 1 ? '' : 's'} will be invited
                  </div>
                )}
              </div>
            </>
          )}
          {error && <div style={{ color: theme.rust, fontSize: 13, marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${theme.border}`, color: theme.textSubtle, padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
            <button onClick={create} disabled={creating || !book} style={{ background: theme.rust, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: (creating || !book) ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: (creating || !book) ? 0.5 : 1 }}>
              {creating ? 'Creating…' : selected.size > 0 ? `Create & invite ${selected.size} →` : 'Create →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { getCoverUrl } from '../lib/coverUrl'
import { notify } from '../lib/notify'

export default function BuddyReadDetail({ session }) {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const { theme } = useTheme()
  const isMobile  = useIsMobile()

  const [read, setRead]                 = useState(null)
  const [participants, setParticipants] = useState([])
  const [messages, setMessages]         = useState([])
  const [profileMap, setProfileMap]     = useState({})  // user_id -> { username, avatar_url }
  const [loading, setLoading]           = useState(true)
  const [msgDraft, setMsgDraft]         = useState('')
  const [pageDraft, setPageDraft]       = useState('')
  const [savingProgress, setSavingProgress] = useState(false)
  const [posting, setPosting]           = useState(false)
  const [showInvite, setShowInvite]     = useState(false)
  const [friends, setFriends]           = useState([])
  const messagesEndRef                  = useRef(null)

  useEffect(() => {
    if (!session) { navigate('/'); return }
    fetchAll()
  }, [id, session?.user?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function fetchAll() {
    setLoading(true)
    const [{ data: br }, { data: parts }, { data: msgs }] = await Promise.all([
      supabase.from('buddy_reads')
        .select('*, books(id, title, author, cover_image_url, pages)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('buddy_read_participants').select('*').eq('buddy_read_id', id),
      supabase.from('buddy_read_messages').select('*').eq('buddy_read_id', id).order('created_at', { ascending: true }).limit(200),
    ])
    if (!br) { setRead(null); setLoading(false); return }
    setRead(br)
    setParticipants(parts || [])
    setMessages(msgs || [])

    const userIds = new Set([br.owner_id, ...(parts || []).map(p => p.user_id), ...(msgs || []).map(m => m.user_id)])
    if (userIds.size > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, username, avatar_url').in('id', [...userIds])
      const map = {}
      for (const p of profiles || []) map[p.id] = p
      setProfileMap(map)
    }

    const me = (parts || []).find(p => p.user_id === session.user.id)
    if (me) setPageDraft(String(me.current_page || 0))

    setLoading(false)
  }

  const myParticipant = participants.find(p => p.user_id === session.user.id)
  const isOwner       = read?.owner_id === session.user.id
  const isParticipant = !!myParticipant
  const canChat       = isOwner || (isParticipant && (myParticipant.status === 'joined' || myParticipant.status === 'finished'))

  async function postMessage() {
    if (!msgDraft.trim() || !canChat) return
    setPosting(true)
    const body = msgDraft.trim()
    const { data } = await supabase
      .from('buddy_read_messages')
      .insert({ buddy_read_id: id, user_id: session.user.id, body })
      .select('*')
      .single()
    setMsgDraft('')
    setPosting(false)
    if (data) setMessages(prev => [...prev, data])

    const recipients = new Set(
      participants
        .filter(p => p.status === 'joined' || p.status === 'finished')
        .map(p => p.user_id)
    )
    recipients.add(read.owner_id)
    recipients.delete(session.user.id)
    const others = [...recipients]
    const fromUsername = profileMap[session.user.id]?.username || 'A buddy'
    const bookTitle = read.books?.title || 'a book'
    Promise.allSettled(others.map(uid => notify(uid, 'buddy_read_message', {
      title: `New buddy read message`,
      body: `${fromUsername} on "${bookTitle}": ${body.slice(0, 100)}`,
      link: `/buddy-reads/${id}`,
      metadata: { buddy_read_id: id },
    }))).catch(() => {})
  }

  async function saveProgress() {
    const n = parseInt(pageDraft, 10)
    if (isNaN(n) || n < 0) return
    setSavingProgress(true)
    const { data } = await supabase
      .from('buddy_read_participants')
      .update({ current_page: n, last_progress_at: new Date().toISOString() })
      .eq('buddy_read_id', id)
      .eq('user_id', session.user.id)
      .select('*')
      .single()
    if (data) setParticipants(prev => prev.map(p => p.user_id === session.user.id ? data : p))
    setSavingProgress(false)
  }

  async function joinOrDecline(action) {
    const next = action === 'join' ? { status: 'joined', joined_at: new Date().toISOString() } : { status: 'declined' }
    const { data } = await supabase
      .from('buddy_read_participants')
      .update(next)
      .eq('buddy_read_id', id)
      .eq('user_id', session.user.id)
      .select('*')
      .single()
    if (data) setParticipants(prev => prev.map(p => p.user_id === session.user.id ? data : p))
  }

  async function loadFriends() {
    const { data } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
    const friendIds = [...new Set((data || []).map(f =>
      f.requester_id === session.user.id ? f.addressee_id : f.requester_id
    ))]
    if (!friendIds.length) { setFriends([]); return }
    const existing = new Set(participants.map(p => p.user_id))
    const { data: profiles } = await supabase.from('profiles').select('id, username, avatar_url').in('id', friendIds)
    setFriends((profiles || []).filter(p => !existing.has(p.id)))
  }

  async function inviteFriend(friendId) {
    const { data } = await supabase
      .from('buddy_read_participants')
      .insert({ buddy_read_id: id, user_id: friendId, status: 'invited' })
      .select('*')
      .single()
    if (data) setParticipants(prev => [...prev, data])
    // Notify
    const me = profileMap[session.user.id]
    const fromUsername = me?.username || 'A friend'
    const bookTitle = read.books?.title || 'a book'
    notify(friendId, 'buddy_read_invite', {
      title: 'Buddy read invite',
      body: `${fromUsername} invited you to read "${bookTitle}" together`,
      link: `/buddy-reads/${id}`,
      metadata: { buddy_read_id: id },
    })
    setFriends(prev => prev.filter(f => f.id !== friendId))
  }

  const totalPages = read?.books?.pages || 0
  const myPct = totalPages > 0 && myParticipant ? Math.round((myParticipant.current_page / totalPages) * 100) : 0

  const s = {
    page:    { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    inner:   { maxWidth: 760, margin: '0 auto', padding: isMobile ? '20px 14px 80px' : '32px 24px 80px' },
    backLink:{ background: 'none', border: 'none', color: theme.textSubtle, fontSize: 13, padding: 0, cursor: 'pointer', marginBottom: 12 },
    header:  { display: 'flex', gap: 14, marginBottom: 20 },
    cover:   { width: 78, height: 116, borderRadius: 6, objectFit: 'cover', flexShrink: 0, boxShadow: '0 3px 10px rgba(0,0,0,0.2)' },
    title:   { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, lineHeight: 1.2, marginBottom: 4 },
    author:  { fontSize: 14, color: theme.textSubtle, marginBottom: 8 },
    meta:    { fontSize: 12, color: theme.textSubtle },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 11, fontWeight: 700, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
    card:    { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 14 },
    progressRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' },
    avatar:  { width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff', fontWeight: 700, fontSize: 14, overflow: 'hidden' },
    bar:     { flex: 1, height: 8, background: theme.bgSubtle, borderRadius: 4, overflow: 'hidden' },
    barFill: (pct) => ({ width: `${pct}%`, height: '100%', background: theme.rust, borderRadius: 4 }),
    msgRow:  { padding: '10px 0', borderBottom: `1px solid ${theme.borderLight || theme.border}` },
    msgMeta: { fontSize: 12, color: theme.textSubtle, marginBottom: 4 },
    msgBody: { fontSize: 14, color: theme.text, lineHeight: 1.5 },
    inputRow:{ display: 'flex', gap: 8, marginTop: 8 },
    input:   { flex: 1, padding: '8px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: theme.bg, color: theme.text },
    btnPrimary: { background: theme.rust, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:   { background: 'transparent', border: `1px solid ${theme.border}`, color: theme.textSubtle, padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  }

  if (loading) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.inner}><div>Loading…</div></div>
      </div>
    )
  }

  if (!read) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.inner}>
          <div>This buddy read doesn't exist or you don't have access.</div>
          <button onClick={() => navigate('/buddy-reads')} style={{ ...s.btnGhost, marginTop: 12 }}>Back to buddy reads</button>
        </div>
      </div>
    )
  }

  const cover = getCoverUrl(read.books)

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.inner}>
        <button onClick={() => navigate('/buddy-reads')} style={s.backLink}>← All buddy reads</button>

        <div style={s.header}>
          {cover ? <img src={cover} alt={read.books?.title} style={s.cover} /> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={s.title}>{read.title || read.books?.title}</div>
            <div style={s.author}>{read.books?.author}</div>
            <div style={s.meta}>
              {participants.length} participant{participants.length === 1 ? '' : 's'}
              {read.target_finish && ` · finish by ${new Date(read.target_finish).toLocaleDateString()}`}
              {totalPages > 0 && ` · ${totalPages} pages`}
            </div>
          </div>
        </div>

        {/* Pending invite for me */}
        {myParticipant?.status === 'invited' && (
          <div style={{ ...s.card, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 14, color: theme.text }}>You've been invited to this buddy read.</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={s.btnPrimary} onClick={() => joinOrDecline('join')}>Join</button>
              <button style={s.btnGhost} onClick={() => joinOrDecline('decline')}>Decline</button>
            </div>
          </div>
        )}

        {/* My progress */}
        {(isOwner || (myParticipant?.status === 'joined' || myParticipant?.status === 'finished')) && (
          <div style={s.section}>
            <div style={s.sectionTitle}>Your progress</div>
            <div style={s.card}>
              <div style={s.progressRow}>
                <div style={s.bar}><div style={s.barFill(myPct)} /></div>
                <div style={{ fontSize: 12, color: theme.textSubtle, minWidth: 60, textAlign: 'right' }}>
                  {totalPages > 0 ? `${myPct}%` : ''}
                </div>
              </div>
              <div style={s.inputRow}>
                <input
                  type="number"
                  min="0"
                  value={pageDraft}
                  onChange={e => setPageDraft(e.target.value)}
                  style={s.input}
                  placeholder="Current page"
                />
                {totalPages > 0 && <span style={{ alignSelf: 'center', fontSize: 12, color: theme.textSubtle }}>/ {totalPages}</span>}
                <button style={s.btnPrimary} onClick={saveProgress} disabled={savingProgress}>
                  {savingProgress ? '…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Participants */}
        <div style={s.section}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={s.sectionTitle}>Participants</div>
            {isOwner && (
              <button style={{ ...s.btnGhost, padding: '4px 10px', fontSize: 11 }} onClick={() => { setShowInvite(true); loadFriends() }}>
                + Invite friend
              </button>
            )}
          </div>
          <div style={s.card}>
            {participants.map(p => {
              const prof = profileMap[p.user_id] || {}
              const pct = totalPages > 0 ? Math.round((p.current_page / totalPages) * 100) : 0
              return (
                <div key={p.user_id} style={s.progressRow}>
                  <div style={s.avatar}>
                    {prof.avatar_url ? <img src={prof.avatar_url} alt={prof.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (prof.username?.charAt(0).toUpperCase() || '?')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
                      {prof.username || 'Someone'}
                      {p.user_id === read.owner_id && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: 'rgba(192,82,30,0.12)', color: theme.rust, marginLeft: 6 }}>OWNER</span>}
                      {p.status === 'invited' && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: 'rgba(184,134,11,0.15)', color: '#9a7200', marginLeft: 6 }}>INVITED</span>}
                      {p.status === 'declined' && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: theme.bgSubtle, color: theme.textSubtle, marginLeft: 6 }}>DECLINED</span>}
                    </div>
                    {(p.status === 'joined' || p.status === 'finished') && totalPages > 0 && (
                      <div style={{ ...s.bar, marginTop: 4 }}><div style={s.barFill(pct)} /></div>
                    )}
                  </div>
                  {(p.status === 'joined' || p.status === 'finished') && (
                    <div style={{ fontSize: 12, color: theme.textSubtle, minWidth: 48, textAlign: 'right' }}>
                      {totalPages > 0 ? `${pct}%` : `p. ${p.current_page}`}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Invite modal */}
        {showInvite && isOwner && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowInvite(false)}>
            <div style={{ background: theme.bgCard, borderRadius: 14, padding: 20, width: 360, maxWidth: '92vw', maxHeight: '70vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 12 }}>Invite a friend</div>
              {friends.length === 0 ? (
                <div style={{ fontSize: 13, color: theme.textSubtle }}>No more friends to invite — everyone you know is already in.</div>
              ) : friends.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                  <div style={{ ...s.avatar, width: 28, height: 28, fontSize: 12 }}>
                    {f.avatar_url ? <img src={f.avatar_url} alt={f.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : f.username.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, fontSize: 13, color: theme.text }}>{f.username}</div>
                  <button style={{ ...s.btnPrimary, padding: '5px 10px', fontSize: 11 }} onClick={() => inviteFriend(f.id)}>Invite</button>
                </div>
              ))}
              <button style={{ ...s.btnGhost, marginTop: 12, width: '100%' }} onClick={() => setShowInvite(false)}>Close</button>
            </div>
          </div>
        )}

        {/* Chat */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Discussion</div>
          <div style={s.card}>
            {messages.length === 0 ? (
              <div style={{ fontSize: 13, color: theme.textSubtle, padding: '8px 0' }}>No messages yet. Start the conversation!</div>
            ) : messages.map(m => {
              const prof = profileMap[m.user_id] || {}
              return (
                <div key={m.id} style={s.msgRow}>
                  <div style={s.msgMeta}>
                    <strong style={{ color: theme.text }}>{prof.username || 'Someone'}</strong>
                    {' · '}{new Date(m.created_at).toLocaleString()}
                    {m.page_anchor != null && ` · p. ${m.page_anchor}`}
                  </div>
                  <div style={s.msgBody}>{m.body}</div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
            {canChat && (
              <div style={s.inputRow}>
                <input
                  type="text"
                  value={msgDraft}
                  onChange={e => setMsgDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && postMessage()}
                  placeholder="Say something…"
                  style={s.input}
                />
                <button style={s.btnPrimary} onClick={postMessage} disabled={posting || !msgDraft.trim()}>
                  {posting ? '…' : 'Post'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

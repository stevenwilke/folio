import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { fetchBlockedUserIds } from '../lib/moderation'

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function timeRemaining(expiresAt) {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return null
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h left`
  return `${Math.floor(hours / 24)}d left`
}

function FakeCover({ title, size = 52 }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const c1 = colors[title.charCodeAt(0) % colors.length]
  const c2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return (
    <div style={{ width: size, height: Math.round(size * 1.5), borderRadius: 4, background: `linear-gradient(135deg, ${c1}, ${c2})`, flexShrink: 0 }} />
  )
}

function UserAvatar({ profile, size = 36 }) {
  const { theme } = useTheme()
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt={profile.username} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  const initial = profile?.username?.charAt(0).toUpperCase() || '?'
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `linear-gradient(135deg, ${theme.rust}, ${theme.gold})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: Math.round(size * 0.38), flexShrink: 0, cursor: 'pointer' }}>
      {initial}
    </div>
  )
}

// ── Poll Card ─────────────────────────────────────────────────────────────────

function PollCard({ poll, userId, onVote, onClose }) {
  const { theme } = useTheme()
  const [hoverOption, setHoverOption] = useState(null)
  const [voting, setVoting] = useState(false)

  const myVote    = (poll.poll_votes || []).find(v => v.user_id === userId)
  const hasVoted  = !!myVote
  const isOwner   = poll.user_id === userId
  const totalVotes = (poll.poll_votes || []).length
  const remaining = timeRemaining(poll.expires_at)
  const isClosed  = !remaining

  async function handleVote(optionId) {
    if (hasVoted || isClosed || voting) return
    setVoting(true)
    await onVote(poll.id, optionId)
    setVoting(false)
  }

  return (
    <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 22px', borderLeft: `3px solid ${theme.gold}` }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
        <UserAvatar profile={poll.profiles} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: theme.text, fontSize: 14 }}>{poll.profiles?.username}</span>
          <span style={{ color: theme.textSubtle, fontSize: 14 }}> asks:</span>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 16, fontWeight: 600, color: theme.text, marginTop: 3 }}>{poll.question}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          {isClosed
            ? <span style={{ background: 'rgba(26,18,8,0.07)', color: theme.textSubtle, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 500 }}>Closed</span>
            : <span style={{ background: theme.sageLight, color: theme.sage, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>{remaining}</span>
          }
          {isOwner && !isClosed && (
            <span style={{ fontSize: 12, color: theme.rust, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => onClose(poll.id)}>Close early</span>
          )}
        </div>
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(poll.poll_options || []).map(opt => {
          const book = opt.books
          const optVotes = (poll.poll_votes || []).filter(v => v.option_id === opt.id).length
          const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0
          const isMyChoice = myVote?.option_id === opt.id
          const isLeading  = hasVoted && totalVotes > 0 && optVotes === Math.max(...(poll.poll_options || []).map(o => (poll.poll_votes || []).filter(v => v.option_id === o.id).length))

          return (
            <div
              key={opt.id}
              style={{
                borderRadius: 10, padding: '12px 14px',
                cursor: hasVoted || isClosed ? 'default' : 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
                border: isMyChoice
                  ? `2px solid ${theme.rust}`
                  : hoverOption === opt.id && !hasVoted && !isClosed
                  ? `2px solid ${theme.gold}`
                  : `2px solid ${theme.borderLight}`,
                background: isMyChoice ? theme.rustLight : theme.bgCard,
              }}
              onClick={() => handleVote(opt.id)}
              onMouseEnter={() => setHoverOption(opt.id)}
              onMouseLeave={() => setHoverOption(null)}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {book?.cover_image_url
                  ? <img src={book.cover_image_url} alt={book.title} style={{ width: 44, height: 66, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} loading="lazy" />
                  : <FakeCover title={book?.title || '?'} size={44} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{book?.title}</div>
                  <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>{book?.author}</div>
                  {isMyChoice && <div style={{ fontSize: 11, color: theme.rust, fontWeight: 600, marginTop: 4 }}>Your vote</div>}
                </div>
                {hasVoted && <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, flexShrink: 0 }}>{pct}%</div>}
              </div>
              {hasVoted && (
                <div style={{ marginTop: 8, height: 6, background: theme.bgSubtle, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 3, minWidth: 4, width: `${pct}%`, background: isLeading ? theme.gold : theme.sage, transition: 'width 0.5s ease' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${theme.borderLight}` }}>
        <span style={{ fontSize: 12, color: theme.textSubtle, fontWeight: 500 }}>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: 12, color: theme.textSubtle }}>{timeAgo(poll.created_at)}</span>
      </div>
    </div>
  )
}

// ── Create Poll Modal ─────────────────────────────────────────────────────────

function CreatePollModal({ session, onClose, onCreated }) {
  const { theme } = useTheme()
  const [question,       setQuestion]       = useState("What should I read next?")
  const [bookSearch,     setBookSearch]     = useState('')
  const [searchResults,  setSearchResults]  = useState([])
  const [searching,      setSearching]      = useState(false)
  const [selectedBooks,  setSelectedBooks]  = useState([])
  const [shareMode,      setShareMode]      = useState('all')
  const [friends,        setFriends]        = useState([])
  const [selectedFriends,setSelectedFriends]= useState([])
  const [expireDays,     setExpireDays]     = useState('3')
  const [saving,         setSaving]         = useState(false)
  const searchRef = useRef(null)

  useEffect(() => { fetchFriends() }, [])

  async function fetchFriends() {
    const { data: fs } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
    const ids = (fs || []).map(f => f.requester_id === session.user.id ? f.addressee_id : f.requester_id)
    if (!ids.length) return
    const { data: profiles } = await supabase.from('profiles').select('id, username, avatar_url').in('id', ids)
    setFriends(profiles || [])
  }

  async function searchBooks(q) {
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    const { data } = await supabase
      .from('collection_entries')
      .select('books(id, title, author, cover_image_url)')
      .eq('user_id', session.user.id)
      .eq('read_status', 'want')
      .ilike('books.title', `%${q}%`)
      .limit(10)
    const books = (data || []).map(e => e.books).filter(Boolean)
    const seen = new Set()
    setSearchResults(books.filter(b => { if (seen.has(b.id)) return false; seen.add(b.id); return true }))
    setSearching(false)
  }

  useEffect(() => {
    const t = setTimeout(() => searchBooks(bookSearch), 300)
    return () => clearTimeout(t)
  }, [bookSearch])

  function toggleBook(book) {
    setSelectedBooks(prev => {
      if (prev.find(b => b.id === book.id)) return prev.filter(b => b.id !== book.id)
      if (prev.length >= 6) return prev
      return [...prev, book]
    })
  }

  async function handleSubmit() {
    if (selectedBooks.length < 2) return
    setSaving(true)
    const expires_at = new Date(Date.now() + parseInt(expireDays) * 86400000).toISOString()
    const { data: poll, error } = await supabase
      .from('polls')
      .insert({ user_id: session.user.id, question, expires_at })
      .select().single()
    if (error || !poll) { setSaving(false); return }
    await supabase.from('poll_options').insert(selectedBooks.map(b => ({ poll_id: poll.id, book_id: b.id })))
    const recipientIds = shareMode === 'all' ? friends.map(f => f.id) : selectedFriends
    if (recipientIds.length) {
      await supabase.from('poll_recipients').insert(recipientIds.map(rid => ({ poll_id: poll.id, recipient_id: rid })))
    }
    setSaving(false)
    onCreated()
  }

  const inp = { width: '100%', padding: '9px 13px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' }
  const lbl = { display: 'block', fontSize: 13, fontWeight: 600, color: theme.textMuted, marginBottom: 6 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24 }} onClick={onClose}>
      <div style={{ background: theme.bgCard, borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: theme.shadow }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: `1px solid ${theme.borderLight}` }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: theme.text }}>New Poll</div>
          <button style={{ background: 'none', border: 'none', fontSize: 16, color: theme.textSubtle, cursor: 'pointer' }} onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          <label style={lbl}>Poll question</label>
          <input style={inp} value={question} onChange={e => setQuestion(e.target.value)} maxLength={120} />

          <label style={{ ...lbl, marginTop: 18 }}>Choose 2–6 books from your "Want to Read" list</label>
          <input ref={searchRef} style={inp} placeholder="Search your want-to-read books…" value={bookSearch} onChange={e => setBookSearch(e.target.value)} />

          {bookSearch && (
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', marginTop: 6, maxHeight: 220, overflowY: 'auto' }}>
              {searching
                ? <div style={{ padding: '14px 12px', fontSize: 13, color: theme.textSubtle, textAlign: 'center' }}>Searching…</div>
                : searchResults.length === 0
                ? <div style={{ padding: '14px 12px', fontSize: 13, color: theme.textSubtle, textAlign: 'center' }}>No want-to-read books match "{bookSearch}"</div>
                : searchResults.map(book => {
                    const selected = !!selectedBooks.find(b => b.id === book.id)
                    return (
                      <div key={book.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', cursor: 'pointer', background: selected ? theme.rustLight : theme.bgCard, borderBottom: `1px solid ${theme.borderLight}` }} onClick={() => toggleBook(book)}>
                        {book.cover_image_url
                          ? <img src={book.cover_image_url} alt={book.title} style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                          : <FakeCover title={book.title} size={32} />
                        }
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{book.title}</div>
                          <div style={{ fontSize: 12, color: theme.textSubtle }}>{book.author}</div>
                        </div>
                        <div style={{ fontSize: 13, color: selected ? theme.rust : theme.textSubtle }}>{selected ? '✓ Added' : '+ Add'}</div>
                      </div>
                    )
                  })
              }
            </div>
          )}

          {selectedBooks.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
              {selectedBooks.map(book => (
                <div key={book.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: theme.rustLight, color: theme.rust, borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 500 }}>
                  {book.title}
                  <span style={{ cursor: 'pointer', fontSize: 11, opacity: 0.7 }} onClick={() => toggleBook(book)}>✕</span>
                </div>
              ))}
              <div style={{ fontSize: 12, color: theme.textSubtle }}>{selectedBooks.length}/6</div>
            </div>
          )}

          <label style={{ ...lbl, marginTop: 18 }}>Share with</label>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 20 }}>
            {['all', 'specific'].map(mode => (
              <label key={mode} style={{ display: 'flex', alignItems: 'center', fontSize: 14, color: theme.textMuted, cursor: 'pointer' }}>
                <input type="radio" name="share" value={mode} checked={shareMode === mode} onChange={() => setShareMode(mode)} style={{ accentColor: theme.rust }} />
                <span style={{ marginLeft: 6 }}>{mode === 'all' ? `All friends (${friends.length})` : 'Specific friends'}</span>
              </label>
            ))}
          </div>

          {shareMode === 'specific' && friends.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 160, overflowY: 'auto', background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '10px 12px' }}>
              {friends.map(f => (
                <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={selectedFriends.includes(f.id)} onChange={() => setSelectedFriends(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id])} style={{ accentColor: theme.rust }} />
                  <UserAvatar profile={f} size={24} />
                  <span style={{ fontSize: 13, color: theme.text }}>{f.username}</span>
                </label>
              ))}
            </div>
          )}

          <label style={{ ...lbl, marginTop: 18 }}>Expires in</label>
          <select style={{ ...inp }} value={expireDays} onChange={e => setExpireDays(e.target.value)}>
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7">1 week</option>
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${theme.borderLight}` }}>
          <button style={{ padding: '9px 16px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }} onClick={onClose}>Cancel</button>
          <button
            style={{ padding: '9px 18px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: selectedBooks.length < 2 || saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: selectedBooks.length < 2 || saving ? 0.6 : 1 }}
            onClick={handleSubmit}
            disabled={selectedBooks.length < 2 || saving}
          >
            {saving ? 'Posting…' : 'Post Poll'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Friend Card ───────────────────────────────────────────────────────────────

function FriendCard({ friend, onVisit, onUnfriend, acting }) {
  const { theme } = useTheme()
  const [hover,     setHover]     = useState(false)
  const [menuOpen,  setMenuOpen]  = useState(false)
  const s = makeStyles(theme)

  return (
    <div style={{ ...s.friendCard, ...(hover ? s.friendCardHover : {}) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setMenuOpen(false) }}
    >
      <div style={s.friendAvatarWrap} onClick={onVisit}>
        <UserAvatar profile={friend} size={64} />
      </div>
      <div style={s.friendName} onClick={onVisit}>{friend.username}</div>
      <div style={s.friendStats}>
        {friend.stats.total > 0
          ? `${friend.stats.total} book${friend.stats.total !== 1 ? 's' : ''} · ${friend.stats.read} read`
          : 'No books yet'}
      </div>
      <div style={s.friendActions}>
        <button style={s.btnVisit} onClick={onVisit}>View Profile</button>
        <div style={{ position: 'relative' }}>
          <button style={s.btnMore} onClick={() => setMenuOpen(v => !v)}>···</button>
          {menuOpen && (
            <div style={s.moreMenu}>
              <div style={s.moreMenuItem} onClick={() => { setMenuOpen(false); onUnfriend() }}>
                {acting ? '…' : 'Remove friend'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Friends({ session, initialTab }) {
  const navigate   = useNavigate()
  const { theme }  = useTheme()
  const isMobile   = useIsMobile()
  const s          = makeStyles(theme)

  // ── Top-level tab: friends | polls
  const [activeTab, setActiveTab] = useState(initialTab || 'friends')

  // ── Friends state
  const [friends,        setFriends]        = useState([])
  const [incoming,       setIncoming]       = useState([])
  const [outgoing,       setOutgoing]       = useState([])
  const [friendsLoading, setFriendsLoading] = useState(true)
  const [search,         setSearch]         = useState('')
  const [searchResults,  setSearchResults]  = useState([])
  const [searching,      setSearching]      = useState(false)
  const [searched,       setSearched]       = useState(false)
  const [acting,         setActing]         = useState(null)
  const [myUsername,     setMyUsername]     = useState(null)
  const [inviteCopied,   setInviteCopied]   = useState(false)

  // ── Polls state
  const [polls,        setPolls]        = useState([])
  const [pollsLoading, setPollsLoading] = useState(true)
  const [pollTab,      setPollTab]      = useState('active')
  const [showCreate,   setShowCreate]   = useState(false)

  useEffect(() => {
    fetchAll(); fetchPolls()
    supabase.from('profiles').select('username').eq('id', session.user.id).single()
      .then(({ data }) => setMyUsername(data?.username ?? null))
  }, [])

  // ── Friends data ──────────────────────────────────────────────────────────

  async function fetchAll() {
    setFriendsLoading(true)

    const [{ data: fs }, { data: incRaw }, { data: outRaw }] = await Promise.all([
      supabase.from('friendships').select('id, requester_id, addressee_id').eq('status', 'accepted').or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`),
      supabase.from('friendships').select('id, requester_id, created_at').eq('addressee_id', session.user.id).eq('status', 'pending'),
      supabase.from('friendships').select('id, addressee_id, created_at').eq('requester_id', session.user.id).eq('status', 'pending'),
    ])

    const pendingIds = [...new Set([...(incRaw || []).map(f => f.requester_id), ...(outRaw || []).map(f => f.addressee_id)])]
    let pendingProfileMap = {}
    if (pendingIds.length) {
      const { data: ps } = await supabase.from('profiles').select('id, username, avatar_url').in('id', pendingIds)
      pendingProfileMap = Object.fromEntries((ps || []).map(p => [p.id, p]))
    }

    setIncoming((incRaw || []).map(f => ({ ...f, profiles: pendingProfileMap[f.requester_id] || null })))
    setOutgoing((outRaw  || []).map(f => ({ ...f, profiles: pendingProfileMap[f.addressee_id] || null })))

    const friendIds = (fs || []).map(f => f.requester_id === session.user.id ? f.addressee_id : f.requester_id)
    if (!friendIds.length) { setFriends([]); setFriendsLoading(false); return }

    const [{ data: profiles }, { data: counts }] = await Promise.all([
      supabase.from('profiles').select('id, username, avatar_url').in('id', friendIds),
      supabase.from('collection_entries').select('user_id, read_status').in('user_id', friendIds),
    ])

    const countMap = {}
    for (const e of counts || []) {
      if (!countMap[e.user_id]) countMap[e.user_id] = { total: 0, read: 0 }
      countMap[e.user_id].total++
      if (e.read_status === 'read') countMap[e.user_id].read++
    }

    const friendshipIdMap = {}
    for (const f of fs || []) {
      const fid = f.requester_id === session.user.id ? f.addressee_id : f.requester_id
      friendshipIdMap[fid] = f.id
    }

    setFriends((profiles || []).map(p => ({ ...p, friendshipId: friendshipIdMap[p.id], stats: countMap[p.id] || { total: 0, read: 0 } })))
    setFriendsLoading(false)
  }

  async function respondToRequest(id, accept) {
    setActing(id)
    if (accept) await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    else         await supabase.from('friendships').delete().eq('id', id)
    setActing(null); fetchAll()
  }

  async function cancelOutgoing(id) {
    setActing(id)
    await supabase.from('friendships').delete().eq('id', id)
    setActing(null); fetchAll()
  }

  async function unfriend(friendshipId) {
    setActing(friendshipId)
    await supabase.from('friendships').delete().eq('id', friendshipId)
    setActing(null); fetchAll()
  }

  async function runSearch() {
    const q = search.trim()
    if (!q) return
    setSearching(true); setSearched(true)
    const blockedIds = await fetchBlockedUserIds(session.user.id)
    const blockedSet = new Set(blockedIds)
    const { data: raw } = await supabase.from('profiles').select('id, username, avatar_url').ilike('username', `%${q}%`).neq('id', session.user.id).limit(30)
    const data = (raw || []).filter(p => !blockedSet.has(p.id)).slice(0, 20)
    const ids = data.map(p => p.id)
    let statusMap = {}
    if (ids.length) {
      const { data: fs } = await supabase.from('friendships').select('id, requester_id, addressee_id, status').or(ids.map(id => `and(requester_id.eq.${session.user.id},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${session.user.id})`).join(','))
      for (const f of fs || []) {
        const otherId = f.requester_id === session.user.id ? f.addressee_id : f.requester_id
        statusMap[otherId] = { friendshipId: f.id, status: f.status, iAmRequester: f.requester_id === session.user.id }
      }
    }
    setSearchResults(data.map(p => ({ ...p, friendship: statusMap[p.id] || null })))
    setSearching(false)
  }

  async function addFriend(userId) {
    setActing(userId)
    await supabase.from('friendships').insert({ requester_id: session.user.id, addressee_id: userId })
    setActing(null); runSearch(); fetchAll()
  }

  async function cancelSearch(friendshipId, userId) {
    setActing(userId)
    await supabase.from('friendships').delete().eq('id', friendshipId)
    setActing(null); runSearch(); fetchAll()
  }

  // ── Polls data ────────────────────────────────────────────────────────────

  async function fetchPolls() {
    setPollsLoading(true)
    const userId = session.user.id
    const { data: recipientRows } = await supabase.from('poll_recipients').select('poll_id').eq('recipient_id', userId)
    const sharedIds = (recipientRows || []).map(r => r.poll_id)

    let query = supabase.from('polls').select(`*, profiles(username, avatar_url), poll_votes(*), poll_options(*, books(id, title, author, cover_image_url))`).order('created_at', { ascending: false })
    if (sharedIds.length > 0) query = query.or(`user_id.eq.${userId},id.in.(${sharedIds.join(',')})`)
    else                       query = query.eq('user_id', userId)

    const { data } = await query
    setPolls(data || [])
    setPollsLoading(false)
  }

  async function handleVote(pollId, optionId) {
    await supabase.from('poll_votes').insert({ poll_id: pollId, user_id: session.user.id, option_id: optionId })
    fetchPolls()
  }

  async function handleClosePoll(pollId) {
    await supabase.from('polls').update({ expires_at: new Date().toISOString() }).eq('id', pollId)
    fetchPolls()
  }

  const now           = new Date()
  const activePolls   = polls.filter(p => new Date(p.expires_at) > now)
  const pastPolls     = polls.filter(p => new Date(p.expires_at) <= now)
  const myPolls       = polls.filter(p => p.user_id === session.user.id)
  const displayPolls  = pollTab === 'active' ? activePolls : pollTab === 'mine' ? myPolls : pastPolls
  const pollTabs      = [{ key: 'active', label: 'Active', count: activePolls.length }, { key: 'mine', label: 'My Polls', count: myPolls.length }, { key: 'past', label: 'Past', count: pastPolls.length }]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      <NavBar session={session} />

      <div style={s.content}>

        {/* Page header */}
        <div style={s.pageHead}>
          <div>
            <div style={s.pageTitle}>{activeTab === 'polls' ? 'Reading Polls' : 'Friends'}</div>
            <div style={s.pageSub}>
              {activeTab === 'friends'
                ? (friendsLoading ? 'Loading…' : `${friends.length} friend${friends.length !== 1 ? 's' : ''}`)
                : 'Ask your friends what you should read next'}
            </div>
          </div>
          {activeTab === 'polls' && (
            <button style={s.btnPrimary} onClick={() => setShowCreate(true)}>📊 New Poll</button>
          )}
        </div>

        {/* Top-level tab bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, marginBottom: 28 }}>
          {[
            { key: 'friends', label: '👥 Friends', count: incoming.length > 0 ? incoming.length : null },
            { key: 'polls',   label: '📊 Polls',   count: activePolls.length > 0 ? activePolls.length : null },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: isMobile ? '10px 16px' : '10px 24px',
                background: 'none', border: 'none',
                borderBottom: `2px solid ${activeTab === t.key ? theme.rust : 'transparent'}`,
                fontSize: 14, fontWeight: activeTab === t.key ? 700 : 500,
                color: activeTab === t.key ? theme.rust : theme.textSubtle,
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                marginBottom: -1, transition: 'color 0.15s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {t.label}
              {t.count && (
                <span style={{ background: activeTab === t.key ? theme.rustLight : theme.bgSubtle, color: activeTab === t.key ? theme.rust : theme.textSubtle, borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── FRIENDS TAB ── */}
        {activeTab === 'friends' && (
          <>
            {/* Pending requests */}
            {incoming.length > 0 && (
              <section style={s.section}>
                <div style={s.sectionHead}>
                  <div style={s.sectionTitle}>Friend Requests</div>
                  <span style={s.badge}>{incoming.length}</span>
                </div>
                <div style={s.requestList}>
                  {incoming.map(req => (
                    <div key={req.id} style={s.requestRow}>
                      <UserAvatar profile={req.profiles} size={44} />
                      <div style={s.requestInfo}>
                        <div style={s.requestName} onClick={() => navigate(`/profile/${req.profiles?.username}`)}>{req.profiles?.username}</div>
                        <div style={s.requestSub}>wants to be friends</div>
                      </div>
                      <div style={s.requestActions}>
                        <button style={s.btnAccept} onClick={() => respondToRequest(req.id, true)} disabled={acting === req.id}>{acting === req.id ? '…' : 'Accept'}</button>
                        <button style={s.btnDecline} onClick={() => respondToRequest(req.id, false)} disabled={acting === req.id}>Decline</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Invite a Friend */}
            {(() => {
              const inviteLink = `https://exlibris.app/join${myUsername ? `?ref=${myUsername}` : ''}`
              async function copyInvite() {
                await navigator.clipboard.writeText(inviteLink)
                setInviteCopied(true)
                setTimeout(() => setInviteCopied(false), 2500)
              }
              async function shareInvite() {
                if (navigator.share) {
                  await navigator.share({ title: 'Join me on Ex Libris', text: `I'm using Ex Libris to track my book collection. Join me!`, url: inviteLink })
                } else {
                  copyInvite()
                }
              }
              return (
                <section style={s.section}>
                  <div style={s.sectionHead}><div style={s.sectionTitle}>Invite a Friend</div></div>
                  <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '18px 20px' }}>
                    <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 12, lineHeight: 1.5 }}>
                      Know someone who loves books? Share your invite link — they'll land right on Ex Libris.
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: theme.bgSubtle, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontFamily: 'monospace', fontSize: 13, color: theme.rust, overflow: 'hidden' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inviteLink}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={shareInvite}
                        style={{ flex: 1, padding: '9px 0', background: theme.rust, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        📤 Share
                      </button>
                      <button
                        onClick={copyInvite}
                        style={{ flex: 1, padding: '9px 0', background: 'transparent', color: inviteCopied ? theme.sage : theme.text, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        {inviteCopied ? '✓ Copied!' : 'Copy Link'}
                      </button>
                    </div>
                  </div>
                </section>
              )
            })()}

            {/* Find people */}
            <section style={s.section}>
              <div style={s.sectionHead}><div style={s.sectionTitle}>Find People</div></div>
              <div style={s.searchRow}>
                <input style={s.searchInput} placeholder="Search by username…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} />
                <button style={s.btnSearch} onClick={runSearch} disabled={searching || !search.trim()}>{searching ? '…' : 'Search'}</button>
              </div>
              {searched && !searching && (
                <div style={s.searchResults}>
                  {searchResults.length === 0 ? (
                    <div style={s.emptySearch}>No users found for "{search}"</div>
                  ) : searchResults.map(user => {
                    const f = user.friendship
                    return (
                      <div key={user.id} style={s.searchResultRow}>
                        <UserAvatar profile={user} size={40} />
                        <div style={{ flex: 1 }}>
                          <div style={s.searchResultName} onClick={() => navigate(`/profile/${user.username}`)}>{user.username}</div>
                        </div>
                        <div>
                          {!f && <button style={s.btnAdd} onClick={() => addFriend(user.id)} disabled={acting === user.id}>{acting === user.id ? '…' : '+ Add Friend'}</button>}
                          {f?.status === 'accepted' && <span style={s.friendChip}>Friends ✓</span>}
                          {f?.status === 'pending' && f?.iAmRequester && <button style={s.btnPending} onClick={() => cancelSearch(f.friendshipId, user.id)} disabled={acting === user.id}>{acting === user.id ? '…' : 'Requested ✓'}</button>}
                          {f?.status === 'pending' && !f?.iAmRequester && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button style={s.btnAdd} onClick={() => respondToRequest(f.friendshipId, true)} disabled={acting === f.friendshipId}>Accept</button>
                              <button style={s.btnDeclineSmall} onClick={() => respondToRequest(f.friendshipId, false)} disabled={acting === f.friendshipId}>Decline</button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* Friends list */}
            <section style={s.section}>
              <div style={s.sectionHead}>
                <div style={s.sectionTitle}>My Friends</div>
                {friends.length > 0 && <span style={s.countChip}>{friends.length}</span>}
              </div>
              {friendsLoading ? (
                <div style={s.emptyMsg}>Loading…</div>
              ) : friends.length === 0 ? (
                <div style={s.emptyBox}>
                  <div style={s.emptyIcon}>👥</div>
                  <div style={s.emptyTitle}>No friends yet</div>
                  <div style={s.emptySub}>Search for people above or share your profile to connect with other readers.</div>
                </div>
              ) : (
                <div style={s.friendsGrid}>
                  {friends.map(friend => (
                    <FriendCard key={friend.id} friend={friend} onVisit={() => navigate(`/profile/${friend.username}`)} onUnfriend={() => unfriend(friend.friendshipId)} acting={acting === friend.friendshipId} />
                  ))}
                </div>
              )}
            </section>

            {/* Sent requests */}
            {outgoing.length > 0 && (
              <section style={{ ...s.section, marginBottom: 48 }}>
                <div style={s.sectionHead}>
                  <div style={{ ...s.sectionTitle, fontSize: 15 }}>Sent Requests</div>
                  <span style={s.countChip}>{outgoing.length}</span>
                </div>
                <div style={s.requestList}>
                  {outgoing.map(req => (
                    <div key={req.id} style={s.requestRow}>
                      <UserAvatar profile={req.profiles} size={40} />
                      <div style={s.requestInfo}>
                        <div style={s.requestName} onClick={() => navigate(`/profile/${req.profiles?.username}`)}>{req.profiles?.username}</div>
                        <div style={s.requestSub}>Request pending</div>
                      </div>
                      <button style={s.btnDecline} onClick={() => cancelOutgoing(req.id)} disabled={acting === req.id}>{acting === req.id ? '…' : 'Cancel'}</button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ── POLLS TAB ── */}
        {activeTab === 'polls' && (
          <>
            {/* Poll sub-tabs */}
            <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: `1px solid ${theme.border}` }}>
              {pollTabs.map(t => (
                <button key={t.key}
                  style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: `2px solid ${pollTab === t.key ? theme.rust : 'transparent'}`, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: pollTab === t.key ? theme.rust : theme.textSubtle, fontWeight: pollTab === t.key ? 600 : 500, marginBottom: -1, transition: 'color 0.15s' }}
                  onClick={() => setPollTab(t.key)}
                >
                  {t.label}
                  {t.count > 0 && <span style={{ marginLeft: 6, background: pollTab === t.key ? theme.rustLight : 'rgba(26,18,8,0.07)', color: pollTab === t.key ? theme.rust : theme.textSubtle, borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: pollTab === t.key ? 600 : 500 }}>{t.count}</span>}
                </button>
              ))}
            </div>

            {pollsLoading ? (
              <div style={{ color: theme.textSubtle, fontSize: 14, padding: '60px 0', textAlign: 'center' }}>Loading polls…</div>
            ) : displayPolls.length === 0 ? (
              <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: '60px 32px', textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
                <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 8 }}>
                  {pollTab === 'active' ? 'No active polls' : pollTab === 'mine' ? 'No polls created yet' : 'No past polls'}
                </div>
                <div style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 24 }}>
                  {pollTab === 'active' ? 'Create a poll to ask your friends what you should read next!' : pollTab === 'mine' ? 'Click "New Poll" to get started.' : 'Closed polls will appear here.'}
                </div>
                {pollTab !== 'past' && <button style={s.btnPrimary} onClick={() => setShowCreate(true)}>📊 New Poll</button>}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 48 }}>
                {displayPolls.map(poll => (
                  <PollCard key={poll.id} poll={poll} userId={session.user.id} onVote={handleVote} onClose={handleClosePoll} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreatePollModal session={session} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchPolls() }} />
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(theme) {
  return {
    page:    { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content: { maxWidth: 720, margin: '0 auto', padding: '36px 32px' },

    pageHead:  { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
    pageTitle: { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, color: theme.text },
    pageSub:   { fontSize: 14, color: theme.textSubtle, marginTop: 4 },

    section:      { marginBottom: 36 },
    sectionHead:  { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 },
    sectionTitle: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text },
    badge:        { background: theme.rust, color: 'white', borderRadius: 20, padding: '2px 9px', fontSize: 12, fontWeight: 600 },
    countChip:    { background: theme.bgSubtle, color: theme.textSubtle, borderRadius: 20, padding: '2px 9px', fontSize: 12, fontWeight: 500 },

    requestList:  { display: 'flex', flexDirection: 'column', gap: 2 },
    requestRow:   { display: 'flex', alignItems: 'center', gap: 14, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 18px' },
    requestInfo:  { flex: 1 },
    requestName:  { fontSize: 15, fontWeight: 600, color: theme.text, cursor: 'pointer' },
    requestSub:   { fontSize: 12, color: theme.textSubtle, marginTop: 2 },
    requestActions:{ display: 'flex', gap: 8 },

    searchRow:        { display: 'flex', gap: 10, marginBottom: 4 },
    searchInput:      { flex: 1, padding: '9px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text },
    searchResults:    { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 },
    searchResultRow:  { display: 'flex', alignItems: 'center', gap: 12, background: theme.bgCard, border: `1px solid ${theme.borderLight}`, borderRadius: 10, padding: '12px 16px' },
    searchResultName: { fontSize: 14, fontWeight: 600, color: theme.text, cursor: 'pointer' },
    emptySearch:      { color: theme.textSubtle, fontSize: 14, padding: '20px 0', textAlign: 'center' },

    friendsGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 },
    friendCard:     { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '22px 18px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transition: 'box-shadow 0.15s, transform 0.15s' },
    friendCardHover:{ boxShadow: theme.shadowCard, transform: 'translateY(-2px)' },
    friendAvatarWrap:{ cursor: 'pointer', marginBottom: 12 },
    friendName:     { fontSize: 15, fontWeight: 700, color: theme.text, cursor: 'pointer', marginBottom: 4 },
    friendStats:    { fontSize: 12, color: theme.textSubtle, marginBottom: 14 },
    friendActions:  { display: 'flex', gap: 6, alignItems: 'center' },

    emptyMsg:   { color: theme.textSubtle, fontSize: 14, padding: '20px 0' },
    emptyBox:   { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: '48px 32px', textAlign: 'center' },
    emptyIcon:  { fontSize: 36, marginBottom: 12 },
    emptyTitle: { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 8 },
    emptySub:   { fontSize: 14, color: theme.textSubtle, maxWidth: 320, margin: '0 auto' },

    btnAccept:      { padding: '6px 14px', background: theme.rust, color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnDecline:     { padding: '6px 12px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 7, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnDeclineSmall:{ padding: '5px 10px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnSearch:      { padding: '9px 18px', background: theme.text, color: theme.bg, border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnAdd:         { padding: '6px 14px', background: theme.rust, color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
    btnPending:     { padding: '6px 12px', background: 'transparent', color: theme.sage, border: `1px solid ${theme.sage}`, borderRadius: 7, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
    btnPrimary:     { padding: '9px 18px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
    friendChip:     { fontSize: 13, color: theme.sage, fontWeight: 500 },
    btnVisit:       { padding: '6px 14px', background: 'transparent', color: theme.rust, border: `1px solid ${theme.rust}`, borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnMore:        { padding: '5px 9px', background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 7, fontSize: 14, cursor: 'pointer', color: theme.textSubtle, lineHeight: 1 },
    moreMenu:       { position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 8, minWidth: 140, boxShadow: theme.shadow, zIndex: 20 },
    moreMenuItem:   { padding: '10px 14px', fontSize: 13, cursor: 'pointer', color: theme.rust },
  }
}

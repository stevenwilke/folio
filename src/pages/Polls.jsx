import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'

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
  const days = Math.floor(hours / 24)
  return `${days}d left`
}

function FakeCover({ title, size = 52 }) {
  const colors = ['#7b4f3a', '#4a6b8a', '#5a7a5a', '#2c3e50', '#8b2500', '#b8860b', '#3d5a5a', '#c0521e']
  const c1 = colors[title.charCodeAt(0) % colors.length]
  const c2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return (
    <div style={{ width: size, height: Math.round(size * 1.5), borderRadius: 4, background: `linear-gradient(135deg, ${c1}, ${c2})`, flexShrink: 0 }} />
  )
}

function UserAvatar({ profile, size = 36 }) {
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt={profile.username} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  const initial = profile?.username?.charAt(0).toUpperCase() || '?'
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: Math.round(size * 0.38), flexShrink: 0 }}>
      {initial}
    </div>
  )
}

// ---- POLL CARD ----
function PollCard({ poll, userId, onVote, onClose }) {
  const { theme } = useTheme()
  const [hoverOption, setHoverOption] = useState(null)
  const [voting, setVoting] = useState(false)

  const myVote = (poll.poll_votes || []).find(v => v.user_id === userId)
  const hasVoted = !!myVote
  const isOwner = poll.user_id === userId
  const totalVotes = (poll.poll_votes || []).length
  const remaining = timeRemaining(poll.expires_at)
  const isClosed = !remaining

  async function handleVote(optionId) {
    if (hasVoted || isClosed || voting) return
    setVoting(true)
    await onVote(poll.id, optionId)
    setVoting(false)
  }

  const s = {
    pollCard:     { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 22px', borderLeft: `3px solid ${theme.gold}` },
    pollHeader:   { display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16 },
    pollHeaderInfo:{ flex: 1, minWidth: 0 },
    pollAuthor:   { fontWeight: 700, color: theme.text, fontSize: 14 },
    pollAsks:     { color: theme.textSubtle, fontSize: 14 },
    pollQuestion: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 16, fontWeight: 600, color: theme.text, marginTop: 3 },

    badgeOpen:    { background: theme.sageLight, color: theme.sage, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' },
    badgeClosed:  { background: 'rgba(26,18,8,0.07)', color: theme.textSubtle, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 500 },
    closeEarlyLink:{ fontSize: 12, color: theme.rust, cursor: 'pointer', textDecoration: 'underline' },

    pollOptions:  { display: 'flex', flexDirection: 'column', gap: 10 },
    pollOption:   { borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s', userSelect: 'none' },
    pollOptionInner:{ display: 'flex', gap: 12, alignItems: 'center' },
    pollOptionText: { flex: 1, minWidth: 0 },
    pollOptionTitle:{ fontSize: 14, fontWeight: 600, color: theme.text },
    pollOptionAuthor:{ fontSize: 12, color: theme.textSubtle, marginTop: 2 },
    pollVoteCount:{ fontSize: 14, fontWeight: 700, color: theme.text, flexShrink: 0 },

    pollBarTrack: { marginTop: 8, height: 6, background: theme.bgSubtle, borderRadius: 3, overflow: 'hidden' },
    pollBar:      { height: '100%', borderRadius: 3, minWidth: 4 },

    pollFooter:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${theme.borderLight}` },
    pollVoteTotal:{ fontSize: 12, color: theme.textSubtle, fontWeight: 500 },
    pollTime:     { fontSize: 12, color: theme.textSubtle },
  }

  return (
    <div style={s.pollCard}>
      {/* Header */}
      <div style={s.pollHeader}>
        <UserAvatar profile={poll.profiles} size={36} />
        <div style={s.pollHeaderInfo}>
          <span style={s.pollAuthor}>{poll.profiles?.username}</span>
          <span style={s.pollAsks}> asks:</span>
          <div style={s.pollQuestion}>{poll.question}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          {isClosed
            ? <span style={s.badgeClosed}>Closed</span>
            : <span style={s.badgeOpen}>{remaining}</span>
          }
          {isOwner && !isClosed && (
            <span style={s.closeEarlyLink} onClick={() => onClose(poll.id)}>Close early</span>
          )}
        </div>
      </div>

      {/* Options */}
      <div style={s.pollOptions}>
        {(poll.poll_options || []).map(opt => {
          const book = opt.books
          const optVotes = (poll.poll_votes || []).filter(v => v.option_id === opt.id).length
          const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0
          const isMyChoice = myVote?.option_id === opt.id
          const isLeading = hasVoted && totalVotes > 0 && optVotes === Math.max(...(poll.poll_options || []).map(o => (poll.poll_votes || []).filter(v => v.option_id === o.id).length))
          const barColor = isLeading ? theme.gold : theme.sage

          return (
            <div
              key={opt.id}
              style={{
                ...s.pollOption,
                cursor: hasVoted || isClosed ? 'default' : 'pointer',
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
              <div style={s.pollOptionInner}>
                {book?.cover_image_url
                  ? <img src={book.cover_image_url} alt={book.title} style={{ width: 44, height: 66, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                  : <FakeCover title={book?.title || '?'} size={44} />
                }
                <div style={s.pollOptionText}>
                  <div style={s.pollOptionTitle}>{book?.title}</div>
                  <div style={s.pollOptionAuthor}>{book?.author}</div>
                  {isMyChoice && <div style={{ fontSize: 11, color: theme.rust, fontWeight: 600, marginTop: 4 }}>Your vote</div>}
                </div>
                {hasVoted && (
                  <div style={s.pollVoteCount}>{pct}%</div>
                )}
              </div>
              {hasVoted && (
                <div style={s.pollBarTrack}>
                  <div
                    style={{
                      ...s.pollBar,
                      width: `${pct}%`,
                      background: barColor,
                      transition: 'width 0.5s ease',
                    }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={s.pollFooter}>
        <span style={s.pollVoteTotal}>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</span>
        <span style={s.pollTime}>{timeAgo(poll.created_at)}</span>
      </div>
    </div>
  )
}

// ---- CREATE POLL MODAL ----
function CreatePollModal({ session, onClose, onCreated }) {
  const { theme } = useTheme()
  const [question, setQuestion] = useState("What should I read next?")
  const [bookSearch, setBookSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedBooks, setSelectedBooks] = useState([])
  const [shareMode, setShareMode] = useState('all') // 'all' | 'specific'
  const [friends, setFriends] = useState([])
  const [selectedFriends, setSelectedFriends] = useState([])
  const [expireDays, setExpireDays] = useState('3')
  const [saving, setSaving] = useState(false)
  const searchRef = useRef(null)

  useEffect(() => {
    fetchFriends()
  }, [])

  async function fetchFriends() {
    const { data: friendships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)

    const friendIds = (friendships || []).map(f =>
      f.requester_id === session.user.id ? f.addressee_id : f.requester_id
    )
    if (!friendIds.length) return

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', friendIds)

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
    // Deduplicate
    const seen = new Set()
    const unique = books.filter(b => { if (seen.has(b.id)) return false; seen.add(b.id); return true })
    setSearchResults(unique)
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

  function toggleFriend(id) {
    setSelectedFriends(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    )
  }

  async function handleSubmit() {
    if (selectedBooks.length < 2) return
    setSaving(true)

    const expires_at = new Date(Date.now() + parseInt(expireDays) * 86400000).toISOString()

    const { data: poll, error: pollErr } = await supabase
      .from('polls')
      .insert({ user_id: session.user.id, question, expires_at })
      .select()
      .single()

    if (pollErr || !poll) { setSaving(false); return }

    await supabase.from('poll_options').insert(
      selectedBooks.map(b => ({ poll_id: poll.id, book_id: b.id }))
    )

    // Recipients
    const recipientIds = shareMode === 'all'
      ? friends.map(f => f.id)
      : selectedFriends

    if (recipientIds.length) {
      await supabase.from('poll_recipients').insert(
        recipientIds.map(rid => ({ poll_id: poll.id, recipient_id: rid }))
      )
    }

    setSaving(false)
    onCreated()
  }

  const s = {
    modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24 },
    modal:        { background: theme.bgCard, borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: theme.shadow },
    modalHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: `1px solid ${theme.borderLight}` },
    modalTitle:   { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: theme.text },
    modalClose:   { background: 'none', border: 'none', fontSize: 16, color: theme.textSubtle, cursor: 'pointer', padding: '4px 8px', borderRadius: 6 },
    modalBody:    { flex: 1, overflowY: 'auto', padding: '20px 24px' },
    modalFooter:  { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${theme.borderLight}` },

    label:        { display: 'block', fontSize: 13, fontWeight: 600, color: theme.textMuted, marginBottom: 6 },
    input:        { width: '100%', padding: '9px 13px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    select:       { width: '100%', padding: '9px 13px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },

    bookResults:  { border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', marginTop: 6, maxHeight: 220, overflowY: 'auto' },
    bookResultRow:{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', cursor: 'pointer', border: '1px solid transparent', borderRadius: 0, transition: 'background 0.1s' },
    bookResultHint:{ padding: '14px 12px', fontSize: 13, color: theme.textSubtle, textAlign: 'center' },

    selectedBooks:{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' },
    selectedBookChip:{ display: 'flex', alignItems: 'center', gap: 6, background: theme.rustLight, color: theme.rust, borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 500 },
    chipRemove:   { cursor: 'pointer', fontSize: 11, opacity: 0.7 },

    shareRow:     { display: 'flex', alignItems: 'center', marginBottom: 10 },
    radioLabel:   { display: 'flex', alignItems: 'center', fontSize: 14, color: theme.textMuted, cursor: 'pointer' },
    friendChecklist:{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, maxHeight: 160, overflowY: 'auto', background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '10px 12px' },
    checkLabel:   { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 },

    btnPrimary:   { padding: '9px 18px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
    btnGhost:     { padding: '9px 16px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  }

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>New Poll</div>
          <button style={s.modalClose} onClick={onClose}>✕</button>
        </div>

        <div style={s.modalBody}>
          {/* Question */}
          <label style={s.label}>Poll question</label>
          <input
            style={s.input}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            maxLength={120}
          />

          {/* Book search */}
          <label style={{ ...s.label, marginTop: 18 }}>
            Choose 2–6 books from your "Want to Read" list
          </label>
          <input
            ref={searchRef}
            style={s.input}
            placeholder="Search your want-to-read books…"
            value={bookSearch}
            onChange={e => setBookSearch(e.target.value)}
          />

          {/* Search results */}
          {bookSearch && (
            <div style={s.bookResults}>
              {searching
                ? <div style={s.bookResultHint}>Searching…</div>
                : searchResults.length === 0
                ? <div style={s.bookResultHint}>No want-to-read books match "{bookSearch}"</div>
                : searchResults.map(book => {
                  const selected = !!selectedBooks.find(b => b.id === book.id)
                  return (
                    <div
                      key={book.id}
                      style={{ ...s.bookResultRow, background: selected ? theme.rustLight : theme.bgCard, borderColor: selected ? theme.rust : theme.borderLight }}
                      onClick={() => toggleBook(book)}
                    >
                      {book.cover_image_url
                        ? <img src={book.cover_image_url} alt={book.title} style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                        : <FakeCover title={book.title} size={32} />
                      }
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{book.title}</div>
                        <div style={{ fontSize: 12, color: theme.textSubtle }}>{book.author}</div>
                      </div>
                      <div style={{ fontSize: 13, color: selected ? theme.rust : theme.textSubtle }}>
                        {selected ? '✓ Added' : '+ Add'}
                      </div>
                    </div>
                  )
                })
              }
            </div>
          )}

          {/* Selected books */}
          {selectedBooks.length > 0 && (
            <div style={s.selectedBooks}>
              {selectedBooks.map(book => (
                <div key={book.id} style={s.selectedBookChip}>
                  {book.title}
                  <span style={s.chipRemove} onClick={() => toggleBook(book)}>✕</span>
                </div>
              ))}
              <div style={{ fontSize: 12, color: theme.textSubtle, alignSelf: 'center' }}>
                {selectedBooks.length}/6
              </div>
            </div>
          )}

          {/* Share with */}
          <label style={{ ...s.label, marginTop: 18 }}>Share with</label>
          <div style={s.shareRow}>
            <label style={s.radioLabel}>
              <input type="radio" name="share" value="all" checked={shareMode === 'all'} onChange={() => setShareMode('all')} />
              <span style={{ marginLeft: 6 }}>All friends ({friends.length})</span>
            </label>
            <label style={{ ...s.radioLabel, marginLeft: 20 }}>
              <input type="radio" name="share" value="specific" checked={shareMode === 'specific'} onChange={() => setShareMode('specific')} />
              <span style={{ marginLeft: 6 }}>Specific friends</span>
            </label>
          </div>

          {shareMode === 'specific' && friends.length > 0 && (
            <div style={s.friendChecklist}>
              {friends.map(f => (
                <label key={f.id} style={s.checkLabel}>
                  <input
                    type="checkbox"
                    checked={selectedFriends.includes(f.id)}
                    onChange={() => toggleFriend(f.id)}
                    style={{ accentColor: theme.rust }}
                  />
                  <UserAvatar profile={f} size={24} />
                  <span style={{ fontSize: 13, color: theme.text, marginLeft: 6 }}>{f.username}</span>
                </label>
              ))}
            </div>
          )}

          {/* Expires in */}
          <label style={{ ...s.label, marginTop: 18 }}>Expires in</label>
          <select style={s.select} value={expireDays} onChange={e => setExpireDays(e.target.value)}>
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7">1 week</option>
          </select>
        </div>

        <div style={s.modalFooter}>
          <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          <button
            style={{
              ...s.btnPrimary,
              opacity: selectedBooks.length < 2 || saving ? 0.6 : 1,
              cursor: selectedBooks.length < 2 || saving ? 'not-allowed' : 'pointer',
            }}
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

// ---- MAIN PAGE ----
export default function Polls({ session }) {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('active') // 'active' | 'mine' | 'past'
  const [polls, setPolls] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => { fetchPolls() }, [])

  async function fetchPolls() {
    setLoading(true)
    const userId = session.user.id

    // Get poll IDs shared with me
    const { data: recipientRows } = await supabase
      .from('poll_recipients')
      .select('poll_id')
      .eq('recipient_id', userId)

    const sharedIds = (recipientRows || []).map(r => r.poll_id)

    let query = supabase
      .from('polls')
      .select(`
        *,
        profiles(username, avatar_url),
        poll_votes(*),
        poll_options(*, books(id, title, author, cover_image_url))
      `)
      .order('created_at', { ascending: false })

    if (sharedIds.length > 0) {
      query = query.or(`user_id.eq.${userId},id.in.(${sharedIds.join(',')})`)
    } else {
      query = query.eq('user_id', userId)
    }

    const { data } = await query
    setPolls(data || [])
    setLoading(false)
  }

  async function handleVote(pollId, optionId) {
    await supabase.from('poll_votes').insert({
      poll_id: pollId,
      user_id: session.user.id,
      option_id: optionId,
    })
    fetchPolls()
  }

  async function handleClosePoll(pollId) {
    await supabase
      .from('polls')
      .update({ expires_at: new Date().toISOString() })
      .eq('id', pollId)
    fetchPolls()
  }

  const now = new Date()
  const activePollsAll = polls.filter(p => new Date(p.expires_at) > now)
  const pastPolls = polls.filter(p => new Date(p.expires_at) <= now)
  const myPolls = polls.filter(p => p.user_id === session.user.id)

  const displayPolls =
    tab === 'active' ? activePollsAll :
    tab === 'mine'   ? myPolls :
    pastPolls

  const tabs = [
    { key: 'active', label: 'Active Polls', count: activePollsAll.length },
    { key: 'mine',   label: 'My Polls',     count: myPolls.length },
    { key: 'past',   label: 'Past Polls',   count: pastPolls.length },
  ]

  const s = {
    page:         { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content:      { maxWidth: 600, margin: '0 auto', padding: isMobile ? '16px' : '32px 24px' },

    pageHeader:   { display: 'flex', alignItems: isMobile ? 'center' : 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 12 },
    pageTitle:    { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 700, color: theme.text, marginBottom: 4 },
    pageSubtitle: { fontSize: 14, color: theme.textSubtle },

    tabs:         { display: 'flex', gap: 2, marginBottom: 24, borderBottom: `1px solid ${theme.border}`, paddingBottom: 0 },
    tab:          { padding: '8px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', borderRadius: 0, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textSubtle, fontWeight: 500, transition: 'color 0.15s', marginBottom: -1 },
    tabActive:    { padding: '8px 16px', background: 'none', border: 'none', borderBottom: `2px solid ${theme.rust}`, borderRadius: 0, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.rust, fontWeight: 600, marginBottom: -1 },
    tabCount:     { marginLeft: 6, background: 'rgba(26,18,8,0.07)', color: theme.textSubtle, borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 500 },
    tabCountActive:{ marginLeft: 6, background: theme.rustLight, color: theme.rust, borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 600 },

    feed:         { display: 'flex', flexDirection: 'column', gap: 16 },

    empty:        { color: theme.textSubtle, fontSize: 14, padding: '60px 0', textAlign: 'center' },
    emptyBox:     { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: '60px 32px', textAlign: 'center' },
    emptyIcon:    { fontSize: 40, marginBottom: 16 },
    emptyTitle:   { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 8 },
    emptyText:    { fontSize: 14, color: theme.textSubtle, marginBottom: 24 },

    btnPrimary:   { padding: '9px 18px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />

      <div style={s.content}>
        {/* Page header */}
        <div style={s.pageHeader}>
          <div>
            <div style={s.pageTitle}>Reading Polls</div>
            <div style={s.pageSubtitle}>Ask your friends what you should read next</div>
          </div>
          <button style={s.btnPrimary} onClick={() => setShowCreate(true)}>
            📊 New Poll
          </button>
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {tabs.map(t => (
            <button
              key={t.key}
              style={tab === t.key ? s.tabActive : s.tab}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.count > 0 && (
                <span style={tab === t.key ? s.tabCountActive : s.tabCount}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Polls feed */}
        {loading ? (
          <div style={s.empty}>Loading polls…</div>
        ) : displayPolls.length === 0 ? (
          <div style={s.emptyBox}>
            <div style={s.emptyIcon}>📊</div>
            <div style={s.emptyTitle}>
              {tab === 'active' ? 'No active polls' : tab === 'mine' ? 'No polls created yet' : 'No past polls'}
            </div>
            <div style={s.emptyText}>
              {tab === 'active'
                ? 'Create a poll to ask your friends what you should read next!'
                : tab === 'mine'
                ? 'Click "New Poll" to get started.'
                : 'Closed polls will appear here.'}
            </div>
            {tab !== 'past' && (
              <button style={s.btnPrimary} onClick={() => setShowCreate(true)}>
                📊 New Poll
              </button>
            )}
          </div>
        ) : (
          <div style={s.feed}>
            {displayPolls.map(poll => (
              <PollCard
                key={poll.id}
                poll={poll}
                userId={session.user.id}
                onVote={handleVote}
                onClose={handleClosePoll}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreatePollModal
          session={session}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchPolls() }}
        />
      )}
    </div>
  )
}

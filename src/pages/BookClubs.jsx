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

function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function FakeCover({ title, size = 44 }) {
  const colors = ['#7b4f3a', '#4a6b8a', '#5a7a5a', '#2c3e50', '#8b2500', '#b8860b', '#3d5a5a', '#c0521e']
  const c1 = colors[(title || '?').charCodeAt(0) % colors.length]
  const c2 = colors[((title || '?').charCodeAt(0) + 3) % colors.length]
  return (
    <div style={{ width: size, height: Math.round(size * 1.5), borderRadius: 4, background: `linear-gradient(135deg, ${c1}, ${c2})`, flexShrink: 0 }} />
  )
}

function UserAvatar({ profile, size = 32 }) {
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

// ---- MEMBER AVATAR STACK ----
function AvatarStack({ members, max = 4 }) {
  const { theme } = useTheme()
  const shown = members.slice(0, max)
  const extra = members.length - max
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((m, i) => (
        <div key={m.user_id || i} style={{ marginLeft: i > 0 ? -8 : 0, zIndex: shown.length - i, border: `2px solid ${theme.bgCard}`, borderRadius: '50%', flexShrink: 0 }}>
          <UserAvatar profile={m.profiles} size={28} />
        </div>
      ))}
      {extra > 0 && (
        <div style={{ marginLeft: -8, width: 28, height: 28, borderRadius: '50%', background: theme.bgHover, border: `2px solid ${theme.bgCard}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: theme.textSubtle, flexShrink: 0, zIndex: 0 }}>
          +{extra}
        </div>
      )}
    </div>
  )
}

// ---- CLUB CARD ----
function ClubCard({ club, isMember, onEnter, onJoin, joining }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const [hover, setHover] = useState(false)
  const book = club.books
  const members = club.book_club_members || []
  const memberCount = members.length

  return (
    <div
      style={{
        ...s.clubCard,
        ...(hover ? s.clubCardHover : {}),
        borderLeft: `4px solid ${theme.sage}`,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Club name */}
      <div style={s.clubName}>{club.name}</div>

      {/* Member avatars */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <AvatarStack members={members} max={4} />
        <span style={s.clubMemberCount}>{memberCount} member{memberCount !== 1 ? 's' : ''}</span>
      </div>

      {/* Current book */}
      {book ? (
        <div style={s.clubBookRow}>
          {book.cover_image_url
            ? <img src={book.cover_image_url} alt={book.title} style={{ width: 36, height: 54, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
            : <FakeCover title={book.title} size={36} />
          }
          <div>
            <div style={s.clubBookLabel}>Currently Reading</div>
            <div style={s.clubBookTitle}>{book.title}</div>
          </div>
        </div>
      ) : (
        <div style={s.clubNoBook}>No current book set</div>
      )}

      {/* Description */}
      {club.description && (
        <div style={s.clubDescription}>{club.description}</div>
      )}

      {/* Action */}
      <div style={{ marginTop: 14 }}>
        {isMember ? (
          <button style={s.btnEnter} onClick={() => onEnter(club)}>
            Enter Club →
          </button>
        ) : (
          <button style={s.btnJoin} onClick={() => onJoin(club.id)} disabled={joining === club.id}>
            {joining === club.id ? 'Joining…' : 'Join Club'}
          </button>
        )}
      </div>
    </div>
  )
}

// ---- CREATE CLUB MODAL ----
function CreateClubModal({ session, onClose, onCreated }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  async function handleSubmit() {
    if (!name.trim()) return
    setSaving(true)
    setErrorMsg(null)

    const { data: club, error } = await supabase
      .from('book_clubs')
      .insert({ name: name.trim(), description: description.trim() || null, created_by: session.user.id, is_public: isPublic })
      .select()
      .single()

    if (error || !club) {
      setSaving(false)
      setErrorMsg(
        error?.code === '23505'
          ? 'A club with that name already exists — please choose a different name.'
          : error?.message || 'Could not create club — please try again.'
      )
      return
    }

    const { error: memberError } = await supabase.from('book_club_members').insert({
      club_id: club.id,
      user_id: session.user.id,
      role: 'admin',
    })

    if (memberError) {
      setSaving(false)
      setErrorMsg(memberError.message || 'Club created but could not add you as a member.')
      return
    }

    setSaving(false)
    onCreated()
  }

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>Create a Book Club</div>
          <button style={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <div style={s.modalBody}>
          <label style={s.label}>Club name <span style={{ color: theme.rust }}>*</span></label>
          <input
            style={s.input}
            placeholder="e.g. The Sunday Readers"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
          />
          <label style={{ ...s.label, marginTop: 16 }}>Description <span style={{ color: theme.textSubtle, fontWeight: 400 }}>(optional)</span></label>
          <textarea
            style={{ ...s.input, height: 80, resize: 'vertical', lineHeight: 1.5 }}
            placeholder="What's this club about?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            maxLength={300}
          />
          <label style={{ ...s.checkLabel, marginTop: 16, gap: 10 }}>
            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} style={{ accentColor: theme.rust, width: 16, height: 16 }} />
            <span style={{ fontSize: 14, color: theme.text }}>Public club (discoverable by anyone)</span>
          </label>
        </div>
        {errorMsg && (
          <div style={{ padding: '0 24px 12px', fontSize: 13, color: theme.rust }}>
            ⚠️ {errorMsg}
          </div>
        )}
        <div style={s.modalFooter}>
          <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          <button
            style={{ ...s.btnPrimary, opacity: !name.trim() || saving ? 0.6 : 1, cursor: !name.trim() || saving ? 'not-allowed' : 'pointer' }}
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
          >
            {saving ? 'Creating…' : 'Create Club'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- CLUB DETAIL ----
function ClubDetail({ club, session, onBack, onClubUpdate, onClubDeleted }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const [posts, setPosts] = useState([])
  const [members, setMembers] = useState(club.book_club_members || [])
  const [myProgress, setMyProgress] = useState(null)
  const [memberProgress, setMemberProgress] = useState([])
  const [postText, setPostText] = useState('')
  const [posting, setPosting] = useState(false)
  const [loadingPosts, setLoadingPosts] = useState(true)

  // Change book
  const [showChangeBook, setShowChangeBook] = useState(false)
  const [bookQuery, setBookQuery] = useState('')
  const [bookResults, setBookResults] = useState([])
  const [searchingBooks, setSearchingBooks] = useState(false)
  const [changingBook, setChangingBook] = useState(false)

  // Invite member
  const [showInvite, setShowInvite] = useState(false)
  const [inviteQuery, setInviteQuery] = useState('')
  const [inviteResults, setInviteResults] = useState([])
  const [searchingInvite, setSearchingInvite] = useState(false)
  const [inviting, setInviting] = useState(null)

  // Edit club info
  const [showEditInfo, setShowEditInfo] = useState(false)
  const [editName, setEditName] = useState(club.name)
  const [editDesc, setEditDesc] = useState(club.description || '')
  const [editPublic, setEditPublic] = useState(club.is_public)
  const [savingInfo, setSavingInfo] = useState(false)

  // Delete club
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Role changes
  const [promotingUser, setPromotingUser] = useState(null)

  // History + nominations + voting
  const [history, setHistory] = useState([])
  const [nominations, setNominations] = useState([])
  const [nomQuery, setNomQuery] = useState('')
  const [nomResults, setNomResults] = useState([])
  const [searchingNom, setSearchingNom] = useState(false)
  const [nominating, setNominating] = useState(null)
  const [voting, setVoting] = useState(null)

  // Due date
  const [dueDate, setDueDate] = useState(club.current_book_due_date || '')
  const [savingDue, setSavingDue] = useState(false)

  const messagesEndRef = useRef(null)
  const isAdmin = members.some(m => m.user_id === session.user.id && m.role === 'admin')
    || club.book_club_members?.some(m => m.user_id === session.user.id && m.role === 'admin')

  useEffect(() => {
    fetchPosts()
    fetchMembers()
    fetchHistory()
    fetchNominations()
  }, [club.id])

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [posts])

  async function fetchPosts() {
    setLoadingPosts(true)
    const { data } = await supabase
      .from('book_club_posts')
      .select('*, profiles(username, avatar_url)')
      .eq('club_id', club.id)
      .order('created_at', { ascending: true })
    setPosts(data || [])
    setLoadingPosts(false)
  }

  async function fetchMembers() {
    const { data } = await supabase
      .from('book_club_members')
      .select('*, profiles(id, username, avatar_url)')
      .eq('club_id', club.id)
    setMembers(data || [])

    // Fetch reading progress for current book
    if (club.current_book_id) {
      const memberIds = (data || []).map(m => m.user_id)
      if (memberIds.length) {
        const { data: entries } = await supabase
          .from('collection_entries')
          .select('user_id, current_page, read_status, books(pages)')
          .in('user_id', memberIds)
          .eq('book_id', club.current_book_id)
        setMemberProgress(entries || [])
      }
    }
  }

  async function handlePost() {
    const content = postText.trim()
    if (!content) return
    setPosting(true)
    await supabase.from('book_club_posts').insert({
      club_id: club.id,
      user_id: session.user.id,
      content,
    })
    setPostText('')
    setPosting(false)
    fetchPosts()
  }

  // Book search
  useEffect(() => {
    if (!showChangeBook) return
    const t = setTimeout(() => {
      if (!bookQuery.trim()) { setBookResults([]); return }
      setSearchingBooks(true)
      supabase.from('books').select('id, title, author, cover_image_url').ilike('title', `%${bookQuery}%`).limit(8)
        .then(({ data }) => { setBookResults(data || []); setSearchingBooks(false) })
    }, 300)
    return () => clearTimeout(t)
  }, [bookQuery, showChangeBook])

  async function fetchHistory() {
    const { data } = await supabase
      .from('book_club_history')
      .select('id, finished_at, books(id, title, author, cover_image_url)')
      .eq('club_id', club.id)
      .order('finished_at', { ascending: false })
    setHistory(data || [])
  }

  async function fetchNominations() {
    const { data } = await supabase
      .from('book_club_nominations')
      .select('id, book_id, nominated_by, books(id, title, author, cover_image_url), profiles(username), book_club_votes(user_id)')
      .eq('club_id', club.id)
      .order('created_at', { ascending: true })
    setNominations(data || [])
  }

  async function changeBook(bookId) {
    setChangingBook(true)
    // Auto-archive the current book before switching
    if (club.current_book_id) {
      await supabase.from('book_club_history').upsert(
        { club_id: club.id, book_id: club.current_book_id, finished_at: new Date().toISOString().split('T')[0] },
        { onConflict: 'club_id,book_id' }
      )
    }
    await supabase.from('book_clubs')
      .update({ current_book_id: bookId, current_book_due_date: null })
      .eq('id', club.id)
    setChangingBook(false)
    setShowChangeBook(false)
    setBookQuery('')
    setDueDate('')
    onClubUpdate()
    fetchMembers()
    fetchHistory()
  }

  async function saveDueDate() {
    setSavingDue(true)
    await supabase.from('book_clubs')
      .update({ current_book_due_date: dueDate || null })
      .eq('id', club.id)
    setSavingDue(false)
    onClubUpdate()
  }

  async function nominateBook(book) {
    setNominating(book.id)
    await supabase.from('book_club_nominations').insert({
      club_id: club.id,
      book_id: book.id,
      nominated_by: session.user.id,
    })
    setNominating(null)
    setNomQuery('')
    setNomResults([])
    fetchNominations()
  }

  async function removeNomination(nominationId) {
    await supabase.from('book_club_nominations').delete().eq('id', nominationId)
    fetchNominations()
  }

  async function toggleVote(nomination) {
    const hasVoted = nomination.book_club_votes?.some(v => v.user_id === session.user.id)
    setVoting(nomination.id)
    if (hasVoted) {
      await supabase.from('book_club_votes')
        .delete().eq('nomination_id', nomination.id).eq('user_id', session.user.id)
    } else {
      await supabase.from('book_club_votes').insert({
        nomination_id: nomination.id,
        club_id: club.id,
        user_id: session.user.id,
      })
    }
    setVoting(null)
    fetchNominations()
  }

  async function selectWinner(nomination) {
    setChangingBook(true)
    if (club.current_book_id) {
      await supabase.from('book_club_history').upsert(
        { club_id: club.id, book_id: club.current_book_id, finished_at: new Date().toISOString().split('T')[0] },
        { onConflict: 'club_id,book_id' }
      )
    }
    await supabase.from('book_clubs')
      .update({ current_book_id: nomination.book_id, current_book_due_date: null })
      .eq('id', club.id)
    await supabase.from('book_club_nominations').delete().eq('club_id', club.id)
    setChangingBook(false)
    setDueDate('')
    onClubUpdate()
    fetchHistory()
    fetchNominations()
  }

  // Invite search
  useEffect(() => {
    if (!showInvite) return
    const t = setTimeout(() => {
      if (!inviteQuery.trim()) { setInviteResults([]); return }
      setSearchingInvite(true)
      const existingIds = members.map(m => m.user_id)
      supabase.from('profiles').select('id, username, avatar_url')
        .ilike('username', `%${inviteQuery}%`)
        .neq('id', session.user.id)
        .limit(10)
        .then(({ data }) => {
          setInviteResults((data || []).filter(p => !existingIds.includes(p.id)))
          setSearchingInvite(false)
        })
    }, 300)
    return () => clearTimeout(t)
  }, [inviteQuery, showInvite])

  async function inviteMember(userId) {
    setInviting(userId)
    await supabase.from('book_club_members').insert({ club_id: club.id, user_id: userId, role: 'member' })
    setInviting(null)
    setInviteQuery('')
    setInviteResults([])
    fetchMembers()
    onClubUpdate()
  }

  async function saveClubInfo() {
    const name = editName.trim()
    if (!name) return
    setSavingInfo(true)
    const { error } = await supabase.from('book_clubs').update({
      name,
      description: editDesc.trim() || null,
      is_public: editPublic,
    }).eq('id', club.id)
    setSavingInfo(false)
    if (error) {
      alert(
        error.code === '23505'
          ? 'A club with that name already exists — please choose a different name.'
          : 'Could not save changes — please try again.'
      )
      return
    }
    setShowEditInfo(false)
    onClubUpdate()
  }

  async function deleteClub() {
    setDeleting(true)
    const { error } = await supabase.from('book_clubs').delete().eq('id', club.id)
    if (error) { setDeleting(false); return }
    onClubDeleted()
  }

  async function toggleMemberRole(member) {
    setPromotingUser(member.user_id)
    const newRole = member.role === 'admin' ? 'member' : 'admin'
    await supabase.from('book_club_members')
      .update({ role: newRole })
      .eq('club_id', club.id)
      .eq('user_id', member.user_id)
    setPromotingUser(null)
    fetchMembers()
    onClubUpdate()
  }

  // Nomination book search
  useEffect(() => {
    const t = setTimeout(() => {
      if (!nomQuery.trim()) { setNomResults([]); return }
      setSearchingNom(true)
      const existingBookIds = nominations.map(n => n.book_id)
      supabase.from('books').select('id, title, author, cover_image_url')
        .ilike('title', `%${nomQuery}%`).limit(6)
        .then(({ data }) => {
          setNomResults((data || []).filter(b => !existingBookIds.includes(b.id)))
          setSearchingNom(false)
        })
    }, 300)
    return () => clearTimeout(t)
  }, [nomQuery, nominations])

  const progressMap = Object.fromEntries(memberProgress.map(e => [e.user_id, e]))

  return (
    <div style={s.detailPage}>
      {/* Header */}
      <div style={s.detailHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <div style={s.detailHeaderMain}>
          <div style={s.detailClubName}>{club.name}</div>
          <div style={s.detailMeta}>{members.length} member{members.length !== 1 ? 's' : ''}</div>
        </div>
        {club.books && (
          <div style={s.detailCurrentBook}>
            {club.books.cover_image_url
              ? <img src={club.books.cover_image_url} alt={club.books.title} style={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 4 }} />
              : <FakeCover title={club.books.title} size={40} />
            }
            <div>
              <div style={s.detailBookLabel}>Currently Reading</div>
              <div style={s.detailBookTitle}>{club.books.title}</div>
              {club.current_book_due_date && (
                <div style={{ fontSize: 11, color: theme.gold, marginTop: 3, fontWeight: 600 }}>
                  📅 Due {fmtDate(club.current_book_due_date)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Two panels */}
      <div style={s.detailPanels}>
        {/* Left: Discussion */}
        <div style={s.discussionPanel}>
          <div style={{ ...s.panelTitle, padding: '14px 16px 0' }}>Discussion</div>
          <div style={s.chatThread}>
            {loadingPosts ? (
              <div style={s.chatEmpty}>Loading…</div>
            ) : posts.length === 0 ? (
              <div style={s.chatEmpty}>No messages yet. Start the conversation!</div>
            ) : (
              posts.map((post, i) => {
                const isMe = post.user_id === session.user.id
                const prevPost = posts[i - 1]
                const showAvatar = !prevPost || prevPost.user_id !== post.user_id
                return (
                  <div
                    key={post.id}
                    style={{
                      display: 'flex',
                      flexDirection: isMe ? 'row-reverse' : 'row',
                      gap: 8,
                      alignItems: 'flex-end',
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ width: 28, flexShrink: 0 }}>
                      {showAvatar && !isMe && <UserAvatar profile={post.profiles} size={28} />}
                    </div>
                    <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 2 }}>
                      {showAvatar && (
                        <div style={{ fontSize: 11, color: theme.textSubtle, marginBottom: 2, paddingLeft: isMe ? 0 : 2, paddingRight: isMe ? 2 : 0 }}>
                          {isMe ? 'You' : post.profiles?.username}
                        </div>
                      )}
                      <div style={{
                        background: isMe ? theme.rust : theme.bgSubtle,
                        color: isMe ? 'white' : theme.text,
                        borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                        padding: '8px 12px',
                        fontSize: 14,
                        lineHeight: 1.5,
                        wordBreak: 'break-word',
                      }}>
                        {post.content}
                      </div>
                      <div style={{ fontSize: 10, color: theme.textSubtle, paddingLeft: 2, paddingRight: 2 }}>
                        {timeAgo(post.created_at)}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </div>
          {/* Input */}
          <div style={s.chatInputRow}>
            <input
              style={s.chatInput}
              placeholder="Add to the discussion…"
              value={postText}
              onChange={e => setPostText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handlePost()}
            />
            <button
              style={{ ...s.btnPrimary, padding: '9px 16px', opacity: !postText.trim() || posting ? 0.6 : 1 }}
              onClick={handlePost}
              disabled={!postText.trim() || posting}
            >
              {posting ? '…' : 'Send'}
            </button>
          </div>
        </div>

        {/* Right: Members + Progress */}
        <div style={s.sidePanel}>
          {/* Members */}
          <div style={s.panelSection}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={s.panelTitle}>Members</div>
              {isAdmin && (
                <button style={s.btnSmallGhost} onClick={() => setShowInvite(v => !v)}>
                  + Invite
                </button>
              )}
            </div>

            {showInvite && isAdmin && (
              <div style={{ marginBottom: 12 }}>
                <input
                  style={{ ...s.input, marginBottom: 4 }}
                  placeholder="Search by username…"
                  value={inviteQuery}
                  onChange={e => setInviteQuery(e.target.value)}
                  autoFocus
                />
                {inviteQuery && (
                  <div style={s.inviteResults}>
                    {searchingInvite
                      ? <div style={s.smallHint}>Searching…</div>
                      : inviteResults.length === 0
                      ? <div style={s.smallHint}>No users found</div>
                      : inviteResults.map(u => (
                        <div key={u.id} style={s.inviteRow}>
                          <UserAvatar profile={u} size={26} />
                          <span style={{ flex: 1, fontSize: 13, color: theme.text }}>{u.username}</span>
                          <button
                            style={{ ...s.btnSmall, opacity: inviting === u.id ? 0.6 : 1 }}
                            onClick={() => inviteMember(u.id)}
                            disabled={inviting === u.id}
                          >
                            {inviting === u.id ? '…' : 'Add'}
                          </button>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {members.map(m => (
                <div key={m.user_id} style={s.memberRow}>
                  <UserAvatar profile={m.profiles} size={32} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{m.profiles?.username}</div>
                    {m.role === 'admin' && <div style={{ fontSize: 11, color: theme.rust }}>Admin</div>}
                  </div>
                  {isAdmin && m.user_id !== session.user.id && (
                    <button
                      style={{ ...s.btnSmallGhost, fontSize: 11, padding: '3px 8px', opacity: promotingUser === m.user_id ? 0.6 : 1 }}
                      onClick={() => toggleMemberRole(m)}
                      disabled={promotingUser === m.user_id}
                    >
                      {promotingUser === m.user_id ? '…' : m.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Reading Progress */}
          {club.current_book_id && memberProgress.length > 0 && (
            <div style={s.panelSection}>
              <div style={{ ...s.panelTitle, marginBottom: 12 }}>Reading Progress</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {members.map(m => {
                  const entry = progressMap[m.user_id]
                  const pageCount = entry?.books?.pages
                  const currentPage = entry?.current_page
                  const pct = pageCount && currentPage ? Math.min(100, Math.round((currentPage / pageCount) * 100)) : null
                  const status = entry?.read_status

                  return (
                    <div key={m.user_id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>{m.profiles?.username}</span>
                        <span style={{ fontSize: 11, color: theme.textSubtle }}>
                          {status === 'read' ? 'Finished' : pct !== null ? `${pct}% · p.${currentPage}` : 'Not started'}
                        </span>
                      </div>
                      <div style={{ height: 5, background: theme.bgHover, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          borderRadius: 3,
                          background: status === 'read' ? theme.sage : theme.gold,
                          width: status === 'read' ? '100%' : pct !== null ? `${pct}%` : '0%',
                          transition: 'width 0.4s ease',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Past Reads */}
          {history.length > 0 && (
            <div style={s.panelSection}>
              <div style={{ ...s.panelTitle, marginBottom: 12 }}>Past Reads</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {history.map(item => (
                  <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {item.books?.cover_image_url
                      ? <img src={item.books.cover_image_url} alt={item.books.title} style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                      : <FakeCover title={item.books?.title || '?'} size={32} />
                    }
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{item.books?.title}</div>
                      <div style={{ fontSize: 11, color: theme.textSubtle }}>by {item.books?.author}</div>
                      <div style={{ fontSize: 11, color: theme.textSubtle }}>Finished {fmtDate(item.finished_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vote on Next Book */}
          <div style={s.panelSection}>
            <div style={{ ...s.panelTitle, marginBottom: 4 }}>Vote on Next Book</div>
            <div style={{ fontSize: 12, color: theme.textSubtle, marginBottom: 12 }}>
              Nominate a book and vote — the club admin picks the winner.
            </div>

            {/* Nominate search */}
            <input
              style={{ ...s.input, marginBottom: 4 }}
              placeholder="Search to nominate a book…"
              value={nomQuery}
              onChange={e => setNomQuery(e.target.value)}
            />
            {nomQuery && (
              <div style={{ ...s.inviteResults, marginBottom: 10 }}>
                {searchingNom
                  ? <div style={s.smallHint}>Searching…</div>
                  : nomResults.length === 0
                  ? <div style={s.smallHint}>No books found</div>
                  : nomResults.map(book => (
                    <div key={book.id} style={s.inviteRow}>
                      {book.cover_image_url
                        ? <img src={book.cover_image_url} alt={book.title} style={{ width: 24, height: 36, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} />
                        : <FakeCover title={book.title} size={24} />
                      }
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{book.title}</div>
                        <div style={{ fontSize: 11, color: theme.textSubtle }}>{book.author}</div>
                      </div>
                      <button
                        style={{ ...s.btnSmall, opacity: nominating === book.id ? 0.6 : 1 }}
                        onClick={() => nominateBook(book)}
                        disabled={nominating === book.id}
                      >
                        {nominating === book.id ? '…' : 'Nominate'}
                      </button>
                    </div>
                  ))
                }
              </div>
            )}

            {/* Nominations list */}
            {nominations.length === 0 ? (
              <div style={s.smallHint}>No nominations yet — search above to add one!</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...nominations]
                  .sort((a, b) => (b.book_club_votes?.length || 0) - (a.book_club_votes?.length || 0))
                  .map(nom => {
                    const voteCount = nom.book_club_votes?.length || 0
                    const hasVoted = nom.book_club_votes?.some(v => v.user_id === session.user.id)
                    const canRemove = nom.nominated_by === session.user.id || isAdmin
                    return (
                      <div key={nom.id} style={{ background: theme.bg, borderRadius: 8, padding: '8px 10px', border: `1px solid ${theme.borderLight}` }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                          {nom.books?.cover_image_url
                            ? <img src={nom.books.cover_image_url} alt={nom.books.title} style={{ width: 28, height: 42, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                            : <FakeCover title={nom.books?.title || '?'} size={28} />
                          }
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{nom.books?.title}</div>
                            <div style={{ fontSize: 11, color: theme.textSubtle }}>{nom.books?.author}</div>
                            <div style={{ fontSize: 10, color: theme.textSubtle, marginTop: 1 }}>
                              by {nom.profiles?.username}
                            </div>
                          </div>
                          {canRemove && (
                            <button
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textSubtle, fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                              onClick={() => removeNomination(nom.id)}
                              title="Remove nomination"
                            >✕</button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            style={{
                              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                              background: hasVoted ? theme.rust : 'transparent',
                              color: hasVoted ? '#fff' : theme.rust,
                              border: `1px solid ${theme.rust}`,
                              opacity: voting === nom.id ? 0.6 : 1,
                            }}
                            onClick={() => toggleVote(nom)}
                            disabled={voting === nom.id}
                          >
                            {voting === nom.id ? '…' : hasVoted ? `❤️ ${voteCount}` : `🤍 ${voteCount}`}
                          </button>
                          {isAdmin && (
                            <button
                              style={{ ...s.btnSmall, fontSize: 11, padding: '3px 10px', opacity: changingBook ? 0.6 : 1 }}
                              onClick={() => selectWinner(nom)}
                              disabled={changingBook}
                            >
                              {changingBook ? '…' : '📖 Read This Next'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            )}
          </div>

          {/* Admin: Club Settings */}
          {isAdmin && (
            <div style={s.panelSection}>
              <div style={{ ...s.panelTitle, marginBottom: 12 }}>Club Settings</div>

              {/* Set / Change current book */}
              <button style={s.btnSmallGhost} onClick={() => setShowChangeBook(v => !v)}>
                {club.current_book_id ? 'Change current book' : 'Set current book'}
              </button>
              {showChangeBook && (
                <div style={{ marginTop: 10 }}>
                  <input
                    style={s.input}
                    placeholder="Search books…"
                    value={bookQuery}
                    onChange={e => setBookQuery(e.target.value)}
                    autoFocus
                  />
                  {bookQuery && (
                    <div style={{ ...s.inviteResults, marginTop: 4 }}>
                      {searchingBooks
                        ? <div style={s.smallHint}>Searching…</div>
                        : bookResults.length === 0
                        ? <div style={s.smallHint}>No books found</div>
                        : bookResults.map(book => (
                          <div key={book.id} style={s.inviteRow}>
                            {book.cover_image_url
                              ? <img src={book.cover_image_url} alt={book.title} style={{ width: 28, height: 42, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                              : <FakeCover title={book.title} size={28} />
                            }
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{book.title}</div>
                              <div style={{ fontSize: 11, color: theme.textSubtle }}>{book.author}</div>
                            </div>
                            <button
                              style={{ ...s.btnSmall, opacity: changingBook ? 0.6 : 1 }}
                              onClick={() => changeBook(book.id)}
                              disabled={changingBook}
                            >
                              Set
                            </button>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              )}

              {/* Reading deadline */}
              {club.current_book_id && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: theme.textSubtle, marginBottom: 4 }}>Reading deadline:</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="date"
                      style={{ ...s.input, flex: 1, padding: '5px 8px', fontSize: 13 }}
                      value={dueDate}
                      onChange={e => setDueDate(e.target.value)}
                    />
                    <button style={{ ...s.btnSmall, opacity: savingDue ? 0.6 : 1 }} onClick={saveDueDate} disabled={savingDue}>
                      {savingDue ? '…' : 'Set'}
                    </button>
                    {dueDate && (
                      <button style={s.btnSmallGhost} onClick={() => { setDueDate(''); saveDueDate() }}>Clear</button>
                    )}
                  </div>
                </div>
              )}

              {/* Edit club info */}
              <div style={{ marginTop: 12 }}>
                <button style={s.btnSmallGhost} onClick={() => {
                  setEditName(club.name)
                  setEditDesc(club.description || '')
                  setEditPublic(club.is_public)
                  setShowEditInfo(v => !v)
                }}>
                  ✏️ Edit Club Info
                </button>
                {showEditInfo && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      style={s.input}
                      placeholder="Club name"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      maxLength={80}
                    />
                    <textarea
                      style={{ ...s.input, height: 70, resize: 'vertical', lineHeight: 1.5 }}
                      placeholder="Description (optional)"
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      maxLength={300}
                    />
                    <label style={{ ...s.checkLabel, gap: 8 }}>
                      <input type="checkbox" checked={editPublic} onChange={e => setEditPublic(e.target.checked)} style={{ accentColor: theme.rust }} />
                      <span style={{ fontSize: 13, color: theme.text }}>Public club</span>
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        style={{ ...s.btnSmall, opacity: !editName.trim() || savingInfo ? 0.6 : 1 }}
                        onClick={saveClubInfo}
                        disabled={!editName.trim() || savingInfo}
                      >
                        {savingInfo ? 'Saving…' : 'Save Changes'}
                      </button>
                      <button style={s.btnSmallGhost} onClick={() => setShowEditInfo(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Delete club */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${theme.borderLight}` }}>
                {showDeleteConfirm ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 13, color: theme.rust, fontWeight: 600 }}>
                      Delete "{club.name}"? This cannot be undone.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        style={{ ...s.btnSmall, background: theme.rust, opacity: deleting ? 0.6 : 1 }}
                        onClick={deleteClub}
                        disabled={deleting}
                      >
                        {deleting ? 'Deleting…' : 'Yes, Delete Club'}
                      </button>
                      <button style={s.btnSmallGhost} onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button
                    style={{ ...s.btnSmallGhost, color: theme.rust, borderColor: theme.rust }}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    🗑 Delete Club
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- MAIN PAGE ----
export default function BookClubs({ session }) {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const s = makeStyles(theme, isMobile)
  const [myClubs, setMyClubs] = useState([])
  const [discoverClubs, setDiscoverClubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedClub, setSelectedClub] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [joining, setJoining] = useState(null)

  useEffect(() => { fetchClubs() }, [])

  // Push a history entry when entering a club so the browser back button
  // returns to the clubs list instead of leaving the page entirely.
  useEffect(() => {
    const handlePopState = () => setSelectedClub(null)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function handleEnter(club) {
    window.history.pushState({ clubId: club.id }, '', window.location.pathname)
    setSelectedClub(club)
  }

  function handleBack() {
    setSelectedClub(null)
    window.history.back()
  }

  async function fetchClubs() {
    setLoading(true)
    const userId = session.user.id

    // Step 1: get the IDs of clubs this user belongs to
    const { data: memberRows } = await supabase
      .from('book_club_members')
      .select('club_id')
      .eq('user_id', userId)

    const joinedIds = (memberRows || []).map(r => r.club_id)

    // Step 2: fetch full club details for clubs the user has joined
    let myClubsData = []
    if (joinedIds.length > 0) {
      const { data } = await supabase
        .from('book_clubs')
        .select(`
          id, name, description, is_public, current_book_id, current_book_due_date, created_by,
          books(id, title, author, cover_image_url),
          book_club_members(user_id, role, profiles(username, avatar_url))
        `)
        .in('id', joinedIds)
      myClubsData = data || []
    }
    setMyClubs(myClubsData)

    // Step 3: public clubs the user hasn't joined
    let discoverQuery = supabase
      .from('book_clubs')
      .select(`
        id, name, description, is_public, current_book_id, current_book_due_date, created_by,
        books(id, title, author, cover_image_url),
        book_club_members(user_id, role, profiles(username, avatar_url))
      `)
      .eq('is_public', true)
      .limit(20)

    if (joinedIds.length > 0) {
      discoverQuery = discoverQuery.not('id', 'in', `(${joinedIds.join(',')})`)
    }

    const { data: publicClubs } = await discoverQuery
    setDiscoverClubs(publicClubs || [])
    setLoading(false)
  }

  async function handleJoin(clubId) {
    setJoining(clubId)
    await supabase.from('book_club_members').insert({ club_id: clubId, user_id: session.user.id, role: 'member' })
    setJoining(null)
    fetchClubs()
  }

  async function refreshSelectedClub() {
    await fetchClubs()
    if (selectedClub) {
      // Re-fetch the selected club from updated state
      const { data } = await supabase
        .from('book_clubs')
        .select(`
          id, name, description, is_public, current_book_id, current_book_due_date, created_by,
          books(id, title, author, cover_image_url),
          book_club_members(user_id, role, profiles(username, avatar_url))
        `)
        .eq('id', selectedClub.id)
        .single()
      if (data) setSelectedClub(data)
    }
  }

  if (selectedClub) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.content}>
          <ClubDetail
            club={selectedClub}
            session={session}
            onBack={handleBack}
            onClubUpdate={refreshSelectedClub}
            onClubDeleted={() => { handleBack(); fetchClubs() }}
          />
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />

      <div style={s.content}>
        {/* Page header */}
        <div style={s.pageHeader}>
          <div>
            <div style={s.pageTitle}>Book Clubs</div>
            <div style={s.pageSubtitle}>Read together, discuss, and track progress with friends</div>
          </div>
          <button style={s.btnPrimary} onClick={() => setShowCreate(true)}>
            + Create Club
          </button>
        </div>

        {loading ? (
          <div style={s.empty}>Loading clubs…</div>
        ) : (
          <>
            {/* My Clubs */}
            <section style={s.section}>
              <div style={s.sectionHead}>
                <div style={s.sectionTitle}>My Clubs</div>
                {myClubs.length > 0 && <span style={s.countChip}>{myClubs.length}</span>}
              </div>
              {myClubs.length === 0 ? (
                <div style={s.emptyBox}>
                  <div style={s.emptyIcon}>📚</div>
                  <div style={s.emptyTitle}>No clubs yet</div>
                  <div style={s.emptyText}>Create a club or join one below to start reading together.</div>
                  <button style={s.btnPrimary} onClick={() => setShowCreate(true)}>+ Create Club</button>
                </div>
              ) : (
                <div style={s.grid}>
                  {myClubs.map(club => (
                    <ClubCard
                      key={club.id}
                      club={club}
                      isMember
                      onEnter={handleEnter}
                      onJoin={handleJoin}
                      joining={joining}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Discover Clubs */}
            {discoverClubs.length > 0 && (
              <section style={s.section}>
                <div style={s.sectionHead}>
                  <div style={s.sectionTitle}>Discover Clubs</div>
                  <span style={s.countChip}>{discoverClubs.length}</span>
                </div>
                <div style={s.grid}>
                  {discoverClubs.map(club => (
                    <ClubCard
                      key={club.id}
                      club={club}
                      isMember={false}
                      onEnter={handleEnter}
                      onJoin={handleJoin}
                      joining={joining}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateClubModal
          session={session}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchClubs() }}
        />
      )}
    </div>
  )
}

// ---- STYLES ----
function makeStyles(theme, isMobile = false) {
  return {
    page:         { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content:      { maxWidth: 900, margin: '0 auto', padding: isMobile ? '16px' : '32px 28px' },

    pageHeader:   { display: 'flex', alignItems: isMobile ? 'center' : 'flex-start', justifyContent: 'space-between', marginBottom: 32, gap: 12 },
    pageTitle:    { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 700, color: theme.text, marginBottom: 4 },
    pageSubtitle: { fontSize: 14, color: theme.textSubtle },

    section:      { marginBottom: 40 },
    sectionHead:  { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 },
    sectionTitle: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 18, fontWeight: 700, color: theme.text },
    countChip:    { background: 'rgba(26,18,8,0.07)', color: theme.textSubtle, borderRadius: 20, padding: '2px 9px', fontSize: 12, fontWeight: 500 },

    grid:         { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },

    clubCard:     { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 20px 18px', transition: 'box-shadow 0.15s, transform 0.15s', cursor: 'default' },
    clubCardHover:{ boxShadow: theme.shadowCard, transform: 'translateY(-2px)' },
    clubName:     { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 10 },
    clubMemberCount:{ fontSize: 12, color: theme.textSubtle },
    clubBookRow:  { display: 'flex', gap: 10, alignItems: 'center', background: theme.bg, borderRadius: 8, padding: '8px 10px', marginBottom: 6 },
    clubBookLabel:{ fontSize: 11, color: theme.textSubtle, marginBottom: 2 },
    clubBookTitle:{ fontSize: 13, fontWeight: 600, color: theme.text },
    clubNoBook:   { fontSize: 13, color: theme.textSubtle, fontStyle: 'italic', marginBottom: 6 },
    clubDescription:{ fontSize: 13, color: theme.textMuted, lineHeight: 1.5, marginTop: 8 },

    empty:        { color: theme.textSubtle, fontSize: 14, padding: '60px 0', textAlign: 'center' },
    emptyBox:     { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: '48px 32px', textAlign: 'center' },
    emptyIcon:    { fontSize: 36, marginBottom: 12 },
    emptyTitle:   { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 8 },
    emptyText:    { fontSize: 14, color: theme.textSubtle, marginBottom: 20 },

    // Detail page
    detailPage:   { },
    detailHeader: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${theme.border}` },
    backBtn:      { background: 'none', border: 'none', fontSize: 14, color: theme.rust, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 500, padding: '4px 0', flexShrink: 0 },
    detailHeaderMain:{ flex: 1 },
    detailClubName:{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 24, fontWeight: 700, color: theme.text, marginBottom: 2 },
    detailMeta:   { fontSize: 13, color: theme.textSubtle },
    detailCurrentBook:{ display: 'flex', gap: 10, alignItems: 'center' },
    detailBookLabel:{ fontSize: 11, color: theme.textSubtle, marginBottom: 2 },
    detailBookTitle:{ fontSize: 14, fontWeight: 600, color: theme.text },

    detailPanels: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap: 24, alignItems: 'start' },

    discussionPanel:{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 480 },
    panelTitle:   { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 16, fontWeight: 700, color: theme.text },

    chatThread:   { flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', minHeight: 360, maxHeight: 480, background: theme.bgCard },
    chatEmpty:    { color: theme.textSubtle, fontSize: 13, textAlign: 'center', padding: '40px 0' },
    chatInputRow: { display: 'flex', gap: 8, padding: '12px 16px', borderTop: `1px solid ${theme.borderLight}`, background: theme.bgSubtle },
    chatInput:    { flex: 1, padding: '9px 13px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text },

    sidePanel:    { display: 'flex', flexDirection: 'column', gap: 16 },
    panelSection: { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '16px 18px' },
    memberRow:    { display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0' },

    inviteResults:{ border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', maxHeight: 200, overflowY: 'auto', marginTop: 4 },
    inviteRow:    { display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: theme.bgCard, borderBottom: `1px solid ${theme.borderLight}` },
    smallHint:    { padding: '10px 12px', fontSize: 12, color: theme.textSubtle, textAlign: 'center' },

    // Buttons
    btnPrimary:   { padding: '9px 18px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
    btnGhost:     { padding: '9px 16px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnEnter:     { padding: '8px 16px', background: 'transparent', color: theme.rust, border: `1px solid ${theme.rust}`, borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnJoin:      { padding: '8px 16px', background: theme.sage, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnSmall:     { padding: '5px 12px', background: theme.rust, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
    btnSmallGhost:{ padding: '5px 12px', background: 'transparent', color: theme.sage, border: `1px solid ${theme.sage}`, borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },

    // Modal
    modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24 },
    modal:        { background: theme.bgCard, borderRadius: 16, width: '100%', maxWidth: 460, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: theme.shadowCard },
    modalHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: `1px solid ${theme.borderLight}` },
    modalTitle:   { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: theme.text },
    modalClose:   { background: 'none', border: 'none', fontSize: 16, color: theme.textSubtle, cursor: 'pointer', padding: '4px 8px', borderRadius: 6 },
    modalBody:    { flex: 1, overflowY: 'auto', padding: '20px 24px' },
    modalFooter:  { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${theme.borderLight}` },

    label:        { display: 'block', fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 6 },
    input:        { width: '100%', padding: '9px 13px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    checkLabel:   { display: 'flex', alignItems: 'center', cursor: 'pointer' },
  }
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'

export default function Friends({ session }) {
  const navigate = useNavigate()

  const [friends,   setFriends]   = useState([])   // accepted
  const [incoming,  setIncoming]  = useState([])   // pending → me
  const [outgoing,  setOutgoing]  = useState([])   // pending ← me
  const [loading,   setLoading]   = useState(true)

  const [search,        setSearch]        = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching,     setSearching]     = useState(false)
  const [searched,      setSearched]      = useState(false)  // has user run a search?
  const [acting,        setActing]        = useState(null)   // id being acted on

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)

    const [{ data: fs }, { data: inc }, { data: out }] = await Promise.all([
      // Accepted friends
      supabase
        .from('friendships')
        .select('id, requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`),
      // Incoming pending
      supabase
        .from('friendships')
        .select('id, requester_id, created_at, profiles!friendships_requester_id_fkey(id, username, avatar_url)')
        .eq('addressee_id', session.user.id)
        .eq('status', 'pending'),
      // Outgoing pending
      supabase
        .from('friendships')
        .select('id, addressee_id, created_at, profiles!friendships_addressee_id_fkey(id, username, avatar_url)')
        .eq('requester_id', session.user.id)
        .eq('status', 'pending'),
    ])

    setIncoming(inc || [])
    setOutgoing(out || [])

    // For accepted friends, get profile + book counts
    const friendIds = (fs || []).map(f =>
      f.requester_id === session.user.id ? f.addressee_id : f.requester_id
    )

    if (!friendIds.length) { setFriends([]); setLoading(false); return }

    const [{ data: profiles }, { data: counts }] = await Promise.all([
      supabase.from('profiles').select('id, username, avatar_url').in('id', friendIds),
      supabase.from('collection_entries').select('user_id, read_status').in('user_id', friendIds),
    ])

    const countMap = {}
    for (const entry of counts || []) {
      if (!countMap[entry.user_id]) countMap[entry.user_id] = { total: 0, read: 0 }
      countMap[entry.user_id].total++
      if (entry.read_status === 'read') countMap[entry.user_id].read++
    }

    // Attach friendship id so we can remove
    const friendshipIdMap = {}
    for (const f of fs || []) {
      const friendId = f.requester_id === session.user.id ? f.addressee_id : f.requester_id
      friendshipIdMap[friendId] = f.id
    }

    setFriends(
      (profiles || []).map(p => ({
        ...p,
        friendshipId: friendshipIdMap[p.id],
        stats: countMap[p.id] || { total: 0, read: 0 },
      }))
    )
    setLoading(false)
  }

  async function respondToRequest(id, accept) {
    setActing(id)
    if (accept) {
      await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    } else {
      await supabase.from('friendships').delete().eq('id', id)
    }
    setActing(null)
    fetchAll()
  }

  async function cancelOutgoing(id) {
    setActing(id)
    await supabase.from('friendships').delete().eq('id', id)
    setActing(null)
    fetchAll()
  }

  async function unfriend(friendshipId) {
    setActing(friendshipId)
    await supabase.from('friendships').delete().eq('id', friendshipId)
    setActing(null)
    fetchAll()
  }

  async function runSearch() {
    const q = search.trim()
    if (!q) return
    setSearching(true)
    setSearched(true)

    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${q}%`)
      .neq('id', session.user.id)
      .limit(20)

    // Enrich with friendship status
    const ids = (data || []).map(p => p.id)
    let statusMap = {}
    if (ids.length) {
      const { data: fs } = await supabase
        .from('friendships')
        .select('id, requester_id, addressee_id, status')
        .or(
          ids.map(id =>
            `and(requester_id.eq.${session.user.id},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${session.user.id})`
          ).join(',')
        )
      for (const f of fs || []) {
        const otherId = f.requester_id === session.user.id ? f.addressee_id : f.requester_id
        statusMap[otherId] = { friendshipId: f.id, status: f.status, iAmRequester: f.requester_id === session.user.id }
      }
    }

    setSearchResults((data || []).map(p => ({ ...p, friendship: statusMap[p.id] || null })))
    setSearching(false)
  }

  async function addFriend(userId) {
    setActing(userId)
    await supabase.from('friendships').insert({ requester_id: session.user.id, addressee_id: userId })
    setActing(null)
    // Re-run search to update button state
    runSearch()
    fetchAll()
  }

  async function cancelSearch(friendshipId, userId) {
    setActing(userId)
    await supabase.from('friendships').delete().eq('id', friendshipId)
    setActing(null)
    runSearch()
    fetchAll()
  }

  const totalNotifs = incoming.length

  return (
    <div style={s.page}>
      <NavBar session={session} />

      <div style={s.content}>

        {/* Page header */}
        <div style={s.pageHead}>
          <div>
            <div style={s.pageTitle}>Friends</div>
            <div style={s.pageSub}>
              {loading ? 'Loading…' : `${friends.length} friend${friends.length !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>

        {/* ── PENDING REQUESTS ── */}
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
                    <div
                      style={s.requestName}
                      onClick={() => navigate(`/profile/${req.profiles?.username}`)}
                    >
                      {req.profiles?.username}
                    </div>
                    <div style={s.requestSub}>wants to be friends</div>
                  </div>
                  <div style={s.requestActions}>
                    <button
                      style={s.btnAccept}
                      onClick={() => respondToRequest(req.id, true)}
                      disabled={acting === req.id}
                    >
                      {acting === req.id ? '…' : 'Accept'}
                    </button>
                    <button
                      style={s.btnDecline}
                      onClick={() => respondToRequest(req.id, false)}
                      disabled={acting === req.id}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── FIND PEOPLE ── */}
        <section style={s.section}>
          <div style={s.sectionHead}>
            <div style={s.sectionTitle}>Find People</div>
          </div>
          <div style={s.searchRow}>
            <input
              style={s.searchInput}
              placeholder="Search by username…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runSearch()}
            />
            <button style={s.btnSearch} onClick={runSearch} disabled={searching || !search.trim()}>
              {searching ? '…' : 'Search'}
            </button>
          </div>

          {searched && !searching && (
            <div style={s.searchResults}>
              {searchResults.length === 0 ? (
                <div style={s.emptySearch}>No users found for "{search}"</div>
              ) : (
                searchResults.map(user => {
                  const f = user.friendship
                  return (
                    <div key={user.id} style={s.searchResultRow}>
                      <UserAvatar profile={user} size={40} />
                      <div style={{ flex: 1 }}>
                        <div
                          style={s.searchResultName}
                          onClick={() => navigate(`/profile/${user.username}`)}
                        >
                          {user.username}
                        </div>
                      </div>
                      <div>
                        {!f && (
                          <button style={s.btnAdd} onClick={() => addFriend(user.id)} disabled={acting === user.id}>
                            {acting === user.id ? '…' : '+ Add Friend'}
                          </button>
                        )}
                        {f?.status === 'accepted' && (
                          <span style={s.friendChip}>Friends ✓</span>
                        )}
                        {f?.status === 'pending' && f?.iAmRequester && (
                          <button style={s.btnPending} onClick={() => cancelSearch(f.friendshipId, user.id)} disabled={acting === user.id} title="Click to cancel">
                            {acting === user.id ? '…' : 'Requested ✓'}
                          </button>
                        )}
                        {f?.status === 'pending' && !f?.iAmRequester && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={s.btnAdd} onClick={() => respondToRequest(f.friendshipId, true)} disabled={acting === f.friendshipId}>Accept</button>
                            <button style={s.btnDeclineSmall} onClick={() => respondToRequest(f.friendshipId, false)} disabled={acting === f.friendshipId}>Decline</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </section>

        {/* ── FRIENDS LIST ── */}
        <section style={s.section}>
          <div style={s.sectionHead}>
            <div style={s.sectionTitle}>My Friends</div>
            {friends.length > 0 && <span style={s.countChip}>{friends.length}</span>}
          </div>

          {loading ? (
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
                <FriendCard
                  key={friend.id}
                  friend={friend}
                  onVisit={() => navigate(`/profile/${friend.username}`)}
                  onUnfriend={() => unfriend(friend.friendshipId)}
                  acting={acting === friend.friendshipId}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── OUTGOING ── */}
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
                    <div style={s.requestName} onClick={() => navigate(`/profile/${req.profiles?.username}`)}>
                      {req.profiles?.username}
                    </div>
                    <div style={s.requestSub}>Request pending</div>
                  </div>
                  <button style={s.btnDecline} onClick={() => cancelOutgoing(req.id)} disabled={acting === req.id}>
                    {acting === req.id ? '…' : 'Cancel'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

// ── FRIEND CARD ──
function FriendCard({ friend, onVisit, onUnfriend, acting }) {
  const [hover, setHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      style={{ ...s.friendCard, ...(hover ? s.friendCardHover : {}) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setMenuOpen(false) }}
    >
      {/* Avatar */}
      <div style={s.friendAvatarWrap} onClick={onVisit}>
        <UserAvatar profile={friend} size={64} />
      </div>

      {/* Name + stats */}
      <div style={s.friendName} onClick={onVisit}>{friend.username}</div>
      <div style={s.friendStats}>
        {friend.stats.total > 0
          ? `${friend.stats.total} book${friend.stats.total !== 1 ? 's' : ''} · ${friend.stats.read} read`
          : 'No books yet'}
      </div>

      {/* Actions */}
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

// ── USER AVATAR ──
function UserAvatar({ profile, size }) {
  const r = size / 2
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt={profile.username} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  const initial = profile?.username?.charAt(0).toUpperCase() || '?'
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: Math.round(size * 0.38), flexShrink: 0, cursor: 'pointer' }}>
      {initial}
    </div>
  )
}

// ── STYLES ──
const s = {
  page:    { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif" },
  content: { maxWidth: 720, margin: '0 auto', padding: '36px 32px' },

  pageHead:  { marginBottom: 32 },
  pageTitle: { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, color: '#1a1208' },
  pageSub:   { fontSize: 14, color: '#8a7f72', marginTop: 4 },

  section:     { marginBottom: 36 },
  sectionHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 },
  sectionTitle:{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#1a1208' },
  badge:       { background: '#c0521e', color: 'white', borderRadius: 20, padding: '2px 9px', fontSize: 12, fontWeight: 600 },
  countChip:   { background: 'rgba(26,18,8,0.07)', color: '#8a7f72', borderRadius: 20, padding: '2px 9px', fontSize: 12, fontWeight: 500 },

  // Pending requests
  requestList: { display: 'flex', flexDirection: 'column', gap: 2 },
  requestRow:  { display: 'flex', alignItems: 'center', gap: 14, background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 12, padding: '14px 18px' },
  requestInfo: { flex: 1 },
  requestName: { fontSize: 15, fontWeight: 600, color: '#1a1208', cursor: 'pointer' },
  requestSub:  { fontSize: 12, color: '#8a7f72', marginTop: 2 },
  requestActions: { display: 'flex', gap: 8 },

  // Search
  searchRow:       { display: 'flex', gap: 10, marginBottom: 4 },
  searchInput:     { flex: 1, padding: '9px 14px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: 'white', color: '#1a1208' },
  searchResults:   { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 },
  searchResultRow: { display: 'flex', alignItems: 'center', gap: 12, background: '#fdfaf4', border: '1px solid #e8dfc8', borderRadius: 10, padding: '12px 16px' },
  searchResultName:{ fontSize: 14, fontWeight: 600, color: '#1a1208', cursor: 'pointer' },
  emptySearch:     { color: '#8a7f72', fontSize: 14, padding: '20px 0', textAlign: 'center' },

  // Friends grid
  friendsGrid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 },
  friendCard:    { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 14, padding: '22px 18px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transition: 'box-shadow 0.15s, transform 0.15s' },
  friendCardHover: { boxShadow: '0 4px 18px rgba(26,18,8,0.1)', transform: 'translateY(-2px)' },
  friendAvatarWrap:{ cursor: 'pointer', marginBottom: 12 },
  friendName:    { fontSize: 15, fontWeight: 700, color: '#1a1208', cursor: 'pointer', marginBottom: 4 },
  friendStats:   { fontSize: 12, color: '#8a7f72', marginBottom: 14 },
  friendActions: { display: 'flex', gap: 6, alignItems: 'center' },

  // Empty state
  emptyMsg:   { color: '#8a7f72', fontSize: 14, padding: '20px 0' },
  emptyBox:   { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, padding: '48px 32px', textAlign: 'center' },
  emptyIcon:  { fontSize: 36, marginBottom: 12 },
  emptyTitle: { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: '#1a1208', marginBottom: 8 },
  emptySub:   { fontSize: 14, color: '#8a7f72', maxWidth: 320, margin: '0 auto' },

  // Buttons
  btnAccept:    { padding: '6px 14px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnDecline:   { padding: '6px 12px', background: 'transparent', color: '#8a7f72', border: '1px solid #d4c9b0', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnDeclineSmall: { padding: '5px 10px', background: 'transparent', color: '#8a7f72', border: '1px solid #d4c9b0', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnSearch:    { padding: '9px 18px', background: '#1a1208', color: '#fdf8f0', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnAdd:       { padding: '6px 14px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnPending:   { padding: '6px 12px', background: 'transparent', color: '#5a7a5a', border: '1px solid #5a7a5a', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  friendChip:   { fontSize: 13, color: '#5a7a5a', fontWeight: 500 },
  btnVisit:     { padding: '6px 14px', background: 'transparent', color: '#c0521e', border: '1px solid #c0521e', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnMore:      { padding: '5px 9px', background: 'transparent', border: '1px solid #d4c9b0', borderRadius: 7, fontSize: 14, cursor: 'pointer', color: '#8a7f72', lineHeight: 1 },
  moreMenu:     { position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 8, minWidth: 140, boxShadow: '0 4px 16px rgba(26,18,8,0.1)', zIndex: 20 },
  moreMenuItem: { padding: '10px 14px', fontSize: 13, cursor: 'pointer', color: '#c0521e' },
}

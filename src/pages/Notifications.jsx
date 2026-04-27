import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { notify } from '../lib/notify'
import { NOTIF_ICONS, LEGACY_INAPP_FILTER } from '../lib/notifTypes'
import { getMyUsername } from '../lib/currentUser'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30)  return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function NotifRow({ icon, title, sub, time, actions, theme }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14,
      padding: '14px 20px', borderBottom: `1px solid ${theme.borderLight ?? '#f0e8d8'}`,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: 'linear-gradient(135deg, #c0521e, #b8860b)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, fontFamily: "'DM Sans', sans-serif", marginBottom: 2 }}>
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 13, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}>
            {sub}
          </div>
        )}
        {actions && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {actions}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif", flexShrink: 0, marginTop: 2 }}>
        {time}
      </div>
    </div>
  )
}

function Section({ title, children, theme }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
        color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif",
        padding: '0 20px 8px',
      }}>
        {title}
      </div>
      <div style={{
        background: theme.bgCard ?? '#fdfaf4',
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  )
}

export default function Notifications({ session }) {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const uid = session.user.id

  const [loading, setLoading]   = useState(true)
  const [acting,  setActing]    = useState(null)

  // Needs Attention
  const [pendingFriends,  setPendingFriends]  = useState([])
  const [pendingBorrows,  setPendingBorrows]  = useState([])
  const [pendingOrders,   setPendingOrders]   = useState([])
  const [pendingRecs,     setPendingRecs]     = useState([])

  // Recent Activity
  const [recentFriends,   setRecentFriends]   = useState([])
  const [activeBorrows,   setActiveBorrows]   = useState([])
  const [recentOrders,    setRecentOrders]    = useState([])

  // Unified notifications
  const [unifiedNotifs, setUnifiedNotifs]     = useState([])
  const [readNotifs,    setReadNotifs]         = useState([])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()

    const [
      { data: pendFriendsRaw },
      { data: recFriendsRaw },
      { data: pendBorrows },
      { data: actBorrows },
      { data: pendOrd },
      { data: recOrd },
    ] = await Promise.all([
      // Pending friend requests (I'm addressee)
      supabase
        .from('friendships')
        .select('id, requester_id, created_at')
        .eq('addressee_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),

      // Recently accepted friends (last 30 days)
      supabase
        .from('friendships')
        .select('id, requester_id, addressee_id, updated_at')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
        .gte('updated_at', thirtyDaysAgo)
        .order('updated_at', { ascending: false }),

      // Pending borrow requests (I'm owner)
      supabase
        .from('borrow_requests')
        .select('id, requester_id, created_at, books(title)')
        .eq('owner_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),

      // Active borrows (I'm involved)
      supabase
        .from('borrow_requests')
        .select('id, created_at, updated_at, owner_id, requester_id, books(title)')
        .eq('status', 'active')
        .or(`owner_id.eq.${uid},requester_id.eq.${uid}`)
        .order('updated_at', { ascending: false }),

      // Pending marketplace orders (I'm seller)
      supabase
        .from('orders')
        .select('id, price, created_at, buyer_id, listings(books(title))')
        .eq('seller_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),

      // Recent orders (I'm buyer, confirmed/shipped/completed)
      supabase
        .from('orders')
        .select('id, price, created_at, updated_at, status, seller_id, listings(books(title))')
        .eq('buyer_id', uid)
        .in('status', ['confirmed', 'shipped', 'completed'])
        .order('updated_at', { ascending: false })
        .limit(20),
    ])

    // Resolve friend usernames separately
    const allFriendUserIds = [...new Set([
      ...(pendFriendsRaw || []).map(f => f.requester_id),
      ...(recFriendsRaw  || []).map(f => f.requester_id),
      ...(recFriendsRaw  || []).map(f => f.addressee_id),
    ].filter(Boolean))]
    let friendProfileMap = {}
    if (allFriendUserIds.length) {
      const { data: fps } = await supabase.from('profiles').select('id, username, avatar_url').in('id', allFriendUserIds)
      friendProfileMap = Object.fromEntries((fps || []).map(p => [p.id, p]))
    }
    const pendFriends = (pendFriendsRaw || []).map(f => ({ ...f, profiles: friendProfileMap[f.requester_id] || null }))
    const recFriends  = (recFriendsRaw  || []).map(f => ({
      ...f,
      requester: friendProfileMap[f.requester_id] || null,
      addressee: friendProfileMap[f.addressee_id] || null,
    }))

    // Resolve borrow request usernames separately
    const allBorrowUserIds = [...new Set([
      ...(pendBorrows || []).map(r => r.requester_id),
      ...(actBorrows  || []).map(r => r.owner_id),
      ...(actBorrows  || []).map(r => r.requester_id),
    ].filter(Boolean))]
    let borrowProfileMap = {}
    if (allBorrowUserIds.length) {
      const { data: bps } = await supabase.from('profiles').select('id, username').in('id', allBorrowUserIds)
      borrowProfileMap = Object.fromEntries((bps || []).map(p => [p.id, p]))
    }
    const pendBorrowsEnriched = (pendBorrows || []).map(r => ({ ...r, profiles: borrowProfileMap[r.requester_id] || null }))
    const actBorrowsEnriched  = (actBorrows  || []).map(r => ({
      ...r,
      owner:     borrowProfileMap[r.owner_id]     || null,
      requester: borrowProfileMap[r.requester_id] || null,
    }))

    // Resolve order usernames separately (orders references auth.users, not profiles)
    const allOrderUserIds = [
      ...(pendOrd || []).map(o => o.buyer_id),
      ...(recOrd  || []).map(o => o.seller_id),
    ].filter(Boolean)
    let orderProfileMap = {}
    if (allOrderUserIds.length) {
      const { data: ops } = await supabase
        .from('profiles').select('id, username').in('id', [...new Set(allOrderUserIds)])
      orderProfileMap = Object.fromEntries((ops || []).map(p => [p.id, p.username]))
    }

    // Fetch book recommendations
    const { data: recsRaw } = await supabase
      .from('book_recommendations')
      .select('id, sender_id, book_id, note, created_at, books(id, title, cover_image_url)')
      .eq('recipient_id', uid)
      .eq('read', false)
      .eq('dismissed', false)
      .order('created_at', { ascending: false })
    let recsEnriched = []
    if (recsRaw?.length) {
      const senderIds = [...new Set(recsRaw.map(r => r.sender_id))]
      const { data: senderProfiles } = await supabase.from('profiles').select('id, username').in('id', senderIds)
      const senderMap = Object.fromEntries((senderProfiles || []).map(p => [p.id, p.username]))
      recsEnriched = recsRaw.map(r => ({ ...r, senderName: senderMap[r.sender_id] || 'Someone' }))
    }

    setPendingFriends(pendFriends)
    setRecentFriends(recFriends)
    setPendingBorrows(pendBorrowsEnriched)
    setActiveBorrows(actBorrowsEnriched)
    setPendingOrders((pendOrd || []).map(o => ({ ...o, profiles: { username: orderProfileMap[o.buyer_id] } })))
    setRecentOrders( (recOrd  || []).map(o => ({ ...o, profiles: { username: orderProfileMap[o.seller_id] } })))
    setPendingRecs(recsEnriched)

    const [{ data: unread }, { data: read }] = await Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', uid)
        .eq('is_read', false)
        .not('type', 'in', LEGACY_INAPP_FILTER)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', uid)
        .eq('is_read', true)
        .not('type', 'in', LEGACY_INAPP_FILTER)
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    setUnifiedNotifs(unread || [])
    setReadNotifs(read || [])
    setLoading(false)
  }

  async function respondFriend(id, accept) {
    setActing(id)
    if (accept) {
      await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
      const { data: row } = await supabase.from('friendships').select('requester_id').eq('id', id).maybeSingle()
      if (row?.requester_id) {
        const fromUsername = (await getMyUsername(uid)) || 'Someone'
        notify(row.requester_id, 'friend_accepted', {
          title: 'Friend request accepted',
          body: `${fromUsername} accepted your friend request`,
          link: `/profile/${fromUsername}`,
          metadata: { friendship_id: id },
        })
      }
    } else {
      await supabase.from('friendships').delete().eq('id', id)
    }
    setActing(null)
    fetchAll()
  }

  async function markNotifRead(id) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setUnifiedNotifs(prev => prev.filter(n => n.id !== id))
    setReadNotifs(prev => {
      const n = unifiedNotifs.find(x => x.id === id)
      return n ? [{ ...n, is_read: true }, ...prev] : prev
    })
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', uid).eq('is_read', false)
    setReadNotifs(prev => [...unifiedNotifs.map(n => ({ ...n, is_read: true })), ...prev])
    setUnifiedNotifs([])
  }

  const needsAttention = pendingFriends.length + pendingBorrows.length + pendingOrders.length + pendingRecs.length
  const recentActivity = recentFriends.length + activeBorrows.length + recentOrders.length

  const btnBase = {
    padding: '5px 14px', border: 'none', borderRadius: 6,
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" }}>
      <NavBar session={session} />

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px 60px' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 26, fontFamily: 'Georgia, serif', fontWeight: 700, color: theme.text, margin: 0, marginBottom: 4 }}>
            Notifications
          </h1>
          <p style={{ fontSize: 14, color: theme.textSubtle, margin: 0 }}>
            Your full notifications history
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: theme.textSubtle, fontSize: 15 }}>
            Loading notifications…
          </div>
        ) : (
          <>
            {/* ── NEEDS ATTENTION ── */}
            {needsAttention > 0 && (
              <Section title="Needs Attention" theme={theme}>
                {pendingFriends.map(req => (
                  <NotifRow
                    key={`pf-${req.id}`}
                    icon="👥"
                    title={`${req.profiles?.username} wants to be friends`}
                    sub={null}
                    time={timeAgo(req.created_at)}
                    theme={theme}
                    actions={[
                      <button
                        key="accept"
                        disabled={acting === req.id}
                        style={{ ...btnBase, background: '#c0521e', color: 'white' }}
                        onClick={() => respondFriend(req.id, true)}
                      >
                        Accept
                      </button>,
                      <button
                        key="decline"
                        disabled={acting === req.id}
                        style={{ ...btnBase, background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}` }}
                        onClick={() => respondFriend(req.id, false)}
                      >
                        Decline
                      </button>,
                    ]}
                  />
                ))}

                {pendingBorrows.map(req => (
                  <NotifRow
                    key={`pb-${req.id}`}
                    icon="📚"
                    title={`${req.profiles?.username} wants to borrow "${req.books?.title}"`}
                    sub="Review the request in Loans"
                    time={timeAgo(req.created_at)}
                    theme={theme}
                    actions={[
                      <button
                        key="loans"
                        style={{ ...btnBase, background: '#5a7a5a', color: 'white' }}
                        onClick={() => navigate('/loans')}
                      >
                        View Loans
                      </button>,
                    ]}
                  />
                ))}

                {pendingOrders.map(order => (
                  <NotifRow
                    key={`po-${order.id}`}
                    icon="🏪"
                    title={`${order.profiles?.username} wants to buy "${order.listings?.books?.title}"`}
                    sub={`Listed at $${Number(order.price).toFixed(2)}`}
                    time={timeAgo(order.created_at)}
                    theme={theme}
                    actions={[
                      <button
                        key="mkt"
                        style={{ ...btnBase, background: '#b8860b', color: 'white' }}
                        onClick={() => navigate('/marketplace')}
                      >
                        View Marketplace
                      </button>,
                    ]}
                  />
                ))}

                {pendingRecs.map(rec => (
                  <NotifRow
                    key={`rec-${rec.id}`}
                    icon="💌"
                    title={`${rec.senderName} recommended "${rec.books?.title}"`}
                    sub={rec.note || null}
                    time={timeAgo(rec.created_at)}
                    theme={theme}
                    actions={[
                      <button
                        key="view"
                        style={{ ...btnBase, background: '#5a7a5a', color: 'white' }}
                        onClick={() => { navigate(`/?book=${rec.books?.id || rec.book_id}`); }}
                      >
                        View Book
                      </button>,
                      <button
                        key="add"
                        style={{ ...btnBase, background: '#c0521e', color: 'white' }}
                        onClick={async () => {
                          await supabase.from('collection_entries').upsert({
                            user_id: uid, book_id: rec.book_id, read_status: 'want',
                          }, { onConflict: 'user_id,book_id' })
                          await supabase.from('book_recommendations').update({ read: true }).eq('id', rec.id)
                          fetchAll()
                        }}
                      >
                        Add to Library
                      </button>,
                      <button
                        key="dismiss"
                        style={{ ...btnBase, background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}` }}
                        onClick={async () => {
                          await supabase.from('book_recommendations').update({ dismissed: true }).eq('id', rec.id)
                          fetchAll()
                        }}
                      >
                        Dismiss
                      </button>,
                    ]}
                  />
                ))}
              </Section>
            )}

            {/* ── RECENT ACTIVITY ── */}
            {recentActivity > 0 && (
              <Section title="Recent Activity" theme={theme}>
                {recentFriends.map(fs => {
                  const other = fs.requester_id === uid ? fs.addressee?.username : fs.requester?.username
                  return (
                    <NotifRow
                      key={`rf-${fs.id}`}
                      icon="👥"
                      title={`You and ${other} are now friends`}
                      sub={null}
                      time={timeAgo(fs.updated_at)}
                      theme={theme}
                      actions={[
                        <button
                          key="profile"
                          style={{ ...btnBase, background: 'transparent', color: theme.rust ?? '#c0521e', border: `1px solid ${theme.rust ?? '#c0521e'}` }}
                          onClick={() => navigate(`/profile/${other}`)}
                        >
                          View Profile
                        </button>,
                      ]}
                    />
                  )
                })}

                {activeBorrows.map(req => {
                  const isOwner = req.owner_id === uid
                  const other   = isOwner ? req.requester?.username : req.owner?.username
                  const desc    = isOwner
                    ? `${other} is currently borrowing "${req.books?.title}"`
                    : `You are borrowing "${req.books?.title}" from ${other}`
                  return (
                    <NotifRow
                      key={`ab-${req.id}`}
                      icon="📚"
                      title={desc}
                      sub="Active loan"
                      time={timeAgo(req.updated_at)}
                      theme={theme}
                      actions={[
                        <button
                          key="loans"
                          style={{ ...btnBase, background: '#5a7a5a', color: 'white' }}
                          onClick={() => navigate('/loans')}
                        >
                          View Loans
                        </button>,
                      ]}
                    />
                  )
                })}

                {recentOrders.map(order => {
                  const STATUS_LABELS = { confirmed: 'Confirmed', shipped: 'Shipped', completed: 'Completed' }
                  return (
                    <NotifRow
                      key={`ro-${order.id}`}
                      icon="🏪"
                      title={`Your order for "${order.listings?.books?.title}" is ${STATUS_LABELS[order.status] ?? order.status}`}
                      sub={`Sold by ${order.profiles?.username} · $${Number(order.price).toFixed(2)}`}
                      time={timeAgo(order.updated_at)}
                      theme={theme}
                      actions={[
                        <button
                          key="mkt"
                          style={{ ...btnBase, background: '#b8860b', color: 'white' }}
                          onClick={() => navigate('/marketplace')}
                        >
                          View Marketplace
                        </button>,
                      ]}
                    />
                  )
                })}
              </Section>
            )}

            {/* ── UNIFIED UNREAD NOTIFICATIONS ── */}
            {unifiedNotifs.length > 0 && (
              <Section title="New" theme={theme}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 16px 0' }}>
                  <button
                    style={{ ...btnBase, background: 'transparent', color: theme.rust ?? '#c0521e', border: 'none', fontSize: 11 }}
                    onClick={markAllRead}
                  >
                    Mark all as read
                  </button>
                </div>
                {unifiedNotifs.map(n => (
                  <NotifRow
                    key={`un-${n.id}`}
                    icon={NOTIF_ICONS[n.type] || '🔔'}
                    title={n.title}
                    sub={n.body}
                    time={timeAgo(n.created_at)}
                    theme={theme}
                    actions={[
                      n.link && (
                        <button
                          key="go"
                          style={{ ...btnBase, background: '#c0521e', color: 'white' }}
                          onClick={() => { markNotifRead(n.id); navigate(n.link) }}
                        >
                          View
                        </button>
                      ),
                      <button
                        key="read"
                        style={{ ...btnBase, background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}` }}
                        onClick={() => markNotifRead(n.id)}
                      >
                        Dismiss
                      </button>,
                    ].filter(Boolean)}
                  />
                ))}
              </Section>
            )}

            {/* ── READ NOTIFICATIONS HISTORY ── */}
            {readNotifs.length > 0 && (
              <Section title="Earlier" theme={theme}>
                {readNotifs.map(n => (
                  <NotifRow
                    key={`rn-${n.id}`}
                    icon={NOTIF_ICONS[n.type] || '🔔'}
                    title={n.title}
                    sub={n.body}
                    time={timeAgo(n.created_at)}
                    theme={theme}
                    actions={n.link ? [
                      <button
                        key="go"
                        style={{ ...btnBase, background: 'transparent', color: theme.rust ?? '#c0521e', border: `1px solid ${theme.rust ?? '#c0521e'}` }}
                        onClick={() => navigate(n.link)}
                      >
                        View
                      </button>,
                    ] : null}
                  />
                ))}
              </Section>
            )}

            {needsAttention === 0 && recentActivity === 0 && unifiedNotifs.length === 0 && readNotifs.length === 0 && (
              <div style={{
                textAlign: 'center', padding: '60px 20px',
                background: theme.bgCard ?? '#fdfaf4',
                border: `1px solid ${theme.border}`,
                borderRadius: 14,
                color: theme.textSubtle, fontSize: 15,
              }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔔</div>
                <div style={{ fontWeight: 600, color: theme.text, marginBottom: 6 }}>All caught up!</div>
                <div>No notifications to show right now.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

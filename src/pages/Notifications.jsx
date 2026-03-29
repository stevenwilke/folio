import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'

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

  // Recent Activity
  const [recentFriends,   setRecentFriends]   = useState([])
  const [activeBorrows,   setActiveBorrows]   = useState([])
  const [recentOrders,    setRecentOrders]    = useState([])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()

    const [
      { data: pendFriends },
      { data: recFriends },
      { data: pendBorrows },
      { data: actBorrows },
      { data: pendOrd },
      { data: recOrd },
    ] = await Promise.all([
      // Pending friend requests (I'm addressee)
      supabase
        .from('friendships')
        .select('id, created_at, profiles!friendships_requester_id_fkey(id, username, avatar_url)')
        .eq('addressee_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),

      // Recently accepted friends (last 30 days)
      supabase
        .from('friendships')
        .select('id, requester_id, addressee_id, updated_at, requester:profiles!friendships_requester_id_fkey(username), addressee:profiles!friendships_addressee_id_fkey(username)')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
        .gte('updated_at', thirtyDaysAgo)
        .order('updated_at', { ascending: false }),

      // Pending borrow requests (I'm owner)
      supabase
        .from('borrow_requests')
        .select('id, created_at, books(title), profiles!borrow_requests_requester_id_fkey(username)')
        .eq('owner_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),

      // Active borrows (I'm involved)
      supabase
        .from('borrow_requests')
        .select('id, created_at, updated_at, owner_id, requester_id, books(title), owner:profiles!borrow_requests_owner_id_fkey(username), requester:profiles!borrow_requests_requester_id_fkey(username)')
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

    setPendingFriends(pendFriends || [])
    setRecentFriends(recFriends   || [])
    setPendingBorrows(pendBorrows || [])
    setActiveBorrows(actBorrows   || [])
    setPendingOrders((pendOrd || []).map(o => ({ ...o, profiles: { username: orderProfileMap[o.buyer_id] } })))
    setRecentOrders( (recOrd  || []).map(o => ({ ...o, profiles: { username: orderProfileMap[o.seller_id] } })))
    setLoading(false)
  }

  async function respondFriend(id, accept) {
    setActing(id)
    if (accept) {
      await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    } else {
      await supabase.from('friendships').delete().eq('id', id)
    }
    setActing(null)
    fetchAll()
  }

  const needsAttention = pendingFriends.length + pendingBorrows.length + pendingOrders.length
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

            {needsAttention === 0 && recentActivity === 0 && (
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

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Loans({ session }) {
  const navigate  = useNavigate()
  const [lending, setLending]   = useState([])
  const [borrowing, setBorrowing] = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('lending')
  const [myUsername, setMyUsername] = useState(null)

  useEffect(() => {
    fetchLoans()
    supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setMyUsername(data?.username || null))
  }, [])

  async function fetchLoans() {
    setLoading(true)
    const [{ data: lendData }, { data: borrowData }] = await Promise.all([
      supabase
        .from('borrow_requests')
        .select(`
          id, status, message, due_date, created_at, updated_at,
          books ( id, title, author, cover_image_url ),
          profiles!borrow_requests_requester_id_fkey ( id, username )
        `)
        .eq('owner_id', session.user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('borrow_requests')
        .select(`
          id, status, message, due_date, created_at, updated_at,
          books ( id, title, author, cover_image_url ),
          profiles!borrow_requests_owner_id_fkey ( id, username )
        `)
        .eq('requester_id', session.user.id)
        .order('created_at', { ascending: false }),
    ])
    setLending(lendData || [])
    setBorrowing(borrowData || [])
    setLoading(false)
  }

  async function handleAction(id, action) {
    if (action === 'accept') {
      await supabase
        .from('borrow_requests')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', id)
    } else if (action === 'decline' || action === 'cancel') {
      await supabase.from('borrow_requests').delete().eq('id', id)
    } else if (action === 'returned') {
      await supabase
        .from('borrow_requests')
        .update({ status: 'returned', updated_at: new Date().toISOString() })
        .eq('id', id)
    }
    fetchLoans()
  }

  const lendPending  = lending.filter(r => r.status === 'pending')
  const lendActive   = lending.filter(r => r.status === 'active')
  const lendHistory  = lending.filter(r => r.status === 'returned' || r.status === 'declined')
  const borPending   = borrowing.filter(r => r.status === 'pending')
  const borActive    = borrowing.filter(r => r.status === 'active')
  const borHistory   = borrowing.filter(r => r.status === 'returned')

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.logo} onClick={() => navigate('/')} role="button" tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && navigate('/')}>
          Folio
        </div>
        <div style={s.topbarRight}>
          <button style={s.btnGhost} onClick={() => navigate('/')}>Library</button>
          <button style={s.btnGhost} onClick={() => navigate('/discover')}>Discover</button>
          <button style={s.btnGhost} onClick={() => navigate('/feed')}>Feed</button>
          <button style={s.btnActive}>Loans</button>
          <button style={s.btnGhost} onClick={() => navigate('/marketplace')}>Marketplace</button>
          {myUsername && (
            <button style={s.btnGhost} onClick={() => navigate(`/profile/${myUsername}`)}>My Profile</button>
          )}
        </div>
      </div>

      <div style={s.content}>
        <div style={s.pageHeader}>
          <h1 style={s.pageTitle}>Loans</h1>
          <p style={s.pageSubtitle}>Track books you've lent out and borrowed from friends</p>
        </div>

        <div style={s.tabRow}>
          <button style={tab === 'lending' ? s.tabActive : s.tabInactive} onClick={() => setTab('lending')}>
            Lending out
            {lendPending.length > 0 && <span style={s.tabBadge}>{lendPending.length}</span>}
          </button>
          <button style={tab === 'borrowing' ? s.tabActive : s.tabInactive} onClick={() => setTab('borrowing')}>
            Borrowing
            {borPending.length > 0 && <span style={s.tabBadge}>{borPending.length}</span>}
          </button>
        </div>

        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : tab === 'lending' ? (
          <LendingView
            pending={lendPending} active={lendActive} history={lendHistory}
            onAction={handleAction} navigate={navigate}
          />
        ) : (
          <BorrowingView
            pending={borPending} active={borActive} history={borHistory}
            onAction={handleAction} navigate={navigate}
          />
        )}
      </div>
    </div>
  )
}

function LendingView({ pending, active, history, onAction, navigate }) {
  if (!pending.length && !active.length && !history.length) {
    return (
      <div style={s.emptyState}>
        <div style={s.emptyIcon}>📚</div>
        <div style={s.emptyTitle}>No lending activity yet</div>
        <div style={s.emptySub}>When friends request to borrow your books, they'll appear here.</div>
      </div>
    )
  }
  return (
    <>
      {pending.length > 0 && (
        <Section title="Pending Requests" count={pending.length}>
          {pending.map(r => <LoanCard key={r.id} req={r} mode="lend-pending" onAction={onAction} navigate={navigate} />)}
        </Section>
      )}
      {active.length > 0 && (
        <Section title="Currently Lent Out" count={active.length}>
          {active.map(r => <LoanCard key={r.id} req={r} mode="lend-active" onAction={onAction} navigate={navigate} />)}
        </Section>
      )}
      {history.length > 0 && (
        <Section title="History" count={history.length} muted>
          {history.map(r => <LoanCard key={r.id} req={r} mode="history" onAction={onAction} navigate={navigate} />)}
        </Section>
      )}
    </>
  )
}

function BorrowingView({ pending, active, history, onAction, navigate }) {
  if (!pending.length && !active.length && !history.length) {
    return (
      <div style={s.emptyState}>
        <div style={s.emptyIcon}>📖</div>
        <div style={s.emptyTitle}>No borrowing activity yet</div>
        <div style={s.emptySub}>Visit a friend's profile to request a book.</div>
        <button style={s.btnPrimary} onClick={() => navigate('/feed')}>Browse Feed</button>
      </div>
    )
  }
  return (
    <>
      {pending.length > 0 && (
        <Section title="Awaiting Response" count={pending.length}>
          {pending.map(r => <LoanCard key={r.id} req={r} mode="borrow-pending" onAction={onAction} navigate={navigate} />)}
        </Section>
      )}
      {active.length > 0 && (
        <Section title="Currently Borrowing" count={active.length}>
          {active.map(r => <LoanCard key={r.id} req={r} mode="borrow-active" onAction={onAction} navigate={navigate} />)}
        </Section>
      )}
      {history.length > 0 && (
        <Section title="History" count={history.length} muted>
          {history.map(r => <LoanCard key={r.id} req={r} mode="history" onAction={onAction} navigate={navigate} />)}
        </Section>
      )}
    </>
  )
}

function Section({ title, count, muted, children }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ ...s.sectionTitle, color: muted ? '#8a7f72' : '#1a1208' }}>
        {title}
        <span style={s.sectionCount}>{count}</span>
      </div>
      <div style={s.loanList}>{children}</div>
    </div>
  )
}

function LoanCard({ req, mode, onAction, navigate }) {
  const book         = req.books
  const otherProfile = req.profiles
  const [acting, setActing] = useState(false)

  async function act(action) {
    setActing(true)
    await onAction(req.id, action)
    setActing(false)
  }

  const dueDate  = req.due_date
    ? new Date(req.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const isOverdue = req.due_date && req.status === 'active' && new Date(req.due_date) < new Date()

  return (
    <div style={s.loanCard}>
      <div style={s.loanCover}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
          : <MiniCover title={book.title} />
        }
      </div>
      <div style={s.loanInfo}>
        <div style={s.loanBookTitle}>{book.title}</div>
        <div style={s.loanBookAuthor}>{book.author}</div>
        <div style={s.loanMeta}>
          {(mode === 'lend-pending' || mode === 'lend-active') && (
            <span>Requested by{' '}
              <span style={s.loanUsername} onClick={() => navigate(`/profile/${otherProfile?.username}`)}>
                {otherProfile?.username}
              </span>
            </span>
          )}
          {(mode === 'borrow-pending' || mode === 'borrow-active') && (
            <span>Owned by{' '}
              <span style={s.loanUsername} onClick={() => navigate(`/profile/${otherProfile?.username}`)}>
                {otherProfile?.username}
              </span>
            </span>
          )}
        </div>
        {req.message && <div style={s.loanMessage}>"{req.message}"</div>}
        {dueDate && (
          <div style={{ ...s.loanDue, color: isOverdue ? '#c0521e' : '#8a7f72' }}>
            Due {dueDate}{isOverdue ? ' — Overdue' : ''}
          </div>
        )}
      </div>
      <div style={s.loanActions}>
        <StatusBadge status={req.status} />
        {mode === 'lend-pending' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button style={s.btnAccept} onClick={() => act('accept')} disabled={acting}>
              {acting ? '…' : 'Accept'}
            </button>
            <button style={s.btnDecline} onClick={() => act('decline')} disabled={acting}>
              Decline
            </button>
          </div>
        )}
        {mode === 'lend-active' && (
          <button style={{ ...s.btnGhost, marginTop: 8, fontSize: 12 }} onClick={() => act('returned')} disabled={acting}>
            {acting ? '…' : 'Mark Returned'}
          </button>
        )}
        {mode === 'borrow-pending' && (
          <button style={{ ...s.btnGhost, marginTop: 8, fontSize: 12, color: '#8a7f72' }} onClick={() => act('cancel')} disabled={acting}>
            {acting ? '…' : 'Cancel'}
          </button>
        )}
        {mode === 'borrow-active' && (
          <button style={{ ...s.btnGhost, marginTop: 8, fontSize: 12 }} onClick={() => act('returned')} disabled={acting}>
            {acting ? '…' : 'Mark Returned'}
          </button>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    pending:  { label: 'Pending',  bg: 'rgba(184,134,11,0.12)',  color: '#b8860b' },
    active:   { label: 'Active',   bg: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
    returned: { label: 'Returned', bg: 'rgba(138,127,114,0.15)', color: '#8a7f72' },
    declined: { label: 'Declined', bg: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
  }
  const { label, bg, color } = map[status] || map.pending
  return (
    <span style={{ display: 'inline-block', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 500, background: bg, color }}>
      {label}
    </span>
  )
}

function MiniCover({ title }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const c  = colors[title.charCodeAt(0) % colors.length]
  const c2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return <div style={{ width: '100%', height: '100%', borderRadius: 4, background: `linear-gradient(135deg, ${c}, ${c2})` }} />
}

const s = {
  page:          { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif" },
  topbar:        { position: 'sticky', top: 0, zIndex: 10, background: 'rgba(245,240,232,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #d4c9b0', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:          { fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, color: '#1a1208', cursor: 'pointer' },
  topbarRight:   { display: 'flex', gap: 10, alignItems: 'center' },
  btnPrimary:    { padding: '8px 16px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnGhost:      { padding: '6px 12px', background: 'none', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#3a3028' },
  btnActive:     { padding: '6px 12px', background: 'rgba(192,82,30,0.1)', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#c0521e', fontWeight: 600 },
  btnAccept:     { padding: '5px 12px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnDecline:    { padding: '5px 12px', background: 'transparent', color: '#8a7f72', border: '1px solid #d4c9b0', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  content:       { padding: '32px 32px', maxWidth: 800, margin: '0 auto' },
  pageHeader:    { marginBottom: 28 },
  pageTitle:     { fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 700, color: '#1a1208', margin: '0 0 6px' },
  pageSubtitle:  { fontSize: 14, color: '#8a7f72', margin: 0 },
  tabRow:        { display: 'flex', gap: 0, marginBottom: 28, borderBottom: '1px solid #d4c9b0' },
  tabActive:     { padding: '10px 20px', background: 'none', border: 'none', borderBottom: '2px solid #c0521e', marginBottom: -1, fontSize: 14, fontWeight: 600, color: '#c0521e', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 6 },
  tabInactive:   { padding: '10px 20px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: 14, color: '#8a7f72', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 6 },
  tabBadge:      { background: '#c0521e', color: 'white', borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  sectionTitle:  { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 },
  sectionCount:  { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(192,82,30,0.1)', color: '#c0521e', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 },
  loanList:      { display: 'flex', flexDirection: 'column', gap: 12 },
  loanCard:      { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 12, padding: '16px', display: 'flex', gap: 14, alignItems: 'flex-start' },
  loanCover:     { width: 52, height: 78, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: '#e8dfc8' },
  loanInfo:      { flex: 1 },
  loanBookTitle: { fontSize: 15, fontWeight: 600, color: '#1a1208', lineHeight: 1.3, marginBottom: 2 },
  loanBookAuthor:{ fontSize: 13, color: '#8a7f72', marginBottom: 6 },
  loanMeta:      { fontSize: 13, color: '#3a3028', marginBottom: 4 },
  loanUsername:  { fontWeight: 600, cursor: 'pointer', color: '#c0521e' },
  loanMessage:   { fontSize: 13, color: '#5a4a3a', fontStyle: 'italic', marginTop: 4 },
  loanDue:       { fontSize: 12, marginTop: 4 },
  loanActions:   { flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  emptyState:    { textAlign: 'center', padding: '60px 0' },
  emptyIcon:     { fontSize: 48, marginBottom: 16 },
  emptyTitle:    { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: '#1a1208', marginBottom: 8 },
  emptySub:      { fontSize: 14, color: '#8a7f72', marginBottom: 20 },
  empty:         { color: '#8a7f72', fontSize: 14, padding: '60px 0', textAlign: 'center' },
}

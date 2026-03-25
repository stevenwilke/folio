import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'

export default function Loans({ session }) {
  const { theme } = useTheme()
  const navigate  = useNavigate()
  const [lending, setLending]   = useState([])
  const [borrowing, setBorrowing] = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('lending')
  useEffect(() => { fetchLoans() }, [])

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

  const s = {
    page:          { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    btnPrimary:    { padding: '8px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:      { padding: '6px 12px', background: 'none', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.text },
    btnAccept:     { padding: '5px 12px', background: theme.rust, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnDecline:    { padding: '5px 12px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    content:       { padding: '32px 32px', maxWidth: 800, margin: '0 auto' },
    pageHeader:    { marginBottom: 28 },
    pageTitle:     { fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 700, color: theme.text, margin: '0 0 6px' },
    pageSubtitle:  { fontSize: 14, color: theme.textSubtle, margin: 0 },
    tabRow:        { display: 'flex', gap: 0, marginBottom: 28, borderBottom: `1px solid ${theme.border}` },
    tabActive:     { padding: '10px 20px', background: theme.rust, color: 'white', border: 'none', borderBottom: `2px solid ${theme.rust}`, marginBottom: -1, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 6 },
    tabInactive:   { padding: '10px 20px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: 14, color: theme.textSubtle, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 6 },
    tabBadge:      { background: theme.rust, color: 'white', borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
    sectionTitle:  { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 },
    sectionCount:  { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(192,82,30,0.1)', color: theme.rust, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 },
    loanList:      { display: 'flex', flexDirection: 'column', gap: 12 },
    loanCard:      { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '16px', display: 'flex', gap: 14, alignItems: 'flex-start', boxShadow: theme.shadowCard, transition: 'box-shadow 0.15s' },
    loanCover:     { width: 52, height: 78, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: theme.bgSubtle },
    loanInfo:      { flex: 1 },
    loanBookTitle: { fontSize: 15, fontWeight: 600, color: theme.text, lineHeight: 1.3, marginBottom: 2 },
    loanBookAuthor:{ fontSize: 13, color: theme.textSubtle, marginBottom: 6 },
    loanMeta:      { fontSize: 13, color: theme.text, marginBottom: 4 },
    loanUsername:  { fontWeight: 600, cursor: 'pointer', color: theme.rust },
    loanMessage:   { fontSize: 13, color: theme.textMuted, fontStyle: 'italic', marginTop: 4 },
    loanDue:       { fontSize: 12, marginTop: 4 },
    loanActions:   { flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
    emptyState:    { textAlign: 'center', padding: '60px 0' },
    emptyIcon:     { fontSize: 48, marginBottom: 16 },
    emptyTitle:    { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, marginBottom: 8 },
    emptySub:      { fontSize: 14, color: theme.textSubtle, marginBottom: 20 },
    empty:         { color: theme.textSubtle, fontSize: 14, padding: '60px 0', textAlign: 'center' },
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />

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
            onAction={handleAction} navigate={navigate} s={s} theme={theme}
          />
        ) : (
          <BorrowingView
            pending={borPending} active={borActive} history={borHistory}
            onAction={handleAction} navigate={navigate} s={s} theme={theme}
          />
        )}
      </div>
    </div>
  )
}

function LendingView({ pending, active, history, onAction, navigate, s, theme }) {
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
        <Section title="Pending Requests" count={pending.length} s={s} theme={theme}>
          {pending.map(r => <LoanCard key={r.id} req={r} mode="lend-pending" onAction={onAction} navigate={navigate} s={s} theme={theme} />)}
        </Section>
      )}
      {active.length > 0 && (
        <Section title="Currently Lent Out" count={active.length} s={s} theme={theme}>
          {active.map(r => <LoanCard key={r.id} req={r} mode="lend-active" onAction={onAction} navigate={navigate} s={s} theme={theme} />)}
        </Section>
      )}
      {history.length > 0 && (
        <Section title="History" count={history.length} muted s={s} theme={theme}>
          {history.map(r => <LoanCard key={r.id} req={r} mode="history" onAction={onAction} navigate={navigate} s={s} theme={theme} />)}
        </Section>
      )}
    </>
  )
}

function BorrowingView({ pending, active, history, onAction, navigate, s, theme }) {
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
        <Section title="Awaiting Response" count={pending.length} s={s} theme={theme}>
          {pending.map(r => <LoanCard key={r.id} req={r} mode="borrow-pending" onAction={onAction} navigate={navigate} s={s} theme={theme} />)}
        </Section>
      )}
      {active.length > 0 && (
        <Section title="Currently Borrowing" count={active.length} s={s} theme={theme}>
          {active.map(r => <LoanCard key={r.id} req={r} mode="borrow-active" onAction={onAction} navigate={navigate} s={s} theme={theme} />)}
        </Section>
      )}
      {history.length > 0 && (
        <Section title="History" count={history.length} muted s={s} theme={theme}>
          {history.map(r => <LoanCard key={r.id} req={r} mode="history" onAction={onAction} navigate={navigate} s={s} theme={theme} />)}
        </Section>
      )}
    </>
  )
}

function Section({ title, count, muted, children, s, theme }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ ...s.sectionTitle, color: muted ? theme.textSubtle : theme.text }}>
        {title}
        <span style={s.sectionCount}>{count}</span>
      </div>
      <div style={s.loanList}>{children}</div>
    </div>
  )
}

function LoanCard({ req, mode, onAction, navigate, s, theme }) {
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
          <div style={{ ...s.loanDue, color: isOverdue ? theme.rust : theme.textSubtle }}>
            Due {dueDate}{isOverdue ? ' — Overdue' : ''}
          </div>
        )}
      </div>
      <div style={s.loanActions}>
        <StatusBadge status={req.status} theme={theme} />
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
          <button style={{ ...s.btnGhost, marginTop: 8, fontSize: 12, color: theme.textSubtle }} onClick={() => act('cancel')} disabled={acting}>
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

function StatusBadge({ status, theme }) {
  const map = {
    pending:  { label: 'Pending',  bg: 'rgba(184,134,11,0.12)',  color: theme.gold },
    active:   { label: 'Active',   bg: 'rgba(90,122,90,0.15)',   color: theme.sage },
    returned: { label: 'Returned', bg: 'rgba(138,127,114,0.15)', color: theme.textSubtle },
    declined: { label: 'Declined', bg: 'rgba(192,82,30,0.12)',   color: theme.rust },
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

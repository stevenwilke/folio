import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'

export default function Loans({ session }) {
  const { theme } = useTheme()
  const navigate  = useNavigate()
  const [lending, setLending]     = useState([])
  const [borrowing, setBorrowing] = useState([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('lending')
  // Browse friends' books
  const [friends, setFriends]     = useState([])
  const [browseFriend, setBrowseFriend] = useState(null)
  const [friendBooks, setFriendBooks]   = useState([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [requestModal, setRequestModal]   = useState(null) // book entry to request
  const [requestMsg, setRequestMsg]       = useState('')
  const [requestDue, setRequestDue]       = useState('')
  const [requesting, setRequesting]       = useState(false)
  // Accept with due date
  const [acceptModal, setAcceptModal]     = useState(null)
  const [acceptDue, setAcceptDue]         = useState('')
  useEffect(() => { fetchLoans(); fetchFriends() }, [])

  async function fetchLoans() {
    setLoading(true)
    const [{ data: lendRaw }, { data: borrowRaw }] = await Promise.all([
      supabase
        .from('borrow_requests')
        .select('id, requester_id, owner_initiated, status, message, due_date, created_at, updated_at, books ( id, title, author, cover_image_url, isbn_13, isbn_10 )')
        .eq('owner_id', session.user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('borrow_requests')
        .select('id, owner_id, status, message, due_date, created_at, updated_at, books ( id, title, author, cover_image_url, isbn_13, isbn_10 )')
        .eq('requester_id', session.user.id)
        .order('created_at', { ascending: false }),
    ])

    // Look up profiles for the other party in each request
    const allBorrowUserIds = [...new Set([
      ...(lendRaw   || []).map(r => r.requester_id),
      ...(borrowRaw || []).map(r => r.owner_id),
    ].filter(Boolean))]
    let borrowProfileMap = {}
    if (allBorrowUserIds.length) {
      const { data: bps } = await supabase.from('profiles').select('id, username').in('id', allBorrowUserIds)
      borrowProfileMap = Object.fromEntries((bps || []).map(p => [p.id, p]))
    }

    setLending(  (lendRaw   || []).map(r => ({ ...r, profiles: borrowProfileMap[r.requester_id] || null })))
    setBorrowing((borrowRaw || []).map(r => ({ ...r, profiles: borrowProfileMap[r.owner_id]     || null })))
    setLoading(false)
  }

  async function fetchFriends() {
    const { data: fs } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
    const friendIds = (fs || []).map(f =>
      f.requester_id === session.user.id ? f.addressee_id : f.requester_id
    )
    if (!friendIds.length) { setFriends([]); return }
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', friendIds)
    setFriends(profiles || [])
  }

  async function loadFriendBooks(friendId) {
    setBrowseLoading(true)
    setFriendBooks([])
    const { data } = await supabase
      .from('collection_entries')
      .select('id, books(id, title, author, cover_image_url, isbn_13, isbn_10)')
      .eq('user_id', friendId)
      .eq('read_status', 'owned')
      .order('books(title)')
    setFriendBooks(data || [])
    setBrowseLoading(false)
  }

  async function submitBorrowRequest() {
    if (!requestModal) return
    setRequesting(true)
    // _ownerId is set when requesting from a cross-friend search result
    const ownerId = requestModal._ownerId || browseFriend
    await supabase.from('borrow_requests').insert({
      requester_id: session.user.id,
      owner_id: ownerId,
      book_id: requestModal.books.id,
      message: requestMsg || null,
      due_date: requestDue || null,
      status: 'pending',
    })
    setRequesting(false)
    setRequestModal(null)
    setRequestMsg('')
    setRequestDue('')
    fetchLoans()
    setTab('borrowing')
  }

  async function handleAction(id, action, dueDate) {
    if (action === 'accept') {
      await supabase
        .from('borrow_requests')
        .update({ status: 'active', due_date: dueDate || null, updated_at: new Date().toISOString() })
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
          <button style={tab === 'browse' ? s.tabActive : s.tabInactive} onClick={() => setTab('browse')}>
            Browse Friends' Books
          </button>
        </div>

        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : tab === 'lending' ? (
          <LendingView
            pending={lendPending} active={lendActive} history={lendHistory}
            onAction={handleAction} navigate={navigate} s={s} theme={theme}
          />
        ) : tab === 'borrowing' ? (
          <BorrowingView
            pending={borPending} active={borActive} history={borHistory}
            onAction={handleAction} navigate={navigate} s={s} theme={theme}
          />
        ) : (
          /* Browse Friends' Books */
          <BrowseTab
            friends={friends} browseFriend={browseFriend} friendBooks={friendBooks}
            browseLoading={browseLoading} borrowing={borrowing}
            onSelectFriend={id => { setBrowseFriend(id); loadFriendBooks(id) }}
            onRequest={entry => setRequestModal(entry)}
            s={s} theme={theme}
          />
        )}
      </div>

      {/* Borrow request modal */}
      {requestModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 28, width: 420, maxWidth: '95vw' }}>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 4 }}>Request to Borrow</div>
            <div style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 4 }}>{requestModal.books.title} by {requestModal.books.author}</div>
            {requestModal._ownerId && (
              <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 16 }}>
                from <span style={{ color: theme.rust, fontWeight: 600 }}>{friends.find(f => f.id === requestModal._ownerId)?.username}</span>
              </div>
            )}
            {!requestModal._ownerId && <div style={{ marginBottom: 16 }} />}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Message (optional)</label>
              <textarea
                value={requestMsg} onChange={e => setRequestMsg(e.target.value)}
                placeholder="Hi! Would you mind lending me this book?"
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", background: theme.bgCard, color: theme.text, resize: 'vertical', outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Return by (optional)</label>
              <input type="date" value={requestDue} onChange={e => setRequestDue(e.target.value)}
                style={{ padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", background: theme.bgCard, color: theme.text, outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setRequestModal(null); setRequestMsg(''); setRequestDue('') }} style={s.btnDecline}>Cancel</button>
              <button onClick={submitBorrowRequest} disabled={requesting} style={s.btnAccept}>{requesting ? 'Sending…' : 'Send Request'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- BROWSE FRIENDS' BOOKS ----
function BrowseTab({ friends, browseFriend, friendBooks, browseLoading, borrowing, onSelectFriend, onRequest, s, theme }) {
  const [searchQuery, setSearchQuery]   = useState('')
  const [allResults, setAllResults]     = useState([])
  const [searching, setSearching]       = useState(false)
  const debounceRef = useRef(null)

  const alreadyRequested = new Set(borrowing.filter(r => r.status === 'pending' || r.status === 'active').map(r => r.books?.id))
  const friendMap = Object.fromEntries(friends.map(f => [f.id, f]))

  // When no friend is selected, debounce-search across ALL friends
  useEffect(() => {
    if (browseFriend) return // friend selected → client-side filter only
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!searchQuery.trim()) { setAllResults([]); return }
    debounceRef.current = setTimeout(() => searchAllFriends(searchQuery.trim()), 350)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery, browseFriend])

  async function searchAllFriends(query) {
    if (!friends.length) return
    setSearching(true)
    const friendIds = friends.map(f => f.id)

    // Step 1: find book IDs matching the query
    const { data: bookMatches } = await supabase
      .from('books')
      .select('id')
      .or(`title.ilike.%${query}%,author.ilike.%${query}%`)

    if (!bookMatches?.length) { setAllResults([]); setSearching(false); return }

    // Step 2: find which friends own any of those books
    const { data: entries } = await supabase
      .from('collection_entries')
      .select('id, user_id, books(id, title, author, cover_image_url, isbn_13, isbn_10)')
      .in('user_id', friendIds)
      .in('book_id', bookMatches.map(b => b.id))
      .eq('read_status', 'owned')

    setAllResults(entries || [])
    setSearching(false)
  }

  // Client-side filter when a specific friend is selected
  const q = searchQuery.toLowerCase()
  const filteredFriendBooks = searchQuery.trim()
    ? friendBooks.filter(e =>
        e.books?.title?.toLowerCase().includes(q) ||
        e.books?.author?.toLowerCase().includes(q)
      )
    : friendBooks

  if (!friends.length) {
    return (
      <div style={s.emptyState}>
        <div style={s.emptyIcon}>👥</div>
        <div style={s.emptyTitle}>No friends yet</div>
        <div style={s.emptySub}>Add friends to browse their libraries and request to borrow books.</div>
      </div>
    )
  }

  const showingAllSearch = !browseFriend && searchQuery.trim()

  return (
    <div>
      {/* Search bar */}
      <div style={{ marginBottom: 20, position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: theme.textSubtle, pointerEvents: 'none' }}>🔍</span>
          <input
            type="text"
            placeholder="Search friends' books by title or author…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 36px 10px 36px',
              border: `1px solid ${theme.border}`, borderRadius: 10,
              fontSize: 14, fontFamily: "'DM Sans', sans-serif",
              background: theme.bgCard, color: theme.text, outline: 'none',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setAllResults([]) }}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: theme.textSubtle, lineHeight: 1 }}
            >×</button>
          )}
        </div>
      </div>

      {/* Friend picker (hide when doing a cross-friend search) */}
      {!showingAllSearch && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: theme.textSubtle, marginBottom: 8, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {browseFriend ? 'Browsing' : 'Choose a friend'}
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {friends.map(f => (
              <button key={f.id}
                onClick={() => onSelectFriend(f.id)}
                style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${browseFriend === f.id ? theme.rust : theme.border}`, background: browseFriend === f.id ? 'rgba(192,82,30,0.1)' : 'transparent', color: browseFriend === f.id ? theme.rust : theme.text, fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: browseFriend === f.id ? 600 : 400, cursor: 'pointer' }}>
                {f.username}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cross-friend search results */}
      {showingAllSearch && (
        <>
          {searching && <div style={s.empty}>Searching…</div>}
          {!searching && allResults.length === 0 && (
            <div style={s.empty}>No friends own a book matching "{searchQuery}".</div>
          )}
          {!searching && allResults.length > 0 && (
            <>
              <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 14 }}>
                {allResults.length} result{allResults.length !== 1 ? 's' : ''} across your friends' libraries
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {allResults.map(entry => {
                  const book = entry.books
                  const requested = alreadyRequested.has(book.id)
                  const coverUrl = getCoverUrl(book)
                  const owner = friendMap[entry.user_id]
                  return (
                    <div key={entry.id} style={{ ...s.loanCard, alignItems: 'center' }}>
                      <div style={s.loanCover}>
                        {coverUrl
                          ? <img src={coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} onError={e => e.target.style.display='none'} />
                          : <MiniCover title={book.title} />}
                      </div>
                      <div style={s.loanInfo}>
                        <div style={s.loanBookTitle}>{book.title}</div>
                        <div style={s.loanBookAuthor}>{book.author}</div>
                        {owner && (
                          <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 4 }}>
                            Owned by <span style={{ color: theme.rust, fontWeight: 600 }}>{owner.username}</span>
                          </div>
                        )}
                      </div>
                      <div>
                        {requested ? (
                          <span style={{ fontSize: 12, color: theme.textSubtle, fontStyle: 'italic' }}>Requested</span>
                        ) : (
                          <button onClick={() => onRequest({ ...entry, _ownerId: entry.user_id })} style={s.btnAccept}>Request to Borrow</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Single-friend browse */}
      {!showingAllSearch && (
        <>
          {browseLoading && <div style={s.empty}>Loading books…</div>}

          {!browseLoading && browseFriend && filteredFriendBooks.length === 0 && (
            <div style={s.empty}>
              {searchQuery.trim()
                ? `No books matching "${searchQuery}" in this friend's library.`
                : 'This friend has no books marked as "In Library" yet.'}
            </div>
          )}

          {!browseLoading && filteredFriendBooks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredFriendBooks.map(entry => {
                const book = entry.books
                const requested = alreadyRequested.has(book.id)
                const coverUrl = getCoverUrl(book)
                return (
                  <div key={entry.id} style={{ ...s.loanCard, alignItems: 'center' }}>
                    <div style={s.loanCover}>
                      {coverUrl
                        ? <img src={coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} onError={e => e.target.style.display='none'} />
                        : <MiniCover title={book.title} />}
                    </div>
                    <div style={s.loanInfo}>
                      <div style={s.loanBookTitle}>{book.title}</div>
                      <div style={s.loanBookAuthor}>{book.author}</div>
                    </div>
                    <div>
                      {requested ? (
                        <span style={{ fontSize: 12, color: theme.textSubtle, fontStyle: 'italic' }}>Requested</span>
                      ) : (
                        <button onClick={() => onRequest(entry)} style={s.btnAccept}>Request to Borrow</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
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
  const [acting, setActing]   = useState(false)
  const [showDue, setShowDue] = useState(false)
  const [pickedDue, setPickedDue] = useState('')

  async function act(action, due) {
    setActing(true)
    await onAction(req.id, action, due)
    setActing(false)
  }

  const dueDate  = req.due_date
    ? new Date(req.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const isOverdue = req.due_date && req.status === 'active' && new Date(req.due_date) < new Date()

  return (
    <div style={s.loanCard}>
      <div style={s.loanCover}>
        {getCoverUrl(book)
          ? <img src={getCoverUrl(book)} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} onError={e => e.target.style.display='none'} />
          : <MiniCover title={book.title} />
        }
      </div>
      <div style={s.loanInfo}>
        <div style={s.loanBookTitle}>{book.title}</div>
        <div style={s.loanBookAuthor}>{book.author}</div>
        <div style={s.loanMeta}>
          {(mode === 'lend-pending' || mode === 'lend-active') && (
            <span>{req.owner_initiated ? 'Lending to' : 'Requested by'}{' '}
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
        {mode === 'lend-pending' && req.owner_initiated && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button style={s.btnDecline} onClick={() => act('decline')} disabled={acting}>{acting ? '…' : 'Cancel'}</button>
          </div>
        )}
        {mode === 'lend-pending' && !req.owner_initiated && !showDue && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button style={s.btnAccept} onClick={() => setShowDue(true)}>Accept</button>
            <button style={s.btnDecline} onClick={() => act('decline')} disabled={acting}>Decline</button>
          </div>
        )}
        {mode === 'lend-pending' && !req.owner_initiated && showDue && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ fontSize: 11, color: theme.textSubtle }}>Return by (optional)</div>
            <input type="date" value={pickedDue} onChange={e => setPickedDue(e.target.value)}
              style={{ padding: '5px 8px', border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, fontFamily: "'DM Sans', sans-serif", background: theme.bgCard, color: theme.text, outline: 'none' }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={s.btnDecline} onClick={() => setShowDue(false)}>Back</button>
              <button style={s.btnAccept} onClick={() => act('accept', pickedDue)} disabled={acting}>{acting ? '…' : 'Confirm'}</button>
            </div>
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

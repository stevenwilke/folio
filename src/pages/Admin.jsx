import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'

const TABS = [
  { key: 'overview',  label: 'Overview',     emoji: '📊' },
  { key: 'covers',    label: 'Covers',       emoji: '🖼️' },
  { key: 'claims',    label: 'Claims',       emoji: '📝' },
  { key: 'authors',   label: 'Authors',      emoji: '✍️' },
  { key: 'users',     label: 'Users',        emoji: '👥' },
]

export default function Admin({ session }) {
  const navigate   = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { theme }  = useTheme()
  const [isAdmin,  setIsAdmin]  = useState(null)

  const tab = searchParams.get('tab') || 'overview'
  const setTab = (t) => setSearchParams({ tab: t }, { replace: false })

  // Data
  const [claims,   setClaims]   = useState([])
  const [authors,  setAuthors]  = useState([])
  const [users,    setUsers]    = useState([])
  const [covers,   setCovers]   = useState([])
  const [stats,    setStats]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [acting,   setActing]   = useState(null)

  // Search
  const [authorSearch, setAuthorSearch] = useState('')
  const [userSearch,   setUserSearch]   = useState('')

  useEffect(() => { checkAdmin() }, [])

  async function checkAdmin() {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', session.user.id)
      .single()
    if (!profile?.is_admin) { setIsAdmin(false); return }
    setIsAdmin(true)
    loadAll()
  }

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadClaims(), loadAuthors(), loadUsers(), loadCovers(), loadStats()])
    setLoading(false)
  }

  async function loadClaims() {
    const { data } = await supabase
      .from('author_claims')
      .select('*, authors(id, name), profiles(username, avatar_url)')
      .order('created_at', { ascending: true })
    setClaims(data || [])
  }

  async function loadAuthors() {
    const { data } = await supabase
      .from('authors')
      .select('*')
      .order('name', { ascending: true })
    setAuthors(data || [])
  }

  async function loadUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, is_admin, is_banned, created_at')
      .order('created_at', { ascending: false })
    setUsers(data || [])
  }

  async function loadCovers() {
    const { data } = await supabase
      .from('pending_covers')
      .select('*, books(id, title, author, cover_image_url), profiles(username)')
      .order('submitted_at', { ascending: true })
    setCovers(data || [])
  }

  async function loadStats() {
    const [
      { count: userCount },
      { count: bookCount },
      { count: entryCount },
      { count: authorCount },
      { count: followCount },
      { count: claimPendingCount },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('books').select('*', { count: 'exact', head: true }),
      supabase.from('collection_entries').select('*', { count: 'exact', head: true }),
      supabase.from('authors').select('*', { count: 'exact', head: true }),
      supabase.from('author_follows').select('*', { count: 'exact', head: true }),
      supabase.from('author_claims').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    ])

    // Book cover images stored in Supabase Storage
    let coverImageCount = 0
    let coverImageSize  = 0
    try {
      const { data: files } = await supabase.storage.from('book-covers').list('', { limit: 1000 })
      if (files) {
        coverImageCount = files.length
        coverImageSize  = files.reduce((sum, f) => sum + (f.metadata?.size || 0), 0)
      }
    } catch {}

    // Avatar images
    let avatarCount = 0
    let avatarSize  = 0
    try {
      const { data: avFiles } = await supabase.storage.from('avatars').list('', { limit: 1000 })
      if (avFiles) {
        avatarCount = avFiles.length
        avatarSize  = avFiles.reduce((sum, f) => sum + (f.metadata?.size || 0), 0)
      }
    } catch {}

    // Pending cover submissions
    const { count: coverPendingCount } = await supabase
      .from('pending_covers').select('*', { count: 'exact', head: true }).eq('status', 'pending')

    setStats({
      userCount, bookCount, entryCount, authorCount, followCount, claimPendingCount,
      coverImageCount, coverImageSize, avatarCount, avatarSize,
      coverPendingCount: coverPendingCount ?? 0,
    })
  }

  async function reviewClaim(claim, decision, note = '') {
    setActing(claim.id)
    await supabase
      .from('author_claims')
      .update({ status: decision, admin_note: note || null })
      .eq('id', claim.id)
    if (decision === 'approved') {
      await supabase
        .from('authors')
        .update({ is_verified: true, claimed_by: claim.user_id })
        .eq('id', claim.author_id)
    }
    setActing(null)
    loadClaims()
    loadAuthors()
    loadStats()
  }

  async function toggleVerified(author) {
    await supabase
      .from('authors')
      .update({ is_verified: !author.is_verified })
      .eq('id', author.id)
    loadAuthors()
  }

  async function removeAuthorClaim(author) {
    await supabase
      .from('authors')
      .update({ is_verified: false, claimed_by: null })
      .eq('id', author.id)
    loadAuthors()
  }

  async function deleteAuthor(author) {
    if (!window.confirm(`Delete author "${author.name}"? This will remove all follows and posts for this author.`)) return
    // Delete related data first
    await supabase.from('author_follows').delete().eq('author_id', author.id)
    await supabase.from('author_posts').delete().eq('author_id', author.id)
    await supabase.from('author_claims').delete().eq('author_id', author.id)
    await supabase.from('authors').delete().eq('id', author.id)
    loadAuthors()
    loadStats()
  }

  async function seedAuthorsFromBooks() {
    if (!window.confirm('Create author pages for every distinct author in your books database?')) return
    setActing('seed')
    const { data: books } = await supabase.from('books').select('author')
    const { data: existing } = await supabase.from('authors').select('name')
    const existingNames = new Set((existing || []).map(a => a.name.toLowerCase()))
    const seen = new Set()
    const toInsert = []
    for (const b of (books || [])) {
      if (!b.author) continue
      const key = b.author.toLowerCase()
      if (existingNames.has(key) || seen.has(key)) continue
      seen.add(key)
      toInsert.push({ name: b.author })
    }
    if (toInsert.length === 0) {
      window.alert('All book authors already have pages!')
    } else {
      const { error } = await supabase.from('authors').insert(toInsert)
      if (error) window.alert('Error: ' + error.message)
      else window.alert(`Created ${toInsert.length} new author page${toInsert.length !== 1 ? 's' : ''}!`)
    }
    setActing(null)
    loadAuthors()
    loadStats()
  }

  async function toggleAdmin(user) {
    const newVal = !user.is_admin
    if (user.id === session.user.id && !newVal) {
      if (!window.confirm('Remove your own admin access? You will be locked out of this page.')) return
    }
    await supabase.from('profiles').update({ is_admin: newVal }).eq('id', user.id)
    loadUsers()
  }

  async function toggleBan(user) {
    const banning = !user.is_banned
    const action = banning ? 'ban' : 'unban'
    if (!window.confirm(`${banning ? 'Ban' : 'Unban'} user "${user.username || user.id}"?${banning ? ' They will no longer be able to log in.' : ''}`)) return
    await supabase.from('profiles').update({ is_banned: banning }).eq('id', user.id)
    loadUsers()
  }

  async function deleteUser(user) {
    if (user.id === session.user.id) { window.alert('You cannot delete your own account.'); return }
    if (!window.confirm(`Permanently delete user "${user.username || user.id}"?\n\nThis will remove:\n• Their profile\n• All collection entries\n• All author follows\n• All author claims\n• All pending covers\n• All loan records\n\nThis cannot be undone!`)) return
    setActing(user.id)
    // Delete user data from all tables
    await Promise.all([
      supabase.from('collection_entries').delete().eq('user_id', user.id),
      supabase.from('author_follows').delete().eq('user_id', user.id),
      supabase.from('author_claims').delete().eq('user_id', user.id),
      supabase.from('pending_covers').delete().eq('user_id', user.id),
      supabase.from('loans').delete().or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`),
      supabase.from('friends').delete().or(`user_id.eq.${user.id},friend_id.eq.${user.id}`),
    ])
    // Delete profile last
    await supabase.from('profiles').delete().eq('id', user.id)
    setActing(null)
    loadUsers()
    loadStats()
  }

  async function approveCover(cover) {
    setActing(cover.id)
    // Set the cover as the book's official cover
    const { data: urlData } = supabase.storage.from('book-covers').getPublicUrl(cover.storage_path)
    if (urlData?.publicUrl) {
      await supabase.from('books').update({ cover_image_url: urlData.publicUrl }).eq('id', cover.book_id)
    }
    await supabase.from('pending_covers').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', cover.id)
    setActing(null)
    loadCovers()
    loadStats()
  }

  async function rejectCover(cover) {
    setActing(cover.id)
    // Delete the uploaded file
    await supabase.storage.from('book-covers').remove([cover.storage_path])
    await supabase.from('pending_covers').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', cover.id)
    setActing(null)
    loadCovers()
    loadStats()
  }

  const s = makeStyles(theme)

  if (isAdmin === null) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.center}>Checking access…</div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.center}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, marginBottom: 8 }}>Access Denied</div>
          <div style={{ fontSize: 14, color: theme.textSubtle }}>You don't have admin access.</div>
        </div>
      </div>
    )
  }

  const pending  = claims.filter(c => c.status === 'pending')
  const resolved = claims.filter(c => c.status !== 'pending')

  const filteredAuthors = authorSearch
    ? authors.filter(a => a.name.toLowerCase().includes(authorSearch.toLowerCase()))
    : authors

  const filteredUsers = userSearch
    ? users.filter(u => (u.username || '').toLowerCase().includes(userSearch.toLowerCase()))
    : users

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.content}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={s.pageTitle}>Admin Dashboard</h1>
          <p style={{ fontSize: 14, color: theme.textSubtle, margin: 0 }}>Manage your Ex Libris community</p>
        </div>

        {/* Tab bar */}
        <div style={s.tabBar}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...s.tab,
                ...(tab === t.key ? s.tabActive : {}),
              }}
            >
              <span>{t.emoji}</span> {t.label}
              {t.key === 'claims' && pending.length > 0 && (
                <span style={s.tabBadge}>{pending.length}</span>
              )}
              {t.key === 'covers' && covers.filter(c => c.status === 'pending').length > 0 && (
                <span style={s.tabBadge}>{covers.filter(c => c.status === 'pending').length}</span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ color: theme.textSubtle, fontSize: 14, padding: 40, textAlign: 'center' }}>Loading…</div>
        ) : (
          <>
            {/* ════════════ OVERVIEW ════════════ */}
            {tab === 'overview' && stats && (
              <div>
                <div style={s.statsGrid}>
                  <StatCard theme={theme} emoji="👥" label="Total Users" value={stats.userCount} onClick={() => setTab('users')} />
                  <StatCard theme={theme} emoji="📚" label="Books in Database" value={stats.bookCount} />
                  <StatCard theme={theme} emoji="📖" label="Collection Entries" value={stats.entryCount} />
                  <StatCard theme={theme} emoji="✍️" label="Author Pages" value={stats.authorCount} onClick={() => setTab('authors')} />
                  <StatCard theme={theme} emoji="❤️" label="Author Follows" value={stats.followCount} onClick={() => setTab('authors')} />
                  <StatCard theme={theme} emoji="📝" label="Pending Claims" value={stats.claimPendingCount}
                    highlight={stats.claimPendingCount > 0} onClick={() => setTab('claims')} />
                </div>

                {/* Storage stats */}
                <div style={{ marginTop: 28 }}>
                  <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text, margin: '0 0 14px' }}>Storage</h3>
                  <div style={s.statsGrid}>
                    <StatCard theme={theme} emoji="🖼️" label="Book Cover Images" value={stats.coverImageCount}
                      subtitle={stats.coverImageSize > 0 ? formatBytes(stats.coverImageSize) : null} onClick={() => setTab('covers')} />
                    <StatCard theme={theme} emoji="📷" label="Pending Covers" value={stats.coverPendingCount}
                      highlight={stats.coverPendingCount > 0} onClick={() => setTab('covers')} />
                    <StatCard theme={theme} emoji="👤" label="User Avatars" value={stats.avatarCount}
                      subtitle={stats.avatarSize > 0 ? formatBytes(stats.avatarSize) : null} />
                  </div>
                </div>

                {/* Quick actions */}
                <div style={{ marginTop: 32 }}>
                  <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text, margin: '0 0 14px' }}>Quick Actions</h3>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {pending.length > 0 && (
                      <button style={s.actionBtn} onClick={() => setTab('claims')}>
                        Review {pending.length} pending claim{pending.length !== 1 ? 's' : ''}
                      </button>
                    )}
                    <button style={s.actionBtnOutline} onClick={() => setTab('authors')}>
                      Browse author pages
                    </button>
                    <button style={s.actionBtnOutline} onClick={() => setTab('users')}>
                      Manage users
                    </button>
                  </div>
                </div>

                {/* Recent users */}
                {users.length > 0 && (
                  <div style={{ marginTop: 32 }}>
                    <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text, margin: '0 0 14px' }}>Recent Signups</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {users.slice(0, 5).map(u => (
                        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, padding: '8px 14px', background: theme.bgCard, borderRadius: 8, border: `1px solid ${theme.border}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {u.avatar_url
                              ? <img src={u.avatar_url} style={{ width: 28, height: 28, borderRadius: 14, objectFit: 'cover' }} alt="" />
                              : <div style={{ width: 28, height: 28, borderRadius: 14, background: theme.rust, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>
                                  {(u.username || '?').charAt(0).toUpperCase()}
                                </div>
                            }
                            <span style={{ fontWeight: 600, color: theme.text }}>{u.username || 'No username'}</span>
                          </div>
                          <span style={{ fontSize: 12, color: theme.textSubtle }}>
                            {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ════════════ CLAIMS ════════════ */}
            {tab === 'claims' && (
              <div>
                <section style={{ marginBottom: 48 }}>
                  <div style={s.sectionHead}>
                    <h2 style={s.sectionTitle}>Pending Claims</h2>
                    {pending.length > 0 && (
                      <span style={s.badge}>{pending.length}</span>
                    )}
                  </div>
                  {pending.length === 0 ? (
                    <div style={s.emptyCard}>
                      <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
                      <div style={{ fontWeight: 600, color: theme.text, marginBottom: 4 }}>All caught up!</div>
                      <div style={{ fontSize: 13, color: theme.textSubtle }}>No pending claims to review.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {pending.map(claim => (
                        <ClaimCard key={claim.id} claim={claim} theme={theme} acting={acting === claim.id} s={s} onReview={reviewClaim} />
                      ))}
                    </div>
                  )}
                </section>
                {resolved.length > 0 && (
                  <section>
                    <h2 style={{ ...s.sectionTitle, color: theme.textSubtle, marginBottom: 16 }}>Resolved</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {resolved.map(claim => (
                        <ClaimCard key={claim.id} claim={claim} theme={theme} acting={false} s={s} resolved />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* ════════════ COVERS ════════════ */}
            {tab === 'covers' && (
              <div>
                {(() => {
                  const pendingCovers  = covers.filter(c => c.status === 'pending')
                  const resolvedCovers = covers.filter(c => c.status !== 'pending')
                  return (
                    <>
                      <section style={{ marginBottom: 48 }}>
                        <div style={s.sectionHead}>
                          <h2 style={s.sectionTitle}>Pending Covers</h2>
                          {pendingCovers.length > 0 && <span style={s.badge}>{pendingCovers.length}</span>}
                        </div>
                        {pendingCovers.length === 0 ? (
                          <div style={s.emptyCard}>
                            <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
                            <div style={{ fontWeight: 600, color: theme.text, marginBottom: 4 }}>All caught up!</div>
                            <div style={{ fontSize: 13, color: theme.textSubtle }}>No pending cover submissions to review.</div>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                            {pendingCovers.map(cover => (
                              <div key={cover.id} style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {/* Cover image preview */}
                                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                                  <div style={{ width: 80, height: 120, borderRadius: 6, overflow: 'hidden', background: theme.bg, border: `1px solid ${theme.border}`, flexShrink: 0 }}>
                                    <img
                                      src={supabase.storage.from('book-covers').getPublicUrl(cover.storage_path).data?.publicUrl}
                                      alt="Submitted cover"
                                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    />
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 15, color: theme.text, marginBottom: 4 }}>
                                      {cover.books?.title || 'Unknown Book'}
                                    </div>
                                    <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 6 }}>
                                      {cover.books?.author || 'Unknown Author'}
                                    </div>
                                    <div style={{ fontSize: 12, color: theme.textSubtle }}>
                                      Submitted by <strong style={{ color: theme.text }}>{cover.profiles?.username || 'Unknown'}</strong>
                                    </div>
                                    <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>
                                      {new Date(cover.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </div>
                                  </div>
                                </div>
                                {/* Current cover comparison */}
                                {cover.books?.cover_image_url && (
                                  <div style={{ fontSize: 12, color: theme.textSubtle, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: theme.bg, borderRadius: 8 }}>
                                    <img src={cover.books.cover_image_url} alt="Current" style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 3 }} />
                                    <span>Current cover</span>
                                  </div>
                                )}
                                {/* Actions */}
                                <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
                                  <button
                                    onClick={() => approveCover(cover)}
                                    disabled={acting === cover.id}
                                    style={{ ...s.btnApprove, flex: 1, opacity: acting === cover.id ? 0.6 : 1 }}
                                  >
                                    {acting === cover.id ? '…' : '✓ Approve'}
                                  </button>
                                  <button
                                    onClick={() => rejectCover(cover)}
                                    disabled={acting === cover.id}
                                    style={{ ...s.btnDecline, flex: 1 }}
                                  >
                                    Reject
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                      {resolvedCovers.length > 0 && (
                        <section>
                          <h2 style={{ ...s.sectionTitle, color: theme.textSubtle, marginBottom: 16 }}>Resolved</h2>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                            {resolvedCovers.map(cover => {
                              const isApproved = cover.status === 'approved'
                              return (
                                <div key={cover.id} style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 14, opacity: 0.75, display: 'flex', gap: 12, alignItems: 'center' }}>
                                  <div style={{ width: 48, height: 72, borderRadius: 4, overflow: 'hidden', background: theme.bg, flexShrink: 0 }}>
                                    {cover.storage_path && isApproved ? (
                                      <img
                                        src={supabase.storage.from('book-covers').getPublicUrl(cover.storage_path).data?.publicUrl}
                                        alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                      />
                                    ) : (
                                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                                        {isApproved ? '✓' : '✕'}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: theme.text }}>{cover.books?.title || 'Unknown'}</div>
                                    <div style={{ fontSize: 12, color: theme.textSubtle }}>by {cover.profiles?.username || 'Unknown'}</div>
                                    <div style={{ marginTop: 4 }}>
                                      <span style={{
                                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                                        background: isApproved ? 'rgba(90,122,90,0.15)' : 'rgba(192,82,30,0.12)',
                                        color: isApproved ? '#5a7a5a' : '#c0521e',
                                      }}>
                                        {isApproved ? 'Approved' : 'Rejected'}
                                      </span>
                                      {cover.reviewed_at && (
                                        <span style={{ fontSize: 11, color: theme.textSubtle, marginLeft: 8 }}>
                                          {new Date(cover.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </section>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            {/* ════════════ AUTHORS ════════════ */}
            {tab === 'authors' && (
              <div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                  <input
                    placeholder="Search authors…"
                    value={authorSearch}
                    onChange={e => setAuthorSearch(e.target.value)}
                    style={s.searchInput}
                  />
                  <span style={{ fontSize: 13, color: theme.textSubtle, whiteSpace: 'nowrap' }}>
                    {filteredAuthors.length} author{filteredAuthors.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    style={{ ...s.actionBtn, fontSize: 13, padding: '8px 16px' }}
                    onClick={seedAuthorsFromBooks}
                    disabled={acting === 'seed'}
                  >
                    {acting === 'seed' ? 'Creating…' : '+ Seed from Books'}
                  </button>
                </div>
                {filteredAuthors.length === 0 ? (
                  <div style={s.emptyCard}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>✍️</div>
                    <div style={{ fontWeight: 600, color: theme.text }}>No authors found</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filteredAuthors.map(author => (
                      <div key={author.id} style={s.authorRow}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span
                              style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 15, color: theme.text, cursor: 'pointer', textDecoration: 'none' }}
                              onClick={() => navigate(`/author/${encodeURIComponent(author.name)}`)}
                            >
                              {author.name}
                            </span>
                            {author.is_verified && (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(90,122,90,0.15)', color: '#5a7a5a' }}>✓ Verified</span>
                            )}
                            {author.claimed_by && !author.is_verified && (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(184,134,11,0.12)', color: '#9a7200' }}>Claimed</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: theme.textSubtle }}>
                            Created {new Date(author.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            {author.bio && (' · Bio set')}
                            {author.website && (' · Has website')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            style={{ ...s.smallBtn, background: author.is_verified ? 'rgba(192,82,30,0.1)' : 'rgba(90,122,90,0.1)', color: author.is_verified ? theme.rust : '#5a7a5a' }}
                            onClick={() => toggleVerified(author)}
                            title={author.is_verified ? 'Unverify' : 'Verify'}
                          >
                            {author.is_verified ? 'Unverify' : 'Verify'}
                          </button>
                          {author.claimed_by && (
                            <button
                              style={{ ...s.smallBtn, background: 'rgba(184,134,11,0.1)', color: '#9a7200' }}
                              onClick={() => removeAuthorClaim(author)}
                              title="Remove claim"
                            >
                              Unclaim
                            </button>
                          )}
                          <button
                            style={{ ...s.smallBtn, background: 'rgba(192,82,30,0.08)', color: '#c0521e' }}
                            onClick={() => deleteAuthor(author)}
                            title="Delete author"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ════════════ USERS ════════════ */}
            {tab === 'users' && (
              <div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
                  <input
                    placeholder="Search users…"
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    style={s.searchInput}
                  />
                  <span style={{ fontSize: 13, color: theme.textSubtle, whiteSpace: 'nowrap' }}>
                    {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {filteredUsers.length === 0 ? (
                  <div style={s.emptyCard}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>👥</div>
                    <div style={{ fontWeight: 600, color: theme.text }}>No users found</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filteredUsers.map(user => (
                      <div key={user.id} style={{ ...s.userRow, opacity: user.is_banned ? 0.5 : 1 }}>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: 'pointer' }}
                          onClick={() => user.username && navigate(`/profile/${user.username}`)}
                        >
                          {user.avatar_url
                            ? <img src={user.avatar_url} style={{ width: 36, height: 36, borderRadius: 18, objectFit: 'cover', flexShrink: 0 }} alt="" />
                            : <div style={{ width: 36, height: 36, borderRadius: 18, background: theme.rust, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
                                {(user.username || '?').charAt(0).toUpperCase()}
                              </div>
                          }
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: theme.text, fontSize: 14 }}>
                              {user.username || 'No username'}
                              {user.is_admin && (
                                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(192,82,30,0.12)', color: theme.rust }}>Admin</span>
                              )}
                              {user.is_banned && (
                                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(200,30,30,0.12)', color: '#c01e1e' }}>Banned</span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: theme.textSubtle }}>
                              Joined {new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            style={{
                              ...s.smallBtn,
                              background: user.is_admin ? 'rgba(192,82,30,0.1)' : 'rgba(90,122,90,0.1)',
                              color: user.is_admin ? theme.rust : '#5a7a5a',
                            }}
                            onClick={() => toggleAdmin(user)}
                          >
                            {user.is_admin ? 'Remove Admin' : 'Make Admin'}
                          </button>
                          <button
                            style={{ ...s.smallBtn, background: user.is_banned ? 'rgba(90,122,90,0.1)' : 'rgba(200,150,0,0.1)', color: user.is_banned ? '#5a7a5a' : '#9a7200' }}
                            onClick={() => toggleBan(user)}
                          >
                            {user.is_banned ? 'Unban' : 'Ban'}
                          </button>
                          {user.id !== session.user.id && (
                            <button
                              style={{ ...s.smallBtn, background: 'rgba(200,30,30,0.08)', color: '#c01e1e' }}
                              onClick={() => deleteUser(user)}
                              disabled={acting === user.id}
                            >
                              {acting === user.id ? '…' : 'Delete'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ── Helpers ─────────────────────────────────── */

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/* ── Stat Card ──────────────────────────────── */

function StatCard({ theme, emoji, label, value, highlight, onClick, subtitle }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: highlight ? 'rgba(192,82,30,0.06)' : theme.bgCard,
        border: `1px solid ${highlight ? 'rgba(192,82,30,0.3)' : theme.border}`,
        borderRadius: 14,
        padding: '22px 20px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s',
      }}
    >
      <div style={{ fontSize: 26, marginBottom: 8 }}>{emoji}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: highlight ? '#c0521e' : theme.text, fontFamily: 'Georgia, serif' }}>
        {(value ?? 0).toLocaleString()}
      </div>
      <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 4 }}>{label}</div>
      {subtitle && <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2, opacity: 0.7 }}>{subtitle}</div>}
    </div>
  )
}

/* ── Claim Card ─────────────────────────────── */

function ClaimCard({ claim, theme, acting, s, onReview, resolved }) {
  const [note, setNote] = useState('')
  const [showDecline, setShowDecline] = useState(false)

  const statusColors = {
    pending:  { bg: 'rgba(184,134,11,0.12)',  color: '#9a7200' },
    approved: { bg: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
    rejected: { bg: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
  }
  const sc = statusColors[claim.status] || statusColors.pending

  return (
    <div style={s.claimCard}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text }}>
              {claim.authors?.name}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: sc.bg, color: sc.color }}>
              {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
            </span>
          </div>
          <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 8 }}>
            Claimed by <strong style={{ color: theme.text }}>{claim.profiles?.username}</strong>
            {' · '}
            {new Date(claim.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          {claim.message && (
            <div style={{ fontSize: 14, color: theme.text, lineHeight: 1.6, background: theme.bgSubtle || theme.bg, borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
              "{claim.message}"
            </div>
          )}
          {claim.proof_url && (
            <a href={claim.proof_url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 13, color: theme.rust, textDecoration: 'none' }}>
              View proof
            </a>
          )}
          {claim.admin_note && (
            <div style={{ fontSize: 13, color: theme.textSubtle, fontStyle: 'italic', marginTop: 8 }}>
              Admin note: {claim.admin_note}
            </div>
          )}
        </div>
      </div>

      {!resolved && claim.status === 'pending' && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${theme.border}`, paddingTop: 14 }}>
          {!showDecline ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => onReview(claim, 'approved')}
                disabled={acting}
                style={{ ...s.btnApprove, opacity: acting ? 0.6 : 1 }}
              >
                {acting ? '…' : '✓ Approve'}
              </button>
              <button
                onClick={() => setShowDecline(true)}
                disabled={acting}
                style={s.btnDecline}
              >
                Decline
              </button>
            </div>
          ) : (
            <div>
              <input
                placeholder="Reason for declining (optional)"
                value={note}
                onChange={e => setNote(e.target.value)}
                style={{ ...s.noteInput, marginBottom: 10 }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowDecline(false)} style={s.btnGhost}>Back</button>
                <button onClick={() => onReview(claim, 'rejected', note)} disabled={acting} style={{ ...s.btnDeclineConfirm, opacity: acting ? 0.6 : 1 }}>
                  {acting ? '…' : 'Confirm Decline'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Styles ─────────────────────────────────── */

function makeStyles(theme) {
  return {
    page:    { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content: { maxWidth: 900, margin: '0 auto', padding: '36px 32px' },
    center:  { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: theme.textSubtle, fontSize: 15 },

    pageTitle:   { fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 700, color: theme.text, margin: '0 0 6px' },
    sectionHead: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
    sectionTitle:{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, margin: 0 },
    badge:       { display: 'inline-block', background: theme.rust, color: '#fff', borderRadius: 20, fontSize: 12, fontWeight: 700, padding: '3px 10px' },

    // Tabs
    tabBar: {
      display: 'flex', gap: 6, marginBottom: 28, borderBottom: `1px solid ${theme.border}`, paddingBottom: 0,
      overflowX: 'auto',
    },
    tab: {
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '10px 16px', border: 'none', background: 'none',
      fontSize: 14, fontWeight: 500, cursor: 'pointer',
      color: theme.textSubtle, borderBottom: '2px solid transparent',
      fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap',
      transition: 'color 0.15s, border-color 0.15s',
      position: 'relative',
    },
    tabActive: {
      color: theme.rust, fontWeight: 700,
      borderBottom: `2px solid ${theme.rust}`,
    },
    tabBadge: {
      background: theme.rust, color: '#fff', borderRadius: 10,
      fontSize: 11, fontWeight: 700, padding: '1px 7px', marginLeft: 2,
    },

    // Cards
    emptyCard:   { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '40px 32px', textAlign: 'center' },
    claimCard:   { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 22px' },

    // Stats grid
    statsGrid: {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      gap: 14,
    },

    // Author / User rows
    authorRow: {
      display: 'flex', alignItems: 'center', gap: 14,
      background: theme.bgCard, border: `1px solid ${theme.border}`,
      borderRadius: 10, padding: '14px 16px',
    },
    userRow: {
      display: 'flex', alignItems: 'center', gap: 14,
      background: theme.bgCard, border: `1px solid ${theme.border}`,
      borderRadius: 10, padding: '12px 16px',
    },

    // Search input
    searchInput: {
      flex: 1, padding: '9px 14px', border: `1px solid ${theme.border}`,
      borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif",
      background: theme.bgCard, color: theme.text, outline: 'none',
    },

    // Buttons
    smallBtn: {
      padding: '5px 12px', border: 'none', borderRadius: 7,
      fontSize: 12, fontWeight: 600, cursor: 'pointer',
      fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap',
    },
    actionBtn: {
      padding: '10px 20px', background: theme.rust, color: '#fff',
      border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
      cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    },
    actionBtnOutline: {
      padding: '10px 20px', background: 'transparent', color: theme.text,
      border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14,
      cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    },

    btnApprove:       { padding: '8px 18px', background: '#5a7a5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnDecline:       { padding: '8px 18px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnDeclineConfirm:{ padding: '8px 18px', background: '#c0521e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:         { padding: '8px 14px', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" },
    noteInput:        { width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", background: theme.bg, color: theme.text, outline: 'none' },
  }
}

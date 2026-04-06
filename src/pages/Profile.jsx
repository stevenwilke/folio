import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BookDetail from './BookDetail'
import NavBar from '../components/NavBar'
import EditProfileModal from '../components/EditProfileModal'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'
import { useIsMobile } from '../hooks/useIsMobile'

const STATUS_COLORS = {
  owned:   { bg: 'rgba(138,127,114,0.15)', color: '#8a7f72' },
  read:    { bg: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
  reading: { bg: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
  want:    { bg: 'rgba(184,134,11,0.12)',  color: '#b8860b' },
}

import { computeBadges, BADGE_CATEGORIES, TIER_STYLES } from '../lib/badges'

export default function Profile({ session }) {
  const { username } = useParams()
  const navigate = useNavigate()
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const [profile, setProfile]             = useState(null)
  const [books, setBooks]                 = useState([])
  const [loading, setLoading]             = useState(true)
  const [notFound, setNotFound]           = useState(false)
  const [selectedBook, setSelectedBook]   = useState(null)
  const [isFriend, setIsFriend]           = useState(false)
  const [borrowTarget, setBorrowTarget]   = useState(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const fileInputRef = useRef(null)

  // ── CUSTOMIZATION STATE ──
  const [accentColor,    setAccentColor]    = useState('#c0521e')
  const [featuredBook,   setFeaturedBook]   = useState(null)
  const [showCustomize,  setShowCustomize]  = useState(false)

  // ── GOAL STATE ──
  const [goal, setGoal]                   = useState(null)
  const [booksReadThisYear, setBooksReadThisYear] = useState(0)
  const [showGoalInput, setShowGoalInput] = useState(false)
  const [goalInputVal, setGoalInputVal]   = useState('')
  const [savingGoal, setSavingGoal]       = useState(false)
  const [showClearBooks,   setShowClearBooks]   = useState(false)
  const [showDeleteAcct,   setShowDeleteAcct]   = useState(false)

  // ── BADGES STATE ──
  const [badges, setBadges]               = useState([])
  const [friendCount, setFriendCount]     = useState(0)

  const isOwnProfile = session?.user?.id === profile?.id

  const s = makeStyles(theme, accentColor, isMobile)

  useEffect(() => { fetchProfile() }, [username])

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !session) return
    setUploadingAvatar(true)
    const ext  = file.name.split('.').pop()
    const path = `${session.user.id}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', session.user.id)
      setProfile(prev => ({ ...prev, avatar_url: publicUrl }))
    }
    setUploadingAvatar(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function fetchProfile() {
    setLoading(true)
    setNotFound(false)
    setBooks([])
    setProfile(null)

    const { data: prof } = await supabase
      .from('profiles')
      .select('id, username, bio, is_public, created_at, avatar_url, accent_color, featured_book_id, paypal_handle, venmo_handle, books!profiles_featured_book_id_fkey(id, title, author, cover_image_url)')
      .eq('username', username)
      .maybeSingle()

    if (!prof) { setNotFound(true); setLoading(false); return }
    setProfile(prof)
    setAccentColor(prof.accent_color || '#c0521e')
    setFeaturedBook(prof.books || null)

    const isOwn = session?.user?.id === prof.id
    if (!isOwn && session?.user?.id) {
      supabase
        .from('friendships')
        .select('status')
        .or(`and(requester_id.eq.${session.user.id},addressee_id.eq.${prof.id}),and(requester_id.eq.${prof.id},addressee_id.eq.${session.user.id})`)
        .eq('status', 'accepted')
        .maybeSingle()
        .then(({ data }) => setIsFriend(!!data))
    }

    if (!prof.is_public && !isOwn) { setLoading(false); return }

    const { data: entries } = await supabase
      .from('collection_entries')
      .select('id, read_status, user_rating, review_text, added_at, updated_at, books(id, title, author, cover_image_url, isbn_13, isbn_10, genre, published_year, pages)')
      .eq('user_id', prof.id)
      .order('added_at', { ascending: false })

    setBooks(entries || [])

    // ── FRIEND COUNT (for badges) ──
    const { count: fc } = await supabase
      .from('friendships')
      .select('id', { count: 'exact', head: true })
      .or(`requester_id.eq.${prof.id},addressee_id.eq.${prof.id}`)
      .eq('status', 'accepted')
    const friendCountVal = fc || 0
    setFriendCount(friendCountVal)

    // ── BADGES ──
    setBadges(computeBadges(entries || [], friendCountVal))

    // ── GOAL (own profile only) ──
    if (isOwn) {
      fetchGoal(prof.id, entries || [])
    }

    setLoading(false)
  }

  async function fetchGoal(userId, entriesData) {
    const currentYear = new Date().getFullYear()
    const { data: goalData } = await supabase
      .from('reading_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('year', currentYear)
      .maybeSingle()
    setGoal(goalData || null)

    // Count books read this year
    const startOfYear = new Date(currentYear, 0, 1).toISOString()
    const readThisYear = (entriesData || []).filter(e =>
      e.read_status === 'read' && e.updated_at >= startOfYear
    ).length
    setBooksReadThisYear(readThisYear)
  }

  async function saveGoal() {
    const target = parseInt(goalInputVal, 10)
    if (!target || target < 1) return
    setSavingGoal(true)
    const currentYear = new Date().getFullYear()
    const { data } = await supabase
      .from('reading_goals')
      .upsert({ user_id: session.user.id, year: currentYear, target_books: target }, { onConflict: 'user_id,year' })
      .select()
      .single()
    setGoal(data)
    setShowGoalInput(false)
    setGoalInputVal('')
    setSavingGoal(false)
  }

  // Derived shelves
  const reading = books.filter(b => b.read_status === 'reading')
  const read    = books.filter(b => b.read_status === 'read')
  const want    = books.filter(b => b.read_status === 'want')
  const owned   = books.filter(b => b.read_status === 'owned')
  const reviews = books.filter(b => b.review_text)

  const stats = {
    total:     books.length,
    read:      read.length,
    reading:   reading.length,
    want:      want.length,
    avgRating: (() => {
      const rated = books.filter(b => b.user_rating)
      if (!rated.length) return null
      return (rated.reduce((sum, b) => sum + b.user_rating, 0) / rated.length).toFixed(1)
    })(),
  }

  const joinDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  if (loading) return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.loadingMsg}>Loading…</div>
    </div>
  )

  if (notFound) return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.notFoundBox}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>📚</div>
        <div style={s.notFoundTitle}>Profile not found</div>
        <div style={s.notFoundSub}>No user with the username "{username}" exists.</div>
        <button style={s.btnPrimary} onClick={() => navigate('/')}>
          {session ? 'Go to My Library' : 'Go to Ex Libris'}
        </button>
      </div>
    </div>
  )

  const isPrivate = !profile.is_public && !isOwnProfile

  return (
    <div style={s.page}>
      <NavBar session={session} />

      {/* ── HERO ── */}
      <div style={{ ...s.hero, background: `linear-gradient(160deg, #1e140a 0%, #2e1f10 60%, ${accentColor}22 100%)` }}>
        <div style={s.heroInner}>

          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt={profile.username} style={s.heroAvatar} />
              : <div style={s.heroAvatarFallback}>{profile.username.charAt(0).toUpperCase()}</div>
            }
            {isOwnProfile && (
              <>
                <button
                  style={s.avatarEditBtn}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  title="Change photo"
                >
                  {uploadingAvatar ? '…' : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  )}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
              </>
            )}
          </div>

          {/* Name + bio + stats */}
          <div style={s.heroInfo}>
            <div style={s.heroName}>{profile.username}</div>
            {profile.bio && <div style={s.heroBio}>{profile.bio}</div>}

            {stats.total > 0 && (
              <div style={s.heroStatRow}>
                <span style={s.heroStat}>📚 {stats.total} books</span>
                <span style={s.heroDot}>·</span>
                <span style={s.heroStat}>✓ {stats.read} read</span>
                {stats.reading > 0 && <><span style={s.heroDot}>·</span><span style={{ ...s.heroStat, color: '#e8956a' }}>📖 {stats.reading} reading</span></>}
                {stats.avgRating && <><span style={s.heroDot}>·</span><span style={{ ...s.heroStat, color: '#e8c86a' }}>★ {stats.avgRating}</span></>}
                {reviews.length > 0 && <><span style={s.heroDot}>·</span><span style={s.heroStat}>{reviews.length} reviews</span></>}
              </div>
            )}

            {/* ── READING GOAL (own profile only) ── */}
            {isOwnProfile && (
              <div style={{ marginTop: 14 }}>
                {!goal && !showGoalInput && (
                  <button style={s.goalSetBtn} onClick={() => setShowGoalInput(true)}>
                    📖 Set {new Date().getFullYear()} reading goal →
                  </button>
                )}
                {!goal && showGoalInput && (
                  <div style={s.goalInputRow}>
                    <input
                      type="number"
                      min="1"
                      max="999"
                      placeholder="e.g. 24"
                      value={goalInputVal}
                      onChange={e => setGoalInputVal(e.target.value)}
                      style={s.goalInput}
                      onKeyDown={e => e.key === 'Enter' && saveGoal()}
                      autoFocus
                    />
                    <button style={s.goalSaveBtn} onClick={saveGoal} disabled={savingGoal}>
                      {savingGoal ? '…' : 'Save'}
                    </button>
                    <button style={s.goalCancelBtn} onClick={() => { setShowGoalInput(false); setGoalInputVal('') }}>✕</button>
                  </div>
                )}
                {goal && (
                  <div style={s.goalDisplay}>
                    <div style={s.goalProgressWrap}>
                      <div style={{
                        ...s.goalProgressFill,
                        width: `${Math.min(100, Math.round((booksReadThisYear / goal.target_books) * 100))}%`
                      }} />
                    </div>
                    <div style={s.goalText}>
                      {booksReadThisYear} of {goal.target_books} books read in {goal.year}
                      <span style={s.goalPct}> · {Math.min(100, Math.round((booksReadThisYear / goal.target_books) * 100))}%</span>
                    </div>
                    {showGoalInput ? (
                      <div style={{ ...s.goalInputRow, marginTop: 6 }}>
                        <input
                          type="number"
                          min="1"
                          max="999"
                          placeholder={String(goal.target_books)}
                          value={goalInputVal}
                          onChange={e => setGoalInputVal(e.target.value)}
                          style={s.goalInput}
                          onKeyDown={e => e.key === 'Enter' && saveGoal()}
                          autoFocus
                        />
                        <button style={s.goalSaveBtn} onClick={saveGoal} disabled={savingGoal}>
                          {savingGoal ? '…' : 'Save'}
                        </button>
                        <button style={s.goalCancelBtn} onClick={() => { setShowGoalInput(false); setGoalInputVal('') }}>✕</button>
                      </div>
                    ) : (
                      <button style={s.goalEditBtn} onClick={() => { setGoalInputVal(String(goal.target_books)); setShowGoalInput(true) }} title="Edit goal">✏️</button>
                    )}
                  </div>
                )}
              </div>
            )}

            {joinDate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <div style={s.heroMeta}>Member since {joinDate}</div>
                {isOwnProfile && (
                  <button style={s.heroFriendsLink} onClick={() => navigate('/friends')}>
                    👥 My Friends
                  </button>
                )}
              </div>
            )}

            {isOwnProfile && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button style={s.editProfileBtn} onClick={() => setShowEditProfile(true)}>
                  ✏️ Edit Profile
                </button>
                <button style={s.editProfileBtn} onClick={() => setShowCustomize(true)}>
                  🎨 Customize
                </button>
              </div>
            )}
          </div>

          {/* Featured book (own profile, top-right) */}
          {isOwnProfile && featuredBook && (
            <div
              style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', marginRight: 4 }}
              onClick={() => setSelectedBook(featuredBook.id)}
              title={featuredBook.title}
            >
              <span style={{ fontSize: 10, color: 'rgba(253,248,240,0.6)', letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 }}>Featured Read</span>
              <div style={{ width: 60, height: 80, borderRadius: 5, overflow: 'hidden', boxShadow: `0 4px 18px ${accentColor}55, 0 2px 8px rgba(0,0,0,0.4)` }}>
                {featuredBook.cover_image_url
                  ? <img src={featuredBook.cover_image_url} alt={featuredBook.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <FakeCover title={featuredBook.title} />
                }
              </div>
            </div>
          )}

          {/* Action */}
          {isOwnProfile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
              <button style={s.heroGhostBtn} onClick={() => navigate('/')}>← My Library</button>
              <button style={s.heroSignOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          ) : (
            session && <div style={{ flexShrink: 0 }}><FriendButton session={session} profile={profile} theme={theme} /></div>
          )}
        </div>
      </div>

      {/* ── BADGES ── */}
      {badges.length > 0 && (
        <div style={s.badgesSection}>
          <div style={s.badgesSectionInner}>
            <div style={s.badgesHeadRow}>
              <span style={s.badgesTitle}>🏅 Badges</span>
              <span style={s.badgesEarned}>
                {badges.filter(b => b.earned).length} / {badges.length} earned
              </span>
            </div>
            {BADGE_CATEGORIES.map(cat => {
              const catBadges = badges.filter(b => b.category === cat)
              if (!catBadges.length) return null
              return (
                <div key={cat} style={{ marginBottom: 20 }}>
                  <div style={s.badgeCatLabel}>{cat}</div>
                  <div style={s.badgeGrid}>
                    {catBadges.map(b => {
                      const ts = TIER_STYLES[b.tier]
                      return (
                        <div
                          key={b.id}
                          style={{
                            ...s.badgeCard,
                            background:   b.earned ? ts.bg     : theme.bgSubtle,
                            borderColor:  b.earned ? ts.border : theme.borderLight,
                            opacity:      b.earned ? 1 : 0.72,
                          }}
                          title={b.desc}
                        >
                          <div style={s.badgeEmoji}>{b.earned ? b.emoji : '🔒'}</div>
                          <div style={s.badgeCardName}>{b.name}</div>
                          <div style={s.badgeCardDesc}>{b.desc}</div>
                          {b.earned ? (
                            <div style={{ ...s.badgeTierPill, background: ts.bg, color: ts.text, border: `1px solid ${ts.border}` }}>
                              {ts.label}
                            </div>
                          ) : (
                            <div style={s.badgeProgressWrap}>
                              <div style={s.badgeProgressBg}>
                                <div style={{ ...s.badgeProgressFill, width: `${b.pct}%`, background: ts.text }} />
                              </div>
                              <span style={s.badgeProgressLabel}>{b.prog.value.toLocaleString()} / {b.prog.max.toLocaleString()} {b.prog.label}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── CONTENT ── */}
      {isPrivate ? (
        <div style={s.content}>
          <div style={s.privateBox}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <div style={s.privateTitle}>This shelf is private</div>
            <div style={s.privateSub}>{profile.username} hasn't made their library public yet.</div>
          </div>
        </div>
      ) : books.length === 0 ? (
        <div style={s.content}>
          <div style={s.emptyShelf}>
            {isOwnProfile ? 'Your library is empty — add your first book!' : `${profile.username} hasn't added any books yet.`}
          </div>
        </div>
      ) : (
        <div style={s.content}>

          {/* ── CURRENTLY READING WIDGET ── */}
          {reading.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontFamily:'Georgia, serif', fontSize:16, fontWeight:700, color:theme.text, marginBottom:12 }}>
                📖 Currently Reading
                <span style={{ fontSize:14, fontWeight:500, color:theme.textSubtle, fontFamily:"'DM Sans', sans-serif", marginLeft:8 }}>
                  {reading.length} book{reading.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                {reading.map(entry => (
                  <CurrentlyReadingBook
                    key={entry.id || entry.book_id}
                    book={entry.books}
                    theme={theme}
                    onClick={() => { if (session && entry.books?.id) setSelectedBook(entry.books.id) }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Currently Reading */}
          {reading.length > 0 && (
            <section style={s.section}>
              <ShelfHeader label="Currently Reading" count={reading.length} accent="#c0521e" theme={theme} />
              <div style={s.shelf}>
                {reading.map(entry => (
                  <ShelfCard key={entry.id} entry={entry} theme={theme}
                    onSelect={session ? () => setSelectedBook(entry.books.id) : undefined}
                    canBorrow={isFriend && !isOwnProfile && entry.read_status === 'owned'}
                    onBorrow={() => setBorrowTarget(entry)} />
                ))}
              </div>
            </section>
          )}

          {/* Read */}
          {read.length > 0 && (
            <section style={s.section}>
              <ShelfHeader label="Read" count={read.length} accent="#5a7a5a" theme={theme} />
              <div style={s.shelf}>
                {read.map(entry => (
                  <ShelfCard key={entry.id} entry={entry} theme={theme}
                    onSelect={session ? () => setSelectedBook(entry.books.id) : undefined}
                    canBorrow={false} onBorrow={() => {}} />
                ))}
              </div>
            </section>
          )}

          {/* Want to Read */}
          {want.length > 0 && (
            <section style={s.section}>
              <ShelfHeader label="Want to Read" count={want.length} accent="#b8860b" theme={theme} />
              <div style={s.shelf}>
                {want.map(entry => (
                  <ShelfCard key={entry.id} entry={entry} theme={theme}
                    onSelect={session ? () => setSelectedBook(entry.books.id) : undefined}
                    canBorrow={false} onBorrow={() => {}} />
                ))}
              </div>
            </section>
          )}

          {/* In Library */}
          {owned.length > 0 && (
            <section style={s.section}>
              <ShelfHeader label="In Library" count={owned.length} accent="#8a7f72" theme={theme} />
              <div style={s.shelf}>
                {owned.map(entry => (
                  <ShelfCard key={entry.id} entry={entry} theme={theme}
                    onSelect={session ? () => setSelectedBook(entry.books.id) : undefined}
                    canBorrow={isFriend && !isOwnProfile}
                    onBorrow={() => setBorrowTarget(entry)} />
                ))}
              </div>
            </section>
          )}

          {/* Reviews */}
          {reviews.length > 0 && (
            <section style={{ ...s.section, paddingBottom: 48 }}>
              <ShelfHeader label={`Reviews by ${profile.username}`} count={reviews.length} accent="#c0521e" theme={theme} />
              <div style={s.reviewsList}>
                {reviews.map(entry => (
                  <ReviewCard key={entry.id} entry={entry} theme={theme}
                    onBookClick={session ? () => setSelectedBook(entry.books.id) : undefined} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Danger Zone — own profile only */}
      {isOwnProfile && (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: isMobile ? '0 16px 80px' : '0 32px 60px' }}>
          <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 32, marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#c0521e', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 }}>
              ⚠️ Danger Zone
            </div>
            <div style={{ background: 'rgba(192,82,30,0.04)', border: '1px solid rgba(192,82,30,0.18)', borderRadius: 14, padding: '18px 20px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 3 }}>Clear my library</div>
                <div style={{ fontSize: 13, color: theme.textSubtle }}>Remove all books from your collection. Your account stays active.</div>
              </div>
              <button
                onClick={() => setShowClearBooks(true)}
                style={{ padding: '9px 20px', background: 'transparent', border: '1px solid rgba(192,82,30,0.4)', borderRadius: 9, fontSize: 13, fontWeight: 600, color: '#c0521e', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', alignSelf: 'center' }}
              >
                Clear library
              </button>
            </div>

            <div style={{ background: 'rgba(192,82,30,0.04)', border: '1px solid rgba(192,82,30,0.18)', borderRadius: 14, padding: '18px 20px', marginTop: 10, display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 3 }}>Delete account</div>
                <div style={{ fontSize: 13, color: theme.textSubtle }}>Permanently delete your account and all data. This cannot be undone.</div>
              </div>
              <button
                onClick={() => setShowDeleteAcct(true)}
                style={{ padding: '9px 20px', background: '#c0521e', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, color: 'white', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', alignSelf: 'center' }}
              >
                Delete account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Borrow modal */}
      {borrowTarget && session && profile && (
        <BorrowModal session={session} entry={borrowTarget} ownerId={profile.id} theme={theme} onClose={() => setBorrowTarget(null)} />
      )}

      {/* Book detail overlay */}
      {selectedBook && session && (
        <div style={{ position: 'fixed', inset: 0, background: theme.bg, zIndex: 40, overflowY: 'auto', isolation: 'isolate' }}>
          <BookDetail bookId={selectedBook} session={session} onBack={() => setSelectedBook(null)} />
        </div>
      )}

      {showClearBooks && (
        <ClearBooksModal
          session={session}
          bookCount={books.length}
          theme={theme}
          onClose={() => setShowClearBooks(false)}
          onCleared={() => { setShowClearBooks(false); setBooks([]) }}
        />
      )}

      {showDeleteAcct && (
        <DeleteAccountModal
          session={session}
          theme={theme}
          onClose={() => setShowDeleteAcct(false)}
        />
      )}

      {showEditProfile && (
        <EditProfileModal
          session={session}
          profile={profile}
          onClose={() => setShowEditProfile(false)}
          onSaved={(updated) => {
            setProfile(updated)
            setShowEditProfile(false)
            // If username changed, update the URL
            if (updated.username !== profile.username) {
              navigate(`/profile/${updated.username}`, { replace: true })
            }
          }}
        />
      )}

      {showCustomize && (
        <CustomizePanel
          session={session}
          accentColor={accentColor}
          featuredBook={featuredBook}
          userBooks={books}
          onAccentChange={setAccentColor}
          onFeaturedChange={setFeaturedBook}
          onClose={() => setShowCustomize(false)}
          theme={theme}
        />
      )}
    </div>
  )
}

// ── CURRENTLY READING BOOK ──
function CurrentlyReadingBook({ book, theme, onClick }) {
  const [hover, setHover] = useState(false)
  const url = getCoverUrl(book)
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#8b2500','#b8860b','#3d5a5a']
  const c = colors[(book.title||'').charCodeAt(0) % colors.length]
  const c2 = colors[((book.title||'').charCodeAt(0)+3) % colors.length]
  return (
    <div onClick={onClick} onTouchEnd={(e) => { e.preventDefault(); onClick?.() }} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{ cursor:'pointer', textAlign:'center', width:64, transform: hover?'translateY(-2px)':'none', transition:'transform 0.15s' }}>
      <div style={{ width:64, height:96, borderRadius:6, overflow:'hidden', background:`linear-gradient(135deg,${c},${c2})`, marginBottom:6, boxShadow: hover ? '0 4px 12px rgba(0,0,0,0.2)' : '0 2px 6px rgba(0,0,0,0.1)' }}>
        {url && <img src={url} alt={book.title} style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'} />}
      </div>
      <div style={{fontSize:11,color:theme.textSubtle,lineHeight:1.3,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{book.title}</div>
    </div>
  )
}

// ── CUSTOMIZE PANEL ──
const ACCENT_PRESETS = [
  { name: 'Rust',   color: '#c0521e' },
  { name: 'Sage',   color: '#5a7a5a' },
  { name: 'Gold',   color: '#b8860b' },
  { name: 'Navy',   color: '#1e3a5f' },
  { name: 'Purple', color: '#6b3fa0' },
  { name: 'Teal',   color: '#2a7a7a' },
  { name: 'Rose',   color: '#b04060' },
  { name: 'Forest', color: '#2d5a27' },
]

function CustomizePanel({ session, accentColor, featuredBook, userBooks, onAccentChange, onFeaturedChange, onClose, theme }) {
  const [localAccent,  setLocalAccent]  = useState(accentColor)
  const [localFeatured, setLocalFeatured] = useState(featuredBook)
  const [bookSearch,   setBookSearch]   = useState('')
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)

  // Filter user's collection by search query
  const bookOptions = userBooks
    .map(e => e.books)
    .filter(Boolean)
    .filter((b, idx, arr) => arr.findIndex(x => x.id === b.id) === idx) // deduplicate
    .filter(b => {
      if (!bookSearch.trim()) return true
      const q = bookSearch.toLowerCase()
      return b.title?.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q)
    })
    .slice(0, 8)

  function pickAccent(color) {
    setLocalAccent(color)
    onAccentChange(color)
  }

  async function handleSave() {
    setSaving(true)
    await supabase
      .from('profiles')
      .update({
        accent_color: localAccent,
        featured_book_id: localFeatured?.id ?? null,
      })
      .eq('id', session.user.id)
    onFeaturedChange(localFeatured)
    setSaving(false)
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 900)
  }

  async function removeFeatured() {
    setLocalFeatured(null)
    setBookSearch('')
  }

  const s = makeStyles(theme, localAccent)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.6)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div style={{ background: theme.bgCard, borderRadius: 18, padding: 28, maxWidth: 480, width: '100%', boxShadow: '0 20px 60px rgba(26,18,8,0.3)', position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 4 }}>Customize Profile</div>
        <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 24 }}>Personalize your hero section</div>

        {/* Accent color */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 }}>Accent Color</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {ACCENT_PRESETS.map(p => (
              <button
                key={p.color}
                title={p.name}
                onClick={() => pickAccent(p.color)}
                style={{
                  width: 34, height: 34, borderRadius: '50%', background: p.color,
                  border: localAccent === p.color ? `3px solid ${theme.text}` : '3px solid transparent',
                  cursor: 'pointer', padding: 0, outline: 'none',
                  boxShadow: localAccent === p.color ? `0 0 0 2px ${theme.bgCard}, 0 0 0 4px ${p.color}` : 'none',
                  transition: 'box-shadow 0.15s, border 0.15s',
                }}
              />
            ))}
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: localAccent, border: `1px solid ${theme.border}`, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: theme.textSubtle }}>{localAccent}</span>
          </div>
        </div>

        {/* Featured book */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Featured Book</div>
          {localFeatured ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: theme.bgSubtle, borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ width: 40, height: 56, borderRadius: 4, overflow: 'hidden', flexShrink: 0, boxShadow: `0 2px 8px ${localAccent}44` }}>
                {localFeatured.cover_image_url
                  ? <img src={localFeatured.cover_image_url} alt={localFeatured.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <FakeCover title={localFeatured.title} />
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{localFeatured.title}</div>
                <div style={{ fontSize: 12, color: theme.textSubtle }}>{localFeatured.author}</div>
              </div>
              <button
                onClick={removeFeatured}
                style={{ background: 'none', border: 'none', color: theme.textSubtle, cursor: 'pointer', fontSize: 13, padding: '2px 4px', fontFamily: "'DM Sans', sans-serif" }}
              >Remove</button>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 10, fontStyle: 'italic' }}>No featured book set.</div>
          )}

          <input
            type="text"
            placeholder="Search your library..."
            value={bookSearch}
            onChange={e => setBookSearch(e.target.value)}
            style={{ width: '100%', marginTop: 10, padding: '9px 12px', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.text, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', boxSizing: 'border-box' }}
          />

          {bookSearch.trim() && (
            <div style={{ marginTop: 6, background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
              {bookOptions.length === 0
                ? <div style={{ padding: '10px 14px', fontSize: 13, color: theme.textSubtle }}>No books found.</div>
                : bookOptions.map(b => (
                  <div
                    key={b.id}
                    onClick={() => { setLocalFeatured(b); setBookSearch('') }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', borderBottom: `1px solid ${theme.borderLight}` }}
                    onMouseEnter={e => e.currentTarget.style.background = theme.bgSubtle}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ width: 28, height: 40, borderRadius: 3, overflow: 'hidden', flexShrink: 0, background: theme.bgSubtle }}>
                      {b.cover_image_url
                        ? <img src={b.cover_image_url} alt={b.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <MiniCover title={b.title} />
                      }
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{b.title}</div>
                      <div style={{ fontSize: 11, color: theme.textSubtle }}>{b.author}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: '9px 22px', background: localAccent, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
          >
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, cursor: 'pointer', color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}
          >Cancel</button>
        </div>

        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', fontSize: 18, color: theme.textSubtle, cursor: 'pointer', lineHeight: 1 }}
        >✕</button>
      </div>
    </div>
  )
}

// ── SHELF HEADER ──
function ShelfHeader({ label, count, accent, theme }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <div style={{ width: 4, height: 22, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 19, fontWeight: 700, color: theme.text }}>{label}</div>
      <div style={{ background: theme.bgSubtle, color: theme.textSubtle, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 500 }}>{count}</div>
    </div>
  )
}

// ── SHELF CARD ──
function ShelfCard({ entry, onSelect, canBorrow, onBorrow, theme }) {
  const book  = entry.books
  const s     = makeStyles(theme)
  const [hover, setHover] = useState(false)

  return (
    <div
      style={{ ...s.shelfCard, ...(hover && onSelect ? s.shelfCardHover : {}), cursor: onSelect ? 'pointer' : 'default' }}
      onClick={onSelect}
      onTouchEnd={(e) => { e.preventDefault(); onSelect?.() }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.shelfCoverWrap}>
        {(() => {
          const url = getCoverUrl(book)
          return url
            ? <img src={url} alt={book.title} style={s.shelfCoverImg} onError={e => e.target.style.display='none'} />
            : <FakeCover title={book.title} />
        })()}
      </div>
      <div style={{ marginTop: 9 }}>
        <div style={s.shelfTitle}>{book.title}</div>
        <div style={s.shelfAuthor}>{book.author}</div>
        {entry.user_rating && (
          <div style={s.shelfStars}>
            {'★'.repeat(entry.user_rating)}{'☆'.repeat(5 - entry.user_rating)}
          </div>
        )}
        {canBorrow && (
          <button style={s.borrowBtn} onClick={e => { e.stopPropagation(); onBorrow() }}>
            Borrow
          </button>
        )}
      </div>
    </div>
  )
}

// ── REVIEW CARD ──
function ReviewCard({ entry, onBookClick, theme }) {
  const book = entry.books
  const s    = makeStyles(theme)
  return (
    <div style={s.reviewCard}>
      <div style={{ ...s.reviewCover, cursor: onBookClick ? 'pointer' : 'default' }} onClick={onBookClick}>
        {(() => {
          const url = getCoverUrl(book)
          return url
            ? <img src={url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} onError={e => e.target.style.display='none'} />
            : <MiniCover title={book.title} />
        })()}
      </div>
      <div style={s.reviewBody}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <div style={{ ...s.reviewBookTitle, cursor: onBookClick ? 'pointer' : 'default' }} onClick={onBookClick}>
            {book.title}
          </div>
          <div style={s.reviewBookAuthor}>{book.author}</div>
        </div>
        {entry.user_rating && (
          <div style={s.reviewStars}>{'★'.repeat(entry.user_rating)}{'☆'.repeat(5 - entry.user_rating)}</div>
        )}
        <div style={s.reviewQuote}>"{entry.review_text}"</div>
        <div style={s.reviewDate}>
          {new Date(entry.added_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
    </div>
  )
}

// ── FRIEND BUTTON ──
function FriendButton({ session, profile, theme }) {
  const s = makeStyles(theme)
  const [friendship, setFriendship] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [acting, setActing]         = useState(false)

  useEffect(() => { fetchFriendship() }, [profile.id])

  async function fetchFriendship() {
    const { data } = await supabase
      .from('friendships')
      .select('id, status, requester_id, addressee_id')
      .or(`and(requester_id.eq.${session.user.id},addressee_id.eq.${profile.id}),and(requester_id.eq.${profile.id},addressee_id.eq.${session.user.id})`)
      .maybeSingle()
    setFriendship(data || null)
    setLoading(false)
  }

  async function sendRequest() {
    setActing(true)
    const { data } = await supabase.from('friendships').insert({ requester_id: session.user.id, addressee_id: profile.id }).select().single()
    setFriendship(data)
    setActing(false)
  }

  async function cancelRequest() {
    setActing(true)
    await supabase.from('friendships').delete().eq('id', friendship.id)
    setFriendship(null)
    setActing(false)
  }

  async function respond(accept) {
    setActing(true)
    if (accept) {
      const { data } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendship.id).select().single()
      setFriendship(data)
    } else {
      await supabase.from('friendships').delete().eq('id', friendship.id)
      setFriendship(null)
    }
    setActing(false)
  }

  async function unfriend() {
    setActing(true)
    await supabase.from('friendships').delete().eq('id', friendship.id)
    setFriendship(null)
    setActing(false)
  }

  if (loading) return null
  const iAmRequester = friendship?.requester_id === session.user.id
  const iAmAddressee = friendship?.addressee_id === session.user.id

  if (!friendship) return (
    <button style={s.heroPrimaryBtn} onClick={sendRequest} disabled={acting}>
      {acting ? '…' : '+ Add Friend'}
    </button>
  )
  if (friendship.status === 'pending' && iAmRequester) return (
    <button style={s.heroGhostBtn} onClick={cancelRequest} disabled={acting} title="Click to cancel">
      {acting ? '…' : 'Request Sent ✓'}
    </button>
  )
  if (friendship.status === 'pending' && iAmAddressee) return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button style={s.heroPrimaryBtn} onClick={() => respond(true)} disabled={acting}>{acting ? '…' : 'Accept'}</button>
      <button style={s.heroGhostBtn}   onClick={() => respond(false)} disabled={acting}>{acting ? '…' : 'Decline'}</button>
    </div>
  )
  if (friendship.status === 'accepted') return (
    <button style={{ ...s.heroGhostBtn, color: '#a0d4a0', borderColor: 'rgba(160,212,160,0.4)' }}
      onClick={unfriend} disabled={acting} title="Click to unfriend">
      {acting ? '…' : 'Friends ✓'}
    </button>
  )
  return null
}

// ── BORROW MODAL ──
function BorrowModal({ session, entry, ownerId, onClose, theme }) {
  const s    = makeStyles(theme)
  const book = entry.books
  const [message, setMessage]       = useState('')
  const [dueDate, setDueDate]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)
  const [success, setSuccess]       = useState(false)

  async function submit() {
    setSubmitting(true)
    setError(null)
    const { error: err } = await supabase.from('borrow_requests').insert({
      requester_id: session.user.id, owner_id: ownerId, book_id: book.id,
      message: message.trim() || null, due_date: dueDate || null,
    })
    if (err) { setError('Could not send request. You may already have a pending request for this book.'); setSubmitting(false) }
    else { setSuccess(true); setSubmitting(false) }
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.borrowModal} onClick={e => e.stopPropagation()}>
        {success ? (
          <div style={{ padding: '36px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12, color: theme.sage }}>✓</div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 8 }}>Request sent!</div>
            <div style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 24 }}>You'll be notified when they respond.</div>
            <button style={s.btnPrimary} onClick={onClose}>Done</button>
          </div>
        ) : (
          <div style={{ padding: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text }}>Request to Borrow</div>
                <div style={{ fontSize: 14, color: theme.textSubtle, marginTop: 4 }}>{book.title}</div>
              </div>
              <button style={s.closeBtn} onClick={onClose}>✕</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={s.fieldLabel}>Message (optional)</label>
              <textarea style={s.textarea} placeholder="Say something to the owner…" value={message} onChange={e => setMessage(e.target.value)} rows={3} autoFocus />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={s.fieldLabel}>Return by (optional)</label>
              <input type="date" style={s.dateInput} value={dueDate} onChange={e => setDueDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
            </div>
            {error && <div style={{ color: theme.rust, fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={s.btnPrimary} onClick={submit} disabled={submitting}>{submitting ? 'Sending…' : 'Send Request'}</button>
              <button style={s.btnGhost} onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── FAKE COVERS ──
function FakeCover({ title }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const color  = colors[title.charCodeAt(0) % colors.length]
  const color2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return (
    <div style={{ width: '100%', height: '100%', borderRadius: 6, display: 'flex', alignItems: 'flex-end', padding: '8px 8px 8px 14px', position: 'relative', overflow: 'hidden', background: `linear-gradient(135deg, ${color}, ${color2})` }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, background: 'rgba(0,0,0,0.2)' }} />
      <span style={{ fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.5)', lineHeight: 1.3, position: 'relative', zIndex: 1 }}>{title}</span>
    </div>
  )
}

function MiniCover({ title }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const color  = colors[title.charCodeAt(0) % colors.length]
  const color2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return <div style={{ width: '100%', height: '100%', borderRadius: 4, background: `linear-gradient(135deg, ${color}, ${color2})` }} />
}

// ── STYLES ──
function makeStyles(theme, accentColor = '#c0521e', isMobile = false) {
  return {
    page:        { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    loadingMsg:  { color: theme.textSubtle, fontSize: 14, padding: '80px 0', textAlign: 'center' },

    // Hero — always dark, hero text stays light regardless of theme
    hero:        { background: theme.heroBg, borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'relative', overflow: 'hidden' },
    heroInner:   { maxWidth: 960, margin: '0 auto', padding: isMobile ? '24px 16px' : '36px 32px', display: 'flex', alignItems: isMobile ? 'center' : 'flex-start', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 24, textAlign: isMobile ? 'center' : 'left' },
    heroAvatar:  { width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', display: 'block', border: '3px solid rgba(255,255,255,0.15)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' },
    heroAvatarFallback: { width: 88, height: 88, borderRadius: '50%', background: `linear-gradient(135deg, ${accentColor}, #b8860b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontSize: 34, color: 'white', fontWeight: 700, border: '3px solid rgba(255,255,255,0.15)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', flexShrink: 0 },
    avatarEditBtn: { position: 'absolute', bottom: 2, right: 2, width: 24, height: 24, borderRadius: '50%', background: accentColor, border: '2px solid #1e140a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', padding: 0 },
    heroInfo:    { flex: 1, paddingTop: 4 },
    heroName:    { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, color: '#fdf8f0', marginBottom: 6, letterSpacing: '-0.3px' },
    heroBio:     { fontSize: 14, color: 'rgba(253,248,240,0.65)', lineHeight: 1.55, marginBottom: 10, maxWidth: 480 },
    heroStatRow: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8, justifyContent: isMobile ? 'center' : 'flex-start' },
    heroStat:    { fontSize: 13, color: 'rgba(253,248,240,0.75)' },
    heroDot:     { fontSize: 13, color: 'rgba(253,248,240,0.3)' },
    heroMeta:        { fontSize: 12, color: 'rgba(253,248,240,0.35)' },
    heroFriendsLink: { fontSize: 12, color: 'rgba(253,248,240,0.5)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    heroPrimaryBtn:  { padding: '8px 18px', background: accentColor, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    heroGhostBtn:    { padding: '7px 14px', background: 'transparent', border: '1px solid rgba(253,248,240,0.25)', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: 'rgba(253,248,240,0.7)' },
    heroSignOutBtn:  { padding: '5px 12px', background: 'transparent', border: '1px solid rgba(253,248,240,0.15)', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: 'rgba(253,248,240,0.35)' },
    editProfileBtn: { marginTop: 10, padding: '6px 14px', background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

    // Reading goal — lives on the hero, so stays light always
    goalSetBtn:      { background: 'transparent', border: '1px dashed rgba(253,248,240,0.3)', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: 'rgba(253,248,240,0.65)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    goalInputRow:    { display: 'flex', alignItems: 'center', gap: 6 },
    goalInput:       { width: 72, padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(253,248,240,0.3)', background: 'rgba(255,255,255,0.12)', color: '#fdf8f0', fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none' },
    goalSaveBtn:     { padding: '5px 12px', background: accentColor, color: 'white', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    goalCancelBtn:   { background: 'transparent', border: 'none', color: 'rgba(253,248,240,0.4)', fontSize: 14, cursor: 'pointer', padding: '4px 6px', lineHeight: 1 },
    goalDisplay:     { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    goalProgressWrap:{ width: 160, height: 7, background: 'rgba(245,240,232,0.15)', borderRadius: 20, overflow: 'hidden', flexShrink: 0 },
    goalProgressFill:{ height: '100%', background: accentColor, borderRadius: 20, minWidth: 4, transition: 'width 0.5s ease' },
    goalText:        { fontSize: 12, color: 'rgba(253,248,240,0.7)' },
    goalPct:         { color: 'rgba(253,248,240,0.45)' },
    goalEditBtn:     { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 4px', opacity: 0.6, lineHeight: 1 },

    // Badges strip — directly below hero, still dark
    badgesSection:      { background: 'rgba(26,18,8,0.35)', borderBottom: '1px solid rgba(255,255,255,0.05)' },
    badgesSectionInner: { maxWidth: 960, margin: '0 auto', padding: isMobile ? '16px 16px' : '20px 32px' },
    badgesHeadRow:      { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 },
    badgesTitle:        { fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 700, color: 'rgba(253,248,240,0.85)' },
    badgesEarned:       { fontSize: 11, color: 'rgba(253,248,240,0.45)', background: 'rgba(255,255,255,0.08)', padding: '2px 10px', borderRadius: 20 },
    badgeCatLabel:      { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(253,248,240,0.35)', marginBottom: 8 },
    badgeGrid:          { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 },
    badgeCard:          { borderRadius: 10, border: '1px solid', padding: '12px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center', transition: 'opacity 0.2s' },
    badgeEmoji:         { fontSize: 28, lineHeight: 1, marginBottom: 2 },
    badgeCardName:      { fontSize: 12, fontWeight: 700, color: 'rgba(253,248,240,0.85)', lineHeight: 1.2 },
    badgeCardDesc:      { fontSize: 10, color: 'rgba(253,248,240,0.45)', lineHeight: 1.3 },
    badgeTierPill:      { marginTop: 4, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 8px', borderRadius: 20 },
    badgeProgressWrap:  { marginTop: 4, width: '100%' },
    badgeProgressBg:    { height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden', marginBottom: 3 },
    badgeProgressFill:  { height: '100%', borderRadius: 2, transition: 'width 0.4s' },
    badgeProgressLabel: { fontSize: 9, color: 'rgba(253,248,240,0.35)' },

    // Content
    content:     { maxWidth: 960, margin: '0 auto', padding: isMobile ? '16px' : '36px 32px' },
    section:     { marginBottom: 40 },
    emptyShelf:  { color: theme.textSubtle, fontSize: 14, padding: '60px 0', textAlign: 'center' },

    // Shelf
    shelf:       { display: 'flex', gap: 18, overflowX: 'auto', paddingBottom: 12, scrollbarWidth: 'thin', scrollbarColor: `${theme.border} transparent` },
    shelfCard:   { flexShrink: 0, width: 120, transition: 'transform 0.15s' },
    shelfCardHover: { transform: 'translateY(-3px)' },
    shelfCoverWrap: { width: 120, height: 180, borderRadius: 6, overflow: 'hidden', boxShadow: theme.shadowCard },
    shelfCoverImg:  { width: '100%', height: '100%', objectFit: 'cover' },
    shelfTitle:  { fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.3, marginTop: 2 },
    shelfAuthor: { fontSize: 11, color: theme.textSubtle, marginTop: 2 },
    shelfStars:  { fontSize: 10, color: theme.gold, letterSpacing: 0.5, marginTop: 4 },

    // Reviews
    reviewsList: { display: 'flex', flexDirection: 'column', gap: 20 },
    reviewCard:  { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 22px', display: 'flex', gap: 18 },
    reviewCover: { width: 56, height: 84, flexShrink: 0, borderRadius: 5, overflow: 'hidden', background: theme.bgSubtle },
    reviewBody:  { flex: 1 },
    reviewBookTitle:  { fontSize: 15, fontWeight: 700, color: theme.text, lineHeight: 1.3 },
    reviewBookAuthor: { fontSize: 13, color: theme.textSubtle },
    reviewStars: { fontSize: 13, color: theme.gold, letterSpacing: 1, margin: '6px 0' },
    reviewQuote: { fontSize: 14, color: theme.text, lineHeight: 1.65, fontStyle: 'italic', borderLeft: `3px solid ${theme.bgSubtle}`, paddingLeft: 12, marginTop: 4 },
    reviewDate:  { fontSize: 12, color: theme.textSubtle, marginTop: 10 },

    // Not found / private
    notFoundBox:   { maxWidth: 400, margin: '80px auto', textAlign: 'center', padding: '0 32px' },
    notFoundTitle: { fontFamily: 'Georgia, serif', fontSize: 20, color: theme.text, marginBottom: 8 },
    notFoundSub:   { color: theme.textSubtle, marginBottom: 24, fontSize: 14 },
    privateBox:    { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: '60px 32px', textAlign: 'center' },
    privateTitle:  { fontFamily: 'Georgia, serif', fontSize: 18, color: theme.text, marginBottom: 8 },
    privateSub:    { color: theme.textSubtle, fontSize: 14 },

    // Buttons / shared
    btnPrimary:  { padding: '8px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:    { padding: '6px 12px', background: 'none', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.text },
    borrowBtn:   { display: 'block', marginTop: 8, padding: '4px 10px', fontSize: 11, background: 'transparent', border: `1px solid ${theme.sage}`, borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.sage, fontWeight: 500 },
    overlay:     { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    borrowModal: { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 420, maxWidth: '92vw' },
    closeBtn:    { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4, flexShrink: 0 },
    fieldLabel:  { display: 'block', fontSize: 11, fontWeight: 600, color: theme.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    textarea:    { width: '100%', padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    dateInput:   { width: '100%', padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
  }
}

// ── CLEAR BOOKS MODAL ──────────────────────────────────────────────────────
function ClearBooksModal({ session, theme, onClose, onCleared }) {
  const [count,      setCount]      = useState(null)   // fetched fresh on open
  const [confirming, setConfirming] = useState(false)
  const [done,       setDone]       = useState(false)

  // Fetch the real count when modal opens
  useEffect(() => {
    supabase
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.user.id)
      .then(({ count: c }) => setCount(c ?? 0))
  }, [])

  async function handleClear() {
    setConfirming(true)
    await supabase
      .from('collection_entries')
      .delete()
      .eq('user_id', session.user.id)
    // Prevent the empty-library onboarding redirect
    localStorage.setItem('exlibris-onboarded', '1')
    setConfirming(false)
    setDone(true)
    window.dispatchEvent(new CustomEvent('exlibris:bookRemoved'))
    setTimeout(onCleared, 1400)
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const box     = { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 420, maxWidth: '92vw', padding: '28px 28px 24px' }
  const countLabel = count === null ? '…' : `${count} book${count !== 1 ? 's' : ''}`

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={box}>
        {done ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text }}>Library cleared</div>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 8 }}>
              Clear your library?
            </div>
            <div style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 24, lineHeight: 1.6 }}>
              This will remove all <strong style={{ color: theme.text }}>{countLabel}</strong> from your collection.
              Your account, reviews, and friends will be kept. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '9px 18px', background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 9, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textSubtle }}>
                Cancel
              </button>
              <button onClick={handleClear} disabled={confirming || count === null} style={{ padding: '9px 20px', background: '#c0521e', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 600, color: 'white', cursor: confirming || count === null ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                {confirming ? 'Clearing…' : `Yes, clear ${countLabel}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── DELETE ACCOUNT MODAL ───────────────────────────────────────────────────
function DeleteAccountModal({ session, theme, onClose }) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting,    setDeleting]    = useState(false)
  const [error,       setError]       = useState('')
  const ready = confirmText.trim().toUpperCase() === 'DELETE'

  async function handleDelete() {
    if (!ready) return
    setDeleting(true)
    setError('')
    try {
      const { error: err } = await supabase.rpc('delete_user_account')
      if (err) throw err
      await supabase.auth.signOut()
    } catch (e) {
      setError('Something went wrong. Please try again or contact support.')
      setDeleting(false)
    }
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.65)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const box     = { background: theme.bgCard, border: '1px solid rgba(192,82,30,0.3)', borderRadius: 16, width: 440, maxWidth: '92vw', padding: '28px 28px 24px' }

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && !deleting && onClose()}>
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 28 }}>⚠️</span>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: '#c0521e' }}>Delete account</div>
        </div>
        <div style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 8, lineHeight: 1.65 }}>
          This will <strong style={{ color: theme.text }}>permanently delete</strong> your account and all associated data including:
        </div>
        <ul style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 20, paddingLeft: 18, lineHeight: 2 }}>
          <li>Your entire book collection</li>
          <li>Reviews, ratings &amp; journal entries</li>
          <li>Friends &amp; friend requests</li>
          <li>Marketplace listings &amp; orders</li>
          <li>All profile data</li>
        </ul>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
          Type <span style={{ fontFamily: 'monospace', background: 'rgba(192,82,30,0.1)', padding: '1px 6px', borderRadius: 4, color: '#c0521e' }}>DELETE</span> to confirm:
        </div>
        <input
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder="DELETE"
          disabled={deleting}
          style={{ width: '100%', padding: '10px 14px', border: `2px solid ${ready ? '#c0521e' : theme.border}`, borderRadius: 9, fontSize: 15, fontFamily: 'monospace', outline: 'none', background: theme.bgCard, color: theme.text, marginBottom: 16, boxSizing: 'border-box', transition: 'border-color 0.15s' }}
        />
        {error && <div style={{ fontSize: 13, color: '#c0521e', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={deleting} style={{ padding: '9px 18px', background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 9, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textSubtle }}>
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!ready || deleting}
            style={{ padding: '9px 20px', background: ready ? '#c0521e' : '#ccc', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 600, color: 'white', cursor: ready && !deleting ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans', sans-serif", transition: 'background 0.15s' }}
          >
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </div>
    </div>
  )
}

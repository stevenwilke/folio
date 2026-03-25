import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BookDetail from './BookDetail'
import NavBar from '../components/NavBar'

const STATUS_COLORS = {
  owned:   { bg: 'rgba(138,127,114,0.15)', color: '#8a7f72' },
  read:    { bg: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
  reading: { bg: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
  want:    { bg: 'rgba(184,134,11,0.12)',  color: '#b8860b' },
}

export default function Profile({ session }) {
  const { username } = useParams()
  const navigate = useNavigate()
  const [profile, setProfile]             = useState(null)
  const [books, setBooks]                 = useState([])
  const [loading, setLoading]             = useState(true)
  const [notFound, setNotFound]           = useState(false)
  const [selectedBook, setSelectedBook]   = useState(null)
  const [isFriend, setIsFriend]           = useState(false)
  const [borrowTarget, setBorrowTarget]   = useState(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef(null)

  const isOwnProfile = session?.user?.id === profile?.id

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
      .select('id, username, bio, is_public, created_at, avatar_url')
      .eq('username', username)
      .maybeSingle()

    if (!prof) { setNotFound(true); setLoading(false); return }
    setProfile(prof)

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
      .select('id, read_status, user_rating, review_text, added_at, books(id, title, author, cover_image_url, genre, published_year)')
      .eq('user_id', prof.id)
      .order('added_at', { ascending: false })

    setBooks(entries || [])
    setLoading(false)
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
          {session ? 'Go to My Library' : 'Go to Folio'}
        </button>
      </div>
    </div>
  )

  const isPrivate = !profile.is_public && !isOwnProfile

  return (
    <div style={s.page}>
      <NavBar session={session} />

      {/* ── HERO ── */}
      <div style={s.hero}>
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

            {joinDate && <div style={s.heroMeta}>Member since {joinDate}</div>}
          </div>

          {/* Action */}
          {isOwnProfile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
              <button style={s.heroGhostBtn} onClick={() => navigate('/')}>← My Library</button>
              <button style={s.heroSignOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          ) : (
            session && <div style={{ flexShrink: 0 }}><FriendButton session={session} profile={profile} /></div>
          )}
        </div>
      </div>

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

          {/* Currently Reading */}
          {reading.length > 0 && (
            <section style={s.section}>
              <ShelfHeader label="Currently Reading" count={reading.length} accent="#c0521e" />
              <div style={s.shelf}>
                {reading.map(entry => (
                  <ShelfCard key={entry.id} entry={entry}
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
              <ShelfHeader label="Read" count={read.length} accent="#5a7a5a" />
              <div style={s.shelf}>
                {read.map(entry => (
                  <ShelfCard key={entry.id} entry={entry}
                    onSelect={session ? () => setSelectedBook(entry.books.id) : undefined}
                    canBorrow={false} onBorrow={() => {}} />
                ))}
              </div>
            </section>
          )}

          {/* Want to Read */}
          {want.length > 0 && (
            <section style={s.section}>
              <ShelfHeader label="Want to Read" count={want.length} accent="#b8860b" />
              <div style={s.shelf}>
                {want.map(entry => (
                  <ShelfCard key={entry.id} entry={entry}
                    onSelect={session ? () => setSelectedBook(entry.books.id) : undefined}
                    canBorrow={false} onBorrow={() => {}} />
                ))}
              </div>
            </section>
          )}

          {/* In Library */}
          {owned.length > 0 && (
            <section style={s.section}>
              <ShelfHeader label="In Library" count={owned.length} accent="#8a7f72" />
              <div style={s.shelf}>
                {owned.map(entry => (
                  <ShelfCard key={entry.id} entry={entry}
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
              <ShelfHeader label={`Reviews by ${profile.username}`} count={reviews.length} accent="#c0521e" />
              <div style={s.reviewsList}>
                {reviews.map(entry => (
                  <ReviewCard key={entry.id} entry={entry}
                    onBookClick={session ? () => setSelectedBook(entry.books.id) : undefined} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Borrow modal */}
      {borrowTarget && session && profile && (
        <BorrowModal session={session} entry={borrowTarget} ownerId={profile.id} onClose={() => setBorrowTarget(null)} />
      )}

      {/* Book detail overlay */}
      {selectedBook && session && (
        <div style={{ position: 'fixed', inset: 0, background: '#f5f0e8', zIndex: 40, overflowY: 'auto', isolation: 'isolate' }}>
          <BookDetail bookId={selectedBook} session={session} onBack={() => setSelectedBook(null)} />
        </div>
      )}
    </div>
  )
}

// ── SHELF HEADER ──
function ShelfHeader({ label, count, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <div style={{ width: 4, height: 22, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 19, fontWeight: 700, color: '#1a1208' }}>{label}</div>
      <div style={{ background: 'rgba(26,18,8,0.06)', color: '#8a7f72', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 500 }}>{count}</div>
    </div>
  )
}

// ── SHELF CARD ──
function ShelfCard({ entry, onSelect, canBorrow, onBorrow }) {
  const book  = entry.books
  const [hover, setHover] = useState(false)

  return (
    <div
      style={{ ...s.shelfCard, ...(hover && onSelect ? s.shelfCardHover : {}), cursor: onSelect ? 'pointer' : 'default' }}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.shelfCoverWrap}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={s.shelfCoverImg} />
          : <FakeCover title={book.title} />
        }
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
function ReviewCard({ entry, onBookClick }) {
  const book = entry.books
  return (
    <div style={s.reviewCard}>
      <div style={{ ...s.reviewCover, cursor: onBookClick ? 'pointer' : 'default' }} onClick={onBookClick}>
        {book.cover_image_url
          ? <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
          : <MiniCover title={book.title} />
        }
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
function FriendButton({ session, profile }) {
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
function BorrowModal({ session, entry, ownerId, onClose }) {
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
            <div style={{ fontSize: 40, marginBottom: 12, color: '#5a7a5a' }}>✓</div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: '#1a1208', marginBottom: 8 }}>Request sent!</div>
            <div style={{ fontSize: 14, color: '#8a7f72', marginBottom: 24 }}>You'll be notified when they respond.</div>
            <button style={s.btnPrimary} onClick={onClose}>Done</button>
          </div>
        ) : (
          <div style={{ padding: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: '#1a1208' }}>Request to Borrow</div>
                <div style={{ fontSize: 14, color: '#8a7f72', marginTop: 4 }}>{book.title}</div>
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
            {error && <div style={{ color: '#c0521e', fontSize: 13, marginBottom: 12 }}>{error}</div>}
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
    <div style={{ ...s.fakeCover, background: `linear-gradient(135deg, ${color}, ${color2})` }}>
      <div style={s.fakeSpine} />
      <span style={s.fakeCoverText}>{title}</span>
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
const s = {
  page:        { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif" },
  loadingMsg:  { color: '#8a7f72', fontSize: 14, padding: '80px 0', textAlign: 'center' },

  // Hero
  hero:        { background: 'linear-gradient(160deg, #1e140a 0%, #2e1f10 60%, #3a2818 100%)', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  heroInner:   { maxWidth: 960, margin: '0 auto', padding: '36px 32px', display: 'flex', alignItems: 'flex-start', gap: 24 },
  heroAvatar:  { width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', display: 'block', border: '3px solid rgba(255,255,255,0.15)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' },
  heroAvatarFallback: { width: 88, height: 88, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontSize: 34, color: 'white', fontWeight: 700, border: '3px solid rgba(255,255,255,0.15)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', flexShrink: 0 },
  avatarEditBtn: { position: 'absolute', bottom: 2, right: 2, width: 24, height: 24, borderRadius: '50%', background: '#c0521e', border: '2px solid #1e140a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', padding: 0 },
  heroInfo:    { flex: 1, paddingTop: 4 },
  heroName:    { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, color: '#fdf8f0', marginBottom: 6, letterSpacing: '-0.3px' },
  heroBio:     { fontSize: 14, color: 'rgba(253,248,240,0.65)', lineHeight: 1.55, marginBottom: 10, maxWidth: 480 },
  heroStatRow: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 },
  heroStat:    { fontSize: 13, color: 'rgba(253,248,240,0.75)' },
  heroDot:     { fontSize: 13, color: 'rgba(253,248,240,0.3)' },
  heroMeta:    { fontSize: 12, color: 'rgba(253,248,240,0.35)', marginTop: 4 },
  heroPrimaryBtn:  { padding: '8px 18px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  heroGhostBtn:    { padding: '7px 14px', background: 'transparent', border: '1px solid rgba(253,248,240,0.25)', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: 'rgba(253,248,240,0.7)' },
  heroSignOutBtn:  { padding: '5px 12px', background: 'transparent', border: '1px solid rgba(253,248,240,0.15)', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: 'rgba(253,248,240,0.35)' },

  // Content
  content:     { maxWidth: 960, margin: '0 auto', padding: '36px 32px' },
  section:     { marginBottom: 40 },
  emptyShelf:  { color: '#8a7f72', fontSize: 14, padding: '60px 0', textAlign: 'center' },

  // Shelf
  shelf:       { display: 'flex', gap: 18, overflowX: 'auto', paddingBottom: 12, scrollbarWidth: 'thin', scrollbarColor: '#d4c9b0 transparent' },
  shelfCard:   { flexShrink: 0, width: 120, transition: 'transform 0.15s' },
  shelfCardHover: { transform: 'translateY(-3px)' },
  shelfCoverWrap: { width: 120, height: 180, borderRadius: 6, overflow: 'hidden', boxShadow: '2px 4px 12px rgba(26,18,8,0.2)' },
  shelfCoverImg:  { width: '100%', height: '100%', objectFit: 'cover' },
  shelfTitle:  { fontSize: 12, fontWeight: 600, color: '#1a1208', lineHeight: 1.3, marginTop: 2 },
  shelfAuthor: { fontSize: 11, color: '#8a7f72', marginTop: 2 },
  shelfStars:  { fontSize: 10, color: '#b8860b', letterSpacing: 0.5, marginTop: 4 },
  fakeCover:   { width: '100%', height: '100%', borderRadius: 6, display: 'flex', alignItems: 'flex-end', padding: '8px 8px 8px 14px', position: 'relative', overflow: 'hidden' },
  fakeSpine:   { position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, background: 'rgba(0,0,0,0.2)' },
  fakeCoverText: { fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.5)', lineHeight: 1.3, position: 'relative', zIndex: 1 },

  // Reviews
  reviewsList: { display: 'flex', flexDirection: 'column', gap: 20 },
  reviewCard:  { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 14, padding: '20px 22px', display: 'flex', gap: 18 },
  reviewCover: { width: 56, height: 84, flexShrink: 0, borderRadius: 5, overflow: 'hidden', background: '#e8dfc8' },
  reviewBody:  { flex: 1 },
  reviewBookTitle:  { fontSize: 15, fontWeight: 700, color: '#1a1208', lineHeight: 1.3 },
  reviewBookAuthor: { fontSize: 13, color: '#8a7f72' },
  reviewStars: { fontSize: 13, color: '#b8860b', letterSpacing: 1, margin: '6px 0' },
  reviewQuote: { fontSize: 14, color: '#3a3028', lineHeight: 1.65, fontStyle: 'italic', borderLeft: '3px solid #e8dfc8', paddingLeft: 12, marginTop: 4 },
  reviewDate:  { fontSize: 12, color: '#b0a898', marginTop: 10 },

  // Not found / private
  notFoundBox:   { maxWidth: 400, margin: '80px auto', textAlign: 'center', padding: '0 32px' },
  notFoundTitle: { fontFamily: 'Georgia, serif', fontSize: 20, color: '#1a1208', marginBottom: 8 },
  notFoundSub:   { color: '#8a7f72', marginBottom: 24, fontSize: 14 },
  privateBox:    { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, padding: '60px 32px', textAlign: 'center' },
  privateTitle:  { fontFamily: 'Georgia, serif', fontSize: 18, color: '#1a1208', marginBottom: 8 },
  privateSub:    { color: '#8a7f72', fontSize: 14 },

  // Buttons / shared
  btnPrimary:  { padding: '8px 16px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnGhost:    { padding: '6px 12px', background: 'none', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#3a3028' },
  borrowBtn:   { display: 'block', marginTop: 8, padding: '4px 10px', fontSize: 11, background: 'transparent', border: '1px solid #5a7a5a', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#5a7a5a', fontWeight: 500 },
  overlay:     { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  borrowModal: { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, width: 420, maxWidth: '92vw' },
  closeBtn:    { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#8a7f72', padding: 4, flexShrink: 0 },
  fieldLabel:  { display: 'block', fontSize: 11, fontWeight: 600, color: '#3a3028', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  textarea:    { width: '100%', padding: '10px 12px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: 'white', color: '#1a1208', boxSizing: 'border-box' },
  dateInput:   { width: '100%', padding: '9px 12px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: 'white', color: '#1a1208', boxSizing: 'border-box' },
}

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'
import { enrichBook } from '../lib/enrichBook'

const STATUS_LABELS = {
  owned:   'In Library',
  read:    'Read',
  reading: 'Reading',
  want:    'Want to Read',
}
const STATUS_COLORS = {
  owned:   { bg: 'rgba(138,127,114,0.15)', color: '#8a7f72' },
  read:    { bg: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
  reading: { bg: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
  want:    { bg: 'rgba(184,134,11,0.12)',  color: '#b8860b' },
}
const POST_TYPE_LABELS = {
  update:       { label: 'Update',       emoji: '📝', color: '#5a7a5a' },
  giveaway:     { label: 'Giveaway',     emoji: '🎁', color: '#b8860b' },
  announcement: { label: 'Announcement', emoji: '📣', color: '#c0521e' },
  new_book:     { label: 'New Book',     emoji: '📚', color: '#7b5ea8' },
}

export default function Author({ session }) {
  const { authorName } = useParams()
  const navigate        = useNavigate()
  const { theme }       = useTheme()

  const decoded = decodeURIComponent(authorName)

  // Books
  const [folioBooks,  setFolioBooks]  = useState([])
  const [olBooks,     setOlBooks]     = useState([])
  const [myEntries,   setMyEntries]   = useState({})
  const [friendData,  setFriendData]  = useState({})
  const [friendCount, setFriendCount] = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [addTarget,   setAddTarget]   = useState(null)

  // Author record & bio
  const [authorRecord, setAuthorRecord] = useState(null)
  const [bio,          setBio]          = useState(null)
  const [olPhoto,      setOlPhoto]      = useState(null)

  // Follow / favorite
  const [followed,     setFollowed]     = useState(false)
  const [isFavorite,   setIsFavorite]   = useState(false)
  const [followCount,  setFollowCount]  = useState(0)
  const [followId,     setFollowId]     = useState(null)
  const [toggling,     setToggling]     = useState(false)

  // Posts
  const [posts,       setPosts]       = useState([])
  const [showPostForm,setShowPostForm]= useState(false)
  const [postType,    setPostType]    = useState('update')
  const [postTitle,   setPostTitle]   = useState('')
  const [postContent, setPostContent] = useState('')
  const [postLink,    setPostLink]    = useState('')
  const [posting,     setPosting]     = useState(false)

  // Claim
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [myClaim,        setMyClaim]        = useState(null)
  const [claimMsg,       setClaimMsg]       = useState('')
  const [claimProof,     setClaimProof]     = useState('')
  const [claiming,       setClaiming]       = useState(false)

  useEffect(() => { loadAll() }, [authorName])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadBooks(), loadAuthorRecord()])
    setLoading(false)
  }

  // ── Author record (upsert by name) ────────────────────────────────────────
  async function loadAuthorRecord() {
    // Upsert author by name
    const { data: existing } = await supabase
      .from('authors')
      .select('*')
      .ilike('name', decoded)
      .maybeSingle()

    let record = existing
    if (!record) {
      const { data: inserted } = await supabase
        .from('authors')
        .insert({ name: decoded })
        .select('*')
        .single()
      record = inserted
    }
    if (!record) return
    setAuthorRecord(record)

    // Follow count
    const { count } = await supabase
      .from('author_follows')
      .select('*', { count: 'exact', head: true })
      .eq('author_id', record.id)
    setFollowCount(count ?? 0)

    // My follow status
    if (session) {
      const { data: myFollow } = await supabase
        .from('author_follows')
        .select('id, is_favorite')
        .eq('author_id', record.id)
        .eq('user_id', session.user.id)
        .maybeSingle()
      setFollowed(!!myFollow)
      setIsFavorite(myFollow?.is_favorite ?? false)
      setFollowId(myFollow?.id ?? null)

      // My claim
      const { data: claim } = await supabase
        .from('author_claims')
        .select('*')
        .eq('author_id', record.id)
        .eq('user_id', session.user.id)
        .maybeSingle()
      setMyClaim(claim)
    }

    // Posts
    const { data: postsData } = await supabase
      .from('author_posts')
      .select('*')
      .eq('author_id', record.id)
      .order('created_at', { ascending: false })
    setPosts(postsData || [])

    // Bio from OL if not stored
    if (!record.bio) fetchOLBio(decoded)
    else setBio(record.bio)
    if (record.photo_url) setOlPhoto(record.photo_url)
  }

  async function fetchOLBio(name) {
    try {
      const r = await fetch(
        `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(name)}&limit=1`
      )
      const j = await r.json()
      const olid = j.docs?.[0]?.key
      if (!olid) return
      const r2 = await fetch(`https://openlibrary.org/authors/${olid}.json`)
      const j2 = await r2.json()
      const bioRaw = j2.bio
      const bioText = typeof bioRaw === 'string' ? bioRaw : bioRaw?.value ?? null
      if (bioText) setBio(bioText.slice(0, 600))
      const photoId = j2.photos?.[0]
      if (photoId && photoId > 0) {
        setOlPhoto(`https://covers.openlibrary.org/a/id/${photoId}-L.jpg`)
      }
    } catch {}
  }

  // ── Books ─────────────────────────────────────────────────────────────────
  async function loadBooks() {
    const [folioRes, olRes] = await Promise.all([
      supabase
        .from('books')
        .select('*')
        .ilike('author', `%${decoded}%`)
        .order('published_year', { ascending: false }),
      fetch(`https://openlibrary.org/search.json?author=${encodeURIComponent(decoded)}&limit=20`)
        .then(r => r.ok ? r.json() : { docs: [] })
        .catch(() => ({ docs: [] })),
    ])

    const folio = folioRes.data || []
    setFolioBooks(folio)

    const folioIsbnSet = new Set()
    const folioTitleSet = new Set()
    for (const b of folio) {
      if (b.isbn_13) folioIsbnSet.add(b.isbn_13)
      if (b.isbn_10) folioIsbnSet.add(b.isbn_10)
      folioTitleSet.add(b.title?.toLowerCase().trim())
    }

    const extras = (olRes.docs || [])
      .filter(doc => {
        const isbn13 = doc.isbn?.find(i => i.length === 13)
        const isbn10 = doc.isbn?.find(i => i.length === 10)
        if (isbn13 && folioIsbnSet.has(isbn13)) return false
        if (isbn10 && folioIsbnSet.has(isbn10)) return false
        if (folioTitleSet.has(doc.title?.toLowerCase().trim())) return false
        return true
      })
      .slice(0, 12)
      .map(doc => ({
        key: doc.key, title: doc.title,
        author: doc.author_name?.[0] || decoded,
        year: doc.first_publish_year || null,
        isbn13: doc.isbn?.find(i => i.length === 13) || null,
        isbn10: doc.isbn?.find(i => i.length === 10) || null,
        coverId: doc.cover_i || null,
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
        genre: doc.subject?.[0] || null,
        source: 'openlibrary',
      }))
    setOlBooks(extras)

    if (session && folio.length > 0) {
      const bookIds = folio.map(b => b.id)
      const { data: entries } = await supabase
        .from('collection_entries')
        .select('book_id, read_status, user_rating')
        .eq('user_id', session.user.id)
        .in('book_id', bookIds)
      const map = {}
      for (const e of entries || []) map[e.book_id] = e
      setMyEntries(map)
      await loadFriendData(bookIds)
    }
  }

  async function loadFriendData(bookIds) {
    if (!session) return
    const { data: fs } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
    const friendIds = (fs || []).map(f =>
      f.requester_id === session.user.id ? f.addressee_id : f.requester_id
    )
    if (!friendIds.length) return
    const { data: friendEntries } = await supabase
      .from('collection_entries')
      .select('user_id, book_id, read_status, profiles(username, avatar_url)')
      .in('user_id', friendIds)
      .in('book_id', bookIds)
    const byBook = {}
    const allFriendIds = new Set()
    for (const e of friendEntries || []) {
      if (!byBook[e.book_id]) byBook[e.book_id] = []
      byBook[e.book_id].push({ username: e.profiles?.username, status: e.read_status })
      allFriendIds.add(e.user_id)
    }
    setFriendData(byBook)
    setFriendCount(allFriendIds.size)
  }

  // ── Follow / Favorite ────────────────────────────────────────────────────
  async function toggleFollow() {
    if (!session || !authorRecord) return
    setToggling(true)
    if (followed) {
      await supabase.from('author_follows').delete().eq('id', followId)
      setFollowed(false); setIsFavorite(false); setFollowId(null)
      setFollowCount(c => c - 1)
    } else {
      const { data } = await supabase
        .from('author_follows')
        .insert({ user_id: session.user.id, author_id: authorRecord.id, is_favorite: false })
        .select('id')
        .single()
      setFollowed(true); setFollowId(data?.id ?? null)
      setFollowCount(c => c + 1)
    }
    setToggling(false)
  }

  async function toggleFavorite() {
    if (!session || !authorRecord || !followed) return
    setToggling(true)
    const next = !isFavorite
    await supabase.from('author_follows').update({ is_favorite: next }).eq('id', followId)
    setIsFavorite(next)
    setToggling(false)
  }

  // ── Add OL book ──────────────────────────────────────────────────────────
  async function addOlBook(book, status) {
    setAddTarget(book.key)
    const { data: existing } = await supabase
      .from('books')
      .select('id')
      .or([
        book.isbn13 ? `isbn_13.eq.${book.isbn13}` : null,
        book.isbn10 ? `isbn_10.eq.${book.isbn10}` : null,
      ].filter(Boolean).join(',') || `title.ilike.${book.title}`)
      .maybeSingle()
    let bookId = existing?.id
    if (!bookId) {
      const { data: inserted } = await supabase
        .from('books')
        .insert({ title: book.title, author: book.author, isbn_13: book.isbn13 || null, isbn_10: book.isbn10 || null, genre: book.genre || null, published_year: book.year || null, cover_image_url: book.coverUrl })
        .select('id').single()
      bookId = inserted?.id
    }
    if (bookId) {
      enrichBook(bookId, { isbn_13: book.isbn13 || null, isbn_10: book.isbn10 || null, title: book.title, author: book.author, cover_image_url: book.coverUrl || null, description: null })
      await supabase.from('collection_entries').upsert({ user_id: session.user.id, book_id: bookId, read_status: status }, { onConflict: 'user_id,book_id' })
      window.dispatchEvent(new CustomEvent('exlibris:bookAdded'))
      loadAll()
    }
    setAddTarget(null)
  }

  // ── Claim ────────────────────────────────────────────────────────────────
  const [claimAgreed, setClaimAgreed] = useState(false)
  const [showFriendList, setShowFriendList] = useState(false)

  async function submitClaim() {
    if (!session || !authorRecord || !claimMsg.trim() || !claimProof.trim() || !claimAgreed) return
    setClaiming(true)
    const { data } = await supabase
      .from('author_claims')
      .insert({ author_id: authorRecord.id, user_id: session.user.id, message: claimMsg, proof_url: claimProof || null })
      .select('*').single()
    setMyClaim(data)
    setShowClaimModal(false)
    setClaiming(false)
  }

  // ── Post ─────────────────────────────────────────────────────────────────
  async function submitPost() {
    if (!session || !authorRecord || !postContent.trim()) return
    setPosting(true)
    const { data } = await supabase
      .from('author_posts')
      .insert({ author_id: authorRecord.id, type: postType, title: postTitle || null, content: postContent, link_url: postLink || null })
      .select('*').single()
    if (data) setPosts(prev => [data, ...prev])
    setPostContent(''); setPostTitle(''); setPostLink(''); setShowPostForm(false)
    setPosting(false)
  }

  async function deletePost(id) {
    await supabase.from('author_posts').delete().eq('id', id)
    setPosts(prev => prev.filter(p => p.id !== id))
  }

  const myReadCount  = folioBooks.filter(b => myEntries[b.id]?.read_status === 'read').length
  const myInLibrary  = folioBooks.filter(b => myEntries[b.id]).length
  const totalFolio   = folioBooks.length
  const totalKnown   = totalFolio + olBooks.length   // all known books (DB + Open Library)
  const allRead      = session && totalFolio > 0 && myReadCount === totalFolio
  const isVerifiedOwner = session && authorRecord?.claimed_by === session.user.id && authorRecord?.is_verified

  // Friend stats breakdown
  const allFriendEntries = Object.values(friendData).flat()
  const friendsRead = new Set(allFriendEntries.filter(e => e.status === 'read').map(e => e.username)).size
  const friendsWant = new Set(allFriendEntries.filter(e => e.status === 'want').map(e => e.username)).size
  const friendsReading = new Set(allFriendEntries.filter(e => e.status === 'reading').map(e => e.username)).size
  const canClaim = session && authorRecord && !authorRecord.is_verified && !myClaim

  const s = makeStyles(theme)

  if (loading) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.loadingWrap}>Loading author…</div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.content}>

        {/* ── Author header ── */}
        <div style={s.authorHeader}>
          <div style={s.authorAvatar}>
            {olPhoto
              ? <img src={olPhoto} alt={decoded} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} onError={() => setOlPhoto(null)} />
              : <span style={{ fontFamily: 'Georgia,serif', fontWeight: 700, fontSize: 26, color: 'white' }}>{decoded.charAt(0).toUpperCase()}</span>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              <h1 style={s.authorName}>{decoded}</h1>
              {authorRecord?.is_verified && (
                <span style={s.verifiedBadge}>✓ Verified Author</span>
              )}
            </div>
            <div style={s.authorMeta}>
              <span>{totalKnown} known book{totalKnown !== 1 ? 's' : ''}</span>
              {session && myReadCount > 0 && <><span style={s.dot}>·</span><span>You've read {myReadCount}</span></>}
              {friendCount > 0 && (
                <>
                  <span style={s.dot}>·</span>
                  <span
                    style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
                    onClick={() => setShowFriendList(v => !v)}
                  >
                    {friendsRead > 0 && `${friendsRead} read`}
                    {friendsRead > 0 && (friendsReading > 0 || friendsWant > 0) && ', '}
                    {friendsReading > 0 && `${friendsReading} reading`}
                    {friendsReading > 0 && friendsWant > 0 && ', '}
                    {friendsWant > 0 && `${friendsWant} want to read`}
                    {' '}(click to see)
                  </span>
                </>
              )}
              {followCount > 0 && <><span style={s.dot}>·</span><span>{followCount} follower{followCount !== 1 ? 's' : ''}</span></>}
            </div>
            {/* Friend detail list */}
            {showFriendList && friendCount > 0 && (() => {
              // Collect unique friends with their statuses
              const friendMap = {}
              for (const entries of Object.values(friendData)) {
                for (const e of entries) {
                  if (!friendMap[e.username]) friendMap[e.username] = new Set()
                  friendMap[e.username].add(e.status)
                }
              }
              const statusLabel = { read: 'Read', reading: 'Reading', want: 'Want to read', owned: 'In Library' }
              return (
                <div style={{ marginTop: 10, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {Object.entries(friendMap).map(([name, statuses]) => (
                      <span
                        key={name}
                        onClick={() => navigate(`/profile/${name}`)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: theme.text, background: theme.bg, borderRadius: 20, padding: '4px 12px', border: `1px solid ${theme.border}` }}
                      >
                        <strong>{name}</strong>
                        <span style={{ color: theme.textSubtle, fontSize: 11 }}>
                          {[...statuses].map(st => statusLabel[st] || st).join(', ')}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })()}
            {allRead && (
              <div style={s.completionBadge}>
                <span style={{ fontSize: 18 }}>🏆</span>
                <span>You've read every book by {decoded}!</span>
              </div>
            )}

            {/* Follow / Favorite buttons */}
            {session && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button
                  onClick={toggleFollow}
                  disabled={toggling}
                  style={{
                    ...s.btn,
                    background: followed ? theme.rust : 'transparent',
                    color: followed ? '#fff' : theme.text,
                    border: `1px solid ${followed ? theme.rust : theme.border}`,
                  }}
                >
                  {followed ? '✓ Following' : '+ Follow'}
                </button>
                {followed && (
                  <button
                    onClick={toggleFavorite}
                    disabled={toggling}
                    style={{
                      ...s.btn,
                      background: isFavorite ? '#b8860b' : 'transparent',
                      color: isFavorite ? '#fff' : theme.text,
                      border: `1px solid ${isFavorite ? '#b8860b' : theme.border}`,
                    }}
                  >
                    {isFavorite ? '★ Favorite' : '☆ Favorite'}
                  </button>
                )}
                {canClaim && (
                  <button onClick={() => setShowClaimModal(true)} style={{ ...s.btn, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.textSubtle }}>
                    Claim this page
                  </button>
                )}
                {myClaim && myClaim.status === 'pending' && (
                  <span style={{ fontSize: 13, color: theme.textSubtle, alignSelf: 'center', fontStyle: 'italic' }}>Claim pending review…</span>
                )}
                {myClaim && myClaim.status === 'rejected' && (
                  <span style={{ fontSize: 13, color: theme.rust, alignSelf: 'center' }}>Claim declined</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Bio ── */}
        {bio && (
          <div style={s.bioSection}>
            <p style={s.bioText}>{bio}</p>
            {authorRecord?.website && (
              <a href={authorRecord.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: theme.rust, textDecoration: 'none' }}>
                🌐 {authorRecord.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        )}

        {/* ── Progress bar ── */}
        {session && totalFolio > 0 && (
          <div style={s.progressSection}>
            <div style={s.progressLabel}>
              You've read <strong>{myReadCount}</strong> of <strong>{totalFolio}</strong> book{totalFolio !== 1 ? 's' : ''} in your library by {decoded}
              {olBooks.length > 0 && <span style={{ color: theme.textSubtle }}> ({totalKnown} total known)</span>}
            </div>
            <div style={s.progressBarWrap}>
              <div style={{ ...s.progressBarFill, width: `${totalFolio > 0 ? Math.round((myReadCount / totalFolio) * 100) : 0}%` }} />
            </div>
            {allRead && (
              <div style={{ fontSize: 13, color: '#5a7a5a', fontWeight: 600, marginTop: 8 }}>
                🏆 Complete! You've read all their books in your library.
              </div>
            )}
          </div>
        )}

        {/* ── Author posts (verified authors only) ── */}
        {(posts.length > 0 || isVerifiedOwner) && (
          <section style={s.section}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={s.sectionTitle}>From the Author</h2>
              {isVerifiedOwner && (
                <button onClick={() => setShowPostForm(v => !v)} style={{ ...s.btn, background: theme.rust, color: '#fff', border: 'none' }}>
                  {showPostForm ? 'Cancel' : '+ New Post'}
                </button>
              )}
            </div>

            {/* New post form */}
            {isVerifiedOwner && showPostForm && (
              <div style={s.postForm}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  {Object.entries(POST_TYPE_LABELS).map(([key, { label, emoji }]) => (
                    <button key={key} onClick={() => setPostType(key)}
                      style={{ ...s.typeBtn, background: postType === key ? theme.rust : theme.bgCard, color: postType === key ? '#fff' : theme.text, border: `1px solid ${postType === key ? theme.rust : theme.border}` }}>
                      {emoji} {label}
                    </button>
                  ))}
                </div>
                <input
                  placeholder="Title (optional)"
                  value={postTitle}
                  onChange={e => setPostTitle(e.target.value)}
                  style={s.postInput}
                />
                <textarea
                  placeholder="What do you want to share with your readers?"
                  value={postContent}
                  onChange={e => setPostContent(e.target.value)}
                  rows={4}
                  style={{ ...s.postInput, resize: 'vertical', marginTop: 8 }}
                />
                <input
                  placeholder="Link URL (optional)"
                  value={postLink}
                  onChange={e => setPostLink(e.target.value)}
                  style={{ ...s.postInput, marginTop: 8 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button onClick={submitPost} disabled={posting || !postContent.trim()}
                    style={{ ...s.btn, background: theme.rust, color: '#fff', border: 'none', opacity: posting || !postContent.trim() ? 0.6 : 1 }}>
                    {posting ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </div>
            )}

            {/* Posts list */}
            {posts.length === 0 && isVerifiedOwner && (
              <p style={{ color: theme.textSubtle, fontSize: 14 }}>No posts yet. Share an update with your readers!</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {posts.map(post => {
                const pt = POST_TYPE_LABELS[post.type] || POST_TYPE_LABELS.update
                return (
                  <div key={post.id} style={s.postCard}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ ...s.postTypeBadge, background: `${pt.color}18`, color: pt.color }}>
                        {pt.emoji} {pt.label}
                      </span>
                      <span style={{ fontSize: 12, color: theme.textSubtle, marginLeft: 'auto' }}>
                        {new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      {isVerifiedOwner && (
                        <button onClick={() => deletePost(post.id)} style={{ background: 'none', border: 'none', color: theme.textSubtle, fontSize: 13, cursor: 'pointer', padding: '0 4px' }}>✕</button>
                      )}
                    </div>
                    {post.title && <div style={{ fontFamily: 'Georgia,serif', fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 6 }}>{post.title}</div>}
                    <p style={{ fontSize: 14, color: theme.text, lineHeight: 1.6, margin: 0 }}>{post.content}</p>
                    {post.link_url && (
                      <a href={post.link_url} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-block', marginTop: 10, fontSize: 13, color: theme.rust, textDecoration: 'none', fontWeight: 500 }}>
                        Learn more →
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── In Ex Libris section ── */}
        {folioBooks.length > 0 && (
          <section style={s.section}>
            <h2 style={s.sectionTitle}>In Ex Libris</h2>
            <div style={s.bookGrid}>
              {folioBooks.map(book => (
                <FolioBookCard
                  key={book.id} book={book}
                  entry={myEntries[book.id]}
                  friends={friendData[book.id] || []}
                  theme={theme} session={session}
                  onStatusChange={async (status) => {
                    const entry = myEntries[book.id]
                    if (entry) await supabase.from('collection_entries').update({ read_status: status }).eq('id', entry.id)
                    else { await supabase.from('collection_entries').insert({ user_id: session.user.id, book_id: book.id, read_status: status }); window.dispatchEvent(new CustomEvent('exlibris:bookAdded')) }
                    loadAll()
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── More by this author (OL) ── */}
        {olBooks.length > 0 && (
          <section style={s.section}>
            <h2 style={s.sectionTitle}>More by {decoded}</h2>
            <div style={s.bookGrid}>
              {olBooks.map(book => (
                <OlBookCard key={book.key} book={book} theme={theme} adding={addTarget === book.key} onAdd={addOlBook} />
              ))}
            </div>
          </section>
        )}

        {folioBooks.length === 0 && olBooks.length === 0 && (
          <div style={s.emptyState}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
            <div style={s.emptyTitle}>No books found for "{decoded}"</div>
            <div style={s.emptySub}>Try searching with a slightly different name.</div>
          </div>
        )}
      </div>

      {/* ── Claim Modal ── */}
      {showClaimModal && (
        <div style={s.modalBackdrop}>
          <div style={{ ...s.modalBox, maxWidth: 520 }}>
            <div style={s.modalTitle}>Claim this Author Page</div>

            {/* Warning box */}
            <div style={{ background: 'rgba(192,82,30,0.06)', border: '1px solid rgba(192,82,30,0.2)', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: theme.text, margin: 0, lineHeight: 1.6 }}>
                <strong>This is only for the real author.</strong> Claiming an author page you don't own is a violation of our terms and will result in your account being banned. All claims are manually reviewed by an admin.
              </p>
            </div>

            <p style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 20, lineHeight: 1.5 }}>
              If you are <strong>{decoded}</strong>, please provide verifiable proof of your identity. We require a link to an official source that connects you to this author name.
            </p>

            <label style={s.label}>Proof URL <span style={{ color: theme.rust }}>*</span></label>
            <input
              value={claimProof}
              onChange={e => setClaimProof(e.target.value)}
              placeholder="https://your-official-website.com or publisher page, social media profile, etc."
              style={{ ...s.postInput, marginBottom: 6 }}
            />
            <p style={{ fontSize: 12, color: theme.textSubtle, margin: '0 0 16px', lineHeight: 1.5 }}>
              Accepted proof: your official website, verified social media profile, publisher page, Amazon author page, or Goodreads author profile that shows your identity.
            </p>

            <label style={s.label}>Additional details <span style={{ color: theme.rust }}>*</span></label>
            <textarea
              value={claimMsg}
              onChange={e => setClaimMsg(e.target.value)}
              placeholder="Tell us how to verify you are this author. What books have you published? How does the proof URL connect to this author name?"
              rows={4}
              style={{ ...s.postInput, marginBottom: 20 }}
            />

            {/* Agreement checkbox */}
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 20, cursor: 'pointer', fontSize: 13, color: theme.text, lineHeight: 1.5 }}>
              <input
                type="checkbox"
                checked={claimAgreed}
                onChange={e => setClaimAgreed(e.target.checked)}
                style={{ marginTop: 3, accentColor: theme.rust }}
              />
              <span>I confirm that I am <strong>{decoded}</strong> and understand that falsely claiming an author page will result in my account being permanently banned.</span>
            </label>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowClaimModal(false); setClaimAgreed(false) }} style={{ ...s.btn, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text }}>Cancel</button>
              <button
                onClick={submitClaim}
                disabled={claiming || !claimMsg.trim() || !claimProof.trim() || !claimAgreed}
                style={{ ...s.btn, background: theme.rust, color: '#fff', border: 'none', opacity: claiming || !claimMsg.trim() || !claimProof.trim() || !claimAgreed ? 0.6 : 1 }}
              >
                {claiming ? 'Submitting…' : 'Submit Claim for Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Folio book card ──────────────────────────────────────────────────────────
function FolioBookCard({ book, entry, friends, theme, session, onStatusChange }) {
  const [hover,    setHover]    = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [changing, setChanging] = useState(false)
  const coverUrl = getCoverUrl(book)
  async function handleStatus(status) {
    setChanging(true); setShowMenu(false)
    await onStatusChange(status); setChanging(false)
  }
  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => { setHover(false); setShowMenu(false) }}>
      <div
        style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', transition: 'box-shadow 0.15s, transform 0.15s', boxShadow: hover ? theme.shadowCard : 'none', transform: hover ? 'translateY(-2px)' : 'none', cursor: 'pointer' }}
        onMouseEnter={() => setHover(true)}
        onClick={() => setShowMenu(v => !v)}
      >
        <div style={{ position: 'relative', background: '#d4c9b0', aspectRatio: '2/3' }}>
          {coverUrl ? <img src={coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} /> : <FakeCover title={book.title} />}
          {entry && <div style={{ position: 'absolute', top: 6, left: 6, ...STATUS_COLORS[entry.read_status], padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 600, backdropFilter: 'blur(4px)' }}>{STATUS_LABELS[entry.read_status]}</div>}
        </div>
        <div style={{ padding: '10px 10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, lineHeight: 1.3, marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{book.title}</div>
          {book.published_year && <div style={{ fontSize: 11, color: theme.textSubtle }}>{book.published_year}</div>}
          {friends.length > 0 && <div style={{ fontSize: 11, color: theme.sage, marginTop: 4 }}>{friends.length} friend{friends.length !== 1 ? 's' : ''} have this</div>}
        </div>
      </div>
      {showMenu && session && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, minWidth: 150, boxShadow: '0 6px 20px rgba(26,18,8,0.15)', marginTop: 4 }}>
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <div key={status} style={{ padding: '9px 14px', fontSize: 13, cursor: 'pointer', color: entry?.read_status === status ? '#c0521e' : theme.text, fontWeight: entry?.read_status === status ? 600 : 400, fontFamily: "'DM Sans', sans-serif" }} onClick={e => { e.stopPropagation(); handleStatus(status) }}>
              {changing ? '…' : label}{entry?.read_status === status && ' ✓'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── OL book card ─────────────────────────────────────────────────────────────
function OlBookCard({ book, theme, adding, onAdd }) {
  const [hover, setHover] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => { setHover(false); setShowMenu(false) }}>
      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', transition: 'box-shadow 0.15s, transform 0.15s', boxShadow: hover ? theme.shadowCard : 'none', transform: hover ? 'translateY(-2px)' : 'none', cursor: 'pointer' }} onMouseEnter={() => setHover(true)} onClick={() => setShowMenu(v => !v)}>
        <div style={{ background: '#d4c9b0', aspectRatio: '2/3', position: 'relative' }}>
          {book.coverUrl ? <img src={book.coverUrl} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} /> : <FakeCover title={book.title} />}
        </div>
        <div style={{ padding: '10px 10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, lineHeight: 1.3, marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{book.title}</div>
          {book.year && <div style={{ fontSize: 11, color: theme.textSubtle }}>{book.year}</div>}
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 10, background: 'rgba(184,134,11,0.12)', color: '#b8860b', padding: '2px 7px', borderRadius: 10, fontWeight: 500 }}>Open Library</span>
          </div>
        </div>
      </div>
      {showMenu && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, minWidth: 150, boxShadow: '0 6px 20px rgba(26,18,8,0.15)', marginTop: 4 }}>
          <div style={{ padding: '8px 14px 6px', fontSize: 11, fontWeight: 600, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add to Library</div>
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <div key={status} style={{ padding: '9px 14px', fontSize: 13, cursor: adding ? 'default' : 'pointer', color: theme.text, fontFamily: "'DM Sans', sans-serif" }} onClick={e => { e.stopPropagation(); !adding && onAdd(book, status) }}>
              {adding ? '…' : label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FakeCover({ title }) {
  const colors = ['#c0521e', '#5a7a5a', '#b8860b', '#8a7f72', '#1a1208']
  const idx = (title || '').charCodeAt(0) % colors.length
  return (
    <div style={{ width: '100%', height: '100%', background: colors[idx], display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
      <span style={{ fontFamily: 'Georgia, serif', color: 'rgba(255,255,255,0.85)', fontSize: 11, textAlign: 'center', lineHeight: 1.4, fontWeight: 600 }}>{title?.slice(0, 40)}</span>
    </div>
  )
}

function makeStyles(theme) {
  return {
    page:        { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content:     { maxWidth: 960, margin: '0 auto', padding: '36px 32px' },
    loadingWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: theme.textSubtle, fontSize: 15 },

    authorHeader: { display: 'flex', gap: 22, alignItems: 'flex-start', marginBottom: 28 },
    authorAvatar: { width: 80, height: 80, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' },
    authorName:   { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 32, fontWeight: 700, color: theme.text, margin: 0, lineHeight: 1.2 },
    authorMeta:   { display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, color: theme.textSubtle, marginTop: 6, flexWrap: 'wrap' },
    dot:          { color: theme.border },
    verifiedBadge:   { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 700, background: 'rgba(90,122,90,0.15)', color: '#5a7a5a', borderRadius: 20, padding: '3px 10px', marginTop: 4 },
    completionBadge: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, background: 'linear-gradient(135deg, rgba(184,134,11,0.15), rgba(192,82,30,0.12))', color: '#9a7200', borderRadius: 20, padding: '6px 14px', marginTop: 10, border: '1px solid rgba(184,134,11,0.2)' },

    btn:    { padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s' },
    typeBtn:{ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    label:  { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },

    bioSection: { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '18px 22px', marginBottom: 28 },
    bioText:    { fontSize: 14, color: theme.text, lineHeight: 1.7, margin: '0 0 8px', fontStyle: 'italic' },

    progressSection: { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '16px 20px', marginBottom: 32 },
    progressLabel:   { fontSize: 14, color: theme.text, marginBottom: 10 },
    progressBarWrap: { height: 8, background: theme.bgSubtle, borderRadius: 4, overflow: 'hidden' },
    progressBarFill: { height: '100%', background: 'linear-gradient(90deg, #c0521e, #b8860b)', borderRadius: 4, transition: 'width 0.4s ease', minWidth: 4 },

    section:      { marginBottom: 48 },
    sectionTitle: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 20, marginTop: 0 },
    bookGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 16 },

    postForm:      { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20, marginBottom: 24 },
    postInput:     { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", background: theme.bg, color: theme.text, outline: 'none' },
    postCard:      { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '18px 20px' },
    postTypeBadge: { display: 'inline-block', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20 },

    modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
    modalBox:      { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 28, width: 480, maxWidth: '95vw' },
    modalTitle:    { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, marginBottom: 12 },

    emptyState: { textAlign: 'center', padding: '80px 32px' },
    emptyTitle: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 8 },
    emptySub:   { fontSize: 14, color: theme.textSubtle },
  }
}

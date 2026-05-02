import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BookDetail from './BookDetail'
import NavBar from '../components/NavBar'
import CreatePostModal from '../components/CreatePostModal'
import ReportModal from '../components/ReportModal'
import { fetchBlockedUserIds } from '../lib/moderation'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'
import { useIsMobile } from '../hooks/useIsMobile'

const ACTION_TEXT = {
  read:    'finished reading',
  reading: 'started reading',
  want:    'wants to read',
  owned:   'added to their library',
}

const ACTION_COLOR = {
  read:    '#5a7a5a',
  reading: '#c0521e',
  want:    '#b8860b',
  owned:   '#8a7f72',
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Feed({ session }) {
  const navigate = useNavigate()
  const { theme, isDark } = useTheme()
  const isMobile = useIsMobile()
  const [posts, setPosts]                 = useState([])
  const [activity, setActivity]           = useState([])
  const [friendListings, setFriendListings] = useState([])
  const [loading, setLoading]             = useState(true)
  const [hasFriends, setHasFriends]       = useState(true)
  const [selectedBook, setSelectedBook]   = useState(null)
  const [showCompose, setShowCompose]     = useState(false)
  const [userBooks, setUserBooks]         = useState([])
  const [userProfile, setUserProfile]     = useState(null)
  const [tab, setTab]                     = useState('posts')  // 'posts' | 'activity'
  const [reportTarget, setReportTarget]   = useState(null)  // { contentType, contentId, reportedUserId }

  const s = makeStyles(theme, isMobile)

  useEffect(() => { fetchFeed() }, [])

  async function fetchFeed() {
    setLoading(true)

    const userId = session.user.id

    // Step 1: get accepted friend IDs + bidirectional block list
    const [friendshipsResult, blockedIds] = await Promise.all([
      supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
      fetchBlockedUserIds(userId),
    ])
    const friendships = friendshipsResult.data
    const blockedSet = new Set(blockedIds)

    const friendIds = (friendships || [])
      .map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
      .filter(id => !blockedSet.has(id))

    setHasFriends(friendIds.length > 0)

    // Step 2: fetch in parallel — posts (self + friends), activity, listings, user profile, user books
    const allUserIds = [userId, ...friendIds]

    const [
      postsResult,
      activitiesResult,
      listingsResult,
      sessionsResult,
      profileResult,
      booksResult,
    ] = await Promise.all([
      // Reading posts (self + friends)
      supabase
        .from('reading_posts')
        .select(`
          id, user_id, content, image_url, post_type, session_data, created_at,
          books ( id, title, author, cover_image_url, isbn_13, isbn_10 ),
          profiles!reading_posts_user_id_fkey ( username ),
          post_likes ( user_id ),
          post_comments ( id )
        `)
        .in('user_id', allUserIds)
        .order('created_at', { ascending: false })
        .limit(40),

      // Friend activity (collection_entries)
      friendIds.length
        ? supabase
            .from('collection_entries')
            .select('id, user_id, read_status, user_rating, review_text, added_at, books(id, title, author, cover_image_url, isbn_13, isbn_10)')
            .in('user_id', friendIds)
            .order('added_at', { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [] }),

      // Friend marketplace listings
      friendIds.length
        ? supabase
            .from('listings')
            .select('id, price, condition, created_at, seller_id, books(id, title, author, cover_image_url), profiles!listings_seller_id_fkey(username)')
            .in('seller_id', friendIds)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(12)
        : Promise.resolve({ data: [] }),

      // Friend reading sessions (timer completions)
      friendIds.length
        ? supabase
            .from('reading_sessions')
            .select('id, user_id, book_id, ended_at, pages_read, started_at, books(id, title, author, cover_image_url)')
            .in('user_id', friendIds)
            .eq('status', 'completed')
            .not('pages_read', 'is', null)
            .order('ended_at', { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] }),

      // Current user's profile (for avatar in compose)
      supabase.from('profiles').select('username').eq('id', userId).maybeSingle(),

      // User's own books for post tagging
      supabase
        .from('collection_entries')
        .select('books(id, title, author, cover_image_url, isbn_13, isbn_10)')
        .eq('user_id', userId)
        .limit(200),
    ])

    // Build friend profile map for activity
    if (friendIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', friendIds)
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]))

      // Merge collection entries + reading sessions into one activity list
      const collectionActivity = ((activitiesResult.data) || []).map(e => ({
        ...e,
        profile: profileMap[e.user_id],
        _type: 'collection',
        _sortDate: e.added_at,
      }))
      const sessionActivity = ((sessionsResult.data) || []).map(s => {
        const durationMin = s.started_at && s.ended_at
          ? Math.round((new Date(s.ended_at) - new Date(s.started_at)) / 60000)
          : null
        return {
          ...s,
          profile: profileMap[s.user_id],
          _type: 'session',
          _sortDate: s.ended_at,
          _durationMin: durationMin,
        }
      })
      const merged = [...collectionActivity, ...sessionActivity]
        .sort((a, b) => new Date(b._sortDate) - new Date(a._sortDate))
        .slice(0, 50)
      setActivity(merged)
    }

    setPosts(postsResult.data || [])
    setFriendListings(listingsResult.data || [])
    setUserProfile(profileResult.data)
    setUserBooks((booksResult.data || []).map(e => e.books).filter(Boolean))
    setLoading(false)
  }

  async function toggleLike(postId) {
    const userId = session.user.id
    const post = posts.find(p => p.id === postId)
    if (!post) return

    const alreadyLiked = post.post_likes?.some(l => l.user_id === userId)
    const prevLikes = post.post_likes || []

    // Optimistic update
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p
      if (alreadyLiked) {
        return { ...p, post_likes: p.post_likes.filter(l => l.user_id !== userId) }
      } else {
        return { ...p, post_likes: [...(p.post_likes || []), { user_id: userId }] }
      }
    }))

    const { error } = alreadyLiked
      ? await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId)
      : await supabase.from('post_likes').insert({ post_id: postId, user_id: userId })

    if (error) {
      // Roll back on failure so the UI matches the DB.
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, post_likes: prevLikes } : p))
      console.error('[toggleLike]', error)
    }
  }

  async function deletePost(postId) {
    if (!window.confirm('Delete this post?')) return
    await supabase.from('reading_posts').delete().eq('id', postId).eq('user_id', session.user.id)
    setPosts(prev => prev.filter(p => p.id !== postId))
  }

  function handlePosted(newPost) {
    // Back-fill the username from the cached profile since the modal skips the join
    const enriched = {
      ...newPost,
      profiles: { username: userProfile?.username || session.user.email?.split('@')[0] || 'You' },
    }
    setPosts(prev => [enriched, ...prev])
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />

      <div style={s.content}>
        {/* ── Page header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={s.pageTitle}>Reading Feed</div>
            <div style={s.pageSubtitle}>Updates from you and your friends</div>
          </div>
          <button
            onClick={() => setShowCompose(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: theme.rust, color: 'white', border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", boxShadow: '0 2px 12px rgba(192,82,30,0.3)', flexShrink: 0 }}>
            ✏️ Share Update
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, marginBottom: 20 }}>
          {[
            { key: 'posts',    label: '📸 Posts',    count: posts.length },
            { key: 'activity', label: '📚 Activity',  count: activity.length },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '9px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontFamily: "'DM Sans', sans-serif", color: tab === t.key ? theme.rust : theme.textSubtle, borderBottom: tab === t.key ? `2px solid ${theme.rust}` : '2px solid transparent', marginBottom: -1, fontWeight: tab === t.key ? 600 : 400, display: 'flex', alignItems: 'center', gap: 6 }}>
              {t.label}
              {t.count > 0 && <span style={{ fontSize: 11, background: tab === t.key ? 'rgba(192,82,30,0.1)' : theme.bgSubtle, color: tab === t.key ? theme.rust : theme.textSubtle, padding: '1px 6px', borderRadius: 20 }}>{t.count}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={s.empty}>Loading feed…</div>
        ) : tab === 'posts' ? (
          /* ── Posts tab ── */
          <div>
            {/* Quick-compose prompt */}
            <div
              onClick={() => setShowCompose(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 20, cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = theme.shadowCard}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
            >
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                {userProfile?.username?.charAt(0).toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1, fontSize: 14, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}>
                What are you reading right now?
              </div>
              <span style={{ fontSize: 13, color: theme.rust, fontWeight: 500 }}>Post →</span>
            </div>

            {posts.length === 0 ? (
              <div style={{ ...s.emptyBox, textAlign: 'center' }}>
                <div style={s.emptyIcon}>📸</div>
                <div style={s.emptyTitle}>No posts yet</div>
                <div style={s.emptyText}>Be the first to share a reading update!</div>
                <button style={s.btnPrimary} onClick={() => setShowCompose(true)}>Share Update</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {posts.map(post => (
                  <PostCard
                    key={post.id}
                    post={post}
                    theme={theme}
                    isDark={isDark}
                    currentUserId={session.user.id}
                    onLike={() => toggleLike(post.id)}
                    onDelete={() => deletePost(post.id)}
                    onBookClick={() => post.books?.id && setSelectedBook(post.books.id)}
                    onReport={() => setReportTarget({
                      contentType: 'feed_post',
                      contentId: post.id,
                      reportedUserId: post.user_id,
                    })}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Activity tab ── */
          <div>
            {!hasFriends ? (
              <div style={s.emptyBox}>
                <div style={s.emptyIcon}>📚</div>
                <div style={s.emptyTitle}>No connections yet</div>
                <div style={s.emptyText}>Add friends to see their reading activity here.</div>
                <button style={s.btnPrimary} onClick={() => navigate('/friends')}>Find Friends</button>
              </div>
            ) : (
              <>
                {/* Friend marketplace listings */}
                {friendListings.length > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      🏪 For Sale by Friends
                      <span style={{ fontSize: 12, fontWeight: 500, color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" }}>{friendListings.length} listing{friendListings.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }}>
                      {friendListings.map(l => (
                        <FriendListingCard key={l.id} listing={l} onView={() => navigate('/marketplace')} theme={theme} />
                      ))}
                    </div>
                  </div>
                )}

                {activity.length === 0 ? (
                  <div style={{ ...s.emptyBox, textAlign: 'center' }}>
                    <div style={s.emptyIcon}>📰</div>
                    <div style={s.emptyTitle}>No activity yet</div>
                    <div style={s.emptyText}>Your friends haven't added any books recently.</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {activity.map(item => (
                      <ActivityCard
                        key={item.id}
                        item={item}
                        theme={theme}
                        onBookClick={() => setSelectedBook(item.books.id)}
                        onProfileClick={() => navigate(`/profile/${item.profile?.username}`)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Compose modal ── */}
      {showCompose && (
        <CreatePostModal
          session={session}
          books={userBooks}
          onClose={() => setShowCompose(false)}
          onPosted={handlePosted}
        />
      )}

      {/* ── Book detail overlay ── */}
      {selectedBook && (
        <div style={{ position: 'fixed', inset: 0, background: theme.bg, zIndex: 40, overflowY: 'auto', isolation: 'isolate' }}>
          <BookDetail bookId={selectedBook} session={session} onBack={() => setSelectedBook(null)} />
        </div>
      )}

      {reportTarget && (
        <ReportModal
          onClose={() => setReportTarget(null)}
          contentType={reportTarget.contentType}
          contentId={reportTarget.contentId}
          reportedUserId={reportTarget.reportedUserId}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// POST CARD
// ─────────────────────────────────────────────
function PostCard({ post, theme, isDark, currentUserId, onLike, onDelete, onBookClick, onReport }) {
  const isMobile = useIsMobile()
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments]         = useState(null)  // null = not loaded
  const [newComment, setNewComment]     = useState('')
  const [savingComment, setSavingComment] = useState(false)
  const [imgError, setImgError]         = useState(false)

  const profile    = post.profiles
  const book       = post.books
  const likeCount  = post.post_likes?.length || 0
  const commentCount = post.post_comments?.length || 0
  const userLiked  = post.post_likes?.some(l => l.user_id === currentUserId) || false
  const isOwn      = post.user_id === currentUserId

  const border = isDark ? '#3a3028' : '#e8dfc8'
  const muted  = isDark ? '#9a8f82' : '#8a7f72'

  async function loadComments() {
    if (comments !== null) return
    const { data } = await supabase
      .from('post_comments')
      .select('id, content, created_at, profiles!post_comments_user_id_fkey(username)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true })
    setComments(data || [])
  }

  async function submitComment() {
    if (!newComment.trim()) return
    setSavingComment(true)
    const { data } = await supabase
      .from('post_comments')
      .insert({ post_id: post.id, user_id: currentUserId, content: newComment.trim() })
      .select('id, content, created_at, profiles!post_comments_user_id_fkey(username)')
      .single()
    if (data) setComments(prev => [...(prev || []), data])
    setNewComment('')
    setSavingComment(false)
  }

  function toggleComments() {
    if (!showComments) loadComments()
    setShowComments(v => !v)
  }

  return (
    <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, overflow: 'hidden' }}>
      {/* ── Post header ── */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
          {profile?.username?.charAt(0).toUpperCase() || '?'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, fontFamily: "'DM Sans', sans-serif" }}>
            {profile?.username || 'Unknown'}
          </div>
          <div style={{ fontSize: 12, color: muted, fontFamily: "'DM Sans', sans-serif" }}>
            {timeAgo(post.created_at)}
          </div>
        </div>
        {isOwn ? (
          <button onClick={onDelete}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 18, padding: 4, lineHeight: 1, opacity: 0.6 }}
            title="Delete post">
            ···
          </button>
        ) : (
          <button onClick={onReport}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 12, padding: 4, lineHeight: 1, opacity: 0.6 }}
            title="Report post">
            Report
          </button>
        )}
      </div>

      {/* ── Tagged book ── */}
      {book && (
        <div
          onClick={onBookClick}
          style={{ margin: '0 16px 12px', padding: '10px 12px', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 10, border: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'}
          onMouseLeave={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'}
        >
          <div style={{ width: 34, height: 46, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: border }}>
            {(() => {
              const url = getCoverUrl(book)
              return url
                ? <img src={url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📖</div>
            })()}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, fontFamily: "'DM Sans', sans-serif" }}>{book.title}</div>
            {book.author && <div style={{ fontSize: 12, color: muted, fontFamily: "'DM Sans', sans-serif" }}>{book.author}</div>}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.rust, fontFamily: "'DM Sans', sans-serif" }}>View →</span>
        </div>
      )}

      {/* ── Activity card (Strava-style) ── */}
      {post.post_type === 'activity' && post.session_data && (() => {
        const sd = post.session_data
        const durLabel = sd.duration_min >= 60
          ? `${Math.floor(sd.duration_min / 60)}h ${sd.duration_min % 60}m`
          : `${sd.duration_min} min`
        const pct = sd.total_pages && sd.end_page
          ? Math.min(100, Math.round((sd.end_page / sd.total_pages) * 100))
          : null
        return (
          <div style={{ margin: '0 16px 12px', padding: '14px 16px', background: isDark ? 'rgba(90,122,90,0.08)' : 'rgba(90,122,90,0.06)', borderRadius: 12, border: `1px solid ${isDark ? 'rgba(90,122,90,0.15)' : 'rgba(90,122,90,0.12)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>📖</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: theme.text, fontFamily: "'DM Sans', sans-serif" }}>
                Reading Session
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: pct != null ? 10 : 0 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: theme.text, fontFamily: "'Playfair Display', Georgia, serif" }}>
                  {sd.pages_read}
                </div>
                <div style={{ fontSize: 10, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8 }}>Pages</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: theme.text, fontFamily: "'Playfair Display', Georgia, serif" }}>
                  {durLabel}
                </div>
                <div style={{ fontSize: 10, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8 }}>Time</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: theme.text, fontFamily: "'Playfair Display', Georgia, serif" }}>
                  {sd.speed_ppm ? `${sd.speed_ppm}` : '—'}
                </div>
                <div style={{ fontSize: 10, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8 }}>Pages/min</div>
              </div>
            </div>
            {pct != null && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: theme.textSubtle, marginBottom: 4 }}>
                  <span>p.{sd.start_page} → p.{sd.end_page}</span>
                  <span>{pct}% complete</span>
                </div>
                <div style={{ height: 6, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: '#5a7a5a', borderRadius: 3, transition: 'width 0.4s' }} />
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Post text ── */}
      {post.content && (
        <div style={{ padding: '0 16px', marginBottom: post.image_url ? 12 : 0 }}>
          {post.post_type === 'quote' ? (
            <div style={{
              borderLeft: `3px solid ${theme.gold}`, paddingLeft: 14, margin: '4px 0',
              fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 15,
              lineHeight: 1.6, color: theme.text,
            }}>
              {post.content}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: theme.text, fontFamily: "'DM Sans', sans-serif" }}>
              {post.content}
            </p>
          )}
        </div>
      )}

      {/* ── Post image ── */}
      {post.image_url && !imgError && (
        <div style={{ marginTop: post.content ? 12 : 0 }}>
          <img
            src={post.image_url}
            alt="Post"
            onError={() => setImgError(true)}
            style={{ width: '100%', maxHeight: 400, objectFit: 'cover', display: 'block' }}
          />
        </div>
      )}

      {/* ── Like / Comment bar ── */}
      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16, borderTop: `1px solid ${border}`, marginTop: (post.content && !post.image_url) ? 12 : 0 }}>
        <button onClick={onLike}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: 0, fontSize: 13, color: userLiked ? '#e05' : muted, fontFamily: "'DM Sans', sans-serif", fontWeight: userLiked ? 600 : 400, transition: 'color 0.15s' }}>
          {userLiked ? '❤️' : '🤍'} {likeCount > 0 ? likeCount : ''} {likeCount === 1 ? 'Like' : likeCount > 1 ? 'Likes' : 'Like'}
        </button>
        <button onClick={toggleComments}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: 0, fontSize: 13, color: muted, fontFamily: "'DM Sans', sans-serif" }}>
          💬 {commentCount > 0 ? `${commentCount} ` : ''}{commentCount === 1 ? 'Comment' : 'Comments'}
        </button>
      </div>

      {/* ── Comments ── */}
      {showComments && (
        <div style={{ borderTop: `1px solid ${border}`, padding: '12px 16px', background: isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.025)' }}>
          {comments === null ? (
            <div style={{ fontSize: 13, color: muted, fontFamily: "'DM Sans', sans-serif" }}>Loading…</div>
          ) : comments.length === 0 ? (
            <div style={{ fontSize: 13, color: muted, fontFamily: "'DM Sans', sans-serif", fontStyle: 'italic' }}>No comments yet. Be the first!</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              {comments.map(c => (
                <div key={c.id} style={{ display: 'flex', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed, #c0521e)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                    {c.profiles?.username?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div style={{ flex: 1, background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '6px 10px' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: theme.text, fontFamily: "'DM Sans', sans-serif" }}>{c.profiles?.username} </span>
                    <span style={{ fontSize: 13, color: theme.text, fontFamily: "'DM Sans', sans-serif" }}>{c.content}</span>
                    <div style={{ fontSize: 11, color: muted, marginTop: 3, fontFamily: "'DM Sans', sans-serif" }}>{timeAgo(c.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Comment input */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submitComment()}
              placeholder="Add a comment…"
              style={{ flex: 1, padding: '7px 12px', border: `1px solid ${border}`, borderRadius: 20, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text }}
            />
            <button onClick={submitComment} disabled={savingComment || !newComment.trim()}
              style={{ padding: '7px 14px', background: theme.rust, color: 'white', border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: !newComment.trim() ? 0.5 : 1 }}>
              {savingComment ? '…' : '→'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// ACTIVITY CARD (unchanged from original)
// ─────────────────────────────────────────────
function ActivityCard({ item, onBookClick, onProfileClick, theme }) {
  const isMobile = useIsMobile()
  const s        = makeStyles(theme, isMobile)
  const book     = item.books
  const profile  = item.profile
  const isSession = item._type === 'session'
  const action   = isSession ? `read ${item.pages_read || '?'} pages of` : (ACTION_TEXT[item.read_status] || 'added')
  const color    = isSession ? '#5a7a5a' : (ACTION_COLOR[item.read_status] || theme.textSubtle)
  const [hover, setHover] = useState(false)

  const durationLabel = isSession && item._durationMin
    ? item._durationMin >= 60
      ? `${Math.floor(item._durationMin / 60)}h ${item._durationMin % 60}m`
      : `${item._durationMin} min`
    : null

  return (
    <div
      style={{ ...s.card, borderLeft: `3px solid ${color}`, ...(hover ? s.cardHover : {}), cursor: 'pointer' }}
      onClick={onBookClick}
      onTouchEnd={e => { e.preventDefault(); onBookClick?.() }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.avatar} onClick={e => { e.stopPropagation(); onProfileClick() }} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onProfileClick()}>
        {profile?.username?.charAt(0).toUpperCase() || '?'}
      </div>
      <div style={s.cardBody}>
        <div style={s.cardTop}>
          <span style={s.username} onClick={e => { e.stopPropagation(); onProfileClick() }} role="button" tabIndex={0}>{profile?.username}</span>
          {' '}<span style={{ ...s.action, color }}>{action}</span>{' '}
          <span style={s.bookLink}>{book?.title}</span>
          {book?.author && <span style={s.byAuthor}> by {book.author}</span>}
        </div>
        {isSession && durationLabel && (
          <div style={{ fontSize: 12, color: '#5a7a5a', marginTop: 2 }}>⏱ {durationLabel}</div>
        )}
        {!isSession && item.user_rating && (
          <div style={s.stars}>{'★'.repeat(item.user_rating)}{'☆'.repeat(5 - item.user_rating)}
            <span style={s.ratingNum}> {item.user_rating}/5</span>
          </div>
        )}
        {!isSession && item.review_text && <div style={s.review}>"{item.review_text}"</div>}
        <div style={s.meta}>{timeAgo(item._sortDate || item.added_at)}<span style={s.tapHint}> · Tap to view</span></div>
      </div>
      <div style={s.coverWrap}>
        {(() => {
          const url = getCoverUrl(book)
          return url
            ? <img src={url} alt={book.title} style={s.coverImg} onError={e => e.target.style.display='none'} />
            : <FakeCover title={book.title} />
        })()}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// FRIEND LISTING CARD
// ─────────────────────────────────────────────
const COND_LABEL = { like_new: 'Like New', very_good: 'Very Good', good: 'Good', acceptable: 'Acceptable', poor: 'Poor' }
function FriendListingCard({ listing, onView, theme }) {
  const book = listing.books
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#8b2500','#b8860b','#3d5a5a']
  const c  = colors[(book.title || '').charCodeAt(0) % colors.length]
  const c2 = colors[((book.title || '').charCodeAt(0) + 3) % colors.length]
  return (
    <div onClick={onView} style={{ flexShrink: 0, width: 130, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', boxShadow: theme.shadowCard }}>
      <div style={{ width: '100%', height: 90, background: `linear-gradient(135deg, ${c}, ${c2})`, position: 'relative', overflow: 'hidden' }}>
        {book.cover_image_url && <img src={book.cover_image_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} />}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.3, marginBottom: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{book.title}</div>
        <div style={{ fontSize: 11, color: theme.textSubtle, marginBottom: 6 }}>{listing.profiles?.username}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: theme.text }}>${Number(listing.price).toFixed(2)}</span>
          <span style={{ fontSize: 10, color: theme.textSubtle }}>{COND_LABEL[listing.condition] || listing.condition}</span>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// FAKE COVER
// ─────────────────────────────────────────────
function FakeCover({ title }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const color  = colors[(title || '').charCodeAt(0) % colors.length]
  const color2 = colors[((title || '').charCodeAt(0) + 3) % colors.length]
  return <div style={{ width: '100%', height: '100%', borderRadius: 4, background: `linear-gradient(135deg, ${color}, ${color2})` }} />
}

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
function makeStyles(theme, isMobile = false) {
  return {
    page:         { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content:      { padding: isMobile ? '16px' : '32px 32px', maxWidth: isMobile ? '100%' : 680, margin: '0 auto' },
    pageTitle:    { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, color: theme.text, marginBottom: 4 },
    pageSubtitle: { fontSize: 14, color: theme.textSubtle },

    card:       { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: isMobile ? '14px 16px' : '18px 20px', display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 12, borderLeft: `3px solid ${theme.borderLight}` },
    avatar:     { width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #c0521e, #b8860b)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 16, flexShrink: 0, cursor: 'pointer' },
    cardBody:   { flex: 1, minWidth: 0 },
    cardTop:    { fontSize: 14, color: theme.text, lineHeight: 1.5, flexWrap: 'wrap' },
    username:   { fontWeight: 700, color: theme.text, cursor: 'pointer' },
    action:     { fontWeight: 500 },
    bookLink:   { fontWeight: 600, color: theme.rust, cursor: 'pointer' },
    byAuthor:   { color: theme.textSubtle },
    stars:      { fontSize: 14, color: theme.gold, letterSpacing: 1, marginTop: 6 },
    review:     { fontSize: 13, color: theme.text, lineHeight: 1.6, marginTop: 8, fontStyle: 'italic', borderLeft: `3px solid ${theme.border}`, paddingLeft: 10 },
    meta:       { fontSize: 12, color: theme.textSubtle, marginTop: 8 },
    cardHover:  { boxShadow: theme.shadowCard, transform: 'translateY(-1px)', transition: 'all 0.15s' },
    ratingNum:  { fontSize: 11, color: theme.textSubtle, fontWeight: 400 },
    tapHint:    { color: theme.rust, fontWeight: 500 },
    coverWrap:  { width: 52, height: 78, flexShrink: 0, borderRadius: 4, overflow: 'hidden' },
    coverImg:   { width: '100%', height: '100%', objectFit: 'cover' },

    btnPrimary: { marginTop: 16, padding: '8px 16px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    empty:      { color: theme.textSubtle, fontSize: 14, padding: '60px 0', textAlign: 'center' },
    emptyBox:   { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: '60px 32px', textAlign: 'center' },
    emptyIcon:  { fontSize: 40, marginBottom: 16 },
    emptyTitle: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, marginBottom: 8 },
    emptyText:  { fontSize: 14, color: theme.textSubtle, marginBottom: 24 },
  }
}

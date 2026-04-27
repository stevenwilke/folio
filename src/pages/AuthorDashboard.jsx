import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { getCoverUrl } from '../lib/coverUrl'
import { createAuthorPost } from '../lib/authorPosts'
import { notify } from '../lib/notify'

export default function AuthorDashboard({ session }) {
  const navigate  = useNavigate()
  const [searchParams] = useSearchParams()
  const impersonateName = searchParams.get('as')
  const { theme } = useTheme()
  const isMobile  = useIsMobile()

  const [authors, setAuthors]         = useState([])    // [{ id, name, is_verified }]
  const [activeAuthor, setActive]     = useState(null)  // selected author name
  const [isAdminViewer, setIsAdmin]   = useState(false)
  const [loading, setLoading]         = useState(true)
  const [bookStats, setBookStats]     = useState([])
  const [recentQuotes, setQuotes]     = useState([])
  const [recentReviews, setReviews]   = useState([])
  const [weekly, setWeekly]           = useState([])
  const [posts, setPosts]             = useState([])
  const [questions, setQuestions]     = useState([])  // { id, question, answer, answered_at, asker_id, created_at }
  const [answerDrafts, setAnswerDrafts] = useState({}) // { [questionId]: draftText }
  const [statsLoading, setStatsLoad]  = useState(false)
  const [sortKey, setSortKey]         = useState('in_library')
  const [sortDir, setSortDir]         = useState('desc')
  const [tab, setTab]                 = useState('books') // books | quotes | reviews | posts | qa

  // Compose state
  const [postType, setPostType]       = useState('update')
  const [postTitle, setPostTitle]     = useState('')
  const [postContent, setPostContent] = useState('')
  const [postLink, setPostLink]       = useState('')
  const [posting, setPosting]         = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)

  useEffect(() => {
    if (!session) { navigate('/'); return }
    loadAuthors()
  }, [session?.user?.id, impersonateName])

  useEffect(() => {
    if (!activeAuthor) return
    loadStats(activeAuthor)
  }, [activeAuthor])

  async function loadAuthors() {
    setLoading(true)
    // Check admin status — admins can impersonate any author via ?as=Name.
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', session.user.id)
      .maybeSingle()
    const admin = !!profile?.is_admin
    setIsAdmin(admin)

    if (admin && impersonateName) {
      // Look up the author record by name so we can show name + verification state.
      // id stays null when no matching row exists — guards downstream queries.
      const { data: a } = await supabase
        .from('authors')
        .select('id, name, is_verified')
        .ilike('name', impersonateName)
        .maybeSingle()
      const fallback = { id: null, name: impersonateName, is_verified: false }
      setAuthors([a || fallback])
      setActive((a || fallback).name)
      setLoading(false)
      return
    }

    const { data, error } = await supabase.rpc('get_my_claimed_authors')
    if (error) console.error('[AuthorDashboard] get_my_claimed_authors:', error)
    const list = data || []
    setAuthors(list)
    if (list.length) setActive(list[0].name)
    setLoading(false)
  }

  // Tracks which loadStats invocation is current; rapid author-chip switching
  // would otherwise let an older response overwrite the newer one.
  const loadTokenRef = useRef(0)

  async function loadStats(name) {
    const token = ++loadTokenRef.current
    setStatsLoad(true)
    const authorId = authors.find(a => a.name === name)?.id || null
    const ownedQuery = (q) => authorId ? q : Promise.resolve({ data: [] })

    const [s, q, r, w, p, fc, qa] = await Promise.all([
      supabase.rpc('get_author_book_stats',     { p_author_name: name }),
      supabase.rpc('get_author_recent_quotes',  { p_author_name: name, p_limit: 20 }),
      supabase.rpc('get_author_recent_reviews', { p_author_name: name, p_limit: 20 }),
      supabase.rpc('get_author_weekly_stats',   { p_author_name: name }),
      ownedQuery(supabase.from('author_posts').select('id, type, title, content, link_url, created_at').eq('author_id', authorId).order('created_at', { ascending: false }).limit(20)),
      authorId
        ? supabase.from('author_follows').select('id', { count: 'exact', head: true }).eq('author_id', authorId)
        : Promise.resolve({ count: 0 }),
      ownedQuery(supabase.from('author_questions').select('id, question, answer, answered_at, asker_id, created_at').eq('author_id', authorId).order('created_at', { ascending: false }).limit(50)),
    ])

    if (token !== loadTokenRef.current) return  // a newer load is in-flight — discard
    if (s.error) console.error('[AuthorDashboard] book stats:', s.error)
    if (q.error) console.error('[AuthorDashboard] quotes:',     q.error)
    if (r.error) console.error('[AuthorDashboard] reviews:',    r.error)
    if (w.error) console.error('[AuthorDashboard] weekly:',     w.error)
    setBookStats(s.data || [])
    setQuotes(q.data   || [])
    setReviews(r.data  || [])
    setWeekly(w.data   || [])
    setPosts(p.data    || [])
    setQuestions(qa.data || [])
    setFollowerCount(fc.count ?? 0)
    setStatsLoad(false)
  }

  async function answerQuestion(question) {
    const text = (answerDrafts[question.id] || '').trim()
    if (!text) return
    const { data, error } = await supabase
      .from('author_questions')
      .update({ answer: text, answered_at: new Date().toISOString() })
      .eq('id', question.id)
      .select('*')
      .single()
    if (error) { console.error('[answerQuestion]', error); return }
    if (data) {
      setQuestions(prev => prev.map(q => q.id === question.id ? data : q))
      setAnswerDrafts(prev => ({ ...prev, [question.id]: '' }))
      notify(question.asker_id, 'author_question', {
        title: `${activeAuthor} answered your question`,
        body:  text.slice(0, 140),
        link:  `/author/${encodeURIComponent(activeAuthor)}`,
        metadata: { author_id: data.author_id, question_id: question.id },
      })
    }
  }

  async function submitPost() {
    if (!postContent.trim()) return
    const authorRow = authors.find(a => a.name === activeAuthor)
    if (!authorRow?.id) return
    setPosting(true)
    const { data, error } = await createAuthorPost({
      authorId:   authorRow.id,
      authorName: activeAuthor,
      type:       postType,
      title:      postTitle,
      content:    postContent,
      linkUrl:    postLink,
    })
    setPosting(false)
    if (error) {
      console.error('[AuthorDashboard] createAuthorPost:', error)
      return
    }
    if (data) setPosts(prev => [data, ...prev])
    setPostContent(''); setPostTitle(''); setPostLink(''); setShowCompose(false)
  }

  async function deletePost(id) {
    if (!window.confirm('Delete this post?')) return
    await supabase.from('author_posts').delete().eq('id', id)
    setPosts(prev => prev.filter(p => p.id !== id))
  }

  function clickSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sortedBooks = [...bookStats].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
  })

  // Top-line totals (sum across all books for the active author)
  const totals = bookStats.reduce((acc, b) => ({
    in_library:  acc.in_library  + Number(b.in_library  || 0),
    read:        acc.read        + Number(b.read_count  || 0),
    reading:     acc.reading     + Number(b.reading_count || 0),
    want:        acc.want        + Number(b.want_count  || 0),
    reviews:     acc.reviews     + Number(b.review_count || 0),
    quotes:      acc.quotes      + Number(b.quote_count  || 0),
    rated_sum:   acc.rated_sum   + Number(b.rating_count || 0) * Number(b.avg_rating || 0),
    rated_count: acc.rated_count + Number(b.rating_count || 0),
  }), { in_library: 0, read: 0, reading: 0, want: 0, reviews: 0, quotes: 0, rated_sum: 0, rated_count: 0 })
  const overallAvg = totals.rated_count > 0 ? (totals.rated_sum / totals.rated_count).toFixed(2) : '—'

  const s = {
    page:       { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    inner:      { maxWidth: 1100, margin: '0 auto', padding: isMobile ? '24px 16px 80px' : '40px 32px 80px' },
    heading:    { fontFamily: 'Georgia, serif', fontSize: isMobile ? 26 : 32, fontWeight: 700, color: theme.text, marginBottom: 6 },
    sub:        { fontSize: 14, color: theme.textSubtle, marginBottom: 24, lineHeight: 1.5 },
    tabRow:     { display: 'flex', gap: 6, marginBottom: 20, borderBottom: `1px solid ${theme.border}` },
    tabBtn:     (active) => ({ padding: '10px 16px', fontSize: 14, fontWeight: active ? 700 : 500, color: active ? theme.rust : theme.textSubtle, background: 'none', border: 'none', borderBottom: active ? `2px solid ${theme.rust}` : '2px solid transparent', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: -1 }),
    statsGrid:  { display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '140px' : '170px'}, 1fr))`, gap: 12, marginBottom: 24 },
    statCard:   { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '14px 16px', boxShadow: theme.shadowCard },
    statNum:    { fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 700, color: theme.text },
    statLabel:  { fontSize: 11, fontWeight: 700, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
    authorRow:  { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 },
    authorChip: (active) => ({ padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: active ? theme.rust : theme.bgCard, color: active ? '#fff' : theme.text, border: `1px solid ${active ? theme.rust : theme.border}`, fontFamily: "'DM Sans', sans-serif" }),
    card:       { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: theme.shadowCard, marginBottom: 24 },
    tableHead:  { display: 'grid', gridTemplateColumns: isMobile ? '1.6fr repeat(4, 50px)' : '36px 2fr repeat(7, 70px)', alignItems: 'center', padding: '12px 14px', borderBottom: `1px solid ${theme.border}`, background: theme.bgSubtle, fontSize: 11, fontWeight: 700, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4 },
    tableRow:   { display: 'grid', gridTemplateColumns: isMobile ? '1.6fr repeat(4, 50px)' : '36px 2fr repeat(7, 70px)', alignItems: 'center', padding: '12px 14px', borderBottom: `1px solid ${theme.borderLight || theme.border}`, fontSize: 13, color: theme.text, cursor: 'pointer' },
    cellNum:    { textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
    sortable:   { cursor: 'pointer', userSelect: 'none' },
    cover:      { width: 28, height: 42, borderRadius: 3, objectFit: 'cover', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
    coverWrap:  { width: 28, height: 42, borderRadius: 3, background: theme.bgSubtle, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    titleCell:  { fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 },
    quoteItem:  { padding: '14px 16px', borderBottom: `1px solid ${theme.borderLight || theme.border}` },
    quoteText:  { fontSize: 14, color: theme.text, fontStyle: 'italic', lineHeight: 1.5, marginBottom: 6 },
    quoteMeta:  { fontSize: 12, color: theme.textSubtle },
    emptyState: { padding: '40px 24px', textAlign: 'center', color: theme.textSubtle, fontSize: 14, lineHeight: 1.6 },
  }

  if (loading) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.inner}>
          <h1 style={s.heading}>Author Dashboard</h1>
          <p style={s.sub}>Loading…</p>
        </div>
      </div>
    )
  }

  if (!authors.length) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.inner}>
          <h1 style={s.heading}>Author Dashboard</h1>
          <p style={s.sub}>This dashboard is for verified authors. To get access, find your author page and submit a claim — once an admin verifies it, your dashboard will unlock here.</p>
          <div style={{ ...s.card, padding: '24px 20px' }}>
            <div style={{ fontSize: 14, color: theme.text, marginBottom: 8 }}>You don't have any verified author claims yet.</div>
            <div style={{ fontSize: 13, color: theme.textSubtle }}>Search for your author name from the search bar and use the "Claim this profile" button.</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.inner}>
        <h1 style={s.heading}>Author Dashboard</h1>
        {isAdminViewer && impersonateName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', background: 'rgba(192,82,30,0.1)', border: `1px solid ${theme.rust}`, borderRadius: 8, fontSize: 13, color: theme.text }}>
            <span style={{ fontSize: 11, fontWeight: 700, background: theme.rust, color: '#fff', padding: '3px 8px', borderRadius: 10, letterSpacing: 0.4 }}>ADMIN VIEW</span>
            <span>Viewing as <strong>{activeAuthor}</strong></span>
            <button onClick={() => navigate('/author-dashboard')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: theme.rust, cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>Exit admin view</button>
          </div>
        ) : (
          <p style={s.sub}>Stats across all your claimed author profiles. Numbers reflect the entire Ex Libris user base.</p>
        )}

        {authors.length > 1 && (
          <div style={s.authorRow}>
            {authors.map(a => (
              <button key={a.id} style={s.authorChip(activeAuthor === a.name)} onClick={() => setActive(a.name)}>
                {a.name}
              </button>
            ))}
          </div>
        )}

        <div style={s.statsGrid}>
          <Stat num={totals.in_library} label="In Libraries" s={s} />
          <Stat num={totals.read}       label="Read"         s={s} />
          <Stat num={totals.reading}    label="Reading"      s={s} />
          <Stat num={totals.want}       label="Want to Read" s={s} />
          <Stat num={overallAvg}        label="Avg Rating"   s={s} suffix={overallAvg !== '—' ? ' ★' : ''} />
          <Stat num={totals.reviews}    label="Reviews"      s={s} />
          <Stat num={totals.quotes}     label="Quotes"       s={s} />
        </div>

        {/* Weekly trends (last 12 weeks) */}
        {weekly.length > 0 && (() => {
          const max = Math.max(1, ...weekly.map(w => Math.max(Number(w.new_readers || 0), Number(w.new_quotes || 0), Number(w.new_reviews || 0))))
          const SERIES = [
            { key: 'new_readers', label: 'New readers', color: theme.rust },
            { key: 'new_quotes',  label: 'New quotes',  color: '#b8860b' },
            { key: 'new_reviews', label: 'New reviews', color: '#5a7a5a' },
          ]
          return (
            <div style={{ ...s.card, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, textTransform: 'uppercase', letterSpacing: 0.5 }}>Last 12 weeks</div>
                <div style={{ display: 'flex', gap: 14 }}>
                  {SERIES.map(serie => (
                    <div key={serie.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: theme.textSubtle }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: serie.color, display: 'inline-block' }} />
                      {serie.label}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, paddingBottom: 22, position: 'relative' }}>
                {weekly.map((w, i) => {
                  const date = new Date(w.week_start)
                  const label = `${date.getMonth() + 1}/${date.getDate()}`
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }} title={`${label}: ${w.new_readers} readers, ${w.new_quotes} quotes, ${w.new_reviews} reviews`}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 100, width: '100%', justifyContent: 'center' }}>
                        {SERIES.map(serie => {
                          const v = Number(w[serie.key] || 0)
                          const h = Math.round((v / max) * 100)
                          return (
                            <div key={serie.key} style={{ width: 6, height: `${h}%`, background: serie.color, borderRadius: '2px 2px 0 0', minHeight: v > 0 ? 2 : 0 }} />
                          )
                        })}
                      </div>
                      <div style={{ fontSize: 9, color: theme.textSubtle, marginTop: 4, transform: 'rotate(-30deg)', transformOrigin: 'center', whiteSpace: 'nowrap', position: 'absolute', bottom: 0 }}>{label}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        <div style={s.tabRow}>
          <button style={s.tabBtn(tab === 'books')}   onClick={() => setTab('books')}>Books</button>
          <button style={s.tabBtn(tab === 'quotes')}  onClick={() => setTab('quotes')}>Recent Quotes</button>
          <button style={s.tabBtn(tab === 'reviews')} onClick={() => setTab('reviews')}>Recent Reviews</button>
          <button style={s.tabBtn(tab === 'posts')}   onClick={() => setTab('posts')}>Posts {posts.length > 0 ? `(${posts.length})` : ''}</button>
          <button style={s.tabBtn(tab === 'qa')}      onClick={() => setTab('qa')}>Q&A {questions.filter(q => !q.answer).length > 0 ? `(${questions.filter(q => !q.answer).length} new)` : ''}</button>
        </div>

        {statsLoading && <div style={s.emptyState}>Loading stats…</div>}

        {!statsLoading && tab === 'books' && (
          <div style={s.card}>
            <div style={s.tableHead}>
              {!isMobile && <div />}
              <div onClick={() => clickSort('title')} style={s.sortable}>Title {sortKey === 'title' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</div>
              <div style={{ ...s.cellNum, ...s.sortable }} onClick={() => clickSort('in_library')}>Lib {sortKey === 'in_library' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</div>
              <div style={{ ...s.cellNum, ...s.sortable }} onClick={() => clickSort('read_count')}>Read</div>
              {!isMobile && <div style={{ ...s.cellNum, ...s.sortable }} onClick={() => clickSort('reading_count')}>Reading</div>}
              {!isMobile && <div style={{ ...s.cellNum, ...s.sortable }} onClick={() => clickSort('want_count')}>Want</div>}
              <div style={{ ...s.cellNum, ...s.sortable }} onClick={() => clickSort('avg_rating')}>★</div>
              <div style={{ ...s.cellNum, ...s.sortable }} onClick={() => clickSort('review_count')}>Rev</div>
              {!isMobile && <div style={{ ...s.cellNum, ...s.sortable }} onClick={() => clickSort('quote_count')}>Quotes</div>}
            </div>
            {sortedBooks.length === 0 ? (
              <div style={s.emptyState}>No books found yet for "{activeAuthor}".</div>
            ) : sortedBooks.map(b => {
              const cover = getCoverUrl({ cover_image_url: b.cover_image_url })
              return (
                <div key={b.book_id} style={s.tableRow} onClick={() => navigate(`/book/${b.book_id}`)}>
                  {!isMobile && (
                    <div style={s.coverWrap}>
                      {cover ? <img src={cover} alt="" style={s.cover} /> : null}
                    </div>
                  )}
                  <div style={s.titleCell}>{b.title}</div>
                  <div style={s.cellNum}>{Number(b.in_library)}</div>
                  <div style={s.cellNum}>{Number(b.read_count)}</div>
                  {!isMobile && <div style={s.cellNum}>{Number(b.reading_count)}</div>}
                  {!isMobile && <div style={s.cellNum}>{Number(b.want_count)}</div>}
                  <div style={s.cellNum}>{b.avg_rating ? Number(b.avg_rating).toFixed(1) : '—'}</div>
                  <div style={s.cellNum}>{Number(b.review_count)}</div>
                  {!isMobile && <div style={s.cellNum}>{Number(b.quote_count)}</div>}
                </div>
              )
            })}
          </div>
        )}

        {!statsLoading && tab === 'quotes' && (
          <div style={s.card}>
            {recentQuotes.length === 0 ? (
              <div style={s.emptyState}>No quotes have been shared yet.</div>
            ) : recentQuotes.map(q => (
              <div key={q.id} style={s.quoteItem}>
                <div style={s.quoteText}>"{q.quote_text}"</div>
                <div style={s.quoteMeta}>
                  <span style={{ color: theme.text, fontWeight: 600 }}>{q.username}</span>
                  {' · '}
                  <span style={{ cursor: 'pointer', color: theme.rust }} onClick={() => navigate(`/book/${q.book_id}`)}>{q.book_title}</span>
                  {q.page_number ? ` · p. ${q.page_number}` : ''}
                  {' · '}{new Date(q.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}

        {!statsLoading && tab === 'reviews' && (
          <div style={s.card}>
            {recentReviews.length === 0 ? (
              <div style={s.emptyState}>No reviews yet.</div>
            ) : recentReviews.map(r => (
              <div key={r.id} style={s.quoteItem}>
                <div style={{ fontSize: 13, color: '#b8860b', marginBottom: 4 }}>
                  {r.user_rating > 0 ? '★'.repeat(r.user_rating) + '☆'.repeat(5 - r.user_rating) : ''}
                </div>
                <div style={{ ...s.quoteText, fontStyle: 'normal' }}>{r.review_text}</div>
                <div style={s.quoteMeta}>
                  <span style={{ color: theme.text, fontWeight: 600 }}>{r.username}</span>
                  {' · '}
                  <span style={{ cursor: 'pointer', color: theme.rust }} onClick={() => navigate(`/book/${r.book_id}`)}>{r.book_title}</span>
                  {' · '}{new Date(r.added_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}

        {!statsLoading && tab === 'posts' && (() => {
          const canCompose = !impersonateName  // admin impersonating shouldn't post on behalf
          return (
            <>
              {canCompose && (
                <div style={{ ...s.card, padding: 16 }}>
                  {!showCompose ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ fontSize: 13, color: theme.textSubtle }}>
                        Share an update with your <strong style={{ color: theme.text }}>{followerCount}</strong> follower{followerCount === 1 ? '' : 's'}.
                      </div>
                      <button onClick={() => setShowCompose(true)} style={{ background: theme.rust, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                        + New post
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[
                          { v: 'update',       l: 'Update' },
                          { v: 'announcement', l: 'Announcement' },
                          { v: 'new_book',     l: 'New Book' },
                          { v: 'giveaway',     l: 'Giveaway' },
                        ].map(opt => (
                          <button key={opt.v} onClick={() => setPostType(opt.v)} style={{ padding: '6px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: postType === opt.v ? theme.rust : 'transparent', color: postType === opt.v ? '#fff' : theme.textSubtle, border: `1px solid ${postType === opt.v ? theme.rust : theme.border}`, fontFamily: "'DM Sans', sans-serif" }}>
                            {opt.l}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        placeholder="Title (optional)"
                        value={postTitle}
                        onChange={e => setPostTitle(e.target.value)}
                        style={{ padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: theme.bg, color: theme.text }}
                      />
                      <textarea
                        placeholder="What's new?"
                        value={postContent}
                        onChange={e => setPostContent(e.target.value)}
                        rows={4}
                        style={{ padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: theme.bg, color: theme.text, resize: 'vertical' }}
                      />
                      <input
                        type="url"
                        placeholder="Link URL (optional)"
                        value={postLink}
                        onChange={e => setPostLink(e.target.value)}
                        style={{ padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: theme.bg, color: theme.text }}
                      />
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => { setShowCompose(false); setPostContent(''); setPostTitle(''); setPostLink('') }} style={{ background: 'transparent', border: `1px solid ${theme.border}`, color: theme.textSubtle, padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                          Cancel
                        </button>
                        <button onClick={submitPost} disabled={posting || !postContent.trim()} style={{ background: theme.rust, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: posting || !postContent.trim() ? 0.6 : 1 }}>
                          {posting ? 'Posting…' : `Post${followerCount > 0 ? ` & notify ${followerCount}` : ''}`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div style={s.card}>
                {posts.length === 0 ? (
                  <div style={s.emptyState}>No posts yet.</div>
                ) : posts.map(p => (
                  <div key={p.id} style={s.quoteItem}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 12 }}>
                      <div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: theme.rust, textTransform: 'uppercase', letterSpacing: 0.5, background: 'rgba(192,82,30,0.1)', padding: '2px 7px', borderRadius: 10 }}>
                          {(p.type || 'update').replace('_', ' ')}
                        </span>
                        {p.title && <span style={{ marginLeft: 10, fontSize: 14, fontWeight: 700, color: theme.text }}>{p.title}</span>}
                      </div>
                      {canCompose && (
                        <button onClick={() => deletePost(p.id)} style={{ background: 'transparent', border: 'none', color: theme.textSubtle, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                          Delete
                        </button>
                      )}
                    </div>
                    <div style={{ ...s.quoteText, fontStyle: 'normal' }}>{p.content}</div>
                    <div style={s.quoteMeta}>
                      {p.link_url && <a href={p.link_url} target="_blank" rel="noopener noreferrer" style={{ color: theme.rust, marginRight: 8 }}>Link →</a>}
                      {new Date(p.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        })()}

        {!statsLoading && tab === 'qa' && (() => {
          const canAnswer = !impersonateName // admin viewer shouldn't answer on behalf
          const unanswered = questions.filter(q => !q.answer)
          const answered   = questions.filter(q => q.answer)
          return (
            <>
              {unanswered.length > 0 && (
                <div style={s.card}>
                  <div style={{ padding: '14px 16px', borderBottom: `1px solid ${theme.borderLight || theme.border}`, fontSize: 12, fontWeight: 700, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Pending — {unanswered.length}
                  </div>
                  {unanswered.map(q => (
                    <div key={q.id} style={s.quoteItem}>
                      <div style={{ fontSize: 14, color: theme.text, fontWeight: 600, marginBottom: 6 }}>Q: {q.question}</div>
                      <div style={{ fontSize: 12, color: theme.textSubtle, marginBottom: 10 }}>{new Date(q.created_at).toLocaleDateString()}</div>
                      {canAnswer ? (
                        <>
                          <textarea
                            placeholder="Write your answer…"
                            value={answerDrafts[q.id] || ''}
                            onChange={e => setAnswerDrafts(prev => ({ ...prev, [q.id]: e.target.value }))}
                            rows={3}
                            style={{ width: '100%', padding: 10, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', background: theme.bg, color: theme.text, boxSizing: 'border-box' }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                            <button onClick={() => answerQuestion(q)} disabled={!(answerDrafts[q.id] || '').trim()} style={{ background: theme.rust, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: (answerDrafts[q.id] || '').trim() ? 1 : 0.5 }}>
                              Answer publicly
                            </button>
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: theme.textSubtle, fontStyle: 'italic' }}>Admin view — answers are disabled.</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div style={s.card}>
                <div style={{ padding: '14px 16px', borderBottom: `1px solid ${theme.borderLight || theme.border}`, fontSize: 12, fontWeight: 700, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Answered — {answered.length}
                </div>
                {answered.length === 0 ? (
                  <div style={s.emptyState}>No answered questions yet.</div>
                ) : answered.map(q => (
                  <div key={q.id} style={s.quoteItem}>
                    <div style={{ fontSize: 14, color: theme.text, fontWeight: 600, marginBottom: 6 }}>Q: {q.question}</div>
                    <div style={{ fontSize: 14, color: theme.text, lineHeight: 1.55, marginBottom: 6, paddingLeft: 12, borderLeft: `2px solid ${theme.rust}` }}>
                      <span style={{ fontStyle: 'italic', color: theme.rust, marginRight: 4 }}>A:</span>{q.answer}
                    </div>
                    <div style={s.quoteMeta}>{new Date(q.answered_at || q.created_at).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}

function Stat({ num, label, s, suffix }) {
  return (
    <div style={s.statCard}>
      <div style={s.statNum}>{num}{suffix || ''}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  )
}

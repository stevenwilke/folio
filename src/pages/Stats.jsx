import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { computeBadges, BADGE_CATEGORIES, TIER_STYLES } from '../lib/badges'
import { computeReadingSpeeds, formatDuration } from '../lib/readingSpeed'

const CHART_COLORS = ['#c0521e', '#5a7a5a', '#b8860b', '#4a6b8a', '#7b4f3a', '#8b5e83', '#3d6b6b']

function computeStreaks(entries) {
  if (!entries.length) return { current: 0, longest: 0 }
  const days = new Set(entries.map(e => e.added_at?.slice(0, 10)).filter(Boolean))
  const sorted = [...days].sort()
  let longest = 1, run = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i-1])
    const curr = new Date(sorted[i])
    const diff = (curr - prev) / 86400000
    if (diff === 1) { run++; longest = Math.max(longest, run) }
    else run = 1
  }
  const today = new Date().toISOString().slice(0, 10)
  let current = 0, check = today
  while (days.has(check)) {
    current++
    const d = new Date(check); d.setDate(d.getDate() - 1)
    check = d.toISOString().slice(0, 10)
  }
  if (current === 0) {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    check = yesterday.toISOString().slice(0, 10)
    while (days.has(check)) {
      current++
      const d = new Date(check); d.setDate(d.getDate() - 1)
      check = d.toISOString().slice(0, 10)
    }
  }
  return { current, longest }
}

export default function Stats({ session }) {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const [entries,      setEntries]      = useState([])
  const [valuations,   setValuations]   = useState([])
  const [loading,      setLoading]      = useState(true)
  const [friendCount,  setFriendCount]  = useState(0)
  const [badges,       setBadges]       = useState([])
  const [readingSessionStats, setReadingSessionStats] = useState(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()

    const [{ data }, { count: fc }] = await Promise.all([
      supabase.from('collection_entries').select('*, books(*)').eq('user_id', session.user.id),
      supabase.from('friendships').select('id', { count: 'exact', head: true })
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`).eq('status', 'accepted'),
    ])
    const rows = data || []
    setEntries(rows)
    setFriendCount(fc || 0)
    setBadges(computeBadges(rows, fc || 0))

    // Fetch valuations for all books in collection
    const bookIds = rows.map(e => e.book_id).filter(Boolean)
    if (bookIds.length) {
      const { data: vals } = await supabase
        .from('valuations')
        .select('book_id, list_price, avg_price')
        .in('book_id', bookIds)
      setValuations(vals || [])
    }

    // Fetch reading sessions for speed stats
    const { data: sessions } = await supabase
      .from('reading_sessions')
      .select('started_at, ended_at, pages_read, is_fiction')
      .eq('user_id', session.user.id)
      .eq('status', 'completed')
      .not('pages_read', 'is', null)
    if (sessions?.length) {
      const speeds = computeReadingSpeeds(sessions)
      const totalMin = sessions.reduce((sum, s) => {
        if (!s.started_at || !s.ended_at) return sum
        return sum + (new Date(s.ended_at) - new Date(s.started_at)) / 60000
      }, 0)
      setReadingSessionStats({ speeds, totalMinutes: Math.round(totalMin), sessionCount: sessions.length })
    }

    setLoading(false)
  }

  // ── COMPUTED STATS ──
  const readEntries = entries.filter(e => e.read_status === 'read')

  const totalBooks   = entries.length
  const booksRead    = readEntries.length
  const totalPages   = readEntries.reduce((sum, e) => sum + (e.books?.pages || 0), 0)
  const ratedEntries = entries.filter(e => e.user_rating != null)
  const avgRating    = ratedEntries.length
    ? (ratedEntries.reduce((sum, e) => sum + e.user_rating, 0) / ratedEntries.length).toFixed(1)
    : null

  // ── COLLECTION VALUE ──
  const valMap = {}
  for (const v of valuations) valMap[v.book_id] = v

  let totalListValue   = 0
  let listValueCount   = 0
  let totalMarketValue = 0
  let marketValueCount = 0
  for (const e of entries) {
    const v = valMap[e.book_id]
    if (v?.list_price)  { totalListValue   += Number(v.list_price);  listValueCount++ }
    if (v?.avg_price)   { totalMarketValue += Number(v.avg_price);   marketValueCount++ }
  }

  function fmtPrice(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  // ── BOOKS PER YEAR ──
  const perYear = {}
  for (const e of readEntries) {
    const year = new Date(e.updated_at).getFullYear()
    perYear[year] = (perYear[year] || 0) + 1
  }
  const yearKeys  = Object.keys(perYear).sort()
  const maxPerYear = Math.max(...Object.values(perYear), 1)

  // ── GENRE BREAKDOWN ──
  const genreMap = {}
  for (const e of readEntries) {
    const g = e.books?.genre || 'Unknown'
    genreMap[g] = (genreMap[g] || 0) + 1
  }
  const sortedGenres = Object.entries(genreMap).sort((a, b) => b[1] - a[1])
  const top6 = sortedGenres.slice(0, 6)
  const otherCount = sortedGenres.slice(6).reduce((sum, [, c]) => sum + c, 0)
  const genreSlices = otherCount > 0 ? [...top6, ['Other', otherCount]] : top6

  // ── HIGHLIGHTS ──
  // Most-read author
  const authorMap = {}
  for (const e of readEntries) {
    const a = e.books?.author || 'Unknown'
    authorMap[a] = (authorMap[a] || 0) + 1
  }
  const topAuthor = Object.entries(authorMap).sort((a, b) => b[1] - a[1])[0]

  // Longest book read
  const longestEntry = readEntries.reduce((best, e) =>
    (e.books?.pages || 0) > (best?.books?.pages || 0) ? e : best, null)

  // Fastest month (most books finished in a calendar month)
  const monthMap = {}
  for (const e of readEntries) {
    const d   = new Date(e.updated_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap[key] = (monthMap[key] || 0) + 1
  }
  const topMonthEntry = Object.entries(monthMap).sort((a, b) => b[1] - a[1])[0]
  let topMonthLabel = null
  if (topMonthEntry) {
    const [ym, count] = topMonthEntry
    const [y, m] = ym.split('-')
    const label = new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    topMonthLabel = { label, count }
  }

  // Reading streak (consecutive months with ≥1 book finished, counting backwards from now)
  const finishedMonths = new Set(Object.keys(monthMap))
  let streak = 0
  const now = new Date()
  let checkYear  = now.getFullYear()
  let checkMonth = now.getMonth() + 1
  while (true) {
    const key = `${checkYear}-${String(checkMonth).padStart(2, '0')}`
    if (!finishedMonths.has(key)) break
    streak++
    checkMonth--
    if (checkMonth === 0) { checkMonth = 12; checkYear-- }
    if (streak > 120) break // safety
  }

  // ── DAILY READING STREAK ──
  const streakEntries = entries.filter(e => e.read_status === 'read' || e.read_status === 'reading')
  const streaks = computeStreaks(streakEntries)

  // Last 30 days activity set
  const activityDays = new Set(streakEntries.map(e => e.added_at?.slice(0, 10)).filter(Boolean))
  const last30 = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    last30.push(d.toISOString().slice(0, 10))
  }

  const s = {
    page:    { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content: { maxWidth: 960, margin: '0 auto', padding: isMobile ? '16px 16px 60px' : '32px 32px 60px' },

    pageHeading:   { marginBottom: 28 },
    h1:            { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 700, color: theme.text, margin: 0, marginBottom: 4 },
    pageSubtitle:  { fontSize: 14, color: theme.textSubtle },

    cardRow:   { display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' },
    statCard:  { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '18px 22px', flex: 1, minWidth: 160 },
    statVal:   { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 26, fontWeight: 700, marginBottom: 4 },
    statLabel: { fontSize: 11, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 1 },

    twoCol:    { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 20 },

    chartCard:  { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: '22px 24px' },
    chartTitle: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 17, fontWeight: 700, color: theme.text, marginBottom: 4 },
    chartEmpty: { fontSize: 13, color: theme.textSubtle, padding: '20px 0' },

    barRow:   { display: 'flex', alignItems: 'center', gap: 10 },
    barLabel: { fontSize: 13, color: theme.text, fontWeight: 500, width: 40, flexShrink: 0, textAlign: 'right' },
    barTrack: { flex: 1, height: 14, background: 'rgba(192,82,30,0.1)', borderRadius: 8, overflow: 'hidden' },
    barFill:  { height: '100%', background: theme.rust, borderRadius: 8, transition: 'width 0.6s ease', minWidth: 4 },
    barCount: { fontSize: 12, color: theme.textSubtle, width: 24, textAlign: 'left', flexShrink: 0 },

    legendList:  { display: 'flex', flexDirection: 'column', gap: 7, flex: 1 },
    legendRow:   { display: 'flex', alignItems: 'center', gap: 8 },
    legendDot:   { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
    legendGenre: { fontSize: 13, color: theme.text, flex: 1 },
    legendCount: { fontSize: 12, color: theme.textSubtle, fontWeight: 600 },

    highlightGrid: { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 16, marginTop: 8 },
    highlightTile: { background: theme.rustLight, border: `1px solid rgba(192,82,30,0.12)`, borderRadius: 12, padding: '16px 14px' },
    highlightIcon:  { fontSize: 22, marginBottom: 6 },
    highlightLabel: { fontSize: 10, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, fontWeight: 600 },
    highlightValue: { fontSize: 14, fontWeight: 700, color: theme.text, lineHeight: 1.35 },
    highlightSub:   { fontSize: 12, color: theme.rust, marginTop: 3 },

    empty:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '80px 0', color: theme.textSubtle, fontSize: 15 },

    section:         { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: isMobile ? '18px 16px' : '24px 28px', marginBottom: 24 },
    sectionHeadRow:  { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
    sectionTitle:    { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: theme.text, margin: 0 },
    badgesEarnedPill:{ fontSize: 11, color: theme.textSubtle, background: theme.bgSubtle, border: `1px solid ${theme.border}`, padding: '2px 10px', borderRadius: 20 },
    badgeCatLabel:   { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: theme.textSubtle, marginBottom: 10 },
    badgeGrid:       { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(auto-fill,minmax(155px,1fr))', gap: 10 },
    badgeCard:       { borderRadius: 10, border: '1px solid', padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center' },
    badgeEmoji:      { fontSize: 30, lineHeight: 1, marginBottom: 2 },
    badgeCardName:   { fontSize: 12, fontWeight: 700, color: theme.text, lineHeight: 1.2 },
    badgeCardDesc:   { fontSize: 10, color: theme.textSubtle, lineHeight: 1.3 },
    badgeTierPill:   { marginTop: 4, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 8px', borderRadius: 20 },
    badgeProgressBg: { height: 3, background: theme.bgSubtle, borderRadius: 2, overflow: 'hidden', marginBottom: 3 },
    badgeProgressFill: { height: '100%', borderRadius: 2, transition: 'width 0.4s' },
    badgeProgressLabel: { fontSize: 9, color: theme.textSubtle },
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.content}>

        <div style={s.pageHeading}>
          <h1 style={s.h1}>Reading Stats</h1>
          <div style={s.pageSubtitle}>Your complete reading journey at a glance</div>
        </div>

        {loading ? (
          <LoadingSkeleton />
        ) : entries.length === 0 ? (
          <div style={s.empty}>
            <span style={{ fontSize: 48 }}>📊</span>
            <div>No books in your collection yet.</div>
            <div style={{ fontSize: 13, color: theme.textSubtle }}>Add some books to start tracking your stats!</div>
          </div>
        ) : (
          <>
            {/* ── TOP STAT CARDS ── */}
            <div style={s.cardRow}>
              {[
                { label: 'Books in Collection', value: totalBooks,   icon: '📚', color: theme.text  },
                { label: 'Books Read',           value: booksRead,   icon: '✓',  color: theme.sage },
                { label: 'Pages Read',           value: totalPages > 0 ? totalPages.toLocaleString() : '—', icon: '📄', color: theme.rust },
                { label: 'Avg Rating',           value: avgRating ? `★ ${avgRating}` : '—', icon: '⭐', color: theme.gold },
              ].map(({ label, value, icon, color }) => (
                <div key={label} style={s.statCard}>
                  <div style={{ ...s.statVal, color }}>{icon} {value}</div>
                  <div style={s.statLabel}>{label}</div>
                </div>
              ))}
            </div>

            {/* ── COLLECTION VALUE CARDS ── */}
            <div style={{ ...s.cardRow, marginTop: -8 }}>
              {/* List / retail value */}
              <div style={{ ...s.statCard, borderColor: theme.sage, flex: 1 }}>
                <div style={{ ...s.statVal, color: theme.sage, fontSize: 22 }}>
                  {listValueCount > 0 ? fmtPrice(totalListValue) : '—'}
                </div>
                <div style={s.statLabel}>Collection Value (list price)</div>
                <div style={{ fontSize: 11, color: theme.textSubtle, marginTop: 4 }}>
                  {listValueCount > 0
                    ? `Based on ${listValueCount} of ${entries.length} books`
                    : 'Open book pages to load pricing'}
                </div>
              </div>

              {/* Market / resale value */}
              <div style={{ ...s.statCard, borderColor: theme.rust, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ ...s.statVal, color: theme.rust, fontSize: 22 }}>
                    {marketValueCount > 0 ? fmtPrice(totalMarketValue) : '—'}
                  </div>
                  {marketValueCount === 0 && (
                    <span style={{ fontSize: 10, background: 'rgba(192,82,30,0.1)', color: theme.rust, borderRadius: 10, padding: '2px 8px', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                      Coming Soon
                    </span>
                  )}
                </div>
                <div style={s.statLabel}>Resale Value (eBay market)</div>
                <div style={{ fontSize: 11, color: theme.textSubtle, marginTop: 4 }}>
                  {marketValueCount > 0
                    ? `Based on ${marketValueCount} of ${entries.length} books · avg ${fmtPrice(totalMarketValue / marketValueCount)}/book`
                    : 'Requires eBay API key to populate'}
                </div>
              </div>
            </div>

            {/* ── READING STREAK CARD ── */}
            <div style={{ ...s.chartCard, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 22 }}>🔥</span>
                    <span style={{ ...s.chartTitle, marginBottom: 0 }}>Reading Streak</span>
                  </div>
                  {streaks.current > 0 ? (
                    <>
                      <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 32, fontWeight: 700, color: theme.rust, lineHeight: 1.1, marginBottom: 2 }}>
                        {streaks.current} day{streaks.current !== 1 ? 's' : ''}
                      </div>
                      <div style={{ fontSize: 13, color: theme.textSubtle }}>
                        Best: {streaks.longest} day{streaks.longest !== 1 ? 's' : ''}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 32, fontWeight: 700, color: theme.textSubtle, lineHeight: 1.1, marginBottom: 2 }}>
                        0 days
                      </div>
                      <div style={{ fontSize: 13, color: theme.textSubtle, fontStyle: 'italic' }}>
                        Start reading today to build your streak!
                      </div>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <div style={{ fontSize: 11, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8 }}>Last 30 days</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 220 }}>
                    {last30.map(day => (
                      <div
                        key={day}
                        title={day}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: activityDays.has(day) ? '#5a7a5a' : '#e8e0d0',
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div style={s.twoCol}>

              {/* ── BOOKS PER YEAR ── */}
              <div style={s.chartCard}>
                <div style={s.chartTitle}>Books Read Per Year</div>
                {yearKeys.length === 0 ? (
                  <div style={s.chartEmpty}>No read books yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                    {yearKeys.map(year => {
                      const count = perYear[year]
                      const pct   = Math.round((count / maxPerYear) * 100)
                      return (
                        <div key={year} style={s.barRow}>
                          <div style={s.barLabel}>{year}</div>
                          <div style={s.barTrack}>
                            <div style={{ ...s.barFill, width: `${pct}%` }} />
                          </div>
                          <div style={s.barCount}>{count}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── GENRE BREAKDOWN ── */}
              <div style={s.chartCard}>
                <div style={s.chartTitle}>Genre Breakdown</div>
                {genreSlices.length === 0 ? (
                  <div style={s.chartEmpty}>No read books yet.</div>
                ) : (
                  <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                    <DonutChart slices={genreSlices} theme={theme} />
                    <div style={s.legendList}>
                      {genreSlices.map(([genre, count], i) => (
                        <div key={genre} style={s.legendRow}>
                          <div style={{ ...s.legendDot, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span style={s.legendGenre}>{genre}</span>
                          <span style={s.legendCount}>{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── READING SPEED ── */}
            {readingSessionStats && (
              <div style={s.chartCard}>
                <div style={s.chartTitle}>Reading Speed</div>
                <div style={s.highlightGrid}>
                  <HighlightTile
                    icon="📖"
                    label="Fiction Speed"
                    value={readingSessionStats.speeds.fiction ? `${readingSessionStats.speeds.fiction.toFixed(1)}` : '—'}
                    sub="pages/min"
                    theme={theme} s={s}
                  />
                  <HighlightTile
                    icon="📚"
                    label="Nonfiction Speed"
                    value={readingSessionStats.speeds.nonfiction ? `${readingSessionStats.speeds.nonfiction.toFixed(1)}` : '—'}
                    sub="pages/min"
                    theme={theme} s={s}
                  />
                  <HighlightTile
                    icon="⏱"
                    label="Total Reading Time"
                    value={formatDuration(readingSessionStats.totalMinutes)}
                    sub="tracked"
                    theme={theme} s={s}
                  />
                  <HighlightTile
                    icon="📊"
                    label="Sessions"
                    value={String(readingSessionStats.sessionCount)}
                    sub={`session${readingSessionStats.sessionCount !== 1 ? 's' : ''} logged`}
                    theme={theme} s={s}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: theme.textSubtle, fontStyle: 'italic' }}>
                    Speed improves with more reading sessions
                  </span>
                  <button
                    onClick={async () => {
                      if (!confirm('This will delete all your reading sessions and reset your speed data. Are you sure?')) return
                      await supabase.from('reading_sessions')
                        .delete()
                        .eq('user_id', session.user.id)
                      setReadingSessionStats(null)
                    }}
                    style={{ padding: '4px 12px', background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, color: theme.textSubtle, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}

            {/* ── HIGHLIGHTS ── */}
            <div style={s.chartCard}>
              <div style={s.chartTitle}>Reading Highlights</div>
              <div style={s.highlightGrid}>

                <HighlightTile
                  icon="✍️"
                  label="Most-Read Author"
                  value={topAuthor ? topAuthor[0] : '—'}
                  sub={topAuthor ? `${topAuthor[1]} book${topAuthor[1] !== 1 ? 's' : ''}` : undefined}
                  theme={theme}
                  s={s}
                />

                <HighlightTile
                  icon="📖"
                  label="Longest Book Read"
                  value={longestEntry ? longestEntry.books?.title : '—'}
                  sub={longestEntry?.books?.pages ? `${longestEntry.books.pages.toLocaleString()} pages` : undefined}
                  theme={theme}
                  s={s}
                />

                <HighlightTile
                  icon="🚀"
                  label="Best Month"
                  value={topMonthLabel ? topMonthLabel.label : '—'}
                  sub={topMonthLabel ? `${topMonthLabel.count} book${topMonthLabel.count !== 1 ? 's' : ''} finished` : undefined}
                  theme={theme}
                  s={s}
                />

                <HighlightTile
                  icon="🔥"
                  label="Reading Streak"
                  value={streak > 0 ? `${streak} month${streak !== 1 ? 's' : ''}` : '—'}
                  sub={streak > 0 ? 'consecutive months' : 'Start reading this month!'}
                  theme={theme}
                  s={s}
                />

              </div>
            </div>

            {/* ── BADGES ── */}
            <div style={s.section}>
              <div style={s.sectionHeadRow}>
                <h2 style={s.sectionTitle}>🏅 Badges & Trophies</h2>
                <span style={s.badgesEarnedPill}>
                  {badges.filter(b => b.earned).length} / {badges.length} earned
                </span>
              </div>
              {BADGE_CATEGORIES.map(cat => {
                const catBadges = badges.filter(b => b.category === cat)
                if (!catBadges.length) return null
                return (
                  <div key={cat} style={{ marginBottom: 24 }}>
                    <div style={s.badgeCatLabel}>{cat}</div>
                    <div style={s.badgeGrid}>
                      {catBadges.map(b => {
                        const ts = TIER_STYLES[b.tier]
                        return (
                          <div
                            key={b.id}
                            style={{
                              ...s.badgeCard,
                              background:  b.earned ? ts.bg      : theme.bgSubtle,
                              borderColor: b.earned ? ts.border  : theme.borderLight,
                              opacity:     b.earned ? 1 : 0.7,
                            }}
                          >
                            <div style={s.badgeEmoji}>{b.earned ? b.emoji : '🔒'}</div>
                            <div style={s.badgeCardName}>{b.name}</div>
                            <div style={s.badgeCardDesc}>{b.desc}</div>
                            {b.earned ? (
                              <div style={{ ...s.badgeTierPill, background: ts.bg, color: ts.text, border: `1px solid ${ts.border}` }}>
                                {ts.label}
                              </div>
                            ) : (
                              <div style={{ width: '100%', marginTop: 4 }}>
                                <div style={s.badgeProgressBg}>
                                  <div style={{ ...s.badgeProgressFill, width: `${b.pct}%`, background: ts.text }} />
                                </div>
                                <div style={s.badgeProgressLabel}>
                                  {b.prog.value.toLocaleString()} / {b.prog.max.toLocaleString()} {b.prog.label}
                                </div>
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

          </>
        )}
      </div>
    </div>
  )
}

// ── DONUT CHART (SVG, no library) ──
function DonutChart({ slices, theme }) {
  const total = slices.reduce((s, [, c]) => s + c, 0)
  if (total === 0) return null

  const SIZE   = 130
  const CX     = SIZE / 2
  const CY     = SIZE / 2
  const R      = 46
  const INNER  = 26

  let cumulative = 0
  const paths = slices.map(([genre, count], i) => {
    const frac  = count / total
    const start = cumulative
    cumulative += frac

    const startAngle = start * 2 * Math.PI - Math.PI / 2
    const endAngle   = cumulative * 2 * Math.PI - Math.PI / 2

    const x1o = CX + R * Math.cos(startAngle)
    const y1o = CY + R * Math.sin(startAngle)
    const x2o = CX + R * Math.cos(endAngle)
    const y2o = CY + R * Math.sin(endAngle)

    const x1i = CX + INNER * Math.cos(endAngle)
    const y1i = CY + INNER * Math.sin(endAngle)
    const x2i = CX + INNER * Math.cos(startAngle)
    const y2i = CY + INNER * Math.sin(startAngle)

    const largeArc = frac > 0.5 ? 1 : 0

    const d = [
      `M ${x1o} ${y1o}`,
      `A ${R} ${R} 0 ${largeArc} 1 ${x2o} ${y2o}`,
      `L ${x1i} ${y1i}`,
      `A ${INNER} ${INNER} 0 ${largeArc} 0 ${x2i} ${y2i}`,
      'Z',
    ].join(' ')

    return { d, color: CHART_COLORS[i % CHART_COLORS.length], genre }
  })

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ flexShrink: 0 }}>
      {paths.map(({ d, color, genre }) => (
        <path key={genre} d={d} fill={color} stroke={theme.bg} strokeWidth="1.5" />
      ))}
      <text x={CX} y={CY - 5} textAnchor="middle" fill={theme.text}
        style={{ fontSize: 16, fontWeight: 700, fontFamily: 'Georgia, serif' }}>
        {total}
      </text>
      <text x={CX} y={CY + 11} textAnchor="middle" fill={theme.textSubtle}
        style={{ fontSize: 8, fontFamily: "'DM Sans', sans-serif" }}>
        books
      </text>
    </svg>
  )
}

// ── HIGHLIGHT TILE ──
function HighlightTile({ icon, label, value, sub, s }) {
  return (
    <div style={s.highlightTile}>
      <div style={s.highlightIcon}>{icon}</div>
      <div style={s.highlightLabel}>{label}</div>
      <div style={s.highlightValue}>{value}</div>
      {sub && <div style={s.highlightSub}>{sub}</div>}
    </div>
  )
}

// ── LOADING SKELETON ──
function LoadingSkeleton() {
  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}.sk{background:linear-gradient(90deg,#e8e0d4 25%,#f0e8dc 50%,#e8e0d4 75%);background-size:800px 100%;animation:shimmer 1.4s infinite linear;border-radius:12px;}`}</style>
      <div style={{ display: 'flex', gap: 14, marginBottom: 28 }}>
        {[1,2,3,4].map(i => <div key={i} className="sk" style={{ flex: 1, height: 90 }} />)}
      </div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <div className="sk" style={{ flex: 1, height: 260 }} />
        <div className="sk" style={{ flex: 1, height: 260 }} />
      </div>
      <div className="sk" style={{ height: 180 }} />
    </>
  )
}

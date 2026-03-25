import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'

// ── PALETTE ──
const CREAM  = '#f5f0e8'
const RUST   = '#c0521e'
const SAGE   = '#5a7a5a'
const GOLD   = '#b8860b'
const INK    = '#1a1208'

const CHART_COLORS = [RUST, SAGE, GOLD, '#4a6b8a', '#7b4f3a', '#8b5e83', '#3d6b6b']

export default function Stats({ session }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('collection_entries')
      .select('*, books(*)')
      .eq('user_id', session.user.id)
    setEntries(data || [])
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
            <div style={{ fontSize: 13, color: '#8a7f72' }}>Add some books to start tracking your stats!</div>
          </div>
        ) : (
          <>
            {/* ── TOP STAT CARDS ── */}
            <div style={s.cardRow}>
              {[
                { label: 'Books in Collection', value: totalBooks,   icon: '📚', color: INK  },
                { label: 'Books Read',           value: booksRead,   icon: '✓',  color: SAGE },
                { label: 'Pages Read',           value: totalPages > 0 ? totalPages.toLocaleString() : '—', icon: '📄', color: RUST },
                { label: 'Avg Rating',           value: avgRating ? `★ ${avgRating}` : '—', icon: '⭐', color: GOLD },
              ].map(({ label, value, icon, color }) => (
                <div key={label} style={s.statCard}>
                  <div style={{ ...s.statVal, color }}>{icon} {value}</div>
                  <div style={s.statLabel}>{label}</div>
                </div>
              ))}
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
                    <DonutChart slices={genreSlices} />
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

            {/* ── HIGHLIGHTS ── */}
            <div style={s.chartCard}>
              <div style={s.chartTitle}>Reading Highlights</div>
              <div style={s.highlightGrid}>

                <HighlightTile
                  icon="✍️"
                  label="Most-Read Author"
                  value={topAuthor ? topAuthor[0] : '—'}
                  sub={topAuthor ? `${topAuthor[1]} book${topAuthor[1] !== 1 ? 's' : ''}` : undefined}
                />

                <HighlightTile
                  icon="📖"
                  label="Longest Book Read"
                  value={longestEntry ? longestEntry.books?.title : '—'}
                  sub={longestEntry?.books?.pages ? `${longestEntry.books.pages.toLocaleString()} pages` : undefined}
                />

                <HighlightTile
                  icon="🚀"
                  label="Best Month"
                  value={topMonthLabel ? topMonthLabel.label : '—'}
                  sub={topMonthLabel ? `${topMonthLabel.count} book${topMonthLabel.count !== 1 ? 's' : ''} finished` : undefined}
                />

                <HighlightTile
                  icon="🔥"
                  label="Reading Streak"
                  value={streak > 0 ? `${streak} month${streak !== 1 ? 's' : ''}` : '—'}
                  sub={streak > 0 ? 'consecutive months' : 'Start reading this month!'}
                />

              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── DONUT CHART (SVG, no library) ──
function DonutChart({ slices }) {
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
        <path key={genre} d={d} fill={color} stroke="#fdfaf4" strokeWidth="1.5" />
      ))}
      <text x={CX} y={CY - 5} textAnchor="middle" fill={INK}
        style={{ fontSize: 16, fontWeight: 700, fontFamily: 'Georgia, serif' }}>
        {total}
      </text>
      <text x={CX} y={CY + 11} textAnchor="middle" fill="#8a7f72"
        style={{ fontSize: 8, fontFamily: "'DM Sans', sans-serif" }}>
        books
      </text>
    </svg>
  )
}

// ── HIGHLIGHT TILE ──
function HighlightTile({ icon, label, value, sub }) {
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

// ── STYLES ──
const s = {
  page:    { minHeight: '100vh', background: CREAM, fontFamily: "'DM Sans', sans-serif" },
  content: { maxWidth: 960, margin: '0 auto', padding: '32px 32px 60px' },

  pageHeading:   { marginBottom: 28 },
  h1:            { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 700, color: INK, margin: 0, marginBottom: 4 },
  pageSubtitle:  { fontSize: 14, color: '#8a7f72' },

  cardRow:   { display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' },
  statCard:  { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 14, padding: '18px 22px', flex: 1, minWidth: 160 },
  statVal:   { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 26, fontWeight: 700, marginBottom: 4 },
  statLabel: { fontSize: 11, color: '#8a7f72', textTransform: 'uppercase', letterSpacing: 1 },

  twoCol:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 },

  chartCard:  { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, padding: '22px 24px' },
  chartTitle: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 17, fontWeight: 700, color: INK, marginBottom: 4 },
  chartEmpty: { fontSize: 13, color: '#8a7f72', padding: '20px 0' },

  barRow:   { display: 'flex', alignItems: 'center', gap: 10 },
  barLabel: { fontSize: 13, color: INK, fontWeight: 500, width: 40, flexShrink: 0, textAlign: 'right' },
  barTrack: { flex: 1, height: 14, background: 'rgba(192,82,30,0.1)', borderRadius: 8, overflow: 'hidden' },
  barFill:  { height: '100%', background: RUST, borderRadius: 8, transition: 'width 0.6s ease', minWidth: 4 },
  barCount: { fontSize: 12, color: '#8a7f72', width: 24, textAlign: 'left', flexShrink: 0 },

  legendList:  { display: 'flex', flexDirection: 'column', gap: 7, flex: 1 },
  legendRow:   { display: 'flex', alignItems: 'center', gap: 8 },
  legendDot:   { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  legendGenre: { fontSize: 13, color: INK, flex: 1 },
  legendCount: { fontSize: 12, color: '#8a7f72', fontWeight: 600 },

  highlightGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 8 },
  highlightTile: { background: 'rgba(192,82,30,0.04)', border: '1px solid rgba(192,82,30,0.12)', borderRadius: 12, padding: '16px 14px' },
  highlightIcon:  { fontSize: 22, marginBottom: 6 },
  highlightLabel: { fontSize: 10, color: '#8a7f72', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, fontWeight: 600 },
  highlightValue: { fontSize: 14, fontWeight: 700, color: INK, lineHeight: 1.35 },
  highlightSub:   { fontSize: 12, color: RUST, marginTop: 3 },

  empty:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '80px 0', color: '#8a7f72', fontSize: 15 },
}

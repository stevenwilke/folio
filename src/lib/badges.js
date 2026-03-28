/**
 * Badge definitions — shared by Profile, Stats, and mobile.
 *
 * Each badge has:
 *   id        – unique key
 *   emoji     – displayed when earned
 *   name      – short title
 *   desc      – what it takes to earn it
 *   category  – grouping label
 *   tier      – 'bronze' | 'silver' | 'gold' | 'platinum'
 *   check(data)     → boolean  (is it earned?)
 *   progress(data)  → { value, max, label } (how close, for locked badges)
 *
 * `data` shape passed to check/progress:
 *   {
 *     entries,      // full collection_entries rows (each has .books, .read_status, etc.)
 *     friendCount,  // number of accepted friends
 *   }
 */

// ─── helpers ────────────────────────────────────────────────────────────────

const readEntries   = (d) => d.entries.filter(e => e.read_status === 'read')
const reviewEntries = (d) => d.entries.filter(e => e.review_text)
const ratedEntries  = (d) => d.entries.filter(e => e.user_rating > 0)

function uniqueGenres(d) {
  return new Set(readEntries(d).map(e => e.books?.genre).filter(Boolean))
}
function totalPages(d) {
  return readEntries(d).reduce((sum, e) => sum + (e.books?.pages || 0), 0)
}
function longestBook(d) {
  return Math.max(0, ...readEntries(d).map(e => e.books?.pages || 0))
}
function uniqueAuthors(d) {
  return new Set(readEntries(d).map(e => e.books?.author).filter(Boolean))
}
function seriesGroups(d) {
  // group read books by series_name
  const map = {}
  for (const e of readEntries(d)) {
    const s = e.books?.series_name
    if (s) map[s] = (map[s] || 0) + 1
  }
  return Object.values(map)
}
function activeMonths(d) {
  return new Set(
    d.entries.map(e => e.added_at?.slice(0, 7)).filter(Boolean)
  )
}

// ─── badge definitions ───────────────────────────────────────────────────────

export const BADGE_DEFS = [

  // ── Reading Milestones ───────────────────────────────────────────────────
  {
    id: 'first_read', emoji: '🌱', name: 'First Chapter',
    desc: 'Finish your first book', category: 'Reading Milestones', tier: 'bronze',
    check: (d) => readEntries(d).length >= 1,
    progress: (d) => ({ value: readEntries(d).length, max: 1, label: 'books read' }),
  },
  {
    id: 'bookworm', emoji: '📚', name: 'Bookworm',
    desc: 'Read 10 books', category: 'Reading Milestones', tier: 'bronze',
    check: (d) => readEntries(d).length >= 10,
    progress: (d) => ({ value: readEntries(d).length, max: 10, label: 'books read' }),
  },
  {
    id: 'devoted', emoji: '📖', name: 'Devoted Reader',
    desc: 'Read 50 books', category: 'Reading Milestones', tier: 'silver',
    check: (d) => readEntries(d).length >= 50,
    progress: (d) => ({ value: readEntries(d).length, max: 50, label: 'books read' }),
  },
  {
    id: 'century', emoji: '🏆', name: 'Century Club',
    desc: 'Read 100 books', category: 'Reading Milestones', tier: 'gold',
    check: (d) => readEntries(d).length >= 100,
    progress: (d) => ({ value: readEntries(d).length, max: 100, label: 'books read' }),
  },
  {
    id: 'legendary', emoji: '👑', name: 'Legendary',
    desc: 'Read 500 books', category: 'Reading Milestones', tier: 'platinum',
    check: (d) => readEntries(d).length >= 500,
    progress: (d) => ({ value: readEntries(d).length, max: 500, label: 'books read' }),
  },

  // ── Pages ────────────────────────────────────────────────────────────────
  {
    id: 'page_turner', emoji: '📄', name: 'Page Turner',
    desc: 'Read 1,000 pages', category: 'Pages Read', tier: 'bronze',
    check: (d) => totalPages(d) >= 1000,
    progress: (d) => ({ value: totalPages(d), max: 1000, label: 'pages' }),
  },
  {
    id: 'marathon', emoji: '🏃', name: 'Marathon Reader',
    desc: 'Read 10,000 pages', category: 'Pages Read', tier: 'silver',
    check: (d) => totalPages(d) >= 10000,
    progress: (d) => ({ value: totalPages(d), max: 10000, label: 'pages' }),
  },
  {
    id: 'page_legend', emoji: '🌋', name: 'Page Legend',
    desc: 'Read 50,000 pages', category: 'Pages Read', tier: 'gold',
    check: (d) => totalPages(d) >= 50000,
    progress: (d) => ({ value: totalPages(d), max: 50000, label: 'pages' }),
  },

  // ── Deep Reads ───────────────────────────────────────────────────────────
  {
    id: 'deep_diver', emoji: '🔍', name: 'Deep Diver',
    desc: 'Finish a book over 500 pages', category: 'Deep Reads', tier: 'bronze',
    check: (d) => longestBook(d) >= 500,
    progress: (d) => ({ value: Math.min(longestBook(d), 500), max: 500, label: 'pages in longest book' }),
  },
  {
    id: 'tome_tamer', emoji: '🗿', name: 'Tome Tamer',
    desc: 'Finish a book over 800 pages', category: 'Deep Reads', tier: 'silver',
    check: (d) => longestBook(d) >= 800,
    progress: (d) => ({ value: Math.min(longestBook(d), 800), max: 800, label: 'pages in longest book' }),
  },
  {
    id: 'epic_reader', emoji: '⚔️', name: 'Epic Reader',
    desc: 'Finish a book over 1,000 pages', category: 'Deep Reads', tier: 'gold',
    check: (d) => longestBook(d) >= 1000,
    progress: (d) => ({ value: Math.min(longestBook(d), 1000), max: 1000, label: 'pages in longest book' }),
  },

  // ── Genres ───────────────────────────────────────────────────────────────
  {
    id: 'genre_curious', emoji: '🎨', name: 'Genre Curious',
    desc: 'Read books in 3 different genres', category: 'Genres', tier: 'bronze',
    check: (d) => uniqueGenres(d).size >= 3,
    progress: (d) => ({ value: uniqueGenres(d).size, max: 3, label: 'genres explored' }),
  },
  {
    id: 'explorer', emoji: '🎭', name: 'Genre Explorer',
    desc: 'Read books in 5 different genres', category: 'Genres', tier: 'silver',
    check: (d) => uniqueGenres(d).size >= 5,
    progress: (d) => ({ value: uniqueGenres(d).size, max: 5, label: 'genres explored' }),
  },
  {
    id: 'omnivore', emoji: '🌍', name: 'Genre Omnivore',
    desc: 'Read books in 10 different genres', category: 'Genres', tier: 'gold',
    check: (d) => uniqueGenres(d).size >= 10,
    progress: (d) => ({ value: uniqueGenres(d).size, max: 10, label: 'genres explored' }),
  },

  // ── Reviews & Ratings ────────────────────────────────────────────────────
  {
    id: 'opinionated', emoji: '💬', name: 'Opinionated',
    desc: 'Rate your first book', category: 'Reviews & Ratings', tier: 'bronze',
    check: (d) => ratedEntries(d).length >= 1,
    progress: (d) => ({ value: ratedEntries(d).length, max: 1, label: 'books rated' }),
  },
  {
    id: 'critic', emoji: '✍️', name: 'Critic',
    desc: 'Write 10 reviews', category: 'Reviews & Ratings', tier: 'silver',
    check: (d) => reviewEntries(d).length >= 10,
    progress: (d) => ({ value: reviewEntries(d).length, max: 10, label: 'reviews written' }),
  },
  {
    id: 'chief_critic', emoji: '🎓', name: 'Chief Critic',
    desc: 'Write 25 reviews', category: 'Reviews & Ratings', tier: 'gold',
    check: (d) => reviewEntries(d).length >= 25,
    progress: (d) => ({ value: reviewEntries(d).length, max: 25, label: 'reviews written' }),
  },

  // ── Social ───────────────────────────────────────────────────────────────
  {
    id: 'connected', emoji: '🤝', name: 'Connected',
    desc: 'Add your first friend', category: 'Social', tier: 'bronze',
    check: (d) => d.friendCount >= 1,
    progress: (d) => ({ value: d.friendCount, max: 1, label: 'friends' }),
  },
  {
    id: 'social', emoji: '🦋', name: 'Social Butterfly',
    desc: 'Make 10 friends', category: 'Social', tier: 'silver',
    check: (d) => d.friendCount >= 10,
    progress: (d) => ({ value: d.friendCount, max: 10, label: 'friends' }),
  },
  {
    id: 'connector', emoji: '🌐', name: 'Super Connector',
    desc: 'Make 25 friends', category: 'Social', tier: 'gold',
    check: (d) => d.friendCount >= 25,
    progress: (d) => ({ value: d.friendCount, max: 25, label: 'friends' }),
  },

  // ── Series ───────────────────────────────────────────────────────────────
  {
    id: 'series_starter', emoji: '📎', name: 'Series Starter',
    desc: 'Read 2 books in the same series', category: 'Series', tier: 'bronze',
    check: (d) => seriesGroups(d).some(n => n >= 2),
    progress: (d) => ({ value: Math.max(0, ...seriesGroups(d), 0), max: 2, label: 'books in best series' }),
  },
  {
    id: 'series_devotee', emoji: '🔗', name: 'Series Devotee',
    desc: 'Read 5 books in the same series', category: 'Series', tier: 'silver',
    check: (d) => seriesGroups(d).some(n => n >= 5),
    progress: (d) => ({ value: Math.max(0, ...seriesGroups(d), 0), max: 5, label: 'books in best series' }),
  },

  // ── Collection & Habits ──────────────────────────────────────────────────
  {
    id: 'completionist', emoji: '🌟', name: 'Completionist',
    desc: 'Have books in all 4 reading statuses',  category: 'Collection & Habits', tier: 'silver',
    check: (d) => {
      const ss = new Set(d.entries.map(e => e.read_status))
      return ['owned', 'reading', 'read', 'want'].every(s => ss.has(s))
    },
    progress: (d) => {
      const ss = new Set(d.entries.map(e => e.read_status))
      const have = ['owned', 'reading', 'read', 'want'].filter(s => ss.has(s)).length
      return { value: have, max: 4, label: 'statuses used' }
    },
  },
  {
    id: 'collector', emoji: '🗄️', name: 'Collector',
    desc: 'Add 50 books to your library', category: 'Collection & Habits', tier: 'silver',
    check: (d) => d.entries.length >= 50,
    progress: (d) => ({ value: d.entries.length, max: 50, label: 'books in library' }),
  },
  {
    id: 'bibliophile', emoji: '🏛️', name: 'Bibliophile',
    desc: 'Add 200 books to your library', category: 'Collection & Habits', tier: 'gold',
    check: (d) => d.entries.length >= 200,
    progress: (d) => ({ value: d.entries.length, max: 200, label: 'books in library' }),
  },
  {
    id: 'well_read', emoji: '🧭', name: 'Well Read',
    desc: 'Read books by 10 different authors', category: 'Collection & Habits', tier: 'silver',
    check: (d) => uniqueAuthors(d).size >= 10,
    progress: (d) => ({ value: uniqueAuthors(d).size, max: 10, label: 'authors read' }),
  },
  {
    id: 'monthly_habit', emoji: '📅', name: 'Monthly Habit',
    desc: 'Add books in 6 different months', category: 'Collection & Habits', tier: 'bronze',
    check: (d) => activeMonths(d).size >= 6,
    progress: (d) => ({ value: activeMonths(d).size, max: 6, label: 'active months' }),
  },
]

// ─── category order for display ──────────────────────────────────────────────

export const BADGE_CATEGORIES = [
  'Reading Milestones',
  'Pages Read',
  'Deep Reads',
  'Genres',
  'Reviews & Ratings',
  'Social',
  'Series',
  'Collection & Habits',
]

// ─── tier colours ─────────────────────────────────────────────────────────────

export const TIER_STYLES = {
  bronze:   { bg: 'rgba(180,100,40,0.12)',  border: 'rgba(180,100,40,0.35)',  text: '#a05a20', label: 'Bronze'   },
  silver:   { bg: 'rgba(120,120,140,0.12)', border: 'rgba(120,120,140,0.35)', text: '#6a6a88', label: 'Silver'   },
  gold:     { bg: 'rgba(184,134,11,0.14)',  border: 'rgba(184,134,11,0.40)',  text: '#a07808', label: 'Gold'     },
  platinum: { bg: 'rgba(80,160,160,0.12)',  border: 'rgba(80,160,160,0.35)', text: '#2a9090', label: 'Platinum' },
}

// ─── main compute function ───────────────────────────────────────────────────

/**
 * Returns the full badge list with `earned` and `pct` (0-100) filled in.
 * @param {object[]} entries   – collection_entries rows (each with .books)
 * @param {number}   friendCount
 */
export function computeBadges(entries, friendCount) {
  const data = { entries: entries || [], friendCount: friendCount || 0 }
  return BADGE_DEFS.map(b => {
    const earned = b.check(data)
    const prog   = b.progress(data)
    const pct    = Math.min(100, Math.round((prog.value / prog.max) * 100))
    return { ...b, earned, prog, pct }
  })
}

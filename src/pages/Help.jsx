import { Link, useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { triggerTutorial } from '../components/TutorialOverlay'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    body: [
      'Ex Libris Omnium is a personal library tracker for book lovers and collectors. Sign in, add a few books, and the app automatically pulls covers, authors, page counts, ratings, and current market prices.',
      'New to the app? Trigger the in-app tour any time from the avatar menu in the top right ("Take the tour"). It walks you through the four most useful features in about 30 seconds.',
    ],
  },
  {
    id: 'adding-books',
    title: 'Adding books',
    body: [
      'Tap "+ Add Book" in the top bar to open the search modal. You can search by title, author, or ISBN — results come from a combination of Open Library, Google Books, and our own database.',
      'On the mobile app you can also scan a barcode. Point the camera at the back-cover ISBN and the book is added in a second.',
      'Have a Goodreads library? From the avatar menu, choose "Import from Goodreads" and upload the export CSV. Your shelves and read dates come over intact.',
      'Manual entry is supported too — useful for rare or self-published books. Open the search modal and tap "Add manually" at the bottom.',
    ],
  },
  {
    id: 'searching',
    title: 'Searching',
    body: [
      'Two search tools, two purposes:',
      '• The magnifying-glass icon in the top bar (or Cmd+K / Ctrl+K) opens global search — looks across your library, public users, authors, and books in our catalog.',
      '• The search bar inside Library filters only the books on your shelves.',
      'Search is fuzzy: typos, partial titles, and partial author names all work.',
    ],
  },
  {
    id: 'library',
    title: 'Your library',
    body: [
      'Every book you own or want lives on the Library page. The four cards at the top show your current totals: in-library count, want-to-read count, retail value, and used-market value.',
      'Filter by status (Reading, Read, Want, Owned), group by shelf, genre, or author, and switch between grid and list views from the toolbar above the books.',
      'Tap any cover to open the book detail page, where you can change reading status, log progress, post a review, save quotes, and lend the book to a friend.',
    ],
  },
  {
    id: 'book-values',
    title: 'Book values',
    body: [
      'For every book in your collection we pull current retail and used-market prices, plus average rare/collectible prices when available. Totals roll up to the value cards at the top of your library.',
      'Open any book to see the full price breakdown: new retail, used paperback, used hardcover, and rare-and-collectible. Each links to a marketplace where you can buy that edition.',
      'Prices refresh in the background as you browse. If a price looks stale, open the book — it will re-fetch automatically.',
    ],
  },
  {
    id: 'reading',
    title: 'Tracking reading',
    body: [
      'Mark a book as Reading from its detail page and start a session whenever you read. The app times you in the background and saves total minutes, pages, and your current page when you stop.',
      'Reading sessions feed your reading speed estimate, weekly stats, streaks, and the "Still reading?" nudges that arrive after 14 days of inactivity.',
      'Want a weekly summary by email? Toggle "Weekly reading report" in your account settings.',
    ],
  },
  {
    id: 'shelves',
    title: 'Shelves & organization',
    body: [
      'Shelves let you group books however you like — by genre, mood, location in your house, or anything else. From the avatar menu, choose "My Shelves" to create and manage them.',
      'Books can live on multiple shelves at once. Inside the Library, change the "Group" dropdown to "Shelf" to see your library laid out by shelf.',
    ],
  },
  {
    id: 'social',
    title: 'Friends, loans, and clubs',
    body: [
      'Add friends from the Friends page or by sharing your profile link. Friends can see your reviews, quotes, and shelves (subject to your privacy settings).',
      'List a book as available to lend, and friends can request to borrow it from the Loans page. You\'ll get a push notification on each request.',
      'Book Clubs let you start group reads with discussion threads, polls, and shared pace tracking. Create one from the Clubs page.',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    body: [
      'We don\'t sell user data — full stop. The app uses one privacy-respecting analytics tool (Microsoft Clarity) to understand which features get used, and you can opt out from the cookie banner at any time.',
      'Your library is private by default. You can choose to make your profile public from account settings, which lets others see your shelves and reviews via your username.',
      'Read the full policy at the privacy page link in the footer.',
    ],
  },
  {
    id: 'support',
    title: 'Need more help?',
    body: [
      'Email us via the Contact page (linked in the footer) and we\'ll respond within a couple of days.',
    ],
  },
]

export default function Help({ session }) {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  const s = {
    page:      { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    container: { maxWidth: 760, margin: '0 auto', padding: isMobile ? '32px 20px 60px' : '48px 24px 80px' },
    heading:   { fontFamily: 'Georgia, serif', fontSize: isMobile ? 28 : 36, fontWeight: 700, color: theme.text, marginBottom: 8 },
    sub:       { fontSize: 15, color: theme.textSubtle, marginBottom: 36, lineHeight: 1.5 },
    tocBox:    { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '20px 24px', marginBottom: 40 },
    tocTitle:  { fontSize: 11, fontWeight: 600, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
    tocList:   { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '6px 16px', margin: 0, padding: 0, listStyle: 'none' },
    tocLink:   { color: theme.rust, textDecoration: 'none', fontSize: 14, padding: '4px 0', display: 'block' },
    sectionH:  { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, marginTop: 36, marginBottom: 12, scrollMarginTop: 80 },
    para:      { fontSize: 15, lineHeight: 1.7, color: theme.text, margin: '0 0 12px', whiteSpace: 'pre-line' },
    cta:       { marginTop: 48, padding: '20px 24px', background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
    ctaText:   { fontSize: 14, color: theme.text },
    ctaBtn:    { padding: '10px 22px', background: theme.rust, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-block' },
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.container}>
        <h1 style={s.heading}>Help & FAQ</h1>
        <p style={s.sub}>
          Everything you need to know about using Ex Libris Omnium. Skim the table of contents, or scroll through.
        </p>

        <nav style={s.tocBox} aria-label="Help topics">
          <div style={s.tocTitle}>On this page</div>
          <ul style={s.tocList}>
            {SECTIONS.map(sec => (
              <li key={sec.id}>
                <a href={`#${sec.id}`} style={s.tocLink}>{sec.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        {SECTIONS.map(sec => (
          <section key={sec.id} id={sec.id}>
            <h2 style={s.sectionH}>{sec.title}</h2>
            {sec.body.map((p, i) => (
              <p key={i} style={s.para}>{p}</p>
            ))}
          </section>
        ))}

        {session ? (
          <div style={s.cta}>
            <span style={s.ctaText}>Want to replay the in-app tour?</span>
            <button style={s.ctaBtn} onClick={() => triggerTutorial(navigate)}>
              Take the tour
            </button>
          </div>
        ) : (
          <div style={s.cta}>
            <span style={s.ctaText}>Ready to start your library?</span>
            <Link to="/auth" style={s.ctaBtn}>Sign up free</Link>
          </div>
        )}
      </div>
    </div>
  )
}

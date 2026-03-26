import { Link } from 'react-router-dom'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'

const ACCENT_COLORS = {
  rust: '#c0521e',
  sage: '#5a7a5a',
  gold: '#b8860b',
  ink: '#1a1208',
  cream: '#f5f0e8',
  card: '#fdfaf4',
  muted: '#8a7f72',
  border: '#d4c9b0',
}

const FEATURES = [
  {
    icon: '📚',
    title: 'Your Library, Perfected',
    body: 'Track every book you own, have read, or want to read. Import your entire Goodreads history in one click.',
  },
  {
    icon: '👥',
    title: 'Read with Friends',
    body: 'See what your friends are reading, share reviews, lend books, and discover your next read through people you trust.',
  },
  {
    icon: '🏪',
    title: 'Buy & Sell Books',
    body: 'List books you no longer need. Find affordable copies from readers in your community.',
  },
]

const FAKE_COVERS = [
  { color: '#7b4f3a', color2: '#4a3028', title: 'The Name of the Wind' },
  { color: '#4a6b8a', color2: '#2c4a6b', title: 'Dune' },
  { color: '#5a7a5a', color2: '#3a5a3a', title: 'Piranesi' },
  { color: '#8b2500', color2: '#6b1800', title: 'A Little Life' },
  { color: '#b8860b', color2: '#8b6508', title: 'Middlemarch' },
  { color: '#3d5a5a', color2: '#2a4040', title: 'Station Eleven' },
]

function FakeCover({ color, color2, title }) {
  return (
    <div style={{
      width: 72, height: 108, borderRadius: 4, flexShrink: 0,
      background: `linear-gradient(135deg, ${color}, ${color2})`,
      position: 'relative', overflow: 'hidden',
      boxShadow: '2px 4px 12px rgba(0,0,0,0.25)',
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: 'rgba(0,0,0,0.25)' }} />
      <div style={{
        position: 'absolute', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 8, zIndex: 2,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.92)',
          textAlign: 'center', lineHeight: 1.3,
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>{title}</span>
      </div>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
        background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent)',
      }} />
    </div>
  )
}

function MockFeedCard() {
  return (
    <div style={{
      background: ACCENT_COLORS.card, border: `1px solid ${ACCENT_COLORS.border}`,
      borderRadius: 12, padding: '16px 20px', maxWidth: 320,
      boxShadow: '0 2px 12px rgba(26,18,8,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', background: ACCENT_COLORS.rust,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 700, fontSize: 14, flexShrink: 0,
        }}>S</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: ACCENT_COLORS.ink }}>sarahreads</div>
          <div style={{ fontSize: 11, color: ACCENT_COLORS.muted }}>just finished reading</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 44, height: 66, borderRadius: 3, flexShrink: 0,
          background: `linear-gradient(135deg, #4a6b8a, #2c4a6b)`,
          boxShadow: '1px 2px 6px rgba(0,0,0,0.2)',
        }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT_COLORS.ink, fontFamily: 'Georgia, serif', lineHeight: 1.3 }}>The Midnight Library</div>
          <div style={{ fontSize: 12, color: ACCENT_COLORS.muted, marginTop: 2 }}>Matt Haig</div>
          <div style={{ fontSize: 14, color: ACCENT_COLORS.gold, marginTop: 6, letterSpacing: 1 }}>★★★★★</div>
          <div style={{ fontSize: 12, color: ACCENT_COLORS.ink, marginTop: 6, fontStyle: 'italic', lineHeight: 1.4 }}>"One of the most moving books I've ever read."</div>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const s = makeStyles(theme, isMobile)

  return (
    <div style={s.page}>

      {/* ── Hero ── */}
      <section style={s.hero}>
        {/* Floating decorations */}
        {!isMobile && (
          <>
            <span style={{ ...s.deco, top: '12%', left: '8%', fontSize: 48, transform: 'rotate(-15deg)', opacity: 0.12 }}>📖</span>
            <span style={{ ...s.deco, top: '20%', right: '10%', fontSize: 64, transform: 'rotate(12deg)', opacity: 0.1 }}>📚</span>
            <span style={{ ...s.deco, bottom: '20%', left: '6%', fontSize: 40, transform: 'rotate(8deg)', opacity: 0.1 }}>🔖</span>
            <span style={{ ...s.deco, bottom: '15%', right: '8%', fontSize: 52, transform: 'rotate(-10deg)', opacity: 0.12 }}>✍️</span>
          </>
        )}

        <div style={s.heroInner}>
          <div style={s.wordmark}>Ex Libris</div>
          <div style={s.subtitle}>Ex Libris Omnium</div>
          <p style={s.tagline}>Your library. Your community. Every book you've ever loved.</p>
          <div style={s.heroBtns}>
            <Link to="/auth" style={s.btnPrimary}>Get Started — It's Free</Link>
            <Link to="/auth" style={s.btnOutline}>Sign In</Link>
          </div>
          <p style={s.heroNote}>Already on Goodreads? Import your library in seconds.</p>
        </div>
      </section>

      {/* ── Features ── */}
      <section style={s.featuresSection}>
        <div style={s.featuresGrid}>
          {FEATURES.map(f => (
            <div key={f.title} style={s.featureCard}>
              <div style={s.featureIcon}>{f.icon}</div>
              <div style={s.featureTitle}>{f.title}</div>
              <p style={s.featureBody}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stats band ── */}
      <section style={s.statsBand}>
        {[
          { icon: '📖', label: 'Track Your Reading' },
          { icon: '🌟', label: 'Discover New Books' },
          { icon: '🤝', label: 'Connect with Readers' },
        ].map(({ icon, label }) => (
          <div key={label} style={s.statItem}>
            <span style={s.statIcon}>{icon}</span>
            <span style={s.statLabel}>{label}</span>
          </div>
        ))}
      </section>

      {/* ── Showcase 1: Library ── */}
      <section style={s.showcase}>
        <div style={{ ...s.showcaseRow, flexDirection: isMobile ? 'column' : 'row' }}>
          <div style={s.showcaseText}>
            <h2 style={s.showcaseHeadline}>Your entire reading life, organized</h2>
            <p style={s.showcaseBody}>
              From the books on your nightstand to the ones you read in college — Ex Libris keeps your full reading history in one beautiful place. Set reading goals, track your progress, and celebrate every book finished.
            </p>
            <Link to="/auth" style={s.showcaseLink}>Start tracking →</Link>
          </div>
          <div style={s.showcaseVisual}>
            <div style={s.fakeLibrary}>
              {FAKE_COVERS.map((c, i) => (
                <FakeCover key={i} {...c} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Showcase 2: Feed ── */}
      <section style={{ ...s.showcase, background: theme.bgSubtle || '#f0ebe0' }}>
        <div style={{ ...s.showcaseRow, flexDirection: isMobile ? 'column' : 'row-reverse' }}>
          <div style={s.showcaseText}>
            <h2 style={s.showcaseHeadline}>Discover through people you trust</h2>
            <p style={s.showcaseBody}>
              Algorithmic recommendations are fine. Your best friend's book recs are better. See what your friends are reading right now, what they loved, and what they couldn't put down.
            </p>
            <Link to="/auth" style={s.showcaseLink}>Find your friends →</Link>
          </div>
          <div style={{ ...s.showcaseVisual, alignItems: isMobile ? 'center' : 'flex-start' }}>
            <MockFeedCard />
          </div>
        </div>
      </section>

      {/* ── Goodreads callout ── */}
      <section style={s.goodreadsSection}>
        <div style={s.goodreadsCard}>
          <div style={s.goodreadsIcon}>📥</div>
          <h2 style={s.goodreadsHeadline}>Already on Goodreads?</h2>
          <p style={s.goodreadsBody}>
            Import your entire reading history in seconds. Ex Libris reads your Goodreads export and brings everything over — ratings, shelves, read dates, and all.
          </p>
          <Link to="/auth" style={s.btnGold}>Import from Goodreads →</Link>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={s.finalCta}>
        <h2 style={s.finalHeadline}>Start your library today.</h2>
        <p style={s.finalSub}>Free forever for personal use.</p>
        <Link to="/auth" style={s.btnPrimaryLarge}>Create Your Free Account</Link>
      </section>

      {/* ── Footer ── */}
      <footer style={s.footer}>
        <span>© 2026 Ex Libris Omnium</span>
        <span style={s.footerSep}>·</span>
        <a href="#" style={s.footerLink}>Privacy</a>
        <span style={s.footerSep}>·</span>
        <a href="#" style={s.footerLink}>Terms</a>
      </footer>
    </div>
  )
}

function makeStyles(theme, isMobile) {
  return {
    page:             { fontFamily: "'DM Sans', sans-serif", color: theme.text, background: theme.bg, minHeight: '100vh' },
    deco:             { position: 'absolute', userSelect: 'none', pointerEvents: 'none' },

    // Hero
    hero:             { position: 'relative', minHeight: '90vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.bg, overflow: 'hidden', padding: isMobile ? '80px 24px 60px' : '80px 40px' },
    heroInner:        { position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 640 },
    wordmark:         { fontFamily: 'Georgia, serif', fontSize: isMobile ? 48 : 80, fontWeight: 700, color: theme.rust, letterSpacing: '-1px', lineHeight: 1 },
    subtitle:         { fontSize: isMobile ? 13 : 15, fontVariant: 'small-caps', letterSpacing: '0.2em', color: theme.textSubtle, marginTop: 8, marginBottom: 24 },
    tagline:          { fontSize: isMobile ? 18 : 22, color: theme.text, lineHeight: 1.5, margin: '0 auto 36px', maxWidth: 480 },
    heroBtns:         { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' },
    btnPrimary:       { display: 'inline-block', padding: '14px 28px', background: theme.rust, color: 'white', textDecoration: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" },
    btnOutline:       { display: 'inline-block', padding: '14px 28px', border: `2px solid ${theme.rust}`, color: theme.rust, textDecoration: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", background: 'transparent' },
    heroNote:         { fontSize: 13, color: theme.textSubtle, marginTop: 20 },

    // Features
    featuresSection:  { padding: isMobile ? '60px 20px' : '80px 40px', maxWidth: 1100, margin: '0 auto' },
    featuresGrid:     { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 24 },
    featureCard:      { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: isMobile ? 24 : 32, boxShadow: theme.shadow },
    featureIcon:      { fontSize: 40, marginBottom: 16 },
    featureTitle:     { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 10 },
    featureBody:      { fontSize: 14, color: theme.textMuted, lineHeight: 1.6, margin: 0 },

    // Stats band
    statsBand:        { background: theme.rust, padding: isMobile ? '32px 20px' : '40px', display: 'flex', justifyContent: 'center', gap: isMobile ? 32 : 80, flexWrap: 'wrap' },
    statItem:         { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
    statIcon:         { fontSize: 32 },
    statLabel:        { fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.04em' },

    // Showcases
    showcase:         { padding: isMobile ? '60px 20px' : '80px 40px' },
    showcaseRow:      { display: 'flex', gap: isMobile ? 40 : 80, alignItems: 'center', maxWidth: 1100, margin: '0 auto' },
    showcaseText:     { flex: 1, minWidth: 0 },
    showcaseHeadline: { fontFamily: 'Georgia, serif', fontSize: isMobile ? 28 : 36, fontWeight: 700, color: theme.text, margin: '0 0 16px', lineHeight: 1.2 },
    showcaseBody:     { fontSize: 16, color: theme.textMuted, lineHeight: 1.7, margin: '0 0 24px' },
    showcaseLink:     { display: 'inline-block', fontSize: 15, fontWeight: 600, color: theme.rust, textDecoration: 'none' },
    showcaseVisual:   { flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minWidth: 0 },
    fakeLibrary:      { display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 10, padding: 20, background: theme.bgCard, borderRadius: 16, border: `1px solid ${theme.border}`, boxShadow: theme.shadowCard },

    // Goodreads
    goodreadsSection: { padding: isMobile ? '60px 20px' : '80px 40px', display: 'flex', justifyContent: 'center', background: theme.bg },
    goodreadsCard:    { background: theme.bgCard, border: `2px solid ${theme.gold}`, borderRadius: 20, padding: isMobile ? '40px 24px' : '56px 64px', textAlign: 'center', maxWidth: 560, boxShadow: theme.shadow },
    goodreadsIcon:    { fontSize: 48, marginBottom: 16 },
    goodreadsHeadline:{ fontFamily: 'Georgia, serif', fontSize: isMobile ? 26 : 32, fontWeight: 700, color: theme.text, margin: '0 0 12px' },
    goodreadsBody:    { fontSize: 15, color: theme.textMuted, lineHeight: 1.7, margin: '0 0 28px' },
    btnGold:          { display: 'inline-block', padding: '14px 28px', background: theme.gold, color: 'white', textDecoration: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" },

    // Final CTA
    finalCta:         { background: theme.ink || '#1a1208', padding: isMobile ? '80px 24px' : '100px 40px', textAlign: 'center' },
    finalHeadline:    { fontFamily: 'Georgia, serif', fontSize: isMobile ? 36 : 52, fontWeight: 700, color: '#f5f0e8', margin: '0 0 12px', lineHeight: 1.1 },
    finalSub:         { fontSize: 16, color: 'rgba(245,240,232,0.65)', margin: '0 0 36px' },
    btnPrimaryLarge:  { display: 'inline-block', padding: '16px 36px', background: theme.rust, color: 'white', textDecoration: 'none', borderRadius: 12, fontSize: 17, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" },

    // Footer
    footer:           { padding: '24px 40px', textAlign: 'center', fontSize: 13, color: theme.textSubtle, display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', background: theme.bg, borderTop: `1px solid ${theme.border}` },
    footerSep:        { color: theme.border },
    footerLink:       { color: theme.textSubtle, textDecoration: 'none' },
  }
}

import { useTheme } from '../contexts/ThemeContext'
import NavBar from '../components/NavBar'
import { Link } from 'react-router-dom'
import { useIsMobile } from '../hooks/useIsMobile'

const EFFECTIVE_DATE = 'April 4, 2026'
const CONTACT_EMAIL  = 'privacy@exlibrisomnium.com'

export default function PrivacyPolicy({ session }) {
  const { theme } = useTheme()
  const isMobile   = useIsMobile()

  const s = {
    page:      { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif", color: theme.text },
    wrap:      { maxWidth: 780, margin: '0 auto', padding: isMobile ? '24px 20px 60px' : '48px 32px 80px' },
    back:      { display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.textMuted, fontSize: 13, textDecoration: 'none', marginBottom: 32 },
    eyebrow:   { fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: theme.rust, marginBottom: 8 },
    h1:        { fontSize: isMobile ? 28 : 36, fontWeight: 700, color: theme.text, margin: '0 0 8px' },
    subtitle:  { fontSize: 14, color: theme.textMuted, marginBottom: 40 },
    divider:   { border: 'none', borderTop: `1px solid ${theme.border}`, margin: '36px 0' },
    h2:        { fontSize: 18, fontWeight: 700, color: theme.text, margin: '36px 0 12px' },
    h3:        { fontSize: 15, fontWeight: 600, color: theme.text, margin: '24px 0 8px' },
    p:         { fontSize: 15, lineHeight: 1.75, color: theme.textMuted, margin: '0 0 16px' },
    ul:        { fontSize: 15, lineHeight: 1.75, color: theme.textMuted, margin: '0 0 16px', paddingLeft: 24 },
    li:        { marginBottom: 6 },
    highlight: { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '16px 20px', marginBottom: 20 },
    tag:       { display: 'inline-block', fontSize: 11, fontWeight: 600, background: theme.rust + '20', color: theme.rust, borderRadius: 4, padding: '2px 7px', marginRight: 6, marginBottom: 4 },
  }

  return (
    <div style={s.page}>
      {session && <NavBar session={session} />}
      <div style={s.wrap}>
        <Link to="/" style={s.back}>← Back to Ex Libris Omnium</Link>

        <div style={s.eyebrow}>Legal</div>
        <h1 style={s.h1}>Privacy Policy</h1>
        <p style={s.subtitle}>Effective date: {EFFECTIVE_DATE} · Last updated: {EFFECTIVE_DATE}</p>

        <div style={s.highlight}>
          <p style={{ ...s.p, margin: 0 }}>
            <strong>Summary:</strong> We collect only what we need to run Ex Libris Omnium. We do not sell
            your personal data. EU/EEA users have full GDPR rights. You can request deletion of your
            account and data at any time by emailing <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: theme.rust }}>{CONTACT_EMAIL}</a>.
          </p>
        </div>

        <hr style={s.divider} />

        {/* 1 */}
        <h2 style={s.h2}>1. Who We Are</h2>
        <p style={s.p}>
          Ex Libris Omnium ("we", "us", "our") is a book community platform that lets you manage your
          personal library, discover books, connect with other readers, lend and borrow books, and buy
          and sell books peer-to-peer. This Privacy Policy explains what personal data we collect, why
          we collect it, and your rights regarding it.
        </p>
        <p style={s.p}>
          For privacy-related inquiries contact us at:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: theme.rust }}>{CONTACT_EMAIL}</a>
        </p>

        {/* 2 */}
        <h2 style={s.h2}>2. Data We Collect</h2>

        <h3 style={s.h3}>Account &amp; Profile Data</h3>
        <ul style={s.ul}>
          <li style={s.li}>Email address (used for login and transactional emails)</li>
          <li style={s.li}>Display name / username chosen by you</li>
          <li style={s.li}>Profile bio and avatar image (optional, user-provided)</li>
        </ul>

        <h3 style={s.h3}>Library &amp; Reading Data</h3>
        <ul style={s.ul}>
          <li style={s.li}>Books you add to your library and their read status (read, reading, want to read)</li>
          <li style={s.li}>Ratings, reviews, and reading journal entries you write</li>
          <li style={s.li}>Reading goals and statistics (pages read, books finished, streaks)</li>
          <li style={s.li}>Custom shelves and book tags you create</li>
          <li style={s.li}>Book club memberships and poll participation</li>
        </ul>

        <h3 style={s.h3}>Social &amp; Marketplace Data</h3>
        <ul style={s.ul}>
          <li style={s.li}>Friend connections and follow relationships</li>
          <li style={s.li}>Book loan requests you send or receive</li>
          <li style={s.li}>Marketplace listings you create (book title, condition, asking price)</li>
          <li style={s.li}>Messages or notes exchanged as part of a marketplace transaction</li>
        </ul>

        <h3 style={s.h3}>Technical Data</h3>
        <ul style={s.ul}>
          <li style={s.li}>Authentication tokens stored in your browser (via Supabase Auth)</li>
          <li style={s.li}>Basic error and usage logs retained for up to 30 days</li>
        </ul>

        <p style={{ ...s.p, fontStyle: 'italic' }}>
          We do <strong>not</strong> collect payment card details. Any peer-to-peer payments for marketplace
          transactions are arranged directly between buyers and sellers outside our platform; we are not
          a party to those payment flows.
        </p>

        {/* 3 */}
        <h2 style={s.h2}>3. How We Use Your Data</h2>
        <ul style={s.ul}>
          <li style={s.li}><strong>Providing the service</strong> — running your library, feed, marketplace listings, and loans</li>
          <li style={s.li}><strong>Account authentication</strong> — verifying your identity on each login</li>
          <li style={s.li}><strong>Transactional emails</strong> — sending cover-review notifications, loan requests, and marketplace activity emails via Resend</li>
          <li style={s.li}><strong>Book metadata enrichment</strong> — looking up cover images, descriptions, and ISBNs via Google Books and Open Library APIs using your book's title/author (no personal data is shared with these APIs)</li>
          <li style={s.li}><strong>Service improvement</strong> — aggregated, anonymised analytics to understand feature usage</li>
        </ul>
        <p style={s.p}>
          We do <strong>not</strong> use your data for advertising, profiling for third-party marketing,
          or automated individual decision-making.
        </p>

        {/* 4 */}
        <h2 style={s.h2}>4. Legal Bases for Processing (GDPR)</h2>
        <p style={s.p}>For users in the EU / EEA, our legal bases for processing personal data are:</p>
        <ul style={s.ul}>
          <li style={s.li}><strong>Contract performance</strong> (Art. 6(1)(b)) — processing necessary to provide the service you signed up for</li>
          <li style={s.li}><strong>Legitimate interests</strong> (Art. 6(1)(f)) — security logging, fraud prevention, service improvement</li>
          <li style={s.li}><strong>Consent</strong> (Art. 6(1)(a)) — optional features such as public profile visibility; you may withdraw consent at any time</li>
          <li style={s.li}><strong>Legal obligation</strong> (Art. 6(1)(c)) — where we are required by law to retain records</li>
        </ul>

        {/* 5 */}
        <h2 style={s.h2}>5. Third-Party Services</h2>
        <div style={s.highlight}>
          <p style={{ ...s.p, margin: '0 0 12px' }}>We use the following sub-processors:</p>
          <ul style={{ ...s.ul, margin: 0 }}>
            <li style={s.li}><strong>Supabase</strong> (database, authentication, file storage) — data may be stored on servers in the US and EU. Supabase is compliant with GDPR. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: theme.rust }}>Supabase Privacy Policy</a></li>
            <li style={s.li}><strong>Resend</strong> (transactional email) — your email address is transmitted to Resend only to deliver emails you have triggered. <a href="https://resend.com/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: theme.rust }}>Resend Privacy Policy</a></li>
            <li style={s.li}><strong>Google Books API</strong> — used server-side to look up book metadata. No personal data is sent; only book titles and ISBNs.</li>
            <li style={s.li}><strong>Open Library (Internet Archive)</strong> — used to fetch public-domain book cover images. No personal data is sent.</li>
          </ul>
        </div>
        <p style={s.p}>We do not share your personal data with any other third parties.</p>

        {/* 6 */}
        <h2 style={s.h2}>6. Cookies &amp; Local Storage</h2>
        <p style={s.p}>
          We use a single authentication session cookie set by Supabase to keep you logged in. We do not
          use advertising cookies, tracking pixels, or third-party analytics cookies. Local storage may
          be used to cache non-personal preferences such as theme (light/dark mode).
        </p>

        {/* 7 */}
        <h2 style={s.h2}>7. Data Retention</h2>
        <ul style={s.ul}>
          <li style={s.li}>Account and library data is retained for as long as your account is active</li>
          <li style={s.li}>Deleted reviews, journal entries, or listings are removed immediately</li>
          <li style={s.li}>On account deletion we permanently erase all personal data within 30 days</li>
          <li style={s.li}>Anonymised aggregate statistics may be retained indefinitely</li>
        </ul>

        {/* 8 */}
        <h2 style={s.h2}>8. Your Rights (GDPR &amp; Equivalent)</h2>
        <p style={s.p}>Depending on your jurisdiction, you have the right to:</p>
        <ul style={s.ul}>
          <li style={s.li}><strong>Access</strong> — request a copy of all personal data we hold about you</li>
          <li style={s.li}><strong>Rectification</strong> — ask us to correct inaccurate data</li>
          <li style={s.li}><strong>Erasure ("right to be forgotten")</strong> — request deletion of your account and all associated personal data</li>
          <li style={s.li}><strong>Restriction</strong> — ask us to pause processing while a dispute is resolved</li>
          <li style={s.li}><strong>Portability</strong> — receive your library data in a machine-readable format</li>
          <li style={s.li}><strong>Object</strong> — object to processing based on legitimate interests</li>
          <li style={s.li}><strong>Withdraw consent</strong> — withdraw consent for any consent-based processing at any time without affecting prior processing</li>
        </ul>
        <p style={s.p}>
          To exercise any of these rights, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: theme.rust }}>{CONTACT_EMAIL}</a>. We will
          respond within 30 days. If you are in the EU/EEA and believe we have not handled your request
          properly, you have the right to lodge a complaint with your national supervisory authority.
        </p>

        {/* 9 */}
        <h2 style={s.h2}>9. Children's Privacy</h2>
        <p style={s.p}>
          Ex Libris Omnium is not directed at children under 13 (or under 16 where required by local law).
          We do not knowingly collect personal data from children. If you believe a child has created an
          account, please contact us and we will delete it promptly.
        </p>

        {/* 10 */}
        <h2 style={s.h2}>10. Security</h2>
        <p style={s.p}>
          All data is transmitted over HTTPS/TLS. Passwords are never stored — we use Supabase Auth's
          secure, salted token system. Database access is governed by Row-Level Security (RLS) policies
          that ensure users can only access their own data. Despite these measures, no system is 100%
          secure and we cannot guarantee absolute security.
        </p>

        {/* 11 */}
        <h2 style={s.h2}>11. Changes to This Policy</h2>
        <p style={s.p}>
          We may update this Privacy Policy from time to time. We will notify you of significant changes
          via a banner on the app or by email. The "last updated" date at the top of this page will
          always reflect the most recent version. Continued use of the service after changes constitutes
          acceptance of the updated policy.
        </p>

        {/* 12 */}
        <h2 style={s.h2}>12. Contact</h2>
        <p style={s.p}>
          For any questions about this Privacy Policy or to exercise your data rights:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: theme.rust }}>{CONTACT_EMAIL}</a>
        </p>

        <hr style={s.divider} />
        <p style={{ ...s.p, fontSize: 13 }}>
          <Link to="/terms" style={{ color: theme.rust }}>Terms of Service</Link>
          {' · '}
          <Link to="/" style={{ color: theme.rust }}>Back to Ex Libris Omnium</Link>
        </p>
      </div>
    </div>
  )
}

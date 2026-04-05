import { useTheme } from '../contexts/ThemeContext'
import NavBar from '../components/NavBar'
import { Link } from 'react-router-dom'
import { useIsMobile } from '../hooks/useIsMobile'

const EFFECTIVE_DATE = 'April 4, 2026'
const CONTACT_EMAIL  = 'hello@exlibriso.com'

export default function TermsOfService({ session }) {
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
    warning:   { background: theme.rust + '12', border: `1px solid ${theme.rust + '40'}`, borderRadius: 10, padding: '16px 20px', marginBottom: 20 },
  }

  return (
    <div style={s.page}>
      {session && <NavBar session={session} />}
      <div style={s.wrap}>
        <Link to="/" style={s.back}>← Back to Ex Libris Omnium</Link>

        <div style={s.eyebrow}>Legal</div>
        <h1 style={s.h1}>Terms of Service</h1>
        <p style={s.subtitle}>Effective date: {EFFECTIVE_DATE} · Last updated: {EFFECTIVE_DATE}</p>

        <div style={s.highlight}>
          <p style={{ ...s.p, margin: 0 }}>
            <strong>Please read these terms carefully.</strong> By creating an account or using Ex Libris
            Omnium, you agree to these Terms of Service. If you do not agree, please do not use the
            service.
          </p>
        </div>

        <hr style={s.divider} />

        {/* 1 */}
        <h2 style={s.h2}>1. About Ex Libris Omnium</h2>
        <p style={s.p}>
          Ex Libris Omnium is a book community platform ("the Service") that provides tools for personal
          library management, reading tracking, social features (reviews, feeds, book clubs), book lending
          between users, and a peer-to-peer marketplace for buying and selling physical books. The Service
          is operated by Ex Libris Omnium ("we", "us", "our").
        </p>
        <p style={s.p}>
          Questions or concerns: <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: theme.rust }}>{CONTACT_EMAIL}</a>
        </p>

        {/* 2 */}
        <h2 style={s.h2}>2. Eligibility</h2>
        <p style={s.p}>
          You must be at least 13 years old to use the Service. Users aged 13–17 may only use the Service
          with parental or guardian consent. By creating an account you represent that you meet these age
          requirements. We reserve the right to terminate accounts that violate this requirement.
        </p>

        {/* 3 */}
        <h2 style={s.h2}>3. Your Account</h2>
        <ul style={s.ul}>
          <li style={s.li}>You are responsible for maintaining the confidentiality of your login credentials</li>
          <li style={s.li}>You are responsible for all activity that occurs under your account</li>
          <li style={s.li}>You must notify us immediately of any unauthorised access</li>
          <li style={s.li}>You may not transfer or sell your account to another person</li>
          <li style={s.li}>You may delete your account at any time via account settings or by emailing us</li>
        </ul>

        {/* 4 */}
        <h2 style={s.h2}>4. Peer-to-Peer Marketplace</h2>

        <div style={s.warning}>
          <p style={{ ...s.p, margin: 0, fontWeight: 600 }}>
            Important: Ex Libris Omnium is a listing platform only. We are not a party to any transaction
            between buyers and sellers, and we accept no liability for any marketplace transaction.
          </p>
        </div>

        <h3 style={s.h3}>4.1 Role of the Platform</h3>
        <p style={s.p}>
          The marketplace allows users to list physical books for sale and connect with potential buyers.
          Ex Libris Omnium provides the listing infrastructure only. We do not:
        </p>
        <ul style={s.ul}>
          <li style={s.li}>Process or handle payments of any kind</li>
          <li style={s.li}>Take custody of books being sold</li>
          <li style={s.li}>Verify the condition, authenticity, or value of listed books</li>
          <li style={s.li}>Guarantee that a transaction will be completed</li>
          <li style={s.li}>Mediate or resolve disputes between buyers and sellers</li>
        </ul>

        <h3 style={s.h3}>4.2 Seller Responsibilities</h3>
        <ul style={s.ul}>
          <li style={s.li}>You must accurately describe the condition of books you list</li>
          <li style={s.li}>You must only list books that you own and have the right to sell</li>
          <li style={s.li}>You are solely responsible for arranging payment, packaging, and shipping</li>
          <li style={s.li}>You must not list counterfeit, stolen, or prohibited items</li>
        </ul>

        <h3 style={s.h3}>4.3 Buyer Responsibilities</h3>
        <ul style={s.ul}>
          <li style={s.li}>You purchase at your own risk; we make no guarantees about listed items</li>
          <li style={s.li}>We recommend using a payment method with buyer protection (e.g. PayPal, credit card)</li>
          <li style={s.li}>Disputes about condition, non-delivery, or payment are between you and the seller</li>
        </ul>

        <h3 style={s.h3}>4.4 No Liability for Transactions</h3>
        <p style={s.p}>
          <strong>To the maximum extent permitted by applicable law, Ex Libris Omnium expressly
          disclaims all liability arising from or related to marketplace transactions, including but not
          limited to: non-payment, non-delivery, misrepresentation of item condition, damage during
          shipment, fraud by another user, or any other dispute between buyers and sellers.</strong>
        </p>

        {/* 5 */}
        <h2 style={s.h2}>5. Book Lending &amp; Borrowing</h2>

        <div style={s.warning}>
          <p style={{ ...s.p, margin: 0, fontWeight: 600 }}>
            Ex Libris Omnium facilitates loan requests between users but is not responsible for the
            outcome of any lending arrangement.
          </p>
        </div>

        <p style={s.p}>
          The loans feature lets you offer or request to borrow physical books from other users. You
          acknowledge and agree that:
        </p>
        <ul style={s.ul}>
          <li style={s.li}>We are not a party to any lending arrangement</li>
          <li style={s.li}>We accept no liability for lost, damaged, or unreturned books</li>
          <li style={s.li}>We accept no liability for disputes over whether a book was lent, returned, or in what condition</li>
          <li style={s.li}>You lend books at your own risk; we recommend lending only to people you trust</li>
          <li style={s.li}>We do not facilitate or enforce the return of books</li>
        </ul>

        {/* 6 */}
        <h2 style={s.h2}>6. User-Generated Content</h2>

        <h3 style={s.h3}>6.1 Content You Post</h3>
        <p style={s.p}>
          You retain ownership of content you create on Ex Libris Omnium (reviews, journal entries,
          profile bios, book cover images). By posting content, you grant us a non-exclusive,
          worldwide, royalty-free licence to store, display, and distribute that content solely to
          operate and improve the Service.
        </p>

        <h3 style={s.h3}>6.2 Book Cover Uploads</h3>
        <p style={s.p}>
          You may submit cover images for books that lack one. By submitting a cover image you confirm
          that you have the right to share the image and that it does not infringe any third-party
          copyright, trademark, or other intellectual property rights. We review submitted covers before
          they go live. We reserve the right to reject any image without explanation.
        </p>

        <h3 style={s.h3}>6.3 Prohibited Content</h3>
        <p style={s.p}>You must not post content that:</p>
        <ul style={s.ul}>
          <li style={s.li}>Is unlawful, defamatory, harassing, or hateful</li>
          <li style={s.li}>Infringes any intellectual property rights</li>
          <li style={s.li}>Contains spam, phishing links, or malware</li>
          <li style={s.li}>Involves impersonation of another person or entity</li>
          <li style={s.li}>Is sexually explicit or contains graphic violence</li>
        </ul>
        <p style={s.p}>
          We reserve the right to remove any content and suspend or terminate accounts that violate
          these rules, without prior notice.
        </p>

        {/* 7 */}
        <h2 style={s.h2}>7. Intellectual Property</h2>
        <p style={s.p}>
          All non-user-generated content on the Service — including the Ex Libris Omnium name, logo,
          interface design, and code — is owned by or licensed to us and protected by copyright and
          other intellectual property laws. You may not copy, modify, or redistribute any part of the
          Service without our written permission.
        </p>
        <p style={s.p}>
          Book metadata (titles, authors, descriptions, cover images) is sourced from Google Books
          and Open Library and is subject to their respective licences.
        </p>

        {/* 8 */}
        <h2 style={s.h2}>8. Disclaimer of Warranties</h2>
        <p style={s.p}>
          The Service is provided <strong>"as is" and "as available"</strong> without warranty of any
          kind. To the fullest extent permitted by law, we disclaim all warranties, express or implied,
          including but not limited to implied warranties of merchantability, fitness for a particular
          purpose, and non-infringement. We do not warrant that the Service will be uninterrupted,
          error-free, or free of viruses or other harmful components.
        </p>

        {/* 9 */}
        <h2 style={s.h2}>9. Limitation of Liability</h2>
        <p style={s.p}>
          <strong>To the maximum extent permitted by applicable law, Ex Libris Omnium and its
          operators, employees, and affiliates shall not be liable for any indirect, incidental,
          special, consequential, or punitive damages, including but not limited to: loss of profits,
          data, or goodwill; loss or damage to physical books arising from lending or marketplace
          activity; costs of substitute services; or any other intangible loss arising from your use
          of or inability to use the Service, however caused and on any theory of liability, even if
          we have been advised of the possibility of such damages.</strong>
        </p>
        <p style={s.p}>
          Where liability cannot be excluded by law, our total aggregate liability to you for any claim
          arising from these Terms or your use of the Service shall not exceed the greater of (a) the
          amount you paid us in the twelve months preceding the claim, or (b) USD $10.
        </p>

        {/* 10 */}
        <h2 style={s.h2}>10. Indemnification</h2>
        <p style={s.p}>
          You agree to indemnify and hold harmless Ex Libris Omnium and its operators from any claims,
          damages, losses, and expenses (including reasonable legal fees) arising from: (a) your use
          of the Service; (b) your violation of these Terms; (c) content you post; or (d) any
          transaction or lending arrangement you enter into with another user.
        </p>

        {/* 11 */}
        <h2 style={s.h2}>11. Third-Party Links &amp; Services</h2>
        <p style={s.p}>
          The Service may display links to or information from third-party services (e.g. Google Books,
          Open Library, bookseller websites). We have no control over these services and are not
          responsible for their content, privacy practices, or availability. Accessing third-party
          services is at your own risk.
        </p>

        {/* 12 */}
        <h2 style={s.h2}>12. Termination</h2>
        <p style={s.p}>
          We may suspend or terminate your access to the Service at any time, with or without notice,
          for conduct that we believe violates these Terms or is harmful to other users, us, or third
          parties. You may delete your account at any time. Upon termination, your right to use the
          Service ceases immediately.
        </p>

        {/* 13 */}
        <h2 style={s.h2}>13. Changes to These Terms</h2>
        <p style={s.p}>
          We may update these Terms from time to time. We will notify you of material changes by
          displaying a notice in the app or by email. The updated Terms will be effective immediately
          upon posting. Continued use of the Service after notification of changes constitutes your
          acceptance of the revised Terms. If you do not agree to the revised Terms, please stop using
          the Service and delete your account.
        </p>

        {/* 14 */}
        <h2 style={s.h2}>14. Governing Law &amp; Disputes</h2>
        <p style={s.p}>
          These Terms are governed by and construed in accordance with applicable law. For EU/EEA
          consumers, nothing in these Terms limits your rights under applicable consumer protection
          legislation. We encourage you to contact us first to resolve any dispute before pursuing
          formal action.
        </p>

        {/* 15 */}
        <h2 style={s.h2}>15. Contact</h2>
        <p style={s.p}>
          Questions about these Terms:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: theme.rust }}>{CONTACT_EMAIL}</a>
        </p>

        <hr style={s.divider} />
        <p style={{ ...s.p, fontSize: 13 }}>
          <Link to="/privacy" style={{ color: theme.rust }}>Privacy Policy</Link>
          {' · '}
          <Link to="/" style={{ color: theme.rust }}>Back to Ex Libris Omnium</Link>
        </p>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useSearchParams } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { ThemeProvider } from './contexts/ThemeContext'
import Auth from './pages/Auth'
import Library from './pages/Library'
import Profile from './pages/Profile'
import Feed from './pages/Feed'
import Loans from './pages/Loans'
import Marketplace from './pages/Marketplace'
import Discover from './pages/Discover'
import Friends from './pages/Friends'
import Stats from './pages/Stats'
import WrappedList from './pages/WrappedList'
import SharedWishlist from './pages/SharedWishlist'
import Shelves from './pages/Shelves'
import BookClubs from './pages/BookClubs'
import Author from './pages/Author'
import Admin from './pages/Admin'
import Onboarding from './pages/Onboarding'
import Landing from './pages/Landing'
import BookDetailPage from './pages/BookDetailPage'
import Notifications from './pages/Notifications'
import NotificationSettings from './pages/NotificationSettings'
import AuthorDashboard from './pages/AuthorDashboard'
import BuddyReads from './pages/BuddyReads'
import BuddyReadDetail from './pages/BuddyReadDetail'
import Nearby from './pages/Nearby'
import PrivacyPolicy from './pages/PrivacyPolicy'
import TermsOfService from './pages/TermsOfService'
import Contact from './pages/Contact'
import Help from './pages/Help'
import BottomTabBar from './components/BottomTabBar'
import AnalyticsConsent from './components/AnalyticsConsent'
import { useIsMobile } from './hooks/useIsMobile'
import { useTheme } from './contexts/ThemeContext'
import { loadClarity } from './lib/clarity'

// Legacy share URLs were `/?book=<uuid>`. Signed-in users still use that to
// open the Library overlay, but anon visitors hit Landing and the param was
// ignored. Redirect them to the public `/book/:id` route instead.
function LandingOrBookRedirect() {
  const [searchParams] = useSearchParams()
  const bookId = searchParams.get('book')
  if (bookId) return <Navigate to={`/book/${bookId}`} replace />
  return <Landing />
}

function AppRoutes({ session }) {
  const isMobile = useIsMobile()

  return (
    <>
      <div style={isMobile && session ? { paddingBottom: 70 } : undefined}>
        <Routes>
          <Route
            path="/"
            element={session ? <Library session={session} /> : <LandingOrBookRedirect />}
          />
          <Route
            path="/profile/:username"
            element={<Profile session={session} />}
          />
          <Route
            path="/share/:username/wishlist"
            element={<SharedWishlist session={session} />}
          />
          <Route
            path="/feed"
            element={session ? <Feed session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/loans"
            element={session ? <Loans session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/marketplace"
            element={session ? <Marketplace session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/discover"
            element={session ? <Discover session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/friends"
            element={session ? <Friends session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/stats"
            element={session ? <Stats session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/wrapped-list"
            element={session ? <WrappedList session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/shelves"
            element={session ? <Shelves session={session} /> : <Navigate to="/" replace />}
          />
          <Route path="/polls" element={<Navigate to="/friends" replace />} />
          <Route
            path="/clubs"
            element={session ? <BookClubs session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/author/:authorName"
            element={<Author session={session} />}
          />
          <Route
            path="/book/:bookId"
            element={<BookDetailPage session={session} />}
          />
          <Route
            path="/admin"
            element={<Admin session={session} />}
          />
          <Route
            path="/nearby"
            element={session ? <Nearby session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/notifications"
            element={session ? <Notifications session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/settings/notifications"
            element={session ? <NotificationSettings session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/author-dashboard"
            element={session ? <AuthorDashboard session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/buddy-reads"
            element={session ? <BuddyReads session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/buddy-reads/:id"
            element={session ? <BuddyReadDetail session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/onboarding"
            element={session ? <Onboarding session={session} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/auth"
            element={session ? <Navigate to="/" replace /> : <Auth />}
          />
          <Route path="/privacy" element={<PrivacyPolicy session={session} />} />
          <Route path="/terms"   element={<TermsOfService session={session} />} />
          <Route path="/contact" element={<Contact session={session} />} />
          <Route path="/help"    element={<Help    session={session} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {session && <BottomTabBar session={session} />}
      {/* Show footer everywhere except where the BottomTabBar is in the way
          (mobile + signed in). That covers logged-out mobile visitors landing
          on share pages and any desktop visitor. */}
      {!(isMobile && session) && <SiteFooter />}
    </>
  )
}

function SiteFooter() {
  const { theme } = useTheme()
  return (
    <footer style={{ borderTop: `1px solid ${theme.border}`, background: theme.bg, padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: theme.textSubtle }}>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 700, color: theme.text }}>
        Ex Libris Omnium
      </div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        {[
          ['Help',    '/help'],
          ['Privacy', '/privacy'],
          ['Terms',   '/terms'],
          ['Contact', '/contact'],
        ].map(([label, href]) => (
          href.startsWith('mailto:')
            ? <a key={label} href={href} style={{ color: theme.textSubtle, textDecoration: 'none', fontSize: 13 }}
                onMouseEnter={e => e.target.style.color = theme.rust}
                onMouseLeave={e => e.target.style.color = theme.textSubtle}>{label}</a>
            : <Link key={label} to={href} style={{ color: theme.textSubtle, textDecoration: 'none', fontSize: 13 }}
                onMouseEnter={e => e.target.style.color = theme.rust}
                onMouseLeave={e => e.target.style.color = theme.textSubtle}>{label}</Link>
        ))}
      </div>
      <div style={{ fontSize: 12 }}>© {new Date().getFullYear()} Ex Libris Omnium · Built for book lovers</div>
    </footer>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadClarity()

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return null

  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes session={session} />
        <AnalyticsConsent />
      </BrowserRouter>
    </ThemeProvider>
  )
}

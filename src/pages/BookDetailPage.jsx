import { useParams, useNavigate } from 'react-router-dom'
import BookDetail from './BookDetail'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'

// Standalone book-detail page — used for public share links (`/book/:bookId`).
// Signed-in users normally reach book detail as an overlay mounted by Library,
// but the overlay pattern doesn't work for anon visitors who land here from a
// shared URL. This wraps BookDetail so it can render on its own.
export default function BookDetailPage({ session }) {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const { theme } = useTheme()

  return (
    <div style={{ background: theme.bg, minHeight: '100vh' }}>
      <NavBar session={session} />
      <BookDetail
        bookId={bookId}
        session={session}
        onBack={window.history.length > 1 ? () => navigate(-1) : undefined}
      />
    </div>
  )
}

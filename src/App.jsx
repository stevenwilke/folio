import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import Shelves from './pages/Shelves'
import Polls from './pages/Polls'
import BookClubs from './pages/BookClubs'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
      <Routes>
        <Route
          path="/"
          element={session ? <Library session={session} /> : <Auth />}
        />
        <Route
          path="/profile/:username"
          element={<Profile session={session} />}
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
          path="/shelves"
          element={session ? <Shelves session={session} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/polls"
          element={session ? <Polls session={session} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/clubs"
          element={session ? <BookClubs session={session} /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
  )
}

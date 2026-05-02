import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState(searchParams.get('mode') === 'signup' ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username },
          emailRedirectTo: 'https://exlibrisomnium.com',
        }
      })
      if (error) setError(error.message)
      else setMessage('Check your email to confirm your account!')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    }

    setLoading(false)
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <img src="/logo.png" alt="" style={styles.brandBadge} />
        <div style={styles.logo}>Ex Libris</div>
        <div style={styles.tagline}>Your book life</div>

        <div style={styles.modeToggle}>
          <button style={mode === 'login' ? styles.modeActive : styles.modeInactive}
            onClick={() => setMode('login')}>Log in</button>
          <button style={mode === 'signup' ? styles.modeActive : styles.modeInactive}
            onClick={() => setMode('signup')}>Sign up</button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {mode === 'signup' && (
            <input style={styles.input} placeholder="Username"
              value={username} onChange={e => setUsername(e.target.value)} required />
          )}
          <input style={styles.input} placeholder="Email" type="email"
            value={email} onChange={e => setEmail(e.target.value)} required />
          <input style={styles.input} placeholder="Password" type="password"
            value={password} onChange={e => setPassword(e.target.value)} required />

          {error && <div style={styles.error}>{error}</div>}
          {message && <div style={styles.message}>{message}</div>}

          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#f5f0e8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif" },
  card: { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, padding: '40px 36px', width: 380, maxWidth: '90vw' },
  brandBadge: { width: 96, height: 96, display: 'block', margin: '0 auto 12px' },
  logo: { fontFamily: 'Georgia, serif', fontSize: 36, fontWeight: 700, color: '#1a1208', textAlign: 'center' },
  tagline: { fontSize: 13, color: '#8a7f72', textAlign: 'center', letterSpacing: 2, textTransform: 'uppercase', marginTop: 4, marginBottom: 28 },
  modeToggle: { display: 'flex', background: '#e8dfc8', borderRadius: 8, padding: 3, marginBottom: 24 },
  modeActive: { flex: 1, padding: '8px 0', border: 'none', borderRadius: 6, background: '#fdfaf4', fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500, cursor: 'pointer', color: '#1a1208' },
  modeInactive: { flex: 1, padding: '8px 0', border: 'none', background: 'transparent', fontFamily: "'DM Sans', sans-serif", fontSize: 14, cursor: 'pointer', color: '#8a7f72' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: { padding: '10px 14px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: 'white', outline: 'none', color: '#1a1208' },
  btn: { padding: '11px 0', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, fontFamily: "'DM Sans', sans-serif", cursor: 'pointer', marginTop: 4 },
  error: { fontSize: 13, color: '#c0521e', background: 'rgba(192,82,30,0.08)', padding: '8px 12px', borderRadius: 6 },
  message: { fontSize: 13, color: '#5a7a5a', background: 'rgba(90,122,90,0.08)', padding: '8px 12px', borderRadius: 6 },
}
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'

export default function Contact({ session }) {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const [name, setName]       = useState(session?.user?.user_metadata?.full_name || '')
  const [email, setEmail]     = useState(session?.user?.email || '')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !message.trim()) {
      setError('Please fill in your name, email, and message.')
      return
    }
    setSending(true)
    setError('')

    const { data, error: err } = await supabase.functions.invoke('submit-contact', {
      body: { name: name.trim(), email: email.trim(), subject: subject.trim(), message: message.trim() },
    })

    if (err || data?.error) {
      setError(data?.error || 'Something went wrong. Please try again.')
      setSending(false)
    } else {
      setSent(true)
      setSending(false)
    }
  }

  const s = {
    page:     { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    container:{ maxWidth: 560, margin: '0 auto', padding: isMobile ? '32px 20px 60px' : '48px 20px 60px' },
    heading:  { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 700, color: theme.text, marginBottom: 6 },
    sub:      { fontSize: 14, color: theme.textSubtle, marginBottom: 32 },
    fieldGroup: { marginBottom: 20 },
    label:    { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
    input:    { width: '100%', padding: '10px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: theme.text, background: theme.bgCard, outline: 'none', boxSizing: 'border-box' },
    textarea: { width: '100%', padding: '10px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: theme.text, background: theme.bgCard, outline: 'none', boxSizing: 'border-box', resize: 'vertical', minHeight: 140, lineHeight: 1.5 },
    btn:      { padding: '12px 28px', background: theme.rust, color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: sending ? 0.6 : 1 },
    error:    { color: theme.rust, fontSize: 13, marginBottom: 12 },
    success:  { textAlign: 'center', padding: '40px 0' },
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.container}>
        {sent ? (
          <div style={s.success}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
            <h1 style={{ ...s.heading, fontSize: 24 }}>Message Sent!</h1>
            <p style={s.sub}>Thanks for reaching out. We'll get back to you as soon as we can.</p>
          </div>
        ) : (
          <>
            <h1 style={s.heading}>Contact Us</h1>
            <p style={s.sub}>Have a question, suggestion, or just want to say hello? We'd love to hear from you.</p>

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
                <div style={s.fieldGroup}>
                  <label style={s.label}>Name</label>
                  <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
                </div>
                <div style={s.fieldGroup}>
                  <label style={s.label}>Email</label>
                  <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
              </div>
              <div style={s.fieldGroup}>
                <label style={s.label}>Subject (optional)</label>
                <input style={s.input} value={subject} onChange={e => setSubject(e.target.value)} placeholder="What's this about?" />
              </div>
              <div style={s.fieldGroup}>
                <label style={s.label}>Message</label>
                <textarea style={s.textarea} value={message} onChange={e => setMessage(e.target.value)} placeholder="Tell us what's on your mind..." />
              </div>
              {error && <div style={s.error}>{error}</div>}
              <button type="submit" style={s.btn} disabled={sending}>
                {sending ? 'Sending…' : 'Send Message'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

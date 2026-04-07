import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import { useTheme } from '../contexts/ThemeContext'

export default function Admin({ session }) {
  const navigate   = useNavigate()
  const { theme }  = useTheme()
  const [isAdmin,  setIsAdmin]  = useState(null)   // null = loading
  const [claims,   setClaims]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [acting,   setActing]   = useState(null)

  useEffect(() => { checkAdmin() }, [])

  async function checkAdmin() {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', session.user.id)
      .single()
    if (!profile?.is_admin) { setIsAdmin(false); return }
    setIsAdmin(true)
    loadClaims()
  }

  async function loadClaims() {
    setLoading(true)
    const { data } = await supabase
      .from('author_claims')
      .select('*, authors(id, name), profiles(username, avatar_url)')
      .order('created_at', { ascending: true })
    setClaims(data || [])
    setLoading(false)
  }

  async function reviewClaim(claim, decision, note = '') {
    setActing(claim.id)
    await supabase
      .from('author_claims')
      .update({ status: decision, admin_note: note || null })
      .eq('id', claim.id)

    if (decision === 'approved') {
      // Mark the author as verified and set claimed_by
      await supabase
        .from('authors')
        .update({ is_verified: true, claimed_by: claim.user_id })
        .eq('id', claim.author_id)
    }
    setActing(null)
    loadClaims()
  }

  const s = makeStyles(theme)

  if (isAdmin === null) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.center}>Checking access…</div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.center}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.text, marginBottom: 8 }}>Access Denied</div>
          <div style={{ fontSize: 14, color: theme.textSubtle }}>You don't have admin access.</div>
        </div>
      </div>
    )
  }

  const pending  = claims.filter(c => c.status === 'pending')
  const resolved = claims.filter(c => c.status !== 'pending')

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.content}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={s.pageTitle}>Admin Panel</h1>
          <p style={{ fontSize: 14, color: theme.textSubtle, margin: 0 }}>Manage author page claims and site administration</p>
        </div>

        {/* ── Pending claims ── */}
        <section style={{ marginBottom: 48 }}>
          <div style={s.sectionHead}>
            <h2 style={s.sectionTitle}>Author Page Claims</h2>
            {pending.length > 0 && (
              <span style={s.badge}>{pending.length} pending</span>
            )}
          </div>

          {loading ? (
            <div style={{ color: theme.textSubtle, fontSize: 14 }}>Loading…</div>
          ) : pending.length === 0 ? (
            <div style={s.emptyCard}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
              <div style={{ fontWeight: 600, color: theme.text, marginBottom: 4 }}>All caught up!</div>
              <div style={{ fontSize: 13, color: theme.textSubtle }}>No pending claims to review.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {pending.map(claim => (
                <ClaimCard key={claim.id} claim={claim} theme={theme} acting={acting === claim.id} s={s} onReview={reviewClaim} />
              ))}
            </div>
          )}
        </section>

        {/* ── Resolved claims ── */}
        {resolved.length > 0 && (
          <section>
            <h2 style={{ ...s.sectionTitle, color: theme.textSubtle }}>Resolved</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {resolved.map(claim => (
                <ClaimCard key={claim.id} claim={claim} theme={theme} acting={false} s={s} resolved />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function ClaimCard({ claim, theme, acting, s, onReview, resolved }) {
  const [note, setNote] = useState('')
  const [showDecline, setShowDecline] = useState(false)

  const statusColors = {
    pending:  { bg: 'rgba(184,134,11,0.12)',  color: '#9a7200' },
    approved: { bg: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
    rejected: { bg: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
  }
  const sc = statusColors[claim.status] || statusColors.pending

  return (
    <div style={s.claimCard}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text }}>
              {claim.authors?.name}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, ...sc }}>
              {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
            </span>
          </div>
          <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 8 }}>
            Claimed by <strong style={{ color: theme.text }}>{claim.profiles?.username}</strong>
            {' · '}
            {new Date(claim.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          {claim.message && (
            <div style={{ fontSize: 14, color: theme.text, lineHeight: 1.6, background: theme.bgSubtle, borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
              "{claim.message}"
            </div>
          )}
          {claim.proof_url && (
            <a href={claim.proof_url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 13, color: theme.rust, textDecoration: 'none' }}>
              🔗 {claim.proof_url}
            </a>
          )}
          {claim.admin_note && (
            <div style={{ fontSize: 13, color: theme.textSubtle, fontStyle: 'italic', marginTop: 8 }}>
              Admin note: {claim.admin_note}
            </div>
          )}
        </div>
      </div>

      {/* Actions (pending only) */}
      {!resolved && claim.status === 'pending' && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${theme.border}`, paddingTop: 14 }}>
          {!showDecline ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => onReview(claim, 'approved')}
                disabled={acting}
                style={{ ...s.btnApprove, opacity: acting ? 0.6 : 1 }}
              >
                {acting ? '…' : '✓ Approve'}
              </button>
              <button
                onClick={() => setShowDecline(true)}
                disabled={acting}
                style={s.btnDecline}
              >
                Decline
              </button>
            </div>
          ) : (
            <div>
              <input
                placeholder="Reason for declining (optional)"
                value={note}
                onChange={e => setNote(e.target.value)}
                style={{ ...s.noteInput, marginBottom: 10 }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowDecline(false)} style={s.btnGhost}>Back</button>
                <button onClick={() => onReview(claim, 'rejected', note)} disabled={acting} style={{ ...s.btnDeclineConfirm, opacity: acting ? 0.6 : 1 }}>
                  {acting ? '…' : 'Confirm Decline'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function makeStyles(theme) {
  return {
    page:    { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content: { maxWidth: 800, margin: '0 auto', padding: '36px 32px' },
    center:  { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: theme.textSubtle, fontSize: 15 },

    pageTitle:   { fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 700, color: theme.text, margin: '0 0 6px' },
    sectionHead: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
    sectionTitle:{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, margin: 0 },
    badge:       { display: 'inline-block', background: theme.rust, color: '#fff', borderRadius: 20, fontSize: 12, fontWeight: 700, padding: '3px 10px' },

    emptyCard:   { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '40px 32px', textAlign: 'center' },
    claimCard:   { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 22px' },

    btnApprove:       { padding: '8px 18px', background: '#5a7a5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnDecline:       { padding: '8px 18px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnDeclineConfirm:{ padding: '8px 18px', background: '#c0521e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    btnGhost:         { padding: '8px 14px', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" },
    noteInput:        { width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", background: theme.bg, color: theme.text, outline: 'none' },
  }
}

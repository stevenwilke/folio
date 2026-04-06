import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'

export default function EditProfileModal({ session, profile, onClose, onSaved }) {
  const { theme } = useTheme()
  const [username,     setUsername]     = useState(profile.username      || '')
  const [bio,          setBio]          = useState(profile.bio            || '')
  const [paypalHandle, setPaypalHandle] = useState(profile.paypal_handle || '')
  const [venmoHandle,  setVenmoHandle]  = useState(profile.venmo_handle  || '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)

  async function save() {
    const u = username.trim()
    if (!u) { setError('Username is required.'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(u)) { setError('Username can only contain letters, numbers, and underscores.'); return }
    setSaving(true)
    setError(null)

    // Check uniqueness (skip if unchanged)
    if (u !== profile.username) {
      const { data: existing } = await supabase
        .from('profiles').select('id').eq('username', u).maybeSingle()
      if (existing) {
        setError('That username is already taken.')
        setSaving(false)
        return
      }
    }

    // Strip leading @ from venmo handle if user typed it
    const venmo = venmoHandle.trim().replace(/^@/, '')
    // Strip https://paypal.me/ prefix if user pasted the full URL
    const paypal = paypalHandle.trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, '')

    const { error: err } = await supabase
      .from('profiles')
      .update({
        username:      u,
        bio:           bio.trim() || null,
        paypal_handle: paypal || null,
        venmo_handle:  venmo  || null,
      })
      .eq('id', session.user.id)

    setSaving(false)
    if (err) { setError('Could not save. Please try again.'); return }
    onSaved({ ...profile, username: u, bio: bio.trim() || null, paypal_handle: paypal || null, venmo_handle: venmo || null })
  }

  const s = makeStyles(theme)

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div style={s.title}>Edit Profile</div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          <div style={s.fieldGroup}>
            <label style={s.label}>Username</label>
            <input
              style={s.input}
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="your_username"
              autoFocus
            />
            <div style={s.hint}>Letters, numbers, and underscores only.</div>
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Bio</label>
            <textarea
              style={{ ...s.input, ...s.textarea }}
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Tell people a little about yourself…"
              rows={3}
            />
          </div>

          <div style={{ borderTop: `1px solid ${s.divider}`, paddingTop: 18, marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: s.sectionLabel, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>
              💳 Marketplace Payment Methods
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>PayPal.me Username</label>
              <input
                style={s.input}
                value={paypalHandle}
                onChange={e => setPaypalHandle(e.target.value)}
                placeholder="e.g. johndoe"
              />
              <div style={s.hint}>Your PayPal.me username — buyers will get a direct pay link.</div>
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>Venmo Handle</label>
              <input
                style={s.input}
                value={venmoHandle}
                onChange={e => setVenmoHandle(e.target.value)}
                placeholder="e.g. johndoe (without @)"
              />
              <div style={s.hint}>Your Venmo username — buyers will get a direct pay link.</div>
            </div>
          </div>

          {error && <div style={s.errorMsg}>{error}</div>}

          <div style={s.footer}>
            <button style={s.btnGhost} onClick={onClose}>Cancel</button>
            <button style={s.btnSave} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function makeStyles(theme) {
  return {
    overlay:      { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:        { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 440, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: theme.shadow },
    header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: `1px solid ${theme.borderLight}` },
    title:        { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text },
    closeBtn:     { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4 },
    body:         { padding: '20px 24px 24px' },
    fieldGroup:   { marginBottom: 18 },
    label:        { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    input:        { width: '100%', padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgSubtle, color: theme.text, boxSizing: 'border-box' },
    textarea:     { resize: 'vertical', minHeight: 80, lineHeight: 1.5 },
    hint:         { fontSize: 11, color: theme.textSubtle, marginTop: 4 },
    errorMsg:     { fontSize: 13, color: theme.rust, marginBottom: 12 },
    footer:       { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
    btnGhost:     { padding: '8px 16px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textMuted },
    btnSave:      { padding: '8px 20px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    divider:      theme.border,
    sectionLabel: theme.textMuted,
  }
}

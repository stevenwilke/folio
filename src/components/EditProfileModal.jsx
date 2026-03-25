import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function EditProfileModal({ session, profile, onClose, onSaved }) {
  const [username, setUsername] = useState(profile.username || '')
  const [bio,      setBio]      = useState(profile.bio || '')
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

    const { error: err } = await supabase
      .from('profiles')
      .update({ username: u, bio: bio.trim() || null })
      .eq('id', session.user.id)

    setSaving(false)
    if (err) { setError('Could not save. Please try again.'); return }
    onSaved({ ...profile, username: u, bio: bio.trim() || null })
  }

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

const s = {
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:     { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, width: 440, maxWidth: '92vw', boxShadow: '0 24px 64px rgba(26,18,8,0.2)' },
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #e8dfc8' },
  title:     { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: '#1a1208' },
  closeBtn:  { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#8a7f72', padding: 4 },
  body:      { padding: '20px 24px 24px' },
  fieldGroup:{ marginBottom: 18 },
  label:     { display: 'block', fontSize: 11, fontWeight: 600, color: '#3a3028', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:     { width: '100%', padding: '9px 12px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: 'white', color: '#1a1208', boxSizing: 'border-box' },
  textarea:  { resize: 'vertical', minHeight: 80, lineHeight: 1.5 },
  hint:      { fontSize: 11, color: '#8a7f72', marginTop: 4 },
  errorMsg:  { fontSize: 13, color: '#c0521e', marginBottom: 12 },
  footer:    { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  btnGhost:  { padding: '8px 16px', background: 'none', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#3a3028' },
  btnSave:   { padding: '8px 20px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'

const TYPES = [
  { key: 'friend_request',   label: 'Friend requests',     desc: 'Someone wants to be your friend' },
  { key: 'friend_accepted',  label: 'Friend accepted',     desc: 'A friend request you sent was accepted' },
  { key: 'borrow_request',   label: 'Borrow requests',     desc: 'A friend wants to borrow one of your books' },
  { key: 'borrow_approved',  label: 'Borrow approved',     desc: 'Your borrow request was accepted' },
  { key: 'borrow_returned',  label: 'Book returned',       desc: 'A book you lent out was marked returned' },
  { key: 'order_update',     label: 'Order updates',       desc: 'Status changes on marketplace orders' },
  { key: 'recommendation',   label: 'Recommendations',     desc: 'A friend recommends a book to you' },
  { key: 'club_activity',    label: 'Book club activity',  desc: 'New posts in your book clubs' },
  { key: 'achievement',      label: 'Achievements',        desc: 'You unlocked a badge or hit a goal' },
  { key: 'quote_shared',     label: 'Quote shared',        desc: 'A friend shared a quote with you' },
  { key: 'author_post',      label: 'Author updates',      desc: 'A new post from an author you follow' },
  { key: 'marketplace_alert',label: 'Marketplace alerts',  desc: 'A book you saved an alert for was just listed' },
  { key: 'author_question',  label: 'Author Q&A',          desc: 'An author answered your question · or asked you one' },
  { key: 'buddy_read_invite',label: 'Buddy read invites',  desc: 'Someone invited you to read a book together' },
  { key: 'buddy_read_message',label:'Buddy read messages', desc: 'New activity in a buddy read you joined' },
]

const ADMIN_TYPES = [
  { key: 'author_claim',     label: 'Author claims',       desc: 'A user submitted a claim for an author profile', adminOnly: true },
]

const CHANNELS = [
  { key: 'in_app', label: 'On site' },
  { key: 'email',  label: 'Email' },
  { key: 'push',   label: 'Push' },
]

export default function NotificationSettings({ session }) {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const [prefs, setPrefs]       = useState({}) // { [type]: { in_app, email, push } }
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [savedAt, setSavedAt]   = useState(null)
  const [isAdmin, setIsAdmin]   = useState(false)

  const allTypes = isAdmin ? [...TYPES, ...ADMIN_TYPES] : TYPES

  useEffect(() => {
    if (!session) { navigate('/'); return }
    fetchPrefs()
  }, [session?.user?.id])

  async function fetchPrefs() {
    setLoading(true)
    const [{ data: profile }, { data }] = await Promise.all([
      supabase.from('profiles').select('is_admin').eq('id', session.user.id).maybeSingle(),
      supabase.from('notification_preferences').select('type, in_app, email, push').eq('user_id', session.user.id),
    ])
    const admin = !!profile?.is_admin
    setIsAdmin(admin)
    const types = admin ? [...TYPES, ...ADMIN_TYPES] : TYPES
    const map = {}
    for (const t of types) {
      const row = (data || []).find(r => r.type === t.key)
      map[t.key] = row
        ? { in_app: !!row.in_app, email: !!row.email, push: !!row.push }
        : { in_app: true, email: true, push: true }
    }
    setPrefs(map)
    setLoading(false)
  }

  async function toggle(type, channel) {
    const next = { ...prefs, [type]: { ...prefs[type], [channel]: !prefs[type][channel] } }
    setPrefs(next)
    setSaving(true)
    const row = { user_id: session.user.id, type, ...next[type], updated_at: new Date().toISOString() }
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(row, { onConflict: 'user_id,type' })
    setSaving(false)
    if (error) {
      console.error('[NotificationSettings] save failed:', error)
      // rollback
      setPrefs(prefs)
    } else {
      setSavedAt(Date.now())
    }
  }

  function setAllForChannel(channel, value) {
    const next = { ...prefs }
    for (const t of allTypes) next[t.key] = { ...next[t.key], [channel]: value }
    setPrefs(next)
    persistAll(next)
  }

  function setAllChannels(value) {
    const next = { ...prefs }
    for (const t of allTypes) next[t.key] = { in_app: value, email: value, push: value }
    setPrefs(next)
    persistAll(next)
  }

  async function persistAll(next) {
    setSaving(true)
    const rows = allTypes.map(t => ({
      user_id: session.user.id,
      type: t.key,
      ...next[t.key],
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(rows, { onConflict: 'user_id,type' })
    setSaving(false)
    if (error) {
      console.error('[NotificationSettings] bulk save failed:', error)
      fetchPrefs()
    } else {
      setSavedAt(Date.now())
    }
  }

  const s = {
    page:      { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    inner:     { maxWidth: 880, margin: '0 auto', padding: isMobile ? '24px 16px 80px' : '40px 32px 80px' },
    heading:   { fontFamily: 'Georgia, serif', fontSize: isMobile ? 26 : 32, fontWeight: 700, color: theme.text, marginBottom: 6 },
    sub:       { fontSize: 14, color: theme.textSubtle, marginBottom: 28, lineHeight: 1.5 },
    card:      { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: theme.shadowCard },
    headRow:   { display: 'grid', gridTemplateColumns: isMobile ? '1fr repeat(3, 56px)' : '1fr repeat(3, 90px)', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${theme.border}`, background: theme.bgSubtle, fontSize: 12, fontWeight: 700, color: theme.textSubtle, letterSpacing: 0.4, textTransform: 'uppercase' },
    headChan:  { textAlign: 'center', cursor: 'pointer', userSelect: 'none' },
    row:       { display: 'grid', gridTemplateColumns: isMobile ? '1fr repeat(3, 56px)' : '1fr repeat(3, 90px)', alignItems: 'center', padding: '14px 16px', borderBottom: `1px solid ${theme.borderLight || theme.border}` },
    rowLast:   { borderBottom: 'none' },
    typeLabel: { fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 2 },
    typeDesc:  { fontSize: 12, color: theme.textSubtle, lineHeight: 1.4 },
    cell:      { display: 'flex', alignItems: 'center', justifyContent: 'center' },
    saveStrip: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 12, color: theme.textSubtle, minHeight: 18 },
    bulkBtn:   { background: 'transparent', border: 'none', color: theme.rust, fontSize: 11, cursor: 'pointer', padding: 0, marginTop: 4, fontFamily: "'DM Sans', sans-serif" },
    quickRow:  { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    quickBtn:  { background: theme.bgCard, border: `1px solid ${theme.border}`, color: theme.text, padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    quickBtnOff: { background: 'rgba(192,82,30,0.08)', border: `1px solid ${theme.rust}`, color: theme.rust, padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  }

  const channelAnyOn = (channel) => allTypes.some(t => prefs[t.key]?.[channel])
  const anyOn = CHANNELS.some(c => channelAnyOn(c.key))

  if (loading) {
    return (
      <div style={s.page}>
        <NavBar session={session} />
        <div style={s.inner}>
          <h1 style={s.heading}>Notifications</h1>
          <p style={s.sub}>Loading your preferences…</p>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.inner}>
        <h1 style={s.heading}>Notifications</h1>
        <p style={s.sub}>Choose how you want to hear about activity on your account. Changes save automatically.</p>

        <div style={s.quickRow}>
          <button
            style={anyOn ? s.quickBtnOff : s.quickBtn}
            onClick={() => setAllChannels(!anyOn)}
          >
            {anyOn ? '🔕 Turn off all notifications' : '🔔 Turn on all notifications'}
          </button>
          {CHANNELS.map(c => {
            const on = channelAnyOn(c.key)
            return (
              <button
                key={c.key}
                style={on ? s.quickBtnOff : s.quickBtn}
                onClick={() => setAllForChannel(c.key, !on)}
              >
                {on ? `Turn off all ${c.label.toLowerCase()}` : `Turn on all ${c.label.toLowerCase()}`}
              </button>
            )
          })}
        </div>

        <div style={s.card}>
          <div style={s.headRow}>
            <div>Type</div>
            {CHANNELS.map(c => {
              const allOn = allTypes.every(t => prefs[t.key]?.[c.key])
              return (
                <div
                  key={c.key}
                  style={s.headChan}
                  title={`Click to ${allOn ? 'disable' : 'enable'} ${c.label.toLowerCase()} for everything`}
                  onClick={() => setAllForChannel(c.key, !allOn)}
                >
                  {c.label}
                </div>
              )
            })}
          </div>
          {allTypes.map((t, i) => (
            <div key={t.key} style={{ ...s.row, ...(i === allTypes.length - 1 ? s.rowLast : {}) }}>
              <div>
                <div style={s.typeLabel}>
                  {t.label}
                  {t.adminOnly && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: theme.rust, background: 'rgba(192,82,30,0.12)', padding: '2px 7px', borderRadius: 10, letterSpacing: 0.4 }}>ADMIN</span>}
                </div>
                <div style={s.typeDesc}>{t.desc}</div>
              </div>
              {CHANNELS.map(c => (
                <div key={c.key} style={s.cell}>
                  <Toggle
                    checked={!!prefs[t.key]?.[c.key]}
                    onChange={() => toggle(t.key, c.key)}
                    accent={theme.rust}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={s.saveStrip}>
          {saving ? 'Saving…' : savedAt ? '✓ Saved' : ''}
        </div>

        <p style={{ fontSize: 12, color: theme.textSubtle, marginTop: 24, lineHeight: 1.5 }}>
          Push notifications require the mobile app to be installed and signed in. Email goes to the address on your account.
        </p>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, accent }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 38, height: 22, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{
        position: 'absolute', inset: 0, borderRadius: 22,
        background: checked ? accent : '#c8bfae',
        transition: 'background 0.18s',
      }} />
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2, width: 18, height: 18,
        borderRadius: '50%', background: '#fff',
        transition: 'left 0.18s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </label>
  )
}

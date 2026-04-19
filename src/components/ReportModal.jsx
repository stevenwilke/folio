import { useState } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { REPORT_REASONS, reportContent } from '../lib/moderation'

export default function ReportModal({ onClose, contentType, contentId, reportedUserId, onReported }) {
  const { isDark } = useTheme()
  const [reason, setReason]   = useState('')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [error, setError] = useState('')

  const bg     = isDark ? '#1c1610' : '#fdfaf4'
  const card   = isDark ? '#2a2218' : '#ffffff'
  const border = isDark ? '#3a3028' : '#e8dfc8'
  const text   = isDark ? '#f0e8d8' : '#1a1208'
  const muted  = isDark ? '#9a8f82' : '#8a7f72'
  const accent = '#c0521e'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!reason || submitting) return
    setSubmitting(true)
    setError('')
    const { error: err } = await reportContent({
      contentType, contentId, reportedUserId, reason, details,
    })
    setSubmitting(false)
    if (err) {
      setError(err.message || 'Could not submit report.')
      return
    }
    setSubmitted(true)
    onReported?.()
    setTimeout(onClose, 1500)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: card, borderRadius: 12, border: `1px solid ${border}`,
          width: 'min(420px, 92vw)', padding: 20, color: text,
        }}
      >
        {submitted ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Report submitted</div>
            <div style={{ color: muted, fontSize: 14 }}>Our team will review it within 24 hours.</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Report content</div>
            <div style={{ color: muted, fontSize: 13, marginBottom: 16 }}>
              Thanks for helping keep Ex Libris safe. An admin will review this within 24 hours.
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Reason</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {REPORT_REASONS.map(r => (
                <label key={r.key} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 6,
                  background: reason === r.key ? bg : 'transparent',
                  border: `1px solid ${reason === r.key ? accent : border}`,
                  cursor: 'pointer', fontSize: 14,
                }}>
                  <input
                    type="radio"
                    name="reason"
                    value={r.key}
                    checked={reason === r.key}
                    onChange={() => setReason(r.key)}
                    style={{ accentColor: accent }}
                  />
                  {r.label}
                </label>
              ))}
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Details <span style={{ color: muted, fontWeight: 400 }}>(optional)</span>
            </div>
            <textarea
              value={details}
              onChange={e => setDetails(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="What specifically is wrong?"
              style={{
                width: '100%', resize: 'vertical', padding: 10,
                borderRadius: 6, border: `1px solid ${border}`,
                background: bg, color: text, fontSize: 14,
                fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 16,
              }}
            />

            {error && (
              <div style={{ color: '#c0521e', fontSize: 13, marginBottom: 12 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '8px 14px', borderRadius: 6, border: `1px solid ${border}`,
                  background: 'transparent', color: text, cursor: 'pointer', fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!reason || submitting}
                style={{
                  padding: '8px 14px', borderRadius: 6, border: 'none',
                  background: accent, color: '#fff', fontWeight: 600,
                  cursor: (!reason || submitting) ? 'not-allowed' : 'pointer',
                  opacity: (!reason || submitting) ? 0.6 : 1, fontSize: 14,
                }}
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

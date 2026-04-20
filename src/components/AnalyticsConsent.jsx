import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../contexts/ThemeContext'
import {
  CONSENT_UNSET,
  CONSENT_GRANTED,
  CONSENT_DENIED,
  getConsent,
  setConsent,
} from '../lib/clarity'

export default function AnalyticsConsent() {
  const { theme } = useTheme()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (getConsent() === CONSENT_UNSET) setVisible(true)
  }, [])

  if (!visible) return null

  const handle = (decision) => {
    setConsent(decision)
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 10000,
        maxWidth: 520,
        marginLeft: 'auto',
        marginRight: 'auto',
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
        padding: 16,
        fontFamily: "'DM Sans', sans-serif",
        color: theme.text,
      }}
    >
      <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 12 }}>
        We use Microsoft Clarity to understand how the site is used (page views,
        clicks, scroll). No personal info is sold. See our{' '}
        <Link to="/privacy" style={{ color: theme.rust }}>Privacy Policy</Link>.
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={() => handle(CONSENT_DENIED)}
          style={{
            background: 'transparent',
            color: theme.text,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Opt out
        </button>
        <button
          onClick={() => handle(CONSENT_GRANTED)}
          style={{
            background: theme.rust,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          OK
        </button>
      </div>
    </div>
  )
}

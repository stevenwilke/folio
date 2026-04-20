const PROJECT_ID = 'wepl6oh810'
const STORAGE_KEY = 'folio-analytics-consent'

export const CONSENT_UNSET = 'unset'
export const CONSENT_GRANTED = 'granted'
export const CONSENT_DENIED = 'denied'

export function getConsent() {
  try {
    return localStorage.getItem(STORAGE_KEY) || CONSENT_UNSET
  } catch {
    return CONSENT_UNSET
  }
}

export function setConsent(value) {
  try { localStorage.setItem(STORAGE_KEY, value) } catch {}
  if (value === CONSENT_DENIED && window.clarity) {
    try { window.clarity('consent', false) } catch {}
  }
}

let injected = false

export function loadClarity() {
  if (!import.meta.env.PROD) return
  if (injected) return
  if (getConsent() === CONSENT_DENIED) return
  injected = true

  ;(function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments) }
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y)
  })(window, document, 'clarity', 'script', PROJECT_ID)
}

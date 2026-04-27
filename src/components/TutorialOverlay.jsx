import { useState, useEffect, useLayoutEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'

const STORAGE_KEY = 'exlibris-tutorial-completed'
const TRIGGER_KEY = 'exlibris-trigger-tutorial'
const SHOW_EVENT  = 'exlibris:show-tutorial'

const SPOTLIGHT_PAD = 8        // px of breathing room around the highlighted element
const BACKDROP      = 'rgba(26,18,8,0.55)'

/**
 * Open the tutorial from anywhere. If we're already on '/', dispatch the event
 * so the mounted overlay re-opens instantly. Otherwise drop a sessionStorage
 * flag and navigate home — the overlay's mount effect picks it up there.
 */
export function triggerTutorial(navigate) {
  if (window.location.pathname === '/') {
    window.dispatchEvent(new Event(SHOW_EVENT))
  } else {
    sessionStorage.setItem(TRIGGER_KEY, '1')
    navigate('/')
  }
}

const STEPS = [
  {
    icon: '📚',
    title: 'Welcome to Ex Libris',
    body: 'A 30-second tour of the four things that matter most. You can replay this any time from your profile menu.',
  },
  {
    icon: '➕',
    title: 'Add your first book',
    body: 'Tap "+ Add Book" in the top bar to search by title, paste an ISBN, or import your Goodreads library. Covers, authors, page counts, and genres are filled in automatically.',
    target: '[data-tour="add-book"]',
  },
  {
    icon: '🔎',
    title: 'Search anything, fast',
    body: 'Use the magnifying-glass icon (or press Cmd+K / Ctrl+K) to search across your library and discover new titles. It works whether the book is in your shelves or not.',
    target: '[data-tour="search"]',
  },
  {
    icon: '🗂️',
    title: 'Browse your library',
    body: 'Every book you add lives here. Filter by status (Reading, Read, Want, Owned) using these cards, then group by shelf or genre and switch between grid and list views from the toolbar.',
    target: '[data-tour="library-stats"]',
  },
  {
    icon: '💰',
    title: 'Track your collection\'s value',
    body: 'These cards show retail and used-market values for everything you own. We pull live prices so you always know what your shelves are worth.',
    target: '[data-tour="book-values"]',
  },
]

export default function TutorialOverlay({ session }) {
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const userId = session?.user?.id

  useEffect(() => {
    if (!userId) return
    const seen      = localStorage.getItem(STORAGE_KEY) === 'true'
    const triggered = sessionStorage.getItem(TRIGGER_KEY) === '1'
    if (triggered) sessionStorage.removeItem(TRIGGER_KEY)
    if (!seen || triggered) {
      setStep(0)
      setOpen(true)
    }

    function onShow() {
      setStep(0)
      setOpen(true)
    }
    window.addEventListener(SHOW_EVENT, onShow)
    return () => window.removeEventListener(SHOW_EVENT, onShow)
  }, [userId])

  // Locate and track the highlighted element's bounding rect. Re-runs on step
  // change and window resize/scroll so the spotlight stays glued to its target.
  const target = open ? STEPS[step]?.target : null
  useLayoutEffect(() => {
    if (!target) { setRect(null); return }

    function update() {
      // Multiple matches (e.g. both value cards) → spotlight their union.
      const els = document.querySelectorAll(target)
      if (!els.length) { setRect(null); return }
      let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity
      els.forEach(el => {
        const r = el.getBoundingClientRect()
        top    = Math.min(top, r.top)
        left   = Math.min(left, r.left)
        right  = Math.max(right, r.right)
        bottom = Math.max(bottom, r.bottom)
      })
      setRect({ top, left, width: right - left, height: bottom - top })
    }

    // Bring the target into view first (instant — smooth scroll would leave
    // getBoundingClientRect stale during the animation), then measure.
    const first = document.querySelector(target)
    if (first) first.scrollIntoView({ block: 'center', behavior: 'auto' })
    update()

    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [target])

  function close() {
    localStorage.setItem(STORAGE_KEY, 'true')
    setOpen(false)
  }

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1)
    else close()
  }

  function back() {
    if (step > 0) setStep(step - 1)
  }

  if (!open) return null

  const s = STEPS[step]
  const isLast  = step === STEPS.length - 1
  const isFirst = step === 0

  // Reserve space for the spotlight by shrinking the modal layer to the half
  // of the viewport opposite the target. Then center the modal vertically
  // within that remaining space — keeps it close to center instead of glued
  // to the edge. No target → modal layer fills the screen.
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const targetMidY = rect ? rect.top + rect.height / 2 : null
  const targetInTopHalf = targetMidY != null && targetMidY < vh / 2

  // Pad the spotlight rect so the glow has breathing room.
  const spot = rect && {
    top:    Math.max(0, rect.top - SPOTLIGHT_PAD),
    left:   Math.max(0, rect.left - SPOTLIGHT_PAD),
    width:  rect.width + SPOTLIGHT_PAD * 2,
    height: rect.height + SPOTLIGHT_PAD * 2,
  }

  const MODAL_GAP = 24  // px of breathing room between spotlight and modal layer
  const layerInset = !rect
    ? { top: 0, bottom: 0 }
    : targetInTopHalf
      ? { top: rect.top + rect.height + MODAL_GAP, bottom: 0 }
      : { top: 0, bottom: vh - rect.top + MODAL_GAP }

  return (
    <>
      <style>{`
        @keyframes exlibris-tutorial-pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(192,82,30,0.20), 0 0 28px rgba(192,82,30,0.45); }
          50%      { box-shadow: 0 0 0 6px rgba(192,82,30,0.35), 0 0 40px rgba(192,82,30,0.65); }
        }
      `}</style>

      {/* Backdrop — split into 4 frames around the spotlight, or full when no target */}
      {spot ? (
        <>
          <div onClick={close} style={{ position: 'fixed', top: 0, left: 0, right: 0, height: spot.top, background: BACKDROP, zIndex: 1000 }} />
          <div onClick={close} style={{ position: 'fixed', top: spot.top, left: 0, width: spot.left, height: spot.height, background: BACKDROP, zIndex: 1000 }} />
          <div onClick={close} style={{ position: 'fixed', top: spot.top, left: spot.left + spot.width, right: 0, height: spot.height, background: BACKDROP, zIndex: 1000 }} />
          <div onClick={close} style={{ position: 'fixed', top: spot.top + spot.height, left: 0, right: 0, bottom: 0, background: BACKDROP, zIndex: 1000 }} />
          {/* Glowing pulse around the target */}
          <div
            aria-hidden
            style={{
              position: 'fixed', top: spot.top, left: spot.left,
              width: spot.width, height: spot.height,
              borderRadius: 12, pointerEvents: 'none', zIndex: 1001,
              animation: 'exlibris-tutorial-pulse 1.8s ease-in-out infinite',
            }}
          />
        </>
      ) : (
        <div onClick={close} style={{ position: 'fixed', inset: 0, background: BACKDROP, zIndex: 1000 }} />
      )}

      {/* Modal layer — confined to the half opposite the spotlight, then
          centered within that space so the modal sits close to the middle. */}
      <div
        style={{
          position: 'fixed', left: 0, right: 0,
          top: layerInset.top, bottom: layerInset.bottom,
          zIndex: 1002,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20, fontFamily: "'DM Sans', sans-serif",
          pointerEvents: 'none',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'relative',
            background: theme.bgCard, borderRadius: 16, maxWidth: 460, width: '100%',
            padding: '32px 28px 24px', boxShadow: '0 24px 60px rgba(26,18,8,0.4)',
            border: `1px solid ${theme.border}`,
            pointerEvents: 'auto',
          }}
        >
          <button
            onClick={close}
            aria-label="Skip tutorial"
            style={{
              position: 'absolute', top: 14, right: 16, background: 'transparent',
              border: 'none', fontSize: 22, color: theme.textSubtle, cursor: 'pointer',
              lineHeight: 1, padding: 4,
            }}
          >×</button>

          <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  height: 4, flex: 1, borderRadius: 2,
                  background: i <= step ? theme.rust : theme.bgSubtle,
                  transition: 'background 0.2s',
                }}
              />
            ))}
          </div>

          <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 16 }}>{s.icon}</div>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 24, color: theme.text, margin: '0 0 12px' }}>
            {s.title}
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: theme.textSubtle, margin: '0 0 28px' }}>
            {s.body}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <button
              onClick={close}
              style={{
                background: 'none', border: 'none', color: theme.textSubtle,
                fontSize: 13, cursor: 'pointer', padding: '8px 0', fontFamily: 'inherit',
              }}
            >
              Skip tour
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              {!isFirst && (
                <button
                  onClick={back}
                  style={{
                    padding: '10px 18px', borderRadius: 8, border: `1px solid ${theme.border}`,
                    background: 'transparent', color: theme.text, fontSize: 14, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Back
                </button>
              )}
              <button
                onClick={next}
                style={{
                  padding: '10px 22px', borderRadius: 8, border: 'none',
                  background: theme.rust, color: 'white', fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {isLast ? 'Got it' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

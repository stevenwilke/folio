import { useEffect } from 'react'

// Closes a popover/menu when the user clicks or taps outside `ref`.
// `enabled` short-circuits the listener when the popover is closed so we
// don't pay for a global listener on every page render.
//
// Listens to both mousedown and touchstart so iOS taps trigger the close
// without waiting for the synthetic click event.
export function useOnClickOutside(ref, onOutside, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside(e)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [ref, onOutside, enabled])
}

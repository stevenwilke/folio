import { useEffect, useRef, useState } from 'react'

// Wraps a horizontal-scrolling row so the user can click-and-drag the cards
// left/right in addition to using the scrollbar/wheel. Disabled on mobile —
// native touch swipe already does the right thing there.
//
// A 4-pixel deadzone before a drag is registered means a true click on a
// card still passes through. The trailing click that browsers fire after a
// drag is swallowed by onClickCapture so dragging doesn't accidentally open
// a card.
//
// Safety net: if pointerup/cancel ever fail to fire (browser quirks like a
// context menu or alt-tab stealing focus), a window-level pointerup listener
// resets the drag state so the row doesn't get stuck in "grabbing".
export default function DragScrollRow({ style, children, isMobile, ...rest }) {
  const ref = useRef(null)
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false })
  const [grabbing, setGrabbing] = useState(false)

  useEffect(() => {
    if (isMobile) return
    const reset = () => {
      drag.current.active = false
      setGrabbing(false)
    }
    window.addEventListener('pointerup', reset)
    window.addEventListener('pointercancel', reset)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('pointerup', reset)
      window.removeEventListener('pointercancel', reset)
      window.removeEventListener('blur', reset)
    }
  }, [isMobile])

  if (isMobile) {
    return <div style={style} {...rest}>{children}</div>
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    drag.current = {
      active: true,
      startX: e.clientX,
      startScroll: ref.current?.scrollLeft ?? 0,
      moved: false,
    }
    setGrabbing(true)
    try { ref.current?.setPointerCapture(e.pointerId) } catch {}
  }
  const onPointerMove = (e) => {
    if (!drag.current.active) return
    const dx = e.clientX - drag.current.startX
    if (Math.abs(dx) > 4) drag.current.moved = true
    if (ref.current) ref.current.scrollLeft = drag.current.startScroll - dx
  }
  const endDrag = (e) => {
    if (drag.current.active) {
      try { ref.current?.releasePointerCapture(e.pointerId) } catch {}
    }
    drag.current.active = false
    setGrabbing(false)
  }
  const onClickCapture = (e) => {
    if (drag.current.moved) {
      e.stopPropagation()
      e.preventDefault()
      drag.current.moved = false
    }
  }

  return (
    <div
      ref={ref}
      style={{ ...style, cursor: grabbing ? 'grabbing' : 'grab', userSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
      {...rest}
    >
      {children}
    </div>
  )
}

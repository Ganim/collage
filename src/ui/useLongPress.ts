import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

const HOLD_MS = 500
/** A finger that moves further than this is swiping, not holding. */
const SLOP_PX = 10

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
  onContextMenu: (e: ReactMouseEvent) => void
  onClickCapture: (e: ReactMouseEvent) => void
}

/**
 * Press and hold with a finger, or right-click with a mouse. The click that ends a hold does
 * not reach the element's own click handler.
 */
export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)
  const callback = useRef(onLongPress)
  useEffect(() => {
    callback.current = onLongPress
  })
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }

  const fire = () => {
    cancel()
    held.current = true
    callback.current()
  }

  return {
    onPointerDown: (e) => {
      held.current = false
      if (e.pointerType === 'mouse') return
      start.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(fire, HOLD_MS)
    },
    onPointerMove: (e) => {
      const from = start.current
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e) => {
      e.preventDefault()
      fire()
    },
    onClickCapture: (e) => {
      if (held.current) {
        held.current = false
        e.stopPropagation()
      }
    },
  }
}

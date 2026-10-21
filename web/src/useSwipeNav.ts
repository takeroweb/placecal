import { useEffect, useRef } from 'react'

/**
 * Horizontal swipe on an element → previous / next (month on the calendar, day on the timetable).
 * Only clear sideways flicks count; taps, vertical scrolls and drags of chips/cards are ignored.
 */
export function useSwipeNav<T extends HTMLElement>(onPrev: () => void, onNext: () => void, enabled = true) {
  const ref = useRef<T>(null)
  const cb = useRef({ onPrev, onNext, enabled })
  useEffect(() => { cb.current = { onPrev, onNext, enabled } })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let x0 = 0, y0 = 0, t0 = 0, active = false
    const start = (e: TouchEvent) => {
      // chips / cards have their own long-press & drag gestures
      active = e.touches.length === 1 && !(e.target as HTMLElement).closest('.chip, .tcard, .tl-event, button.chip-more')
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = performance.now()
    }
    const end = (e: TouchEvent) => {
      if (!active || !cb.current.enabled) return
      active = false
      const t = e.changedTouches[0]
      const dx = t.clientX - x0, dy = t.clientY - y0
      if (performance.now() - t0 > 700) return // slow drags aren't flicks
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      if (dx < 0) cb.current.onNext()
      else cb.current.onPrev()
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchend', end, { passive: true })
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchend', end) }
  }, [])
  return ref
}

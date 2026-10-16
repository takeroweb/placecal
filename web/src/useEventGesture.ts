import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalEvent } from './types'
import { dateAtPoint } from './useTemplateGesture'

/**
 * Gestures on an event chip in the calendar.
 *
 *  mouse : press + move > 5px              → drag; release on another date → move
 *  touch : long-press (400ms) then move    → drag; release on another date → move
 *          moving before the long-press    → cancelled (so a stray swipe never moves anything)
 *  any   : tap without moving              → onTap (open the editor)
 */
export type EventDragState = { event: CalEvent; x: number; y: number; overDate: string | null }

type Opts = {
  onMove: (e: CalEvent, date: string) => void
  onTap: (e: CalEvent) => void
}

const LONG_PRESS_MS = 400

export function useEventGesture({ onMove, onTap }: Opts) {
  const [drag, setDrag] = useState<EventDragState | null>(null)
  const opts = useRef({ onMove, onTap })
  opts.current = { onMove, onTap }
  const cleanup = useRef<() => void>(() => {})

  useEffect(() => () => cleanup.current(), [])

  const onPointerDown = useCallback((e: React.PointerEvent, event: CalEvent) => {
    if (event.pending) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const sx = e.clientX, sy = e.clientY
    const isMouse = e.pointerType === 'mouse'
    const pid = e.pointerId
    let mode: 'pending' | 'drag' | 'cancel' = 'pending'

    const startDrag = (x: number, y: number) => {
      mode = 'drag'
      setDrag({ event, x, y, overDate: dateAtPoint(x, y) })
    }
    const timer = isMouse ? 0 : window.setTimeout(() => {
      if (mode !== 'pending') return
      navigator.vibrate?.(15)
      startDrag(sx, sy)
    }, LONG_PRESS_MS)

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy)
      if (mode === 'pending') {
        if (isMouse && dist > 5) startDrag(ev.clientX, ev.clientY)
        else if (!isMouse && dist > 8) { mode = 'cancel'; window.clearTimeout(timer) }
      }
      if (mode === 'drag') {
        ev.preventDefault()
        setDrag({ event, x: ev.clientX, y: ev.clientY, overDate: dateAtPoint(ev.clientX, ev.clientY) })
      }
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      const m = mode
      finish()
      if (m === 'drag') {
        const date = dateAtPoint(ev.clientX, ev.clientY)
        if (date && date !== event.date) opts.current.onMove(event, date)
      } else if (m === 'pending') {
        opts.current.onTap(event)
      }
    }
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      finish()
    }
    const finish = () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      setDrag(null)
    }
    cleanup.current = finish
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }, [])

  return { drag, onPointerDown }
}

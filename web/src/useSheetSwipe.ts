import { useEffect } from 'react'

/**
 * Swipe-down-to-close for every bottom sheet (.sheet inside .sheet-backdrop).
 *
 *  - Pulling down while the sheet is scrolled to the top moves the WHOLE sheet with the finger
 *    (its text never slides on its own); release far enough / fast enough → it closes.
 *  - Pulling up scrolls a tall sheet as usual.
 *  - Closing is done exactly like tapping the backdrop, so each sheet keeps its own close logic.
 */
const CLOSE_DISTANCE = 110 // px
const CLOSE_SPEED = 0.6 // px per ms

export function useSheetSwipe() {
  useEffect(() => {
    let sheet: HTMLElement | null = null
    let backdrop: HTMLElement | null = null
    let startX = 0, startY = 0, startT = 0, dy = 0
    let state: 'idle' | 'pending' | 'dragging' | 'scrolling' = 'idle'

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      const s = (e.target as HTMLElement | null)?.closest<HTMLElement>('.sheet')
      if (!s || e.touches.length > 1) { state = 'idle'; return }
      // keep native behaviour inside multi-line text / sliders
      if ((e.target as HTMLElement).closest('textarea, input[type=range]')) { state = 'idle'; return }
      sheet = s
      backdrop = s.closest<HTMLElement>('.sheet-backdrop')
      startX = t.clientX; startY = t.clientY; startT = performance.now(); dy = 0
      state = 'pending'
    }

    const onMove = (e: TouchEvent) => {
      if (state === 'idle' || state === 'scrolling' || !sheet) return
      const t = e.touches[0]
      const mx = t.clientX - startX, my = t.clientY - startY
      if (state === 'pending') {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return
        // down + already at the top → drag the sheet; anything else → normal scrolling
        if (my > 0 && Math.abs(my) > Math.abs(mx) && sheet.scrollTop <= 0) {
          state = 'dragging'
          sheet.style.transition = 'none'
          ;(document.activeElement as HTMLElement | null)?.blur?.() // close the keyboard while dragging
        } else {
          state = 'scrolling'
          return
        }
      }
      e.preventDefault() // the sheet moves, its content doesn't
      dy = Math.max(0, my)
      sheet.style.transform = `translateY(${dy}px)`
      if (backdrop) backdrop.style.backgroundColor = `rgba(0,0,0,${0.35 * Math.max(0, 1 - dy / 400)})`
    }

    const onEnd = () => {
      if (state !== 'dragging' || !sheet) { state = 'idle'; return }
      const s = sheet, b = backdrop
      const speed = dy / Math.max(1, performance.now() - startT)
      state = 'idle'
      s.style.transition = 'transform .2s ease-out'
      if (dy > CLOSE_DISTANCE || (dy > 40 && speed > CLOSE_SPEED)) {
        s.style.transform = 'translateY(100%)'
        window.setTimeout(() => b?.click(), 180) // same as tapping outside the sheet
      } else {
        s.style.transform = ''
        if (b) b.style.backgroundColor = ''
      }
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [])
}

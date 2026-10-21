import { useCallback, useEffect, useRef, useState } from 'react'
import type { Template } from './types'

/**
 * One gesture system for mouse, pen and touch (HTML5 drag&drop does not work on phones).
 *
 *  mouse : press + move > 5px            → drag; release on a date → place
 *  touch : swipe UP (vertical dominant)  → drag; release on a date → place,
 *                                          release elsewhere → placement mode ("どの日に配置しますか？")
 *          long-press (hold still)       → drag in any direction (reorder in the List, move into a folder, place)
 *          tap once, then drag that card → same as long-press (the selected card never scrolls the List)
 *          sideways movement before that → ignored, browser scrolls the tray (touch-action: pan-x)
 *  any   : tap without moving            → toggle placement mode, then tap dates
 *  drag released on another template card → reorder (the card moves to that position)
 *  drag released on a folder (or the "back" crumb) → move the template into that folder
 */
export type DragState = {
  template: Template; x: number; y: number
  overDate: string | null; overTemplateId: string | null
  /** folder under the pointer: a folderId, ROOT_FOLDER for the top level, or null */
  overFolder: string | null
}

/** data-folder-drop value meaning "top level of the List" */
export const ROOT_FOLDER = '@root'

const LONG_PRESS_MS = 380

/**
 * True while a card is held. A document-level touchmove listener registered up front (non-passive)
 * cancels scrolling then — iOS ignores listeners added after the touch has started.
 */
let holding = false
let scrollGuardInstalled = false
function installScrollGuard() {
  if (scrollGuardInstalled) return
  scrollGuardInstalled = true
  document.addEventListener('touchmove', (e) => { if (holding) e.preventDefault() }, { passive: false })
}

/** While a card is held near the List's left/right edge, scroll the List so far cards can be reached. */
function autoScroll(x: number, y: number) {
  const grid = document.querySelector<HTMLElement>('.tray-grid')
  if (!grid) return
  const r = grid.getBoundingClientRect()
  if (y < r.top - 20 || y > r.bottom + 20) return
  const edge = 36
  if (x < r.left + edge) grid.scrollLeft -= 10
  else if (x > r.right - edge) grid.scrollLeft += 10
}

type Opts = {
  onDrop: (t: Template, date: string) => void
  onTap: (t: Template) => void
  onSwipeNoTarget: (t: Template) => void
  onReorder: (t: Template, targetId: string) => void
  /** folderId null = top level */
  onMoveToFolder: (t: Template, folderId: string | null) => void
}

export function dateAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  return el?.closest<HTMLElement>('[data-date]')?.dataset.date ?? null
}

function templateAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  return el?.closest<HTMLElement>('[data-template-id]')?.dataset.templateId ?? null
}

function folderAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  return el?.closest<HTMLElement>('[data-folder-drop]')?.dataset.folderDrop ?? null
}

export function useTemplateGesture({ onDrop, onTap, onSwipeNoTarget, onReorder, onMoveToFolder }: Opts) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const opts = useRef({ onDrop, onTap, onSwipeNoTarget, onReorder, onMoveToFolder })
  opts.current = { onDrop, onTap, onSwipeNoTarget, onReorder, onMoveToFolder }
  const cleanup = useRef<() => void>(() => {})

  useEffect(() => () => cleanup.current(), [])
  useEffect(installScrollGuard, [])

  const onPointerDown = useCallback((e: React.PointerEvent, template: Template) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const sx = e.clientX, sy = e.clientY
    const isMouse = e.pointerType === 'mouse'
    // A card selected with one tap (.armed, CSS touch-action: none) can be moved right away by dragging it.
    const selected = (e.currentTarget as HTMLElement).classList.contains('armed')
    let mode: 'pending' | 'drag' | 'scroll' = 'pending'
    const pid = e.pointerId
    let last = { x: sx, y: sy }

    const update = (x: number, y: number) => {
      const over = templateAtPoint(x, y)
      setDrag({
        template, x, y, overDate: dateAtPoint(x, y),
        overTemplateId: over === template.templateId ? null : over,
        overFolder: folderAtPoint(x, y),
      })
    }
    const pickUp = () => {
      mode = 'drag'
      holding = true
      navigator.vibrate?.(12)
      update(last.x, last.y)
    }
    // Touch: holding still picks the card up — then it can go onto another card (reorder),
    // a folder (move) or a date (place). Moving before that is a normal scroll / swipe.
    const hold = isMouse ? 0 : window.setTimeout(() => { if (mode === 'pending') pickUp() }, LONG_PRESS_MS)

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      last = { x: ev.clientX, y: ev.clientY }
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      if (mode === 'pending') {
        if (isMouse || selected) {
          if (Math.hypot(dx, dy) > 6) { window.clearTimeout(hold); pickUp() }
        } else if (dy < -10 && Math.abs(dy) > Math.abs(dx) * 1.2) {
          window.clearTimeout(hold)
          pickUp() // upward swipe picks the template up right away
        } else if (Math.hypot(dx, dy) > 10) {
          window.clearTimeout(hold)
          mode = 'scroll' // sideways before the hold: let the List scroll
        }
      }
      if (mode === 'drag') {
        ev.preventDefault()
        update(ev.clientX, ev.clientY)
        autoScroll(ev.clientX, ev.clientY)
      }
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      const m = mode
      finish()
      if (m === 'drag') {
        const date = dateAtPoint(ev.clientX, ev.clientY)
        const target = templateAtPoint(ev.clientX, ev.clientY)
        const folder = folderAtPoint(ev.clientX, ev.clientY)
        if (date) opts.current.onDrop(template, date)
        else if (folder) opts.current.onMoveToFolder(template, folder === ROOT_FOLDER ? null : folder)
        else if (target && target !== template.templateId) opts.current.onReorder(template, target)
        else if (!isMouse && !target) opts.current.onSwipeNoTarget(template)
      } else if (m === 'pending') {
        opts.current.onTap(template)
      }
    }
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      finish()
    }
    const finish = () => {
      window.clearTimeout(hold)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      holding = false
      setDrag(null)
    }
    cleanup.current = finish
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }, [])

  return { drag, onPointerDown }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Template } from './types'

/**
 * One gesture system for mouse, pen and touch (HTML5 drag&drop does not work on phones).
 *
 *  mouse : press + move > 5px            → drag; release on a date → place
 *  touch : swipe UP (vertical dominant)  → drag; release on a date → place,
 *                                          release elsewhere → placement mode ("どの日に配置しますか？")
 *          sideways movement             → ignored, browser scrolls the tray (touch-action: pan-x)
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

  const onPointerDown = useCallback((e: React.PointerEvent, template: Template) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const sx = e.clientX, sy = e.clientY
    const isMouse = e.pointerType === 'mouse'
    let mode: 'pending' | 'drag' | 'scroll' = 'pending'
    const pid = e.pointerId

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      if (mode === 'pending') {
        if (isMouse) {
          if (Math.hypot(dx, dy) > 5) mode = 'drag'
        } else if (dy < -10 && Math.abs(dy) > Math.abs(dx) * 1.2) {
          mode = 'drag' // upward swipe picks the template up
          navigator.vibrate?.(10)
        } else if (Math.hypot(dx, dy) > 10) {
          mode = 'scroll' // let the tray scroll; never steal sideways gestures
        }
      }
      if (mode === 'drag') {
        ev.preventDefault()
        const over = templateAtPoint(ev.clientX, ev.clientY)
        setDrag({
          template, x: ev.clientX, y: ev.clientY, overDate: dateAtPoint(ev.clientX, ev.clientY),
          overTemplateId: over === template.templateId ? null : over,
          overFolder: folderAtPoint(ev.clientX, ev.clientY),
        })
      }
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      finish()
      if (mode === 'drag') {
        const date = dateAtPoint(ev.clientX, ev.clientY)
        const target = templateAtPoint(ev.clientX, ev.clientY)
        const folder = folderAtPoint(ev.clientX, ev.clientY)
        if (date) opts.current.onDrop(template, date)
        else if (folder) opts.current.onMoveToFolder(template, folder === ROOT_FOLDER ? null : folder)
        else if (target && target !== template.templateId) opts.current.onReorder(template, target)
        else if (!isMouse && !target) opts.current.onSwipeNoTarget(template)
      } else if (mode === 'pending') {
        opts.current.onTap(template)
      }
    }
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      finish()
    }
    const finish = () => {
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

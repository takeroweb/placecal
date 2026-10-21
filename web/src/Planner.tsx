import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, IS_LOCAL } from './api'
import { jpDate, monthGrid, timeLabel, todayStr, ymd } from './dates'
import type { CalEvent, Category, EventInput, Folder, Job, JobInput, Template, TemplateInput, User } from './types'
import { Calendar } from './components/Calendar'
import { TemplateTray } from './components/TemplateTray'
import { EventForm, NewEventForm, TemplateForm } from './components/TemplateForm'
import { DayTimeline } from './components/DayTimeline'
import { AccountSheet } from './components/AccountSheet'
import { FolderSheet } from './components/FolderSheet'
import { CategorySheet } from './components/CategorySheet'
import { BulkSheet } from './components/BulkSheet'
import { DaySheet } from './components/DaySheet'
import { useTemplateGesture } from './useTemplateGesture'
import { useEventGesture } from './useEventGesture'

// '#/day/2026-10-15' → that date's timetable is open.
const readDay = () => /^#\/day\/(\d{4}-\d{2}-\d{2})$/.exec(location.hash)?.[1] ?? null

type Toast = { id: number; text: string; undo?: () => void; error?: boolean; ms?: number }

/** Undo toast after adding a schedule: short, so it doesn't sit over the calendar. */
const ADDED_TOAST_MS = 1500

/** onLogout is absent when the server runs without login. */
export function Planner({ user, onLogout }: { user: User; onLogout?: () => void }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [categories, setCategories] = useState<Category[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [events, setEvents] = useState<CalEvent[]>([])
  const [armed, setArmed] = useState<Template | null>(null)
  // false = closed; otherwise the new-template form, optionally with a preselected category
  const [formOpen, setFormOpen] = useState<false | { categoryId?: string; defaults?: Partial<TemplateInput> }>(false)
  // List folders. The open folder is remembered on this device (a viewer convenience).
  const [folders, setFolders] = useState<Folder[]>([])
  const [currentFolder, setCurrentFolder] = useState<string | null>(() => {
    try { return localStorage.getItem('placecal.folder') || null } catch { return null }
  })
  const [folderSheet, setFolderSheet] = useState<null | { folder?: Folder }>(null)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null)
  const [catOpen, setCatOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
  const [bulkFor, setBulkFor] = useState<Template | null>(null)
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ date: string; startTime?: string; endTime?: string } | null>(null)
  const [dayView, setDayView] = useState(readDay)
  useEffect(() => {
    const on = () => setDayView(readDay())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  // Keep the loaded month in step with the timetable's date (prev/next day can cross months).
  const [syncedDay, setSyncedDay] = useState<string | null>(null)
  if (dayView && dayView !== syncedDay) {
    setSyncedDay(dayView)
    const [y, m] = dayView.split('-').map(Number)
    if (y !== ym.y || m - 1 !== ym.m) setYm({ y, m: m - 1 })
  }
  const openDay = (date: string | null) => { location.hash = date ? `#/day/${date}` : '#/' }
  const [toast, setToast] = useState<Toast | null>(null)
  const [flash, setFlash] = useState<Set<string>>(new Set())
  const [loadErr, setLoadErr] = useState('')
  const today = todayStr()

  // ---- data loading ----
  useEffect(() => {
    Promise.all([api.categories(), api.templates(), api.jobs(), api.folders()])
      .then(([c, t, j, f]) => {
        setCategories(c.categories); setTemplates(t.templates); setJobs(j.jobs); setFolders(f.folders)
        // the remembered folder may have been deleted on another visit
        setCurrentFolder((cur) => (cur && f.folders.some((x) => x.folderId === cur) ? cur : null))
      })
      .catch((e) => setLoadErr(e instanceof ApiError ? e.message : '読み込みに失敗しました'))
  }, [])

  // Only fetch the days visible in this month's grid.
  const range = useMemo(() => {
    const g = monthGrid(ym.y, ym.m)
    return { start: ymd(g[0][0]), end: ymd(g[g.length - 1][6]) }
  }, [ym])
  const reqSeq = useRef(0)
  // Deletes are deferred so "取り消す" can restore the exact event; they are flushed after the toast.
  const pendingDeletes = useRef(new Map<string, number>())
  useEffect(() => {
    const seq = ++reqSeq.current
    api.events(range.start, range.end)
      .then((r) => {
        if (seq !== reqSeq.current) return
        const fresh = r.events.filter((e) => !pendingDeletes.current.has(e.eventId))
        setEvents((prev) => [...fresh, ...prev.filter((e) => e.pending)])
      })
      .catch((e) => setLoadErr(e instanceof ApiError ? e.message : '予定を読み込めませんでした'))
  }, [range])

  const jobMap = useMemo(() => new Map(jobs.map((j) => [j.jobId, j])), [jobs])
  const catMap = useMemo(() => new Map(categories.map((c) => [c.categoryId, c])), [categories])
  const eventsByDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of events) {
      const list = m.get(e.date) ?? []
      list.push(e)
      m.set(e.date, list)
    }
    for (const list of m.values()) list.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
    return m
  }, [events])

  // ---- toast ----
  const toastTimer = useRef<number | undefined>(undefined)
  const showToast = useCallback((t: Omit<Toast, 'id'>) => {
    window.clearTimeout(toastTimer.current)
    setToast({ ...t, id: Date.now() })
    toastTimer.current = window.setTimeout(() => setToast(null), t.ms ?? (t.undo ? 4500 : 3000))
  }, [])

  const flashDate = useCallback((date: string) => {
    setFlash((s) => new Set(s).add(date))
    window.setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(date); return n }), 700)
  }, [])
  const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

  // ---- the core action: place a template on a date ----
  const place = useCallback(async (t: Template, date: string) => {
    const tempId = `tmp-${crypto.randomUUID()}`
    const optimistic: CalEvent = {
      eventId: tempId, userId: user.userId, templateId: t.templateId, title: t.title, categoryId: t.categoryId,
      jobId: t.jobId, breakMinutes: t.breakMinutes,
      date, startTime: t.startTime, endTime: t.endTime, location: t.location, memo: t.memo,
      notificationMinutes: t.notificationMinutes, source: 'template', createdAt: '', updatedAt: '', pending: true,
    }
    setEvents((p) => [...p, optimistic]) // shows instantly
    flashDate(date)
    try {
      const { event } = await api.placeTemplate(t.templateId, date)
      setEvents((p) => p.map((e) => (e.eventId === tempId ? event : e)))
      showToast({
        text: `${jpDate(date)} に「${t.title}」を配置`, ms: ADDED_TOAST_MS,
        undo: () => {
          setEvents((p) => p.filter((e) => e.eventId !== event.eventId))
          api.deleteEvent(event.eventId).catch(() => {
            setEvents((p) => [...p, event])
            showToast({ text: '取り消しに失敗しました', error: true })
          })
          setToast(null)
        },
      })
    } catch (e) {
      setEvents((p) => p.filter((x) => x.eventId !== tempId))
      showToast({ text: e instanceof ApiError ? e.message : '配置できませんでした', error: true })
    }
  }, [user.userId, showToast, flashDate])

  // ---- events: move / edit / delete ----
  const moveEvent = useCallback(async (ev: CalEvent, date: string) => {
    const from = ev.date
    setEvents((p) => p.map((e) => (e.eventId === ev.eventId ? { ...e, date } : e)))
    flashDate(date)
    try {
      const { event } = await api.updateEvent(ev.eventId, { date })
      setEvents((p) => p.map((e) => (e.eventId === event.eventId ? event : e)))
      showToast({
        text: `「${ev.title}」を ${jpDate(date)} に移動`,
        undo: () => {
          setToast(null)
          setEvents((p) => p.map((e) => (e.eventId === ev.eventId ? { ...e, date: from } : e)))
          api.updateEvent(ev.eventId, { date: from }).catch((e) => {
            setEvents((p) => p.map((x) => (x.eventId === ev.eventId ? { ...x, date } : x)))
            showToast({ text: errText(e, '取り消しに失敗しました'), error: true })
          })
        },
      })
    } catch (e) {
      setEvents((p) => p.map((x) => (x.eventId === ev.eventId ? { ...x, date: from } : x)))
      showToast({ text: errText(e, '移動できませんでした'), error: true })
    }
  }, [showToast, flashDate])

  const createEvent = async (input: EventInput, endDate?: string) => {
    if (endDate) {
      const { events: created, batchId } = await api.createEventRange(input, endDate)
      setEvents((p) => [...p, ...created])
      setCreating(null)
      created.forEach((e) => flashDate(e.date))
      showToast({
        text: `${jpDate(input.date)}〜${jpDate(endDate)} に「${input.title}」を追加`, ms: ADDED_TOAST_MS,
        undo: () => {
          setToast(null)
          const ids = new Set(created.map((e) => e.eventId))
          setEvents((p) => p.filter((e) => !ids.has(e.eventId)))
          api.undoBatch(batchId).catch((e) => {
            setEvents((p) => [...p, ...created])
            showToast({ text: errText(e, '取り消しに失敗しました'), error: true })
          })
        },
      })
      return
    }
    const { event } = await api.createEvent(input)
    setEvents((p) => [...p, event])
    setCreating(null)
    flashDate(event.date)
    showToast({
      text: `${jpDate(event.date)} に「${event.title}」を追加`, ms: ADDED_TOAST_MS,
      undo: () => {
        setToast(null)
        setEvents((p) => p.filter((e) => e.eventId !== event.eventId))
        api.deleteEvent(event.eventId).catch((e) => {
          setEvents((p) => [...p, event])
          showToast({ text: errText(e, '取り消しに失敗しました'), error: true })
        })
      },
    })
  }

  const saveEvent = async (ev: CalEvent, input: EventInput) => {
    const { event } = await api.updateEvent(ev.eventId, input)
    setEvents((p) => p.map((e) => (e.eventId === event.eventId ? event : e)))
    setEditingEvent(null)
    if (event.date !== ev.date) flashDate(event.date)
    showToast({ text: '予定を保存しました' })
  }

  const flushDelete = useCallback((ev: CalEvent) => {
    pendingDeletes.current.delete(ev.eventId)
    api.deleteEvent(ev.eventId).catch((e) => {
      setEvents((p) => [...p, ev])
      showToast({ text: errText(e, '削除できませんでした'), error: true })
    })
  }, [showToast])

  const removeEvent = (ev: CalEvent) => {
    setEditingEvent(null)
    setEvents((p) => p.filter((e) => e.eventId !== ev.eventId))
    pendingDeletes.current.set(ev.eventId, window.setTimeout(() => flushDelete(ev), 4600))
    showToast({
      text: `「${ev.title}」を削除しました`,
      undo: () => {
        setToast(null)
        window.clearTimeout(pendingDeletes.current.get(ev.eventId))
        pendingDeletes.current.delete(ev.eventId)
        setEvents((p) => [...p, ev])
      },
    })
  }

  // Leaving the page must not drop a delete the user already confirmed.
  useEffect(() => {
    const flushAll = () => {
      for (const [id, timer] of pendingDeletes.current) {
        window.clearTimeout(timer)
        if (IS_LOCAL) api.deleteEvent(id).catch(() => {}) // on-device: no network involved
        else fetch(`/api/events/${id}`, { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => {})
      }
      pendingDeletes.current.clear()
    }
    window.addEventListener('pagehide', flushAll)
    return () => { window.removeEventListener('pagehide', flushAll); flushAll() }
  }, [])

  // ---- template order (drag a card onto another card) ----
  const reorderTemplate = (t: Template, targetId: string) => {
    const prev = templates
    const from = prev.findIndex((x) => x.templateId === t.templateId)
    const to = prev.findIndex((x) => x.templateId === targetId)
    if (from < 0 || to < 0) return
    const next = [...prev]
    next.splice(to, 0, ...next.splice(from, 1)) // takes the target's position
    setTemplates(next)
    api.reorderTemplates(next.map((x) => x.templateId)).catch((e) => {
      setTemplates(prev)
      showToast({ text: errText(e, '並び替えを保存できませんでした'), error: true })
    })
  }

  const updateJob = async (id: string, input: Partial<JobInput>) => {
    const { job } = await api.updateJob(id, input)
    setJobs((p) => p.map((j) => (j.jobId === id ? job : j)))
    return job
  }

  const createJob = async (input: JobInput) => {
    const { job } = await api.createJob(input)
    setJobs((p) => [...p, job])
    return job
  }

  // ---- bulk placement ----
  const bulkPlace = async (t: Template, start: string, end: string, weekdays?: number[]) => {
    const { events: created, batchId } = await api.bulkPlace(t.templateId, start, end, weekdays)
    setEvents((p) => [...p, ...created])
    created.forEach((e) => flashDate(e.date))
    setBulkFor(null)
    setArmed(null)
    showToast({
      text: `「${t.title}」を${created.length}日に配置`, ms: ADDED_TOAST_MS,
      undo: () => {
        setToast(null)
        const ids = new Set(created.map((e) => e.eventId))
        setEvents((p) => p.filter((e) => !ids.has(e.eventId)))
        api.undoBatch(batchId).catch((e) => {
          setEvents((p) => [...p, ...created])
          showToast({ text: errText(e, '取り消しに失敗しました'), error: true })
        })
      },
    })
  }

  const gesture = useTemplateGesture({
    onDrop: (t, date) => { setArmed(null); place(t, date) },
    onTap: (t) => setArmed((a) => (a?.templateId === t.templateId ? null : t)),
    onSwipeNoTarget: (t) => setArmed(t),
    onReorder: (t, targetId) => reorderTemplate(t, targetId),
    onMoveToFolder: (t, folderId) => moveToFolder(t, folderId),
  })

  const eventGesture = useEventGesture({
    onMove: moveEvent,
    onTap: (ev) => setEditingEvent(ev),
  })
  // In placement mode, chips are just part of the date cell (tap = place there).
  const startEventGesture = eventGesture.onPointerDown
  const onChipPointerDown = useCallback((e: React.PointerEvent, ev: CalEvent) => {
    if (!armed) startEventGesture(e, ev)
  }, [armed, startEventGesture])

  const onDateTap = useCallback((date: string) => {
    if (armed) place(armed, date) // stays armed: tap more dates to place again
    else if (eventsByDate.get(date)?.length) setDayOpen(date) // small cells may clip chips
    else setCreating({ date }) // empty day: straight to a one-off event
  }, [armed, place, eventsByDate, setDayOpen, setCreating])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setArmed(null); setFormOpen(false); setEditingTemplate(null); setEditingEvent(null); setFolderSheet(null)
      setCatOpen(false); setBulkFor(null); setDayOpen(null); setCreating(null); setAcctOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- List folders ----
  const folderMap = useMemo(() => new Map(folders.map((f) => [f.folderId, f])), [folders])
  const openFolder = (id: string | null) => {
    setCurrentFolder(id)
    try { if (id) localStorage.setItem('placecal.folder', id); else localStorage.removeItem('placecal.folder') } catch { /* ignore */ }
  }
  const folderName = (id: string | null) => (id ? folderMap.get(id)?.name ?? 'List' : 'List')

  const moveToFolder = async (t: Template, folderId: string | null) => {
    if ((t.folderId ?? null) === folderId) return
    const from = t.folderId ?? null
    setTemplates((p) => p.map((x) => (x.templateId === t.templateId ? { ...x, folderId } : x)))
    try {
      await api.updateTemplate(t.templateId, { folderId })
      showToast({
        text: `「${t.title}」を「${folderName(folderId)}」へ移動`,
        undo: () => {
          setToast(null)
          setTemplates((p) => p.map((x) => (x.templateId === t.templateId ? { ...x, folderId: from } : x)))
          api.updateTemplate(t.templateId, { folderId: from }).catch(() => {})
        },
      })
    } catch (e) {
      setTemplates((p) => p.map((x) => (x.templateId === t.templateId ? { ...x, folderId: from } : x)))
      showToast({ text: errText(e, '移動できませんでした'), error: true })
    }
  }

  /** New template inside a folder: prefill the folder name, and category / バイト先 / 休憩 from a template nearby. */
  const newTemplateDefaults = (): Partial<TemplateInput> => {
    if (!currentFolder) return {}
    let near: Template | undefined
    for (let f: string | null = currentFolder; f && !near; f = folderMap.get(f)?.parentId ?? null) {
      near = templates.find((t) => t.folderId === f)
    }
    return {
      folderId: currentFolder, title: folderName(currentFolder),
      ...(near ? { categoryId: near.categoryId, jobId: near.jobId, breakMinutes: near.breakMinutes } : {}),
    }
  }

  const saveFolder = async (name: string) => {
    const editingFolder = folderSheet?.folder
    if (editingFolder) {
      const { folder } = await api.updateFolder(editingFolder.folderId, { name })
      setFolders((p) => p.map((f) => (f.folderId === folder.folderId ? folder : f)))
    } else {
      const { folder } = await api.createFolder({ name, parentId: currentFolder })
      setFolders((p) => [...p, folder])
      showToast({ text: `フォルダ「${folder.name}」を作成しました` })
    }
    setFolderSheet(null)
  }

  // Same rule as the server: the folder's contents move up one level.
  const deleteFolder = async (f: Folder) => {
    await api.deleteFolder(f.folderId)
    setFolders((p) => p.filter((x) => x.folderId !== f.folderId).map((x) => (x.parentId === f.folderId ? { ...x, parentId: f.parentId } : x)))
    setTemplates((p) => p.map((t) => (t.folderId === f.folderId ? { ...t, folderId: f.parentId } : t)))
    if (currentFolder === f.folderId) openFolder(f.parentId)
    setFolderSheet(null)
    showToast({ text: `フォルダ「${f.name}」を削除しました（中身は1つ上へ）` })
  }

  const createTemplate = async (input: TemplateInput) => {
    const { template } = await api.createTemplate(input)
    setTemplates((p) => [...p, template])
    setFormOpen(false)
    showToast({ text: `テンプレート「${template.title}」を作成しました` })
  }

  const updateTemplate = async (t: Template, input: TemplateInput) => {
    const { template } = await api.updateTemplate(t.templateId, input)
    setTemplates((p) => p.map((x) => (x.templateId === template.templateId ? template : x)))
    setArmed((a) => (a?.templateId === template.templateId ? template : a))
    setEditingTemplate(null)
    showToast({ text: 'テンプレートを保存しました' })
  }

  const deleteTemplate = async (t: Template) => {
    try {
      await api.deleteTemplate(t.templateId)
      setTemplates((p) => p.filter((x) => x.templateId !== t.templateId))
      setArmed((a) => (a?.templateId === t.templateId ? null : a))
      setEditingTemplate(null)
      showToast({ text: `テンプレート「${t.title}」を削除しました（配置済みの予定は残ります）` })
    } catch (e) {
      showToast({ text: errText(e, '削除できませんでした'), error: true })
    }
  }

  // ---- categories ----
  const createCategory = async (c: { name: string; color: string }) => {
    const { category } = await api.createCategory(c)
    setCategories((p) => [...p, category])
  }
  const updateCategory = async (id: string, c: Partial<{ name: string; color: string }>) => {
    const { category } = await api.updateCategory(id, c)
    setCategories((p) => p.map((x) => (x.categoryId === id ? category : x)))
  }
  // Server keeps events/templates and sets their category to null (未分類); mirror that locally.
  const deleteCategory = async (c: Category) => {
    await api.deleteCategory(c.categoryId)
    setCategories((p) => p.filter((x) => x.categoryId !== c.categoryId))
    const unset = <T extends { categoryId: string | null }>(x: T) => (x.categoryId === c.categoryId ? { ...x, categoryId: null } : x)
    setTemplates((p) => p.map(unset))
    setEvents((p) => p.map(unset))
    setArmed((a) => (a ? unset(a) : a))
  }

  const colorOf = (categoryId: string | null) => catMap.get(categoryId ?? '')?.color ?? '#6b7280'

  const shiftMonth = (d: number) => setYm(({ y, m }) => { const n = new Date(y, m + d, 1); return { y: n.getFullYear(), m: n.getMonth() } })
  const isThisMonth = ym.y === now.getFullYear() && ym.m === now.getMonth()
  const drag = gesture.drag
  const evDrag = eventGesture.drag

  return (
    <div className={`app ${drag || evDrag ? 'is-dragging' : ''}`}>
      <header className="topbar">
        <div className="month-nav">
          <button className="icon-btn" aria-label="前の月" onClick={() => shiftMonth(-1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <h1 className="month-title">{ym.y}年<b>{ym.m + 1}</b>月</h1>
          <button className="icon-btn" aria-label="次の月" onClick={() => shiftMonth(1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <div className="top-actions">
          {!isThisMonth && <button className="btn small" onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>今日</button>}
          <button className="icon-btn" aria-label="タイムテーブル" title="1日のタイムテーブル"
            onClick={() => openDay(isThisMonth ? today : ymd(new Date(ym.y, ym.m, 1)))}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </button>
          <a className="icon-btn" href="#/earnings" aria-label="収入" title="収入（時給の集計）">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 4 6 8 6-8" /><path d="M12 12v8" /><path d="M7 13h10" /><path d="M7 17h10" /></svg>
          </a>
          <button className="icon-btn" aria-label="カテゴリー" title="カテゴリー" onClick={() => setCatOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="1.5" /><circle cx="17.5" cy="10.5" r="1.5" /><circle cx="8.5" cy="7.5" r="1.5" /><circle cx="6.5" cy="12.5" r="1.5" /><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a6 6 0 0 0 6-6c0-4.9-4.5-8.6-10-8.6Z" /></svg>
          </button>
          <button className="icon-btn" aria-label="アカウント" title={IS_LOCAL ? 'データとバックアップ' : 'アカウント・iPhoneウィジェット'} onClick={() => setAcctOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
          </button>
        </div>
      </header>

      <main className="cal-area">
        {loadErr && <p className="banner error" role="alert">{loadErr}</p>}
        {armed && (
          <div className="banner place" role="status">
            <span className="place-dot" style={{ ['--c' as string]: colorOf(armed.categoryId) }} />
            <span className="place-text"><b>{armed.title}</b> {timeLabel(armed.startTime, armed.endTime)} をどの日に配置しますか？</span>
            <span className="place-actions">
              <button className="btn small sub" onClick={() => setBulkFor(armed)}>複数日</button>
              <button className="btn small sub" onClick={() => setEditingTemplate(armed)}>編集</button>
              <button className="btn small" onClick={() => setArmed(null)}>完了</button>
            </span>
          </div>
        )}
        <Calendar
          year={ym.y} month={ym.m} today={today}
          eventsByDate={eventsByDate} categories={catMap}
          hoverDate={drag?.overDate ?? evDrag?.overDate ?? null} armed={!!armed}
          flashDates={flash} movingId={evDrag?.event.eventId ?? null}
          onDateTap={onDateTap} onChipPointerDown={onChipPointerDown}
          onChipKey={setEditingEvent} onMore={setDayOpen}
        />
        {toast && (
          <div key={toast.id} className={`toast ${toast.error ? 'error' : ''} ${dayView ? 'floating' : ''}`} role="status">
            <span>{toast.text}</span>
            {toast.undo && <button className="toast-undo" onClick={toast.undo}>取り消す</button>}
          </div>
        )}
      </main>

      <TemplateTray
        templates={templates.filter((t) => (t.folderId ?? null) === currentFolder)} allTemplates={templates}
        folders={folders} current={currentFolder}
        categories={catMap} jobs={jobMap} armedId={armed?.templateId ?? null}
        draggingId={drag?.template.templateId ?? null} reorderOverId={drag?.overTemplateId ?? null}
        overFolder={drag?.overFolder ?? null}
        onPointerDown={gesture.onPointerDown}
        onKeyboardSelect={(t) => setArmed((a) => (a?.templateId === t.templateId ? null : t))}
        onOpenFolder={openFolder}
        onAddFolder={() => setFolderSheet({})}
        onEditFolder={(f) => setFolderSheet({ folder: f })}
        onAdd={() => setFormOpen({ defaults: newTemplateDefaults() })}
      />
      {folderSheet && (
        <FolderSheet folder={folderSheet.folder}
          parentName={folderName(folderSheet.folder ? folderSheet.folder.parentId : currentFolder)}
          onSubmit={saveFolder}
          onDelete={folderSheet.folder ? () => deleteFolder(folderSheet.folder!) : undefined}
          onClose={() => setFolderSheet(null)} />
      )}

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y, ['--c' as string]: catMap.get(drag.template.categoryId ?? '')?.color ?? '#6b7280' }} aria-hidden="true">
          <b>{drag.template.title}</b>
          <span>{drag.overDate ? jpDate(drag.overDate) : drag.overFolder ? `「${folderName(drag.overFolder === '@root' ? null : drag.overFolder)}」へ移動` : drag.overTemplateId ? 'ここへ移動' : timeLabel(drag.template.startTime, drag.template.endTime)}</span>
        </div>
      )}

      {evDrag && (
        <div className="drag-ghost" style={{ left: evDrag.x, top: evDrag.y, ['--c' as string]: colorOf(evDrag.event.categoryId) }} aria-hidden="true">
          <b>{evDrag.event.title}</b>
          <span>{evDrag.overDate && evDrag.overDate !== evDrag.event.date ? `${jpDate(evDrag.overDate)} へ移動` : timeLabel(evDrag.event.startTime, evDrag.event.endTime)}</span>
        </div>
      )}

      {dayView && (
        <DayTimeline date={dayView} today={today} events={eventsByDate.get(dayView) ?? []}
          categories={catMap} jobs={jobMap}
          onDate={openDay} onClose={() => openDay(null)} onOpenEvent={setEditingEvent}
          onNew={(date, hour) => setCreating(hour === undefined ? { date }
            : { date, startTime: `${String(hour).padStart(2, '0')}:00`, endTime: hour >= 23 ? '23:59' : `${String(hour + 1).padStart(2, '0')}:00` })} />
      )}
      {acctOpen && <AccountSheet user={user} onLogout={onLogout} onClose={() => setAcctOpen(false)} />}
      {catOpen && (
        <CategorySheet categories={categories} templates={templates} jobs={jobMap}
          onEditTemplate={setEditingTemplate} onAddTemplate={(categoryId) => setFormOpen({ categoryId })}
          onCreate={createCategory} onUpdate={updateCategory}
          onDelete={deleteCategory} onClose={() => setCatOpen(false)} />
      )}
      {creating && (
        <NewEventForm categories={categories} jobs={jobs} onCreateJob={createJob} onUpdateJob={updateJob}
          date={creating.date} startTime={creating.startTime} endTime={creating.endTime}
          onSubmit={createEvent} onClose={() => setCreating(null)} />
      )}
      {formOpen && <TemplateForm categories={categories} jobs={jobs} onCreateJob={createJob} onUpdateJob={updateJob} defaultCategoryId={formOpen.categoryId} defaults={formOpen.defaults} folders={folders} onSubmit={createTemplate} onClose={() => setFormOpen(false)} />}
      {editingTemplate && (
        <TemplateForm categories={categories} jobs={jobs} onCreateJob={createJob} onUpdateJob={updateJob} template={editingTemplate} folders={folders}
          onSubmit={(input) => updateTemplate(editingTemplate, input)}
          onDelete={() => deleteTemplate(editingTemplate)}
          onClose={() => setEditingTemplate(null)} />
      )}
      {editingEvent && (
        <EventForm categories={categories} jobs={jobs} onCreateJob={createJob} onUpdateJob={updateJob} event={editingEvent}
          onSubmit={(input) => saveEvent(editingEvent, input)}
          onDelete={() => removeEvent(editingEvent)}
          onClose={() => setEditingEvent(null)} />
      )}
      {bulkFor && (
        <BulkSheet template={bulkFor} color={colorOf(bulkFor.categoryId)}
          defaultStart={isThisMonth ? today : ymd(new Date(ym.y, ym.m, 1))}
          onSubmit={(s, e, w) => bulkPlace(bulkFor, s, e, w)}
          onClose={() => setBulkFor(null)} />
      )}
      {dayOpen && (
        <DaySheet date={dayOpen} events={eventsByDate.get(dayOpen) ?? []} categories={catMap}
          onOpen={(e) => { setDayOpen(null); setEditingEvent(e) }} onClose={() => setDayOpen(null)}
          onAdd={() => { setCreating({ date: dayOpen }); setDayOpen(null) }}
          onTimeline={() => { openDay(dayOpen); setDayOpen(null) }} />
      )}
    </div>
  )
}

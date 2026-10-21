// Browser-only implementation of the PlaceCal API (used by the GitHub Pages build).
// It mirrors server/src/resources.js and reuses the server's validation and pay calculation
// so both builds behave the same. Data never leaves the device.
import { ApiError } from '../apiError'
import type { CalEvent, Category, Earnings, EventInput, Folder, Job, JobInput, Template, TemplateInput, User } from '../types'
import { read, requestPersistence, uuid, write, type Sorted, type State } from './store'
// Shared with the server (plain ES modules, no Node APIs):
import * as v from '../../../server/src/validate.js'
import { payPeriod, summarizeEarnings } from '../../../server/src/earnings.js'
import { ApiError as ServerError } from '../../../server/src/errors.js'
import { DEFAULT_CATEGORIES, DEFAULT_TEMPLATES } from '../../../server/src/seed-data.js'

const now = () => new Date().toISOString()
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const bad = (code: string, message: string, field?: string) => new ApiError(400, code, message, field)
const notFound = (code: string, message: string) => new ApiError(404, code, message)
const strip = <T extends { sortOrder: number }>({ sortOrder: _s, ...rest }: T) => rest
const bySort = <T extends { sortOrder: number; createdAt: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)
const JOB_COLORS = ['#2f6fde', '#0e8f8f', '#e8780c', '#8a4fd8', '#d6336c', '#1f9d55', '#c99a06', '#6b7280']

// ---------- state ----------
function fresh(): State {
  const t = now()
  const user: User = { userId: 'local', name: 'わたし', email: '', createdAt: t }
  const ids: Record<string, string> = {}
  const categories = DEFAULT_CATEGORIES.map((c: { key: string; name: string; color: string }, i: number) => {
    ids[c.key] = uuid()
    return { categoryId: ids[c.key], userId: 'local', name: c.name, color: c.color, sortOrder: i, createdAt: t, updatedAt: t }
  })
  const templates = DEFAULT_TEMPLATES.map((d: { cat: string; title: string; start: string | null; end: string | null; location: string }, i: number) => ({
    templateId: uuid(), userId: 'local', title: d.title, categoryId: ids[d.cat], folderId: null, jobId: null, breakMinutes: 0,
    startTime: d.start, endTime: d.end, location: d.location, memo: '', notificationMinutes: null,
    sortOrder: i, createdAt: t, updatedAt: t,
  }))
  return { v: 1, user, categories, templates, folders: [], jobs: [], events: [] }
}

let loaded: Promise<State> | null = null
function state(): Promise<State> {
  loaded ??= (async () => {
    requestPersistence()
    const s = await read()
    if (s && s.v === 1) {
      s.folders ??= [] // data saved before folders existed
      for (const t of s.templates) t.folderId ??= null
      return s
    }
    const f = fresh()
    await write(f)
    return f
  })()
  return loaded
}

/** Run an operation; server-style errors become the UI's ApiError. Mutations are saved afterwards. */
async function run<T>(fn: (s: State) => T, mutate = false): Promise<T> {
  const s = await state()
  try {
    const r = fn(s)
    if (mutate) await write(s)
    return structuredClone(r)
  } catch (e) {
    if (e instanceof ServerError) {
      const se = e as unknown as { status: number; code: string; message: string; field?: string }
      throw new ApiError(se.status, se.code, se.message, se.field)
    }
    throw e
  }
}

// ---------- lookups / validation (same rules as the server) ----------
const ownCategory = (s: State, id: unknown) => (typeof id === 'string' ? s.categories.find((c) => c.categoryId === id) : undefined)
const ownTemplate = (s: State, id: unknown) => (typeof id === 'string' ? s.templates.find((t) => t.templateId === id) : undefined)
const folders = (s: State) => (s.folders ??= [])
const ownFolder = (s: State, id: unknown) => (typeof id === 'string' ? folders(s).find((f) => f.folderId === id) : undefined)
function checkFolder(s: State, id: unknown): string | null {
  if (id === null || id === undefined || id === '') return null
  if (!ownFolder(s, id)) throw bad('FOLDER_NOT_FOUND', 'フォルダが見つかりません', 'folderId')
  return id as string
}
const MAX_DEPTH = 6
const depthOf = (s: State, id: string | null) => { let d = 0; for (let f = ownFolder(s, id); f; f = ownFolder(s, f.parentId)) d++; return d }
const ownJob = (s: State, id: unknown) => (typeof id === 'string' ? s.jobs.find((j) => j.jobId === id) : undefined)
const ownEvent = (s: State, id: unknown) => (typeof id === 'string' ? s.events.find((e) => e.eventId === id) : undefined)

function checkCategory(s: State, id: unknown, allowNull = false): string | null {
  if ((id === null || id === undefined || id === '') && allowNull) return null
  if (!ownCategory(s, id)) throw bad('CATEGORY_NOT_FOUND', 'カテゴリーが見つかりません', 'categoryId')
  return id as string
}
function checkJob(s: State, id: unknown): string | null {
  if (id === null || id === undefined || id === '') return null
  if (!ownJob(s, id)) throw bad('JOB_NOT_FOUND', 'バイト先が見つかりません', 'jobId')
  return id as string
}

type Body = Record<string, unknown>
type Valid = Pick<Template, 'title' | 'categoryId' | 'jobId' | 'breakMinutes' | 'startTime' | 'endTime' | 'location' | 'memo' | 'notificationMinutes'>

function validateBody(s: State, b: Body, allowNullCategory: boolean): Valid {
  const [startTime, endTime] = v.timeRange(b.startTime, b.endTime)
  return {
    title: v.title(b.title),
    categoryId: checkCategory(s, b.categoryId, allowNullCategory),
    jobId: checkJob(s, b.jobId),
    breakMinutes: v.breakMinutes(b.breakMinutes, startTime, endTime),
    startTime, endTime,
    location: v.text(b.location, 'location', 200),
    memo: v.text(b.memo, 'memo', 2000),
    notificationMinutes: v.notify(b.notificationMinutes),
  }
}

const copyOf = (t: Template): Valid => ({
  title: t.title, categoryId: t.categoryId, jobId: t.jobId, breakMinutes: t.breakMinutes,
  startTime: t.startTime, endTime: t.endTime, location: t.location, memo: t.memo, notificationMinutes: t.notificationMinutes,
})

function insertEvent(s: State, d: Valid, extra: { date: string; templateId?: string | null; source: string; batchId?: string }): CalEvent {
  const t = now()
  const e: CalEvent = {
    eventId: uuid(), userId: 'local', templateId: extra.templateId ?? null, ...d, date: extra.date,
    source: extra.source, batchId: extra.batchId ?? null, createdAt: t, updatedAt: t,
  }
  s.events.push(e)
  return e
}

const nextSort = (list: { sortOrder: number }[]) => list.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1

// ---------- API (same shape as the server client) ----------
export const localApi = {
  me: () => run((s) => ({ user: s.user, authMode: 'local' as const })),
  login: async (_e: string, _p: string): Promise<{ user: User }> => { throw notFound('AUTH_DISABLED', 'この版はログインなしで動作します') },
  register: async (_n: string, _e: string, _p: string): Promise<{ user: User }> => { throw notFound('AUTH_DISABLED', 'この版はログインなしで動作します') },
  logout: async () => ({ ok: true as const }),
  authStatus: async () => ({ authMode: 'local' as const, signupOpen: false }),
  widgetToken: async (): Promise<{ token: string }> => { throw notFound('NOT_AVAILABLE', 'この版ではウィジェットは使えません') },
  rotateWidgetToken: async (): Promise<{ token: string }> => { throw notFound('NOT_AVAILABLE', 'この版ではウィジェットは使えません') },

  // ----- categories -----
  categories: () => run((s) => ({ categories: [...s.categories].sort(bySort).map(strip) as Category[] })),
  createCategory: (b: { name: string; color: string }) => run((s) => {
    const t = now()
    const c = { categoryId: uuid(), userId: 'local', name: v.title(b.name, 'name', 'カテゴリー名'), color: v.color(b.color), sortOrder: nextSort(s.categories), createdAt: t, updatedAt: t }
    s.categories.push(c)
    return { category: strip(c) as Category }
  }, true),
  updateCategory: (id: string, b: Partial<{ name: string; color: string }>) => run((s) => {
    const c = ownCategory(s, id)
    if (!c) throw notFound('CATEGORY_NOT_FOUND', 'カテゴリーが見つかりません')
    const name = has(b, 'name') ? v.title(b.name, 'name', 'カテゴリー名') : c.name
    const color = has(b, 'color') ? v.color(b.color) : c.color
    Object.assign(c, { name, color, updatedAt: now() })
    return { category: strip(c) as Category }
  }, true),
  /** Like the server: events/templates are kept, their category becomes null (未分類). */
  deleteCategory: (id: string) => run((s) => {
    if (!ownCategory(s, id)) throw notFound('CATEGORY_NOT_FOUND', 'カテゴリーが見つかりません')
    s.categories = s.categories.filter((c) => c.categoryId !== id)
    for (const x of [...s.templates, ...s.events]) if (x.categoryId === id) x.categoryId = null
    return { ok: true as const }
  }, true),

  // ----- jobs -----
  jobs: () => run((s) => ({ jobs: [...s.jobs].sort(bySort).map(strip) as Job[] })),
  createJob: (b: JobInput) => run((s) => {
    const t = now()
    const body = b as Body
    const j: Sorted<Job> = {
      jobId: uuid(), userId: 'local',
      name: v.title(body.name, 'name', 'バイト先の名前'),
      hourlyWage: has(body, 'hourlyWage') ? v.yen(body.hourlyWage, 'hourlyWage', '時給') : 0,
      transportFee: has(body, 'transportFee') ? v.yen(body.transportFee, 'transportFee', '交通費') : 0,
      color: has(body, 'color') ? v.color(body.color) : JOB_COLORS[s.jobs.length % JOB_COLORS.length],
      closingDay: has(body, 'closingDay') ? v.intIn(body.closingDay, 0, 28, 'closingDay', '締め日') : 0,
      payDay: has(body, 'payDay') ? v.intIn(body.payDay, 1, 31, 'payDay', '支給日') : 25,
      payMonthOffset: has(body, 'payMonthOffset') ? v.intIn(body.payMonthOffset, 0, 2, 'payMonthOffset', '支給月') : 1,
      breakRules: has(body, 'breakRules') ? v.breakRules(body.breakRules) : [],
      sortOrder: nextSort(s.jobs), createdAt: t, updatedAt: t,
    }
    s.jobs.push(j)
    return { job: strip(j) as Job }
  }, true),
  updateJob: (id: string, b: Partial<JobInput>) => run((s) => {
    const j = ownJob(s, id)
    if (!j) throw notFound('JOB_NOT_FOUND', 'バイト先が見つかりません')
    const body = b as Body
    Object.assign(j, {
      name: has(body, 'name') ? v.title(body.name, 'name', 'バイト先の名前') : j.name,
      hourlyWage: has(body, 'hourlyWage') ? v.yen(body.hourlyWage, 'hourlyWage', '時給') : j.hourlyWage,
      transportFee: has(body, 'transportFee') ? v.yen(body.transportFee, 'transportFee', '交通費') : j.transportFee,
      color: has(body, 'color') ? v.color(body.color) : j.color,
      closingDay: has(body, 'closingDay') ? v.intIn(body.closingDay, 0, 28, 'closingDay', '締め日') : j.closingDay,
      payDay: has(body, 'payDay') ? v.intIn(body.payDay, 1, 31, 'payDay', '支給日') : j.payDay,
      payMonthOffset: has(body, 'payMonthOffset') ? v.intIn(body.payMonthOffset, 0, 2, 'payMonthOffset', '支給月') : j.payMonthOffset,
      breakRules: has(body, 'breakRules') ? v.breakRules(body.breakRules) : j.breakRules,
      updatedAt: now(),
    })
    return { job: strip(j) as Job }
  }, true),
  deleteJob: (id: string) => run((s) => {
    if (!ownJob(s, id)) throw notFound('JOB_NOT_FOUND', 'バイト先が見つかりません')
    s.jobs = s.jobs.filter((j) => j.jobId !== id)
    for (const x of [...s.templates, ...s.events]) if (x.jobId === id) x.jobId = null
    return { ok: true as const }
  }, true),
  earnings: (month: string) => run((s): Earnings => {
    v.month(month)
    const jobs = [...s.jobs].sort(bySort).map(strip) as Job[]
    const events = jobs.flatMap((j) => {
      const p = payPeriod(j, month)
      return s.events.filter((e) => e.jobId === j.jobId && e.date >= p.start && e.date <= p.end)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
    })
    return { month, ...summarizeEarnings(jobs, events, month) }
  }),

  // ----- folders (List) -----
  folders: () => run((s) => ({ folders: [...folders(s)].sort(bySort).map(strip) as Folder[] })),
  createFolder: (b: { name: string; parentId: string | null }) => run((s) => {
    const name = v.title(b.name, 'name', 'フォルダ名')
    const parentId = checkFolder(s, b.parentId)
    if (parentId && depthOf(s, parentId) >= MAX_DEPTH) throw bad('TOO_DEEP', `フォルダは${MAX_DEPTH}階層までです`, 'parentId')
    const t = now()
    const f: Sorted<Folder> = { folderId: uuid(), userId: 'local', parentId, name, sortOrder: nextSort(folders(s)), createdAt: t, updatedAt: t }
    folders(s).push(f)
    return { folder: strip(f) as Folder }
  }, true),
  updateFolder: (id: string, b: Partial<{ name: string; parentId: string | null }>) => run((s) => {
    const f = ownFolder(s, id)
    if (!f) throw notFound('FOLDER_NOT_FOUND', 'フォルダが見つかりません')
    const name = has(b, 'name') ? v.title(b.name, 'name', 'フォルダ名') : f.name
    let parentId = f.parentId
    if (has(b, 'parentId')) {
      parentId = checkFolder(s, b.parentId)
      for (let p = ownFolder(s, parentId); p; p = ownFolder(s, p.parentId)) {
        if (p.folderId === f.folderId) throw bad('INVALID_PARENT', 'フォルダを自分の中には移動できません', 'parentId')
      }
    }
    Object.assign(f, { name, parentId, updatedAt: now() })
    return { folder: strip(f) as Folder }
  }, true),
  /** Contents move up to the parent; nothing is deleted except the folder itself. */
  deleteFolder: (id: string) => run((s) => {
    const f = ownFolder(s, id)
    if (!f) throw notFound('FOLDER_NOT_FOUND', 'フォルダが見つかりません')
    for (const t of s.templates) if (t.folderId === id) t.folderId = f.parentId
    for (const c of folders(s)) if (c.parentId === id) c.parentId = f.parentId
    s.folders = folders(s).filter((x) => x.folderId !== id)
    return { ok: true as const }
  }, true),

  // ----- templates -----
  templates: () => run((s) => ({ templates: [...s.templates].sort(bySort).map(strip) as Template[] })),
  reorderTemplates: (ids: string[]) => run((s) => {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) {
      throw bad('VALIDATION_ERROR', '並び順の指定が正しくありません', 'templateIds')
    }
    if (!ids.every((id) => ownTemplate(s, id))) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません')
    ids.forEach((id, i) => { ownTemplate(s, id)!.sortOrder = i })
    return { templates: [...s.templates].sort(bySort).map(strip) as Template[] }
  }, true),
  createTemplate: (b: TemplateInput) => run((s) => {
    const t = now()
    const folderId = checkFolder(s, (b as Body).folderId)
    const tpl: Sorted<Template> = { templateId: uuid(), userId: 'local', ...validateBody(s, b as Body, false), folderId, sortOrder: nextSort(s.templates), createdAt: t, updatedAt: t }
    s.templates.push(tpl)
    return { template: strip(tpl) as Template }
  }, true),
  updateTemplate: (id: string, b: Partial<TemplateInput>) => run((s) => {
    const cur = ownTemplate(s, id)
    if (!cur) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません')
    const d = validateBody(s, { ...cur, ...b }, !has(b, 'categoryId'))
    const folderId = has(b, 'folderId') ? checkFolder(s, (b as Body).folderId) : cur.folderId
    Object.assign(cur, d, { folderId, updatedAt: now() })
    return { template: strip(cur) as Template }
  }, true),
  /** Placed events keep their copied values; only the link to the template is cleared. */
  deleteTemplate: (id: string) => run((s) => {
    if (!ownTemplate(s, id)) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません')
    s.templates = s.templates.filter((t) => t.templateId !== id)
    for (const e of s.events) if (e.templateId === id) e.templateId = null
    return { ok: true as const }
  }, true),

  // ----- events -----
  events: (start: string, end: string) => run((s) => {
    v.reqDate(start, 'start')
    v.reqDate(end, 'end')
    if (start > end) throw bad('INVALID_RANGE', '開始日は終了日以前にしてください', 'end')
    return {
      events: s.events.filter((e) => e.date >= start && e.date <= end)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.createdAt.localeCompare(b.createdAt)),
    }
  }),
  /** Core flow: copy the template onto the date. */
  placeTemplate: (templateId: string, date: string) => run((s) => {
    v.reqDate(date)
    const tpl = ownTemplate(s, templateId)
    if (!tpl) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません')
    return { event: insertEvent(s, copyOf(tpl), { templateId: tpl.templateId, date, source: 'template' }) }
  }, true),
  createEvent: (b: EventInput) => run((s) => {
    const date = v.reqDate(b.date)
    return { event: insertEvent(s, validateBody(s, b as unknown as Body, false), { date, source: 'manual' }) }
  }, true),
  bulkPlace: (templateId: string, startDate: string, endDate: string, weekdays?: number[]) => run((s) => {
    const tpl = ownTemplate(s, templateId)
    if (!tpl) throw notFound('TEMPLATE_NOT_FOUND', 'テンプレートが見つかりません')
    const dates: string[] = v.dateList(startDate, endDate, weekdays)
    const batchId = uuid()
    const d = copyOf(tpl)
    return { events: dates.map((date) => insertEvent(s, d, { templateId: tpl.templateId, date, source: 'bulk', batchId })), batchId }
  }, true),
  createEventRange: (b: EventInput, endDate: string) => run((s) => {
    const { date, ...rest } = b
    const d = validateBody(s, rest as unknown as Body, false)
    const dates: string[] = v.dateList(date, endDate)
    const batchId = uuid()
    return { events: dates.map((x) => insertEvent(s, d, { date: x, source: 'bulk', batchId })), batchId }
  }, true),
  undoBatch: (batchId: string) => run((s) => {
    const before = s.events.length
    s.events = s.events.filter((e) => e.batchId !== batchId)
    const deleted = before - s.events.length
    if (!deleted) throw notFound('BATCH_NOT_FOUND', '取り消す予定が見つかりません')
    return { ok: true as const, deleted }
  }, true),
  updateEvent: (id: string, b: Partial<EventInput>) => run((s) => {
    const cur = ownEvent(s, id)
    if (!cur) throw notFound('EVENT_NOT_FOUND', '予定が見つかりません')
    const merged = { ...cur, ...b }
    const date = v.reqDate(merged.date)
    const d = validateBody(s, merged, !has(b, 'categoryId'))
    Object.assign(cur, d, { date, updatedAt: now() })
    return { event: cur }
  }, true),
  deleteEvent: (id: string) => run((s) => {
    if (!ownEvent(s, id)) throw notFound('EVENT_NOT_FOUND', '予定が見つかりません')
    s.events = s.events.filter((e) => e.eventId !== id)
    return { ok: true as const }
  }, true),
}

// ---------- backup ----------
/** JSON of everything on this device (for 書き出す). */
export async function exportBackup(): Promise<string> {
  const s = await state()
  return JSON.stringify({ app: 'PlaceCal', exportedAt: now(), ...s }, null, 2)
}

/** Replace all data with a backup file's contents. */
export async function importBackup(text: string): Promise<void> {
  let data: unknown
  try { data = JSON.parse(text) } catch { throw bad('INVALID_BACKUP', 'バックアップファイルを読み込めませんでした') }
  const d = data as Partial<State> & { app?: string }
  const ok = d && d.app === 'PlaceCal' && d.v === 1 && d.user
    && [d.categories, d.templates, d.jobs, d.events].every(Array.isArray)
  if (!ok) throw bad('INVALID_BACKUP', 'PlaceCal のバックアップファイルではありません')
  const s = await state()
  s.user = d.user!
  s.categories = d.categories!
  s.templates = d.templates!
  s.jobs = d.jobs!
  s.events = d.events!
  s.folders = d.folders ?? []
  for (const t of s.templates) t.folderId ??= null
  await write(s)
}

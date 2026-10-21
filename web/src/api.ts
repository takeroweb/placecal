import type { CalEvent, Category, Earnings, EventInput, Folder, Job, JobInput, Template, TemplateInput, User } from './types'

import { ApiError } from './apiError'
import { localApi } from './local/backend'

export { ApiError }

/** Browser-only build (GitHub Pages): data is kept on this device, no server. */
export const IS_LOCAL = import.meta.env.VITE_STORAGE === 'local'

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '通信できませんでした。接続を確認してください')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = data?.error ?? {}
    throw new ApiError(res.status, e.code ?? 'UNKNOWN', e.message ?? 'エラーが発生しました', e.field)
  }
  return data as T
}

const serverApi = {
  /** authMode 'local' = the server runs without login (single user). */
  me: () => call<{ user: User; authMode: 'local' | 'password' }>('GET', '/auth/me'),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/auth/login', { email, password }),
  register: (name: string, email: string, password: string) =>
    call<{ user: User }>('POST', '/auth/register', { name, email, password }),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),
  /** signupOpen = false once the personal server has its account */
  authStatus: () => call<{ authMode: 'local' | 'password'; signupOpen: boolean }>('GET', '/auth/status'),
  widgetToken: () => call<{ token: string }>('GET', '/auth/widget-token'),
  rotateWidgetToken: () => call<{ token: string }>('POST', '/auth/widget-token/rotate'),

  categories: () => call<{ categories: Category[] }>('GET', '/categories'),
  createCategory: (c: { name: string; color: string }) => call<{ category: Category }>('POST', '/categories', c),
  updateCategory: (id: string, c: Partial<{ name: string; color: string }>) =>
    call<{ category: Category }>('PUT', `/categories/${id}`, c),
  deleteCategory: (id: string) => call<{ ok: true }>('DELETE', `/categories/${id}`),

  jobs: () => call<{ jobs: Job[] }>('GET', '/jobs'),
  createJob: (j: JobInput) => call<{ job: Job }>('POST', '/jobs', j),
  updateJob: (id: string, j: Partial<JobInput>) => call<{ job: Job }>('PUT', `/jobs/${id}`, j),
  deleteJob: (id: string) => call<{ ok: true }>('DELETE', `/jobs/${id}`),
  /** month = 'YYYY-MM' */
  earnings: (month: string) => call<Earnings>('GET', `/earnings?month=${month}`),

  folders: () => call<{ folders: Folder[] }>('GET', '/folders'),
  createFolder: (f: { name: string; parentId: string | null }) => call<{ folder: Folder }>('POST', '/folders', f),
  updateFolder: (id: string, f: Partial<{ name: string; parentId: string | null }>) => call<{ folder: Folder }>('PUT', `/folders/${id}`, f),
  /** contents (templates / subfolders) move up to the parent folder */
  deleteFolder: (id: string) => call<{ ok: true }>('DELETE', `/folders/${id}`),

  templates: () => call<{ templates: Template[] }>('GET', '/templates'),
  reorderTemplates: (templateIds: string[]) => call<{ templates: Template[] }>('PUT', '/templates/order', { templateIds }),
  createTemplate: (t: TemplateInput) => call<{ template: Template }>('POST', '/templates', t),
  updateTemplate: (id: string, t: Partial<TemplateInput>) => call<{ template: Template }>('PUT', `/templates/${id}`, t),
  deleteTemplate: (id: string) => call<{ ok: true }>('DELETE', `/templates/${id}`),

  events: (start: string, end: string) =>
    call<{ events: CalEvent[] }>('GET', `/events?start=${start}&end=${end}`),
  /** Core flow: send only templateId + date; the server copies the template. */
  placeTemplate: (templateId: string, date: string) =>
    call<{ event: CalEvent }>('POST', '/events', { templateId, date }),
  /** Place a template on every date in [startDate, endDate], optionally only on weekdays (0=Sun..6=Sat). */
  bulkPlace: (templateId: string, startDate: string, endDate: string, weekdays?: number[]) =>
    call<{ events: CalEvent[]; batchId: string }>('POST', '/events/bulk', { templateId, startDate, endDate, weekdays }),
  /** A typed (non-template) event repeated on every day of the range. */
  createEventRange: (e: EventInput, endDate: string) => {
    const { date, ...rest } = e
    return call<{ events: CalEvent[]; batchId: string }>('POST', '/events/bulk', { ...rest, startDate: date, endDate })
  },
  undoBatch: (batchId: string) => call<{ ok: true; deleted: number }>('DELETE', `/events/batch/${batchId}`),
  /** One-off event typed by the user (not saved as a template). */
  createEvent: (e: EventInput) => call<{ event: CalEvent }>('POST', '/events', e),
  /** Partial update: sending only { date } moves the event. */
  updateEvent: (id: string, e: Partial<EventInput>) => call<{ event: CalEvent }>('PUT', `/events/${id}`, e),
  deleteEvent: (id: string) => call<{ ok: true }>('DELETE', `/events/${id}`),
}

export const api: typeof serverApi = IS_LOCAL ? localApi : serverApi

// On-device persistence for the browser-only build (GitHub Pages).
// The whole state is one small JSON document kept in IndexedDB (localStorage as a fallback).
import type { CalEvent, Category, Job, Template, User } from '../types'

export type Sorted<T> = T & { sortOrder: number }
export type State = {
  v: 1
  user: User
  categories: Sorted<Category>[]
  templates: Sorted<Template>[]
  jobs: Sorted<Job>[]
  events: CalEvent[]
}

const DB = 'placecal'
const STORE = 'kv'
const KEY = 'state'

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(): Promise<State | undefined> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
    r.onsuccess = () => resolve(r.result as State | undefined)
    r.onerror = () => reject(r.error)
  })
}

async function idbPut(s: State): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(s, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function read(): Promise<State | undefined> {
  try {
    return await idbGet()
  } catch {
    try { const raw = localStorage.getItem(DB); return raw ? (JSON.parse(raw) as State) : undefined } catch { return undefined }
  }
}

/** Writes are queued so they land in order even when the UI fires several at once. */
let queue: Promise<void> = Promise.resolve()
export function write(s: State): Promise<void> {
  const snapshot = structuredClone(s)
  queue = queue.then(async () => {
    try { await idbPut(snapshot) } catch { localStorage.setItem(DB, JSON.stringify(snapshot)) }
  })
  return queue
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {})
}

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })

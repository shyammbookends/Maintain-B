/*
 * Offline support for people working on the floor.
 *
 *  - Reads: successful GETs of the screens a technician uses are kept in
 *    IndexedDB; when the network is gone the last copy is served instead.
 *  - Writes: a technician action that can't reach the server is queued in
 *    IndexedDB with its Idempotency-Key and replayed, in order, when the
 *    connection returns. The server applies each key once, so a retry after a
 *    half-finished request never duplicates a photo, a part or a start.
 *  - Anything the server refuses on replay (e.g. the job was reassigned) is
 *    kept in a "could not be saved" list for the user to see and dismiss.
 *
 * Everything degrades to "online only" when IndexedDB isn't available.
 */

const DB_NAME = 'bookends-offline'
const DB_VERSION = 1
const QUEUE = 'queue'
const FAILED = 'failed'
const CACHE = 'cache'
const MAX_CACHE = 300

/** Writes the queue accepts (technician field actions). */
const QUEUEABLE: Array<{ method: string; re: RegExp }> = [
  {
    method: 'POST',
    re: /^\/work-orders\/[^/]+\/(start|hold|resume|complete|messages|parts|time)$/,
  },
  { method: 'POST', re: /^\/work-orders\/[^/]+\/attachments$/ },
  { method: 'POST', re: /^\/work-orders\/[^/]+\/checklist\/[^/]+\/attachments$/ },
  { method: 'PUT', re: /^\/work-orders\/[^/]+\/checklist\/[^/]+$/ },
  { method: 'POST', re: /^\/assets\/[^/]+\/meters\/[^/]+\/readings$/ },
  { method: 'PUT', re: /^\/inspections\/[^/]+\/items\/[^/]+$/ },
  { method: 'POST', re: /^\/inspections\/[^/]+\/items\/[^/]+\/attachments$/ },
  { method: 'POST', re: /^\/inspections\/[^/]+\/submit$/ },
  { method: 'POST', re: /^\/requests$/ },
]

/** Reads kept for offline viewing. */
const CACHEABLE = [
  /^\/me(\/|$)/,
  /^\/work-orders\/[^/]+$/,
  /^\/assets\/by-public\//,
  /^\/assets\/[^/]+(\/meters)?$/,
  /^\/inspections\/[^/]+$/,
  /^\/procedures\/[^/]+$/,
  /^\/notifications(\/unread-count)?$/,
  /^\/restaurants$/,
]

export const isQueueable = (method: string, path: string) =>
  QUEUEABLE.some((q) => q.method === method && q.re.test(path))
export const isCacheable = (path: string) => CACHEABLE.some((re) => re.test(path))

type Part = { name: string; value: string } | { name: string; blob: Blob; fileName: string }

export interface QueuedWrite {
  /** Also the Idempotency-Key. */
  id: string
  method: 'POST' | 'PUT' | 'DELETE'
  path: string
  json?: unknown
  form?: Part[]
  createdAt: number
}

export interface FailedWrite extends QueuedWrite {
  error: string
  failedAt: number
}

// ---------------------------------------------------------------- IndexedDB

let dbPromise: Promise<IDBDatabase> | null = null
const hasIdb = () => typeof indexedDB !== 'undefined'

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const d = open.result
      if (!d.objectStoreNames.contains(QUEUE)) d.createObjectStore(QUEUE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(FAILED)) d.createObjectStore(FAILED, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(CACHE)) d.createObjectStore(CACHE, { keyPath: 'url' })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('IndexedDB unavailable'))
  })
  return dbPromise
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    t.oncomplete = () => resolve(r ? r.result : undefined)
    t.onerror = () => reject(t.error)
  })
}

const all = async <T>(store: string) =>
  ((await tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)) ?? []) as T[]

// ---------------------------------------------------------------- status

export interface OfflineStatus {
  online: boolean
  pending: number
  failed: FailedWrite[]
  syncing: boolean
}

let status: OfflineStatus = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  failed: [],
  syncing: false,
}
const listeners = new Set<() => void>()
const emit = (patch: Partial<OfflineStatus>) => {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}
export const offlineStatus = {
  get: () => status,
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

/** Called after a successful sync so screens refetch fresh data. */
let onSynced: (() => void) | null = null
export const setOnSynced = (fn: (() => void) | null) => {
  onSynced = fn
}

async function refreshCounts() {
  if (!hasIdb()) return
  try {
    const [queue, failed] = await Promise.all([all<QueuedWrite>(QUEUE), all<FailedWrite>(FAILED)])
    emit({ pending: queue.length, failed: failed.sort((a, b) => a.failedAt - b.failedAt) })
  } catch {
    // ignore: counts are cosmetic
  }
}

// ---------------------------------------------------------------- reads

export async function cacheRead(url: string, body: unknown): Promise<void> {
  if (!hasIdb()) return
  try {
    await tx(CACHE, 'readwrite', (s) => s.put({ url, body, at: Date.now() }))
    // Keep the cache small: drop the oldest entries.
    const rows = await all<{ url: string; at: number }>(CACHE)
    if (rows.length > MAX_CACHE) {
      const old = rows.sort((a, b) => a.at - b.at).slice(0, rows.length - MAX_CACHE)
      await tx(CACHE, 'readwrite', (s) => {
        for (const r of old) s.delete(r.url)
      })
    }
  } catch {
    // caching is best effort
  }
}

export async function cachedRead(url: string): Promise<unknown> {
  if (!hasIdb()) return undefined
  try {
    const row = await tx<{ body: unknown } | undefined>(
      CACHE,
      'readonly',
      (s) => s.get(url) as IDBRequest<{ body: unknown } | undefined>,
    )
    return row?.body
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------- writes

export async function serializeBody(body: unknown): Promise<Pick<QueuedWrite, 'json' | 'form'>> {
  if (!(body instanceof FormData)) return { json: body }
  const form: Part[] = []
  body.forEach((value, name) => {
    if (typeof value === 'string') form.push({ name, value })
    else form.push({ name, blob: value, fileName: (value as File).name || 'file' })
  })
  return { form }
}

export function deserializeBody(w: QueuedWrite): unknown {
  if (!w.form) return w.json
  const fd = new FormData()
  for (const p of w.form) {
    if ('value' in p) fd.append(p.name, p.value)
    else fd.append(p.name, p.blob, p.fileName)
  }
  return fd
}

export const canQueue = () => hasIdb()

export async function enqueue(w: QueuedWrite): Promise<void> {
  await tx(QUEUE, 'readwrite', (s) => s.put(w))
  await refreshCounts()
}

export async function dismissFailed(id?: string): Promise<void> {
  if (!hasIdb()) return
  await tx(FAILED, 'readwrite', (s) => (id ? s.delete(id) : s.clear()))
  await refreshCounts()
}

/** Removes everything stored for the signed-in user (logout). */
export async function clearOfflineData(): Promise<void> {
  if (!hasIdb()) return
  try {
    await Promise.all([
      tx(QUEUE, 'readwrite', (s) => s.clear()),
      tx(FAILED, 'readwrite', (s) => s.clear()),
      tx(CACHE, 'readwrite', (s) => s.clear()),
    ])
  } catch {
    // nothing stored
  }
  await refreshCounts()
}

type Sender = (w: QueuedWrite) => Promise<'ok' | 'offline' | 'retry' | { error: string }>
let sender: Sender | null = null
/** The HTTP layer installs how a queued write is sent (avoids an import cycle). */
export const setSender = (fn: Sender) => {
  sender = fn
}

let flushing: Promise<void> | null = null

/** Replays the queue in order. Stops at the first network failure. */
export function flushQueue(): Promise<void> {
  if (!hasIdb() || !sender) return Promise.resolve()
  flushing ??= (async () => {
    emit({ syncing: true })
    let sent = 0
    try {
      const queue = (await all<QueuedWrite>(QUEUE)).sort((a, b) => a.createdAt - b.createdAt)
      for (const w of queue) {
        const result = await sender!(w)
        if (result === 'offline' || result === 'retry') break
        if (result !== 'ok')
          await tx(FAILED, 'readwrite', (s) =>
            s.put({ ...w, error: result.error, failedAt: Date.now() }),
          )
        await tx(QUEUE, 'readwrite', (s) => s.delete(w.id))
        sent++
      }
    } catch {
      // try again on the next trigger
    } finally {
      emit({ syncing: false })
      await refreshCounts()
      flushing = null
      if (sent > 0) onSynced?.()
    }
  })()
  return flushing
}

let started = false
/** Watches the connection and syncs when it comes back (and every 30 s while items wait). */
export function startOfflineSync(): () => void {
  if (started || typeof window === 'undefined') return () => undefined
  started = true
  const online = () => {
    emit({ online: true })
    void flushQueue()
  }
  const offline = () => emit({ online: false })
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  const timer = window.setInterval(() => {
    if (status.pending > 0 && navigator.onLine) void flushQueue()
  }, 30_000)
  void refreshCounts().then(() => {
    if (navigator.onLine) void flushQueue()
  })
  return () => {
    started = false
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
    window.clearInterval(timer)
  }
}

export const markOffline = () => emit({ online: false })

/**
 * A response arrived, so the server is reachable again. `markOffline` also runs
 * when only the server was unreachable (the browser never fires "online" then),
 * so without this the banner stayed on "offline" and queued changes waited for
 * the 30 s timer.
 */
export const markOnline = () => {
  if (status.online) return
  emit({ online: true })
  if (status.pending > 0) void flushQueue()
}

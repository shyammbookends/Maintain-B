import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  IDEMPOTENCY_HEADER,
  type ApiErrorBody,
  type ErrorCode,
} from '@maintainx/shared'
import i18n from '@/i18n'
import {
  cacheRead,
  cachedRead,
  canQueue,
  deserializeBody,
  enqueue,
  isCacheable,
  isQueueable,
  markOffline,
  markOnline,
  serializeBody,
  setSender,
} from './offline'

// ---------------------------------------------------------------------------
// Session plumbing. The access token lives only in memory (never localStorage);
// the auth service installs the refresh handler so this module has no
// dependency on it.
// ---------------------------------------------------------------------------

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

/** Returns true when a new access token is available, false when the session is over. */
type RefreshHandler = () => Promise<boolean>
let refreshHandler: RefreshHandler | null = null

export function setRefreshHandler(handler: RefreshHandler | null): void {
  refreshHandler = handler
}

const RETRYABLE_AUTH_CODES = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID'])

/** QUEUED_OFFLINE: no connection, the change is stored on the device and will be sent later. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'QUEUED_OFFLINE'

/** Normalised API failure. `code` maps to a translated message via describeError(). */
export class ApiError extends Error {
  readonly status: number
  readonly code: ClientErrorCode
  readonly fieldErrors: Record<string, string[]> | undefined
  readonly requestId: string | undefined

  constructor(
    status: number,
    code: ClientErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
    requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
    this.requestId = requestId
  }
}

export const API_BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}/api/v1`

export type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, QueryValue>
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Non-2xx statuses whose body should be returned instead of thrown (e.g. 503 from /ready). */
  acceptStatuses?: readonly number[]
  /** Don't attach the access token (login, refresh). */
  anonymous?: boolean
  /** Internal: this is the retry after a refresh, don't refresh again. */
  isRetry?: boolean
  /** Return the response body as text (CSV downloads) instead of parsed JSON. */
  raw?: boolean
  /** Return a successful response body as a Blob (PDF downloads). */
  binary?: boolean
  /** Internal: replaying from the offline queue (never queue again). */
  noQueue?: boolean
}

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    headers = {},
    signal,
    acceptStatuses = [],
    anonymous = false,
    isRetry = false,
  } = options

  const token = anonymous ? null : accessToken
  // Every write carries a key, so a retry (or the offline queue) is applied once.
  const idempotencyKey =
    method !== 'GET' && !anonymous ? (headers[IDEMPOTENCY_HEADER] ?? newKey()) : undefined
  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': i18n.language,
    [AUTH_CSRF_HEADER]: AUTH_CSRF_VALUE,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(idempotencyKey ? { [IDEMPOTENCY_HEADER]: idempotencyKey } : {}),
    ...headers,
  }
  const init: RequestInit = { method, credentials: 'include', signal, headers: requestHeaders }

  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body
    } else {
      requestHeaders['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
  }

  const url = buildUrl(path, query)
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    markOffline()
    // Offline: serve the last copy of a screen, or keep the change for later.
    if (method === 'GET' && !options.raw && isCacheable(path)) {
      const cached = await cachedRead(url)
      if (cached !== undefined) return cached as T
    }
    if (
      idempotencyKey &&
      !options.noQueue &&
      (method === 'POST' || method === 'PUT') &&
      isQueueable(method, path) &&
      canQueue()
    ) {
      await enqueue({
        id: idempotencyKey,
        method,
        path,
        ...(await serializeBody(body)),
        createdAt: Date.now(),
      })
      throw new ApiError(0, 'QUEUED_OFFLINE', 'Saved on this device; it will be sent when online.')
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.')
  }
  markOnline()

  if (options.binary && response.ok) return (await response.blob()) as T
  const text = await response.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }

  if (!response.ok && !acceptStatuses.includes(response.status)) {
    const error = (json as Partial<ApiErrorBody> | null)?.error

    // Expired access token: refresh once (shared by concurrent requests), then retry.
    if (
      response.status === 401 &&
      token &&
      !isRetry &&
      refreshHandler &&
      error?.code &&
      RETRYABLE_AUTH_CODES.has(error.code)
    ) {
      if (await refreshHandler()) return request<T>(path, { ...options, isRetry: true })
    }

    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `Request failed (${response.status})`,
      error?.fieldErrors,
      error?.requestId,
    )
  }

  if (method === 'GET' && !options.raw && response.ok && isCacheable(path))
    void cacheRead(url, json)
  return (options.raw ? text : json) as T
}

// How the offline queue replays a stored write.
setSender(async (w) => {
  try {
    await request(w.path, {
      method: w.method,
      body: deserializeBody(w),
      headers: { [IDEMPOTENCY_HEADER]: w.id },
      noQueue: true,
    })
    return 'ok'
  } catch (err) {
    if (!(err instanceof ApiError)) return 'retry'
    if (err.status === 0) return 'offline'
    if (err.code === 'REQUEST_IN_PROGRESS' || err.status >= 500 || err.status === 401)
      return 'retry'
    return { error: err.code }
  }
})

type Opts = Omit<RequestOptions, 'method' | 'body'>

export const http = {
  get: <T>(path: string, opts?: Opts) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Opts) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Opts) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: Opts) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: Opts) => request<T>(path, { ...opts, method: 'DELETE' }),
}

/** Downloads an authenticated text file (e.g. CSV) and saves it under `fileName`. */
export async function downloadFile(
  path: string,
  query: Record<string, QueryValue>,
  fileName: string,
  mimeType = 'text/csv;charset=utf-8',
): Promise<void> {
  const text = await request<string>(path, { method: 'GET', query, raw: true })
  saveBlob(new Blob([text], { type: mimeType }), fileName)
}

/** Downloads an authenticated binary file (e.g. PDF) and saves it under `fileName`. */
export async function downloadBinary(
  path: string,
  query: Record<string, QueryValue>,
  fileName: string,
): Promise<void> {
  saveBlob(await request<Blob>(path, { method: 'GET', query, binary: true }), fileName)
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

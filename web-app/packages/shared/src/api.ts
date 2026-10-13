/** Standard success envelopes. */

export interface ApiResponse<T> {
  data: T
}

export interface PageMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PagedResponse<T> {
  data: T[]
  meta: PageMeta
}

export interface CursorMeta {
  nextCursor: string | null
  hasMore: boolean
}

export interface CursorResponse<T> {
  data: T[]
  meta: CursorMeta
}

export function buildPageMeta(page: number, pageSize: number, total: number): PageMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  }
}

/** Header that makes a write safe to retry: the same key returns the first result. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

import { buildPageMeta, type PagedResponse, type PaginationQuery } from '@maintainx/shared'

export function toSkipTake({ page, pageSize }: PaginationQuery): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize }
}

export function toPagedResponse<T>(
  data: T[],
  query: PaginationQuery,
  total: number,
): PagedResponse<T> {
  return { data, meta: buildPageMeta(query.page, query.pageSize, total) }
}

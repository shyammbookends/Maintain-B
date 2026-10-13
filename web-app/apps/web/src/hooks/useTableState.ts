import { useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import type { QueryValue } from '@/services/http'

/**
 * List-page state (page, size, sort, search, filters) stored in the URL, so a
 * filtered view survives refresh and can be shared as a link. Defaults are
 * omitted from the URL to keep it short. Unknown or invalid values fall back
 * to defaults instead of erroring.
 */

export type SortDirection = 'asc' | 'desc'

export interface SortState<S extends string = string> {
  field: S
  direction: SortDirection
}

export interface TableStateConfig<S extends string = string, F extends string = string> {
  sortFields: readonly S[]
  defaultSort?: SortState<S>
  filters?: readonly F[]
  pageSizes?: readonly number[]
  defaultPageSize?: number
}

export interface TableState<S extends string = string, F extends string = string> {
  page: number
  pageSize: number
  sort: SortState<S> | undefined
  q: string
  filters: Partial<Record<F, string>>
}

export const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const

function resolvedPageSizes(config: TableStateConfig): readonly number[] {
  return config.pageSizes ?? DEFAULT_PAGE_SIZES
}

function resolvedDefaultPageSize(config: TableStateConfig): number {
  return config.defaultPageSize ?? 25
}

export function parseTableState<S extends string, F extends string>(
  params: URLSearchParams,
  config: TableStateConfig<S, F>,
): TableState<S, F> {
  const pageRaw = Number(params.get('page'))
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1

  const sizeRaw = Number(params.get('pageSize'))
  const pageSize = resolvedPageSizes(config).includes(sizeRaw)
    ? sizeRaw
    : resolvedDefaultPageSize(config)

  let sort = config.defaultSort
  const sortRaw = params.get('sort')
  if (sortRaw) {
    const [field, dir] = sortRaw.split(':')
    if (field && (config.sortFields as readonly string[]).includes(field)) {
      sort = { field: field as S, direction: dir === 'desc' ? 'desc' : 'asc' }
    }
  }

  const q = (params.get('q') ?? '').slice(0, 200)

  const filters: Partial<Record<F, string>> = {}
  for (const key of config.filters ?? []) {
    const value = params.get(key)
    if (value) filters[key] = value
  }

  return { page, pageSize, sort, q, filters }
}

/** Writes state into `base` (other params are preserved) and returns a new URLSearchParams. */
export function writeTableState<S extends string, F extends string>(
  state: TableState<S, F>,
  config: TableStateConfig<S, F>,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const next = new URLSearchParams(base)
  const setOrDelete = (key: string, value: string | undefined) => {
    if (value === undefined || value === '') next.delete(key)
    else next.set(key, value)
  }

  setOrDelete('page', state.page > 1 ? String(state.page) : undefined)
  setOrDelete(
    'pageSize',
    state.pageSize !== resolvedDefaultPageSize(config) ? String(state.pageSize) : undefined,
  )

  const isDefaultSort =
    (!state.sort && !config.defaultSort) ||
    (state.sort &&
      config.defaultSort &&
      state.sort.field === config.defaultSort.field &&
      state.sort.direction === config.defaultSort.direction)
  setOrDelete(
    'sort',
    state.sort && !isDefaultSort ? `${state.sort.field}:${state.sort.direction}` : undefined,
  )

  setOrDelete('q', state.q.trim() || undefined)
  for (const key of config.filters ?? []) setOrDelete(key, state.filters[key])

  return next
}

/** Shape the API list endpoints accept: ?page=&pageSize=&sort=field:dir&q=&<filters> */
export function toApiQuery<S extends string, F extends string>(
  state: TableState<S, F>,
): Record<string, QueryValue> {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort ? `${state.sort.field}:${state.sort.direction}` : undefined,
    q: state.q.trim() || undefined,
    ...(state.filters as Record<string, string | undefined>),
  }
}

export function useTableState<S extends string, F extends string = never>(
  config: TableStateConfig<S, F>,
) {
  // Config is expected to be static; pin the first value so inline objects don't churn memos.
  const configRef = useRef(config)
  const cfg = configRef.current
  const [params, setParams] = useSearchParams()

  const state = useMemo(() => parseTableState(params, cfg), [params, cfg])

  const update = useCallback(
    (patch: Partial<TableState<S, F>>, { resetPage = true }: { resetPage?: boolean } = {}) => {
      setParams(
        (prev) => {
          const current = parseTableState(prev, cfg)
          const next: TableState<S, F> = {
            ...current,
            ...patch,
            filters: { ...current.filters, ...patch.filters },
          }
          if (resetPage && patch.page === undefined) next.page = 1
          return writeTableState(next, cfg, prev)
        },
        { replace: true },
      )
    },
    [setParams, cfg],
  )

  const setPage = useCallback((page: number) => update({ page }, { resetPage: false }), [update])
  const setPageSize = useCallback((pageSize: number) => update({ pageSize }), [update])
  const setSort = useCallback((sort: SortState<S> | undefined) => update({ sort }), [update])
  const setSearch = useCallback((q: string) => update({ q }), [update])
  const setFilter = useCallback(
    (key: F, value: string | undefined) =>
      update({ filters: { [key]: value } as Partial<Record<F, string>> }),
    [update],
  )
  const clearFilters = useCallback(() => {
    const cleared = Object.fromEntries((cfg.filters ?? []).map((k) => [k, undefined])) as Partial<
      Record<F, string>
    >
    update({ q: '', filters: cleared })
  }, [update, cfg])

  const isFiltered = state.q.trim() !== '' || Object.values(state.filters).some(Boolean)
  const apiQuery = useMemo(() => toApiQuery(state), [state])

  return {
    state,
    apiQuery,
    isFiltered,
    pageSizes: resolvedPageSizes(cfg),
    setPage,
    setPageSize,
    setSort,
    setSearch,
    setFilter,
    clearFilters,
  }
}

export type TableStateController<S extends string, F extends string> = ReturnType<
  typeof useTableState<S, F>
>

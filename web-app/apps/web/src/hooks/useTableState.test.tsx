import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import {
  parseTableState,
  toApiQuery,
  useTableState,
  writeTableState,
  type TableStateConfig,
} from './useTableState'

type S = 'title' | 'dueDate' | 'priority'
type F = 'status' | 'priority'

const config: TableStateConfig<S, F> = {
  sortFields: ['title', 'dueDate', 'priority'],
  defaultSort: { field: 'dueDate', direction: 'asc' },
  filters: ['status', 'priority'],
}

describe('parseTableState', () => {
  it('returns defaults for an empty URL', () => {
    expect(parseTableState(new URLSearchParams(), config)).toEqual({
      page: 1,
      pageSize: 25,
      sort: { field: 'dueDate', direction: 'asc' },
      q: '',
      filters: {},
    })
  })

  it('reads valid values', () => {
    const s = parseTableState(
      new URLSearchParams('page=3&pageSize=50&sort=title:desc&q=freezer&status=OPEN&junk=1'),
      config,
    )
    expect(s).toEqual({
      page: 3,
      pageSize: 50,
      sort: { field: 'title', direction: 'desc' },
      q: 'freezer',
      filters: { status: 'OPEN' },
    })
  })

  it('falls back on invalid values instead of failing', () => {
    const s = parseTableState(new URLSearchParams('page=-2&pageSize=7&sort=password:desc'), config)
    expect(s.page).toBe(1)
    expect(s.pageSize).toBe(25)
    expect(s.sort).toEqual({ field: 'dueDate', direction: 'asc' })
  })
})

describe('writeTableState', () => {
  it('omits defaults and keeps unrelated params', () => {
    const base = new URLSearchParams('tab=open')
    const out = writeTableState(
      { page: 1, pageSize: 25, sort: { field: 'dueDate', direction: 'asc' }, q: '  ', filters: {} },
      config,
      base,
    )
    expect(out.toString()).toBe('tab=open')
  })

  it('round-trips through parse', () => {
    const state = {
      page: 2,
      pageSize: 10,
      sort: { field: 'priority' as const, direction: 'desc' as const },
      q: 'ice',
      filters: { status: 'ASSIGNED', priority: 'HIGH' },
    }
    expect(parseTableState(writeTableState(state, config), config)).toEqual(state)
  })
})

describe('toApiQuery', () => {
  it('builds the list endpoint query', () => {
    expect(
      toApiQuery({
        page: 2,
        pageSize: 10,
        sort: { field: 'title', direction: 'asc' },
        q: ' x ',
        filters: { status: 'OPEN' },
      }),
    ).toEqual({ page: 2, pageSize: 10, sort: 'title:asc', q: 'x', status: 'OPEN' })
  })
})

describe('useTableState', () => {
  function setup(initial = '/list') {
    const location: { current: string } = { current: '' }
    function Spy() {
      const l = useLocation()
      location.current = l.search
      return null
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[initial]}>
        {children}
        <Spy />
      </MemoryRouter>
    )
    const hook = renderHook(() => useTableState(config), { wrapper })
    return { ...hook, location }
  }

  it('changing a filter resets to page 1 and writes the URL', () => {
    const { result, location } = setup('/list?page=4')
    expect(result.current.state.page).toBe(4)
    act(() => result.current.setFilter('status', 'OPEN'))
    expect(result.current.state.page).toBe(1)
    expect(result.current.state.filters.status).toBe('OPEN')
    expect(result.current.isFiltered).toBe(true)
    expect(location.current).toBe('?status=OPEN')
  })

  it('setPage keeps filters; clearFilters removes search and filters', () => {
    const { result, location } = setup('/list?q=fan&priority=HIGH')
    act(() => result.current.setPage(3))
    expect(location.current).toContain('page=3')
    expect(location.current).toContain('priority=HIGH')
    act(() => result.current.clearFilters())
    expect(result.current.isFiltered).toBe(false)
    expect(location.current).toBe('')
  })

  it('sorting changes reset the page', () => {
    const { result } = setup('/list?page=2')
    act(() => result.current.setSort({ field: 'title', direction: 'desc' }))
    expect(result.current.state).toMatchObject({
      page: 1,
      sort: { field: 'title', direction: 'desc' },
    })
  })
})

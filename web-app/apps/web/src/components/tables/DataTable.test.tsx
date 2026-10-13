import { createColumnHelper } from '@tanstack/react-table'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ApiError } from '@/services/http'
import { DataTable, type DataTableProps } from './DataTable'

interface Row {
  id: string
  name: string
  qty: number
}

const col = createColumnHelper<Row>()
const columns = [
  col.accessor('name', { header: 'Name', enableSorting: true, enableHiding: false }),
  col.accessor('qty', { header: 'Qty', meta: { align: 'right' } }),
]

const ROWS: Row[] = [
  { id: '1', name: 'Compressor relay', qty: 3 },
  { id: '2', name: 'Door gasket', qty: 12 },
]

function renderTable(overrides: Partial<DataTableProps<Row>> = {}) {
  const props: DataTableProps<Row> = {
    label: 'Parts',
    columns,
    data: ROWS,
    getRowId: (r) => r.id,
    total: 42,
    page: 1,
    pageSize: 10,
    pageSizes: [10, 25],
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    sort: undefined,
    onSortChange: vi.fn(),
    isLoading: false,
    emptyState: <p>No parts yet</p>,
    ...overrides,
  }
  render(<DataTable {...props} />)
  return props
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
})

describe('DataTable', () => {
  it('renders rows, header and range', () => {
    renderTable()
    const table = screen.getByRole('table', { name: 'Parts' })
    expect(within(table).getAllByRole('row')).toHaveLength(3) // header + 2
    expect(screen.getByText('Compressor relay')).toBeInTheDocument()
    expect(screen.getByText('1–10 of 42')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument()
  })

  it('shows skeleton rows on first load', () => {
    renderTable({ data: undefined, isLoading: true })
    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
  })

  it('shows the page-specific empty state when the list is genuinely empty', () => {
    renderTable({ data: [], total: 0 })
    expect(screen.getByText('No parts yet')).toBeInTheDocument()
    expect(screen.queryByText('No matching results')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
  })

  it('offers "Clear filters" when filtered and empty', async () => {
    const user = userEvent.setup()
    const onClearFilters = vi.fn()
    renderTable({ data: [], total: 0, isFiltered: true, onClearFilters })
    expect(screen.getByText('No matching results')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClearFilters).toHaveBeenCalledOnce()
  })

  it('shows an error state with retry when loading failed', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderTable({
      data: undefined,
      error: new ApiError(503, 'SERVICE_UNAVAILABLE', 'x', undefined, 'req-123'),
      onRetry,
    })
    expect(screen.getByText(/temporarily unavailable/)).toBeInTheDocument()
    expect(screen.getByText('Reference: req-123')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('only opted-in columns are sortable; clicking toggles direction', async () => {
    const user = userEvent.setup()
    const { onSortChange } = renderTable({ sort: { field: 'name', direction: 'asc' } })
    const nameHeader = screen.getByRole('columnheader', { name: /Name/ })
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: 'Qty' })).not.toHaveAttribute('aria-sort')
    await user.click(within(nameHeader).getByRole('button'))
    expect(onSortChange).toHaveBeenCalledWith({ field: 'name', direction: 'desc' })
  })

  it('paginates and disables buttons at the edges', async () => {
    const user = userEvent.setup()
    const { onPageChange } = renderTable()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('rows are clickable by mouse and keyboard', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    renderTable({ onRowClick })
    const row = screen.getByText('Door gasket').closest('tr')!
    await user.click(row)
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1])
    row.focus()
    await user.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenCalledTimes(2)
  })

  it('hides columns from the Columns menu and remembers the choice', async () => {
    const user = userEvent.setup()
    renderTable({ persistKey: 'parts' })
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Qty' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('columnheader', { name: 'Qty' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('mx.table.parts.columns')!)).toEqual({ qty: false })
  })
})

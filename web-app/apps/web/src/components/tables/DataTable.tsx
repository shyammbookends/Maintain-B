import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Header,
  type VisibilityState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, SearchX } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import './column-meta'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SortState } from '@/hooks/useTableState'
import { usePhone } from '@/hooks/usePhone'
import { cn } from '@/utils/cn'
import { DataTablePagination } from './DataTablePagination'
import { DataTableViewOptions } from './DataTableViewOptions'

const HIDE_BELOW: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
}

const ALIGN: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

function readVisibility(key: string | undefined): VisibilityState {
  if (!key) return {}
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as VisibilityState) : {}
  } catch {
    return {}
  }
}

function writeVisibility(key: string | undefined, value: VisibilityState): void {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable (private mode, quota). Visibility just won't persist.
  }
}

export interface DataTableProps<T> {
  /** Accessible name for the table, e.g. "Work orders". */
  label: string
  // Column value types differ per column; TanStack's documented pattern is ColumnDef<T, any>.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[]
  data: T[] | undefined
  getRowId: (row: T) => string
  /** Total rows across all pages (from the API's meta.total). */
  total: number | undefined

  page: number
  pageSize: number
  pageSizes: readonly number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void

  sort: SortState | undefined
  onSortChange: (sort: SortState | undefined) => void

  /** First load (no data yet): skeleton rows. */
  isLoading: boolean
  /** Background refetch (page change etc.): rows dim, previous data stays visible. */
  isFetching?: boolean
  error?: unknown
  onRetry?: () => void

  onRowClick?: (row: T) => void

  /** Search + filters, rendered above the table. */
  toolbar?: ReactNode
  /** Right side of the toolbar (e.g. export). Column menu is added automatically. */
  toolbarActions?: ReactNode
  /** Shown when there are no rows and no filters (the list is genuinely empty). */
  emptyState: ReactNode
  /** When true and there are no rows, shows "No matching results" with a clear action. */
  isFiltered?: boolean
  onClearFilters?: () => void
  /** Persist column visibility under this id (localStorage). */
  persistKey?: string
  /**
   * Phones (< 1024px): each row as a card (the Flutter app's list design)
   * instead of a table row. `open` is onRowClick for that row.
   */
  renderCard?: (row: T, open?: () => void) => ReactNode
}

/**
 * Server-driven table: the API pages, sorts and filters; this renders.
 * Pair with useTableState (URL state) and TanStack Query.
 */
export function DataTable<T>({
  label,
  columns,
  data,
  getRowId,
  total,
  page,
  pageSize,
  pageSizes,
  onPageChange,
  onPageSizeChange,
  sort,
  onSortChange,
  isLoading,
  isFetching = false,
  error,
  onRetry,
  onRowClick,
  toolbar,
  toolbarActions,
  emptyState,
  isFiltered = false,
  onClearFilters,
  persistKey,
  renderCard,
}: DataTableProps<T>) {
  const { t } = useTranslation()
  const phone = usePhone()
  const storageKey = persistKey ? `mx.table.${persistKey}.columns` : undefined
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    readVisibility(storageKey),
  )
  useEffect(() => writeVisibility(storageKey, columnVisibility), [storageKey, columnVisibility])

  const sorting = useMemo(
    () => (sort ? [{ id: sort.field, desc: sort.direction === 'desc' }] : []),
    [sort],
  )
  const rows = useMemo(() => data ?? [], [data])

  const table = useReactTable({
    data: rows,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableSortingRemoval: false,
    // Columns opt in to sorting (`enableSorting: true`) — only fields the API can sort on.
    defaultColumn: { enableSorting: false },
    state: { sorting, columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
  })

  const visibleColumnCount = table.getVisibleLeafColumns().length
  const hasRows = rows.length > 0
  const showSkeleton = isLoading && !hasRows
  const showError = !!error && !hasRows && !isLoading
  const showCards = phone && !!renderCard && hasRows

  const toggleSort = (columnId: string) => {
    if (sort?.field === columnId) {
      onSortChange({ field: columnId, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
    } else {
      onSortChange({ field: columnId, direction: 'asc' })
    }
  }

  const renderHeader = (header: Header<T, unknown>) => {
    const meta = header.column.columnDef.meta
    const canSort = header.column.getCanSort()
    const activeDir = sort?.field === header.column.id ? sort.direction : undefined
    const content = header.isPlaceholder
      ? null
      : flexRender(header.column.columnDef.header, header.getContext())

    return (
      <TableHead
        key={header.id}
        style={header.column.columnDef.size ? { width: header.getSize() } : undefined}
        aria-sort={
          canSort
            ? activeDir === 'asc'
              ? 'ascending'
              : activeDir === 'desc'
                ? 'descending'
                : 'none'
            : undefined
        }
        className={cn(
          meta?.align && ALIGN[meta.align],
          meta?.hideBelow && HIDE_BELOW[meta.hideBelow],
          meta?.headerClassName,
        )}
      >
        {canSort ? (
          <button
            type="button"
            onClick={() => toggleSort(header.column.id)}
            className={cn(
              '-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground',
              'focus-visible:outline-2 focus-visible:outline-ring',
              activeDir && 'text-foreground',
              meta?.align === 'right' && 'flex-row-reverse',
            )}
          >
            {content}
            {activeDir === 'asc' ? (
              <ArrowUp className="size-3.5" aria-hidden />
            ) : activeDir === 'desc' ? (
              <ArrowDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
            )}
            <span className="sr-only">
              {activeDir === 'asc'
                ? `, ${t('table.sortedAscending')}`
                : activeDir === 'desc'
                  ? `, ${t('table.sortedDescending')}`
                  : ''}
            </span>
          </button>
        ) : (
          content
        )}
      </TableHead>
    )
  }

  return (
    <div data-m="table" className="overflow-hidden rounded-lg border bg-card">
      {(toolbar || toolbarActions || table.getAllLeafColumns().some((c) => c.getCanHide())) && (
        <div
          data-m="table-toolbar"
          className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div data-m="table-filters" className="flex flex-1 flex-wrap items-center gap-2">
            {toolbar}
          </div>
          <div className="flex items-center gap-2">
            {toolbarActions}
            <DataTableViewOptions table={table} />
          </div>
        </div>
      )}

      {showCards && (
        <ul
          data-m="cards"
          aria-label={label}
          aria-busy={isFetching || undefined}
          className={cn(
            'grid gap-2.5 transition-opacity duration-(--duration-base) sm:grid-cols-2',
            isFetching && 'opacity-60',
          )}
        >
          {rows.map((r) => (
            <li key={getRowId(r)} className="min-w-0">
              {renderCard(r, onRowClick ? () => onRowClick(r) : undefined)}
            </li>
          ))}
        </ul>
      )}
      {!showCards && (
        <Table aria-label={label} aria-busy={isLoading || isFetching || undefined}>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>{group.headers.map(renderHeader)}</TableRow>
            ))}
          </TableHeader>
          <TableBody
            className={cn(
              'transition-opacity duration-(--duration-base)',
              isFetching && hasRows && 'opacity-60',
            )}
          >
            {showSkeleton &&
              Array.from({ length: Math.min(pageSize, 8) }, (_, i) => (
                <TableRow key={`skeleton-${i}`} data-testid="skeleton-row">
                  {table.getVisibleLeafColumns().map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        column.columnDef.meta?.hideBelow &&
                          HIDE_BELOW[column.columnDef.meta.hideBelow],
                      )}
                    >
                      <Skeleton
                        className={cn(
                          'h-4',
                          i % 3 === 0 ? 'w-3/4' : i % 3 === 1 ? 'w-1/2' : 'w-2/3',
                        )}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {showError && (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-auto border-b-0">
                  <ErrorState error={error} onRetry={onRetry} compact />
                </TableCell>
              </TableRow>
            )}

            {!showSkeleton && !showError && !hasRows && (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-auto border-b-0">
                  {isFiltered ? (
                    <EmptyState
                      compact
                      icon={SearchX}
                      title={t('table.noResults')}
                      description={t('table.noResultsHint')}
                      action={
                        onClearFilters && (
                          <Button variant="secondary" size="sm" onClick={onClearFilters}>
                            {t('table.clearFilters')}
                          </Button>
                        )
                      }
                    />
                  ) : (
                    emptyState
                  )}
                </TableCell>
              </TableRow>
            )}

            {hasRows &&
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-clickable={onRowClick ? true : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.target !== e.currentTarget) return
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onRowClick(row.original)
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    onRowClick &&
                      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  )}
                >
                  {row.getVisibleCells().map((cell, index) => {
                    const meta = cell.column.columnDef.meta
                    const heading = cell.column.columnDef.header
                    return (
                      <TableCell
                        key={cell.id}
                        // Phone card layout (mobile.css): first cell is the title, the
                        // others show their column name as a label.
                        data-m-title={index === 0 ? '' : undefined}
                        data-label={typeof heading === 'string' ? heading : undefined}
                        data-hide-below={meta?.hideBelow}
                        data-col={cell.column.id}
                        className={cn(
                          meta?.align && ALIGN[meta.align],
                          meta?.hideBelow && HIDE_BELOW[meta.hideBelow],
                          meta?.cellClassName,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}

      {(hasRows || page > 1) && total !== undefined && (
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          pageSizes={pageSizes}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  )
}

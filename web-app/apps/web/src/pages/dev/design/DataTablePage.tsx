import { PRIORITY, WORK_ORDER_STATUS } from '@maintainx/shared'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import { ClipboardList, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DetailList } from '@/components/common/DetailList'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { useTableState } from '@/hooks/useTableState'
import { cn } from '@/utils/cn'
import { DUE_TONE_CLASS, describeDue, formatDateTime, formatDuration } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { DEMO_RESTAURANTS, fetchDemoWorkOrders, type DemoWorkOrder } from './demo-data'

const SORT_FIELDS = ['code', 'title', 'priority', 'status', 'dueDate'] as const
const FILTERS = ['status', 'priority', 'restaurant'] as const

const TABLE_CONFIG = {
  sortFields: SORT_FIELDS,
  defaultSort: { field: 'dueDate', direction: 'asc' },
  filters: FILTERS,
} as const

const col = createColumnHelper<DemoWorkOrder>()

export function DataTablePage() {
  const { t } = useTranslation()
  const table = useTableState<(typeof SORT_FIELDS)[number], (typeof FILTERS)[number]>(TABLE_CONFIG)
  const [simulateEmpty, setSimulateEmpty] = useState(false)
  const [simulateError, setSimulateError] = useState(false)
  const [selected, setSelected] = useState<DemoWorkOrder | null>(null)

  const query = useQuery({
    queryKey: ['design', 'work-orders', table.apiQuery, simulateEmpty, simulateError],
    queryFn: ({ signal }) =>
      fetchDemoWorkOrders(
        {
          page: table.state.page,
          pageSize: table.state.pageSize,
          sort: table.apiQuery.sort as string | undefined,
          q: table.state.q,
          ...table.state.filters,
        },
        { signal, empty: simulateEmpty, fail: simulateError },
      ),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const now = new Date()
  const columns = [
    col.accessor('code', {
      header: 'Code',
      enableSorting: true,
      enableHiding: false,
      cell: (c) => <span className="text-muted-foreground tabular">{c.getValue()}</span>,
      meta: { cellClassName: 'w-28' },
    }),
    col.accessor('title', {
      header: 'Title',
      enableSorting: true,
      enableHiding: false,
      cell: (c) => (
        <div className="min-w-48">
          <p className="font-medium">{c.getValue()}</p>
          <p className="text-13 text-muted-foreground">
            {c.row.original.asset} · {c.row.original.location}
          </p>
        </div>
      ),
    }),
    col.accessor('restaurant', { header: 'Restaurant', meta: { hideBelow: 'lg' } }),
    col.accessor('priority', {
      header: 'Priority',
      enableSorting: true,
      cell: (c) => <StatusBadge kind="priority" value={c.getValue()} />,
    }),
    col.accessor('status', {
      header: 'Status',
      enableSorting: true,
      cell: (c) => <StatusBadge kind="workOrderStatus" value={c.getValue()} />,
    }),
    col.accessor('assignee', {
      header: 'Assignee',
      meta: { hideBelow: 'md' },
      cell: (c) => {
        const name = c.getValue()
        return name ? (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Avatar name={name} size="sm" />
            {name}
          </span>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )
      },
    }),
    col.accessor('dueDate', {
      header: 'Due',
      enableSorting: true,
      cell: (c) => {
        const due = describeDue(c.getValue(), t, now)
        return (
          <span className={cn('whitespace-nowrap text-13', DUE_TONE_CLASS[due.tone])}>
            {due.label}
          </span>
        )
      },
    }),
  ]

  return (
    <>
      <PageHeader
        title="Data table"
        description="Server-driven: filter, sort and page state lives in the URL (try refreshing). Rows dim while the next page loads; skeleton rows on first load."
        actions={
          <Button>
            <Plus /> New work order
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-background px-3 py-2 text-13">
        <span className="text-muted-foreground">Simulate:</span>
        <div className="flex items-center gap-2">
          <Switch id="sim-empty" checked={simulateEmpty} onCheckedChange={setSimulateEmpty} />
          <Label htmlFor="sim-empty" className="text-13 font-normal">
            Empty list
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="sim-error" checked={simulateError} onCheckedChange={setSimulateError} />
          <Label htmlFor="sim-error" className="text-13 font-normal">
            Server error
          </Label>
        </div>
      </div>

      <DataTable
        label="Work orders"
        persistKey="design-work-orders"
        columns={columns}
        data={query.data?.data}
        getRowId={(r) => r.id}
        total={query.data?.meta.total}
        page={table.state.page}
        pageSize={table.state.pageSize}
        pageSizes={table.pageSizes}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        sort={table.state.sort}
        onSortChange={(s) => table.setSort(s as typeof table.state.sort)}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={setSelected}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder="Search title, code, asset…"
            />
            <FilterSelect
              label="Status"
              value={table.state.filters.status}
              onChange={(v) => table.setFilter('status', v)}
              options={WORK_ORDER_STATUS.map((s) => ({
                value: s,
                label: enumLabel(t, 'workOrderStatus', s),
              }))}
            />
            <FilterSelect
              label="Priority"
              value={table.state.filters.priority}
              onChange={(v) => table.setFilter('priority', v)}
              options={PRIORITY.map((p) => ({ value: p, label: enumLabel(t, 'priority', p) }))}
            />
            <FilterSelect
              label="Restaurant"
              value={table.state.filters.restaurant}
              onChange={(v) => table.setFilter('restaurant', v)}
              options={DEMO_RESTAURANTS.map((r) => ({ value: r, label: r }))}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={ClipboardList}
            title="No work orders yet"
            description="Work orders you create, or requests you convert, will appear here."
            action={
              <Button size="sm">
                <Plus /> New work order
              </Button>
            }
          />
        }
      />

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          {selected && (
            <>
              <SheetHeader>
                <SheetDescription className="tabular">{selected.code}</SheetDescription>
                <SheetTitle>{selected.title}</SheetTitle>
                <div className="mt-1 flex gap-2">
                  <StatusBadge kind="workOrderStatus" value={selected.status} />
                  <StatusBadge kind="priority" value={selected.priority} />
                </div>
              </SheetHeader>
              <SheetBody>
                <DetailList
                  items={[
                    { label: 'Restaurant', value: selected.restaurant },
                    { label: 'Location', value: selected.location },
                    { label: 'Asset', value: selected.asset },
                    {
                      label: 'Category',
                      value: enumLabel(t, 'workOrderCategory', selected.category),
                    },
                    { label: 'Assignee', value: selected.assignee },
                    { label: 'Due', value: formatDateTime(selected.dueDate) },
                    { label: 'Estimated time', value: formatDuration(selected.estimatedMinutes) },
                  ]}
                />
              </SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

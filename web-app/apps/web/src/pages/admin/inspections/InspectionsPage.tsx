import {
  INSPECTION_SORT_FIELDS,
  INSPECTION_TYPE,
  fullName,
  type InspectionListItem,
} from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { ClipboardCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Badge } from '@/components/ui/badge'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useTableState } from '@/hooks/useTableState'
import { useScopeRestaurantFilter } from '@/hooks/useScopeFilter'
import { useInspections } from '@/services/maintenance.service'
import { formatDateTime } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

const FILTERS = ['restaurantId', 'type', 'status', 'result'] as const
const TABLE_CONFIG = {
  sortFields: INSPECTION_SORT_FIELDS,
  defaultSort: { field: 'startedAt', direction: 'desc' },
  filters: FILTERS,
} as const
const col = createColumnHelper<InspectionListItem>()

/** "3 pass · 1 fail" result summary, or "In progress". */
export function InspectionResult({ i }: { i: InspectionListItem }) {
  const { t } = useTranslation()
  if (i.status === 'IN_PROGRESS')
    return <Badge tone="warning">{enumLabel(t, 'inspectionStatus', i.status)}</Badge>
  return i.failCount > 0 ? (
    <Badge tone="danger" dot>
      {t('inspections.failedCount', { count: i.failCount })}
    </Badge>
  ) : (
    <Badge tone="success" dot>
      {t('inspections.allPassed')}
    </Badge>
  )
}

export function InspectionsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const table = useTableState<(typeof INSPECTION_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const restaurants = useRestaurants()
  const query = useInspections(table.apiQuery)

  useScopeRestaurantFilter(table.state.filters.restaurantId, (id) =>
    table.setFilter('restaurantId', id),
  )

  const columns = [
    col.accessor('name', {
      header: t('inspections.colInspection'),
      enableHiding: false,
      cell: ({ row: { original: i } }) => (
        <div className="min-w-48">
          <p className="font-medium">{i.name}</p>
          <p className="text-13 text-muted-foreground">
            <span className="tabular">{i.code}</span> · {enumLabel(t, 'inspectionType', i.type)}
            {i.asset && ` · ${i.asset.name}`}
          </p>
        </div>
      ),
    }),
    col.display({
      id: 'result',
      header: t('inspections.colResult'),
      cell: ({ row: { original: i } }) => <InspectionResult i={i} />,
    }),
    col.accessor((i) => fullName(i.performedBy), {
      id: 'performedBy',
      header: t('inspections.colBy'),
      meta: { hideBelow: 'md' },
    }),
    col.accessor((i) => i.restaurant.name, {
      id: 'restaurant',
      header: t('wo.colRestaurant'),
      meta: { hideBelow: 'lg' },
    }),
    col.accessor('startedAt', {
      header: t('inspections.colStarted'),
      enableSorting: true,
      meta: { hideBelow: 'md' },
      cell: (c) => (
        <span className="text-13 whitespace-nowrap">{formatDateTime(c.getValue())}</span>
      ),
    }),
    col.accessor('submittedAt', {
      header: t('inspections.colSubmitted'),
      enableSorting: true,
      meta: { hideBelow: 'lg' },
      cell: (c) => {
        const v = c.getValue()
        return v ? <span className="text-13 whitespace-nowrap">{formatDateTime(v)}</span> : '—'
      },
    }),
  ]

  return (
    <>
      <PageHeader title={t('inspections.title')} description={t('inspections.subtitle')} />
      <DataTable
        label={t('inspections.title')}
        persistKey="inspections"
        columns={columns}
        data={query.data?.data}
        getRowId={(i) => i.id}
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
        onRowClick={(i) => navigate(`/inspections/${i.id}`)}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('inspections.search')}
            />
            {(restaurants.data?.length ?? 0) > 1 && (
              <FilterSelect
                label={t('wo.colRestaurant')}
                value={table.state.filters.restaurantId}
                onChange={(v) => table.setFilter('restaurantId', v)}
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
            <FilterSelect
              label={t('templates.type')}
              value={table.state.filters.type}
              onChange={(v) => table.setFilter('type', v)}
              options={INSPECTION_TYPE.map((x) => ({
                value: x,
                label: enumLabel(t, 'inspectionType', x),
              }))}
            />
            <FilterSelect
              label={t('inspections.colResult')}
              value={table.state.filters.result}
              onChange={(v) => table.setFilter('result', v)}
              options={[
                { value: 'failed', label: t('inspections.filterFailed') },
                { value: 'passed', label: t('inspections.allPassed') },
              ]}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={ClipboardCheck}
            title={t('inspections.emptyTitle')}
            description={t('inspections.emptyBody')}
          />
        }
      />
    </>
  )
}

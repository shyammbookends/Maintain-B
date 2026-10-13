import { FREQUENCY, PM_SORT_FIELDS, fullName, type PmScheduleListItem } from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { CalendarClock, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { PmScheduleForm } from '@/components/maintenance/PmScheduleForm'
import { describeSchedule, meterNextDue } from '@/components/maintenance/schedule-text'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useTableState } from '@/hooks/useTableState'
import { useScopeRestaurantFilter } from '@/hooks/useScopeFilter'
import { usePmSchedules } from '@/services/maintenance.service'
import { formatDateTime } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

const FILTERS = ['restaurantId', 'frequency', 'active', 'assetId'] as const
const TABLE_CONFIG = {
  sortFields: PM_SORT_FIELDS,
  defaultSort: { field: 'nextDueAt', direction: 'asc' },
  filters: FILTERS,
} as const
const col = createColumnHelper<PmScheduleListItem>()

/** Compliance shown as text plus a tone, never colour alone. */
export function ComplianceText({ value }: { value: number | null }) {
  const { t } = useTranslation()
  if (value === null) return <span className="text-muted-foreground">—</span>
  const tone = value >= 90 ? 'text-success-fg' : value >= 70 ? 'text-warning-fg' : 'text-danger-fg'
  return (
    <span className={`font-medium tabular ${tone}`} title={t('pm.complianceHint')}>
      {value}%
    </span>
  )
}

export function MaintenancePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const table = useTableState<(typeof PM_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const restaurants = useRestaurants()
  const query = usePmSchedules(table.apiQuery)
  const [creating, setCreating] = useState<{ assetId?: string; restaurantId?: string } | null>(null)

  // "/maintenance?new=1&newAssetId=…" opens the form prefilled (from an asset page).
  useEffect(() => {
    if (params.get('new') !== '1') return
    setCreating({
      assetId: params.get('newAssetId') ?? undefined,
      restaurantId: params.get('newRestaurantId') ?? undefined,
    })
    const next = new URLSearchParams(params)
    for (const k of ['new', 'newAssetId', 'newRestaurantId']) next.delete(k)
    setParams(next, { replace: true })
  }, [params, setParams])

  useScopeRestaurantFilter(table.state.filters.restaurantId, (id) =>
    table.setFilter('restaurantId', id),
  )

  const columns = [
    col.accessor('name', {
      header: t('pm.colSchedule'),
      enableSorting: true,
      enableHiding: false,
      cell: ({ row: { original: s } }) => (
        <div className="min-w-56">
          <p className="font-medium">{s.name}</p>
          <p className="text-13 text-muted-foreground">{describeSchedule(t, s)}</p>
        </div>
      ),
    }),
    col.accessor((s) => s.asset?.name ?? '—', {
      id: 'asset',
      header: t('wo.fieldAsset'),
      meta: { hideBelow: 'md' },
    }),
    col.accessor((s) => s.restaurant.name, {
      id: 'restaurant',
      header: t('wo.colRestaurant'),
      meta: { hideBelow: 'lg' },
    }),
    col.display({
      id: 'assignee',
      header: t('wo.colAssignee'),
      meta: { hideBelow: 'lg' },
      cell: ({ row: { original: s } }) =>
        s.assignedUser
          ? fullName(s.assignedUser)
          : s.assignedTeam
            ? t('wo.teamOption', { name: s.assignedTeam.name })
            : '—',
    }),
    col.accessor('nextDueAt', {
      header: t('pm.colNext'),
      enableSorting: true,
      cell: ({ row: { original: s } }) => {
        // Meter schedules are due at a reading, not a date.
        const next =
          s.triggerType === 'METER'
            ? meterNextDue(t, s)
            : s.nextDueAt && formatDateTime(s.nextDueAt)
        return s.active && next ? (
          <span className="text-13 whitespace-nowrap">{next}</span>
        ) : (
          <Badge tone="outline">{t('pm.paused')}</Badge>
        )
      },
    }),
    col.accessor('compliance', {
      header: t('pm.colCompliance'),
      meta: { hideBelow: 'md' },
      cell: (c) => <ComplianceText value={c.getValue()} />,
    }),
    col.accessor('priority', {
      header: t('wo.colPriority'),
      meta: { hideBelow: 'lg' },
      cell: (c) => <StatusBadge kind="priority" value={c.getValue()} />,
    }),
  ]

  return (
    <>
      <PageHeader
        title={t('pm.title')}
        description={t('pm.subtitle')}
        actions={
          <Can permission="maintenance:create">
            <Button onClick={() => setCreating({})}>
              <Plus aria-hidden /> {t('pm.new')}
            </Button>
          </Can>
        }
      />
      <DataTable
        label={t('pm.title')}
        persistKey="pm-schedules"
        columns={columns}
        data={query.data?.data}
        getRowId={(s) => s.id}
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
        onRowClick={(s) => navigate(`/maintenance/${s.id}`)}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('pm.search')}
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
              label={t('pm.fieldFrequency')}
              value={table.state.filters.frequency}
              onChange={(v) => table.setFilter('frequency', v)}
              options={FREQUENCY.map((f) => ({ value: f, label: enumLabel(t, 'frequency', f) }))}
            />
            <FilterSelect
              label={t('pm.filterState')}
              value={table.state.filters.active}
              onChange={(v) => table.setFilter('active', v)}
              options={[
                { value: 'true', label: t('pm.active') },
                { value: 'false', label: t('pm.paused') },
              ]}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={CalendarClock}
            title={t('pm.emptyTitle')}
            description={t('pm.emptyBody')}
            action={
              <Can permission="maintenance:create">
                <Button size="sm" onClick={() => setCreating({})}>
                  <Plus aria-hidden /> {t('pm.new')}
                </Button>
              </Can>
            }
          />
        }
      />

      <Sheet open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('pm.createTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {creating && (
              <PmScheduleForm
                assetId={creating.assetId}
                restaurantId={creating.restaurantId ?? table.state.filters.restaurantId}
                onCancel={() => setCreating(null)}
                onDone={(s) => {
                  setCreating(null)
                  navigate(`/maintenance/${s.id}`)
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}

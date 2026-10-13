import {
  PRIORITY,
  WORK_ORDER_ACTIVE_STATUSES,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_SORT_FIELDS,
  WORK_ORDER_STATUS,
  WORK_ORDER_TYPE,
  fullName,
  type WorkOrderListItem,
} from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { AlarmClock, ClipboardList, GitBranch, Plus, Tag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { MTaskCard } from '@/components/mobile/MTaskCard'
import { initialsOf } from '@/components/mobile/tones'
import { SavedViews } from '@/components/common/SavedViews'
import { StatusBadge } from '@/components/common/StatusBadge'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ViewSwitch } from '@/components/ui/view-switch'
import { useWorkflow } from '@/contexts/WorkflowContext'
import { WorkOrderForm, type WorkOrderPrefill } from '@/components/work-orders/WorkOrderForm'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useTableState } from '@/hooks/useTableState'
import { useScopeRestaurantFilter } from '@/hooks/useScopeFilter'
import { useWorkOrders } from '@/services/work-orders.service'
import { useLabels } from '@/services/customization.service'
import { LabelChip } from '@/components/common/LabelChip'
import { cn } from '@/utils/cn'
import { DUE_TONE_CLASS, describeDue } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

const FILTERS = [
  'view',
  'status',
  'priority',
  'category',
  'type',
  'restaurantId',
  'locationId',
  'assetId',
  'assignedUserId',
  'assignedTeamId',
  'vendorId',
  'parentId',
  'labelId',
] as const
const TABLE_CONFIG = {
  sortFields: WORK_ORDER_SORT_FIELDS,
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: FILTERS,
} as const
const VIEWS = [
  'all',
  'active',
  'overdue',
  'unassigned',
  'scheduled',
  'review',
  'draft',
  'done',
] as const
/** With simple statuses the stage tabs that only matter in the detailed flow are hidden. */
const SIMPLE_VIEWS = ['all', 'active', 'overdue', 'unassigned', 'review', 'done'] as const
const col = createColumnHelper<WorkOrderListItem>()

export function WorkOrdersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const workflow = useWorkflow()
  const [params, setParams] = useSearchParams()
  const table = useTableState<(typeof WORK_ORDER_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const restaurants = useRestaurants()
  const query = useWorkOrders(table.apiQuery)
  const labels = useLabels()

  // "/work-orders?new=1&assetId=…" opens the create sheet prefilled (from an asset page).
  const [creating, setCreating] = useState<WorkOrderPrefill | null>(null)
  useEffect(() => {
    if (params.get('new') !== '1') return
    setCreating({
      assetId: params.get('newAssetId'),
      restaurantId: params.get('newRestaurantId') ?? undefined,
      locationId: params.get('newLocationId'),
      category: undefined,
    })
    const next = new URLSearchParams(params)
    for (const k of ['new', 'newAssetId', 'newRestaurantId', 'newLocationId']) next.delete(k)
    setParams(next, { replace: true })
  }, [params, setParams])

  useScopeRestaurantFilter(table.state.filters.restaurantId, (id) =>
    table.setFilter('restaurantId', id),
  )

  const columns = [
    col.accessor('title', {
      header: t('wo.colWorkOrder'),
      enableHiding: false,
      cell: ({ row: { original: w } }) => (
        // One tidy block per row: title on one line, then code · asset · labels.
        <div className="w-full lg:w-[max(14rem,24vw)] xl:w-[max(14rem,21vw)] 2xl:w-[clamp(18rem,26vw,30rem)]">
          <p className="truncate font-medium" title={w.title}>
            {w.title}
          </p>
          <p className="flex items-center gap-x-1.5 text-13 whitespace-nowrap text-muted-foreground">
            <span className="shrink-0 tabular">{w.code}</span>
            {w.asset && (
              <span className="min-w-0 truncate" title={w.asset.name}>
                · {w.asset.name}
              </span>
            )}
            {w.subProgress.total > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1">
                · <GitBranch className="size-3.5" aria-hidden />
                {t('wo.subProgress', w.subProgress)}
              </span>
            )}
            {/* Labels stay on the same line: the first one and a count on wide screens,
                just a tag and a count on narrower ones; hover lists them all. */}
            {w.labels.length > 0 && (
              <span
                className="ml-auto flex shrink-0 items-center gap-1 pl-1"
                title={w.labels.map((l) => l.name).join(', ')}
              >
                <LabelChip label={w.labels[0]!} className="hidden max-w-28 2xl:inline-flex" />
                {w.labels.length > 1 && (
                  <span className="hidden text-xs 2xl:inline">+{w.labels.length - 1}</span>
                )}
                <span className="inline-flex items-center gap-0.5 text-xs 2xl:hidden">
                  <Tag className="size-3.5" aria-hidden />
                  {w.labels.length}
                </span>
              </span>
            )}
          </p>
        </div>
      ),
    }),
    col.accessor('status', {
      header: t('wo.colStatus'),
      enableSorting: true,
      // Overdue shows in the Due column (red, with a clock), so the status stays one badge.
      cell: ({ row: { original: w } }) => (
        <StatusBadge kind="workOrderStatus" value={w.status} className="whitespace-nowrap" />
      ),
    }),
    col.accessor('priority', {
      header: t('wo.colPriority'),
      enableSorting: true,
      cell: (c) => (
        <StatusBadge kind="priority" value={c.getValue()} className="whitespace-nowrap" />
      ),
    }),
    col.accessor((w) => w.restaurant.name, {
      id: 'restaurant',
      header: t('wo.colRestaurant'),
      // Narrow screens keep Due in view; the restaurant is in the top switcher too.
      meta: { hideBelow: 'xl' },
      cell: (c) => (
        <span className="block max-w-40 truncate 2xl:max-w-48" title={c.getValue()}>
          {c.getValue()}
        </span>
      ),
    }),
    col.display({
      id: 'assignee',
      header: t('wo.colAssignee'),
      meta: { hideBelow: 'md' },
      cell: ({ row: { original: w } }) => {
        const who = w.assignedUser
          ? fullName(w.assignedUser)
          : w.assignedTeam
            ? t('wo.teamOption', { name: w.assignedTeam.name })
            : null
        return who ? (
          <span className="block max-w-44 truncate" title={who}>
            {who}
          </span>
        ) : (
          <span className="whitespace-nowrap text-muted-foreground">
            {t('dashboard.unassigned')}
          </span>
        )
      },
    }),
    col.accessor('dueDate', {
      header: t('wo.colDue'),
      enableSorting: true,
      meta: { hideBelow: 'md' },
      cell: ({ row: { original: w } }) => {
        if (!w.dueDate) return <span className="text-muted-foreground">—</span>
        const done = !(WORK_ORDER_ACTIVE_STATUSES as readonly string[]).includes(w.status)
        const due = describeDue(w.dueDate, t)
        return (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-13 whitespace-nowrap',
              done ? 'text-muted-foreground' : DUE_TONE_CLASS[due.tone],
            )}
          >
            {w.overdue && !done && <AlarmClock className="size-3.5" aria-hidden />}
            {due.label}
          </span>
        )
      },
    }),
  ]

  const view = table.state.filters.view ?? 'all'

  return (
    <>
      <PageHeader
        title={t('wo.title')}
        description={t('wo.subtitle')}
        actions={
          <>
            <SavedViews resource="work_orders" />
            <Can permission="work_orders:create">
              <Button onClick={() => setCreating({})}>
                <Plus aria-hidden /> {t('wo.new')}
              </Button>
            </Can>
          </>
        }
      />

      <ViewSwitch
        label={t('wo.views')}
        value={view}
        onValueChange={(v) => table.setFilter('view', v === 'all' ? undefined : v)}
        options={(workflow?.simpleStatuses ? SIMPLE_VIEWS : VIEWS)
          .filter(
            (v) => v !== 'review' || !workflow?.simpleStatuses || workflow.requireVerification,
          )
          .map((v) => ({ value: v, label: t(`wo.view_${v}`) }))}
        className="mb-3"
      />

      <DataTable
        label={t('wo.title')}
        persistKey="work-orders"
        columns={columns}
        data={query.data?.data}
        getRowId={(w) => w.id}
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
        onRowClick={(w) => navigate(`/work-orders/${w.id}`)}
        renderCard={(w) => (
          <MTaskCard
            to={`/work-orders/${w.id}`}
            code={w.code}
            title={w.title}
            where={[w.asset?.name, w.location?.name, w.restaurant.name]}
            priority={w.priority}
            status={w.status}
            type={w.type}
            dueDate={w.dueDate}
            overdue={w.overdue}
            assignee={
              w.assignedUser
                ? { initials: initialsOf(w.assignedUser), name: fullName(w.assignedUser) }
                : null
            }
            team={w.assignedTeam ? w.assignedTeam.name : t('dashboard.unassigned')}
          />
        )}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('wo.search')}
            />
            {(restaurants.data?.length ?? 0) > 1 && (
              <FilterSelect
                label={t('wo.colRestaurant')}
                value={table.state.filters.restaurantId}
                onChange={(v) => table.setFilter('restaurantId', v)}
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
            {/* Simple statuses: the tabs above already cover Open / In progress / Done. */}
            {(!workflow?.simpleStatuses || table.state.filters.status) && (
              <FilterSelect
                label={t('wo.colStatus')}
                value={table.state.filters.status}
                onChange={(v) => table.setFilter('status', v)}
                options={WORK_ORDER_STATUS.map((s) => ({
                  value: s,
                  label: enumLabel(t, 'workOrderStatus', s),
                }))}
              />
            )}
            <FilterSelect
              label={t('wo.colPriority')}
              value={table.state.filters.priority}
              onChange={(v) => table.setFilter('priority', v)}
              options={PRIORITY.map((p) => ({ value: p, label: enumLabel(t, 'priority', p) }))}
            />
            <FilterSelect
              label={t('wo.fieldType')}
              value={table.state.filters.type}
              onChange={(v) => table.setFilter('type', v)}
              options={WORK_ORDER_TYPE.map((v) => ({
                value: v,
                label: enumLabel(t, 'workOrderType', v),
              }))}
            />
            <FilterSelect
              label={t('wo.fieldCategory')}
              value={table.state.filters.category}
              onChange={(v) => table.setFilter('category', v)}
              options={WORK_ORDER_CATEGORY.map((c) => ({
                value: c,
                label: enumLabel(t, 'workOrderCategory', c),
              }))}
            />
            {(labels.data?.length ?? 0) > 0 && (
              <FilterSelect
                label={t('labels.title')}
                value={table.state.filters.labelId}
                onChange={(v) => table.setFilter('labelId', v)}
                options={(labels.data ?? []).map((l) => ({ value: l.id, label: l.name }))}
              />
            )}
          </>
        }
        emptyState={
          <EmptyState
            icon={ClipboardList}
            title={t('wo.emptyTitle')}
            description={t('wo.emptyBody')}
            action={
              <Can permission="work_orders:create">
                <Button size="sm" onClick={() => setCreating({})}>
                  <Plus aria-hidden /> {t('wo.new')}
                </Button>
              </Can>
            }
          />
        }
      />

      <Sheet open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('wo.createTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {creating && (
              <WorkOrderForm
                prefill={{
                  ...creating,
                  restaurantId: creating.restaurantId ?? table.state.filters.restaurantId,
                }}
                onCancel={() => setCreating(null)}
                onDone={(w) => {
                  setCreating(null)
                  navigate(`/work-orders/${w.id}`)
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}

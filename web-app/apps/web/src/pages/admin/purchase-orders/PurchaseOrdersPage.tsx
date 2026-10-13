import {
  PO_SORT_FIELDS,
  PURCHASE_ORDER_STATUS,
  fullName,
  type PurchaseOrderListItem,
} from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { Plus, ShoppingCart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Button } from '@/components/ui/button'
import { ViewSwitch } from '@/components/ui/view-switch'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useTableState } from '@/hooks/useTableState'
import { useScopeRestaurantFilter } from '@/hooks/useScopeFilter'
import { usePurchaseOrders, useVendorOptions } from '@/services/purchasing.service'
import { formatCurrency, formatDate } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { ListCard as MListCard } from '@/components/mobile/kit'

const FILTERS = ['view', 'status', 'restaurantId', 'vendorId'] as const
const TABLE_CONFIG = {
  sortFields: PO_SORT_FIELDS,
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: FILTERS,
} as const
const VIEWS = ['all', 'approval', 'open'] as const
const col = createColumnHelper<PurchaseOrderListItem>()

export function PurchaseOrdersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const table = useTableState<(typeof PO_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const restaurants = useRestaurants()
  const vendors = useVendorOptions()
  const query = usePurchaseOrders(table.apiQuery)

  useScopeRestaurantFilter(table.state.filters.restaurantId, (id) =>
    table.setFilter('restaurantId', id),
  )

  const columns = [
    col.accessor('code', {
      header: t('po.colOrder'),
      enableSorting: true,
      enableHiding: false,
      cell: ({ row: { original: p } }) => (
        <div className="min-w-40">
          <p className="font-medium tabular">{p.code}</p>
          <p className="text-13 text-muted-foreground">{p.vendor.name}</p>
        </div>
      ),
    }),
    col.accessor('status', {
      header: t('po.colStatus'),
      cell: (c) => <StatusBadge kind="purchaseOrderStatus" value={c.getValue()} />,
    }),
    col.accessor('total', {
      header: t('po.total'),
      enableSorting: true,
      cell: (c) => <span className="tabular">{formatCurrency(c.getValue())}</span>,
    }),
    col.accessor((p) => p.restaurant.name, {
      id: 'restaurant',
      header: t('wo.colRestaurant'),
      meta: { hideBelow: 'lg' },
    }),
    col.accessor((p) => fullName(p.requestedBy), {
      id: 'requestedBy',
      header: t('po.requestedBy'),
      meta: { hideBelow: 'lg' },
    }),
    col.accessor('expectedAt', {
      header: t('po.expected'),
      enableSorting: true,
      meta: { hideBelow: 'md' },
      cell: (c) => {
        const v = c.getValue()
        return v ? formatDate(`${v}T00:00:00`) : '—'
      },
    }),
  ]

  return (
    <>
      <PageHeader
        title={t('po.title')}
        description={t('po.subtitle')}
        actions={
          <Can permission="purchase_orders:create">
            <Button asChild>
              <Link to="/purchase-orders/new">
                <Plus aria-hidden /> {t('po.new')}
              </Link>
            </Button>
          </Can>
        }
      />
      <ViewSwitch
        label={t('wo.views')}
        value={table.state.filters.view ?? 'all'}
        onValueChange={(v) => table.setFilter('view', v === 'all' ? undefined : v)}
        options={VIEWS.map((v) => ({ value: v, label: t(`po.view_${v}`) }))}
        className="mb-3"
      />
      <DataTable
        label={t('po.title')}
        persistKey="purchase-orders"
        columns={columns}
        data={query.data?.data}
        getRowId={(p) => p.id}
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
        onRowClick={(p) => navigate(`/purchase-orders/${p.id}`)}
        renderCard={(p) => (
          <MListCard
            to={`/purchase-orders/${p.id}`}
            top={
              <>
                <span className="text-[12.5px] text-[#64748b] tabular-nums">{p.code}</span>
                <span className="flex-1" />
                <StatusBadge kind="purchaseOrderStatus" value={p.status} />
              </>
            }
            title={p.vendor.name}
            lines={[p.restaurant.name]}
            bottom={
              <>
                <span className="text-base font-semibold tabular-nums">
                  {formatCurrency(p.total)}
                </span>
                <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-[#64748b]">
                  {fullName(p.requestedBy)}
                  {p.expectedAt ? ` · ${formatDate(p.expectedAt)}` : ''}
                </span>
              </>
            }
          />
        )}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('po.search')}
            />
            <FilterSelect
              label={t('po.colStatus')}
              value={table.state.filters.status}
              onChange={(v) => table.setFilter('status', v)}
              options={PURCHASE_ORDER_STATUS.map((s) => ({
                value: s,
                label: enumLabel(t, 'purchaseOrderStatus', s),
              }))}
            />
            {(restaurants.data?.length ?? 0) > 1 && (
              <FilterSelect
                label={t('wo.colRestaurant')}
                value={table.state.filters.restaurantId}
                onChange={(v) => table.setFilter('restaurantId', v)}
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
            {(vendors.data?.length ?? 0) > 0 && (
              <FilterSelect
                label={t('po.vendor')}
                value={table.state.filters.vendorId}
                onChange={(v) => table.setFilter('vendorId', v)}
                options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
              />
            )}
          </>
        }
        emptyState={
          <EmptyState
            icon={ShoppingCart}
            title={t('po.emptyTitle')}
            description={t('po.emptyBody')}
          />
        }
      />
    </>
  )
}

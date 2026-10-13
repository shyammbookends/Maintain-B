import { PART_SORT_FIELDS, type PartListItem } from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { AlertTriangle, Boxes, PackageCheck, Plus, Settings2, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { SavedViews } from '@/components/common/SavedViews'
import {
  InventorySettingsDialog,
  LowStockOrderDialog,
} from '@/components/inventory/InventoryDialogs'
import { PartForm } from '@/components/inventory/PartForm'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useTableState } from '@/hooks/useTableState'
import { useScopeRestaurantFilter } from '@/hooks/useScopeFilter'
import { usePartCategories, useParts } from '@/services/purchasing.service'
import { formatCurrency, formatNumber } from '@/utils/format'
import { ListCard as MListCard, MPill as MobilePill } from '@/components/mobile/kit'
import { Cpu as MCpu } from 'lucide-react'

const FILTERS = ['restaurantId', 'category', 'low', 'vendorId'] as const
const TABLE_CONFIG = {
  sortFields: PART_SORT_FIELDS,
  defaultSort: { field: 'name', direction: 'asc' },
  filters: FILTERS,
} as const
const col = createColumnHelper<PartListItem>()

/** Quantity with a "low" marker (icon + text, not colour alone). */
export function StockQty({
  qty,
  unit,
  low,
  reserved = 0,
}: {
  qty: number
  unit: string
  low: boolean
  reserved?: number
}) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap tabular">
      {formatNumber(qty)} {unit}
      {low && (
        <Badge tone="danger" className="gap-1">
          <AlertTriangle className="size-3" aria-hidden /> {t('stock.low')}
        </Badge>
      )}
      {reserved > 0 && (
        <span className="text-xs text-muted-foreground">
          {t('stock.reservedShort', { qty: formatNumber(reserved) })}
        </span>
      )}
    </span>
  )
}

export function InventoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const scope = useRestaurantScope()
  const table = useTableState<(typeof PART_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const restaurants = useRestaurants()
  const categories = usePartCategories()
  const query = useParts(table.apiQuery)
  const [creating, setCreating] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [settings, setSettings] = useState(false)
  const oneRestaurant = table.state.filters.restaurantId

  useScopeRestaurantFilter(table.state.filters.restaurantId, (id) =>
    table.setFilter('restaurantId', id),
  )

  const columns = [
    col.accessor('name', {
      header: t('parts.colPart'),
      enableSorting: true,
      enableHiding: false,
      cell: ({ row: { original: p } }) => (
        <div className="min-w-48">
          <p className="font-medium">{p.name}</p>
          <p className="text-13 text-muted-foreground">
            <span className="tabular">{p.partNumber}</span>
            {p.category && ` · ${p.category}`}
          </p>
        </div>
      ),
    }),
    col.display({
      id: 'stock',
      header: oneRestaurant ? t('stock.inStock') : t('stock.inStockAll'),
      cell: ({ row: { original: p } }) =>
        oneRestaurant ? (
          <StockQty
            qty={p.stock?.quantity ?? 0}
            unit={p.unit}
            low={p.stock?.low ?? false}
            reserved={p.stock?.reserved ?? 0}
          />
        ) : (
          <StockQty qty={p.totalQuantity} unit={p.unit} low={p.lowCount > 0} />
        ),
    }),
    col.accessor('minStock', {
      header: t('parts.minStock'),
      meta: { hideBelow: 'md' },
      cell: ({ row: { original: p } }) => (
        <span className="tabular">{formatNumber(p.stock?.minStock ?? p.minStock)}</span>
      ),
    }),
    col.accessor('unitCost', {
      header: t('parts.unitCost'),
      meta: { hideBelow: 'md' },
      cell: (c) => <span className="tabular">{formatCurrency(c.getValue())}</span>,
    }),
    col.accessor((p) => p.preferredVendor?.name ?? '—', {
      id: 'vendor',
      header: t('parts.preferredVendor'),
      meta: { hideBelow: 'lg' },
    }),
  ]

  return (
    <>
      <PageHeader
        title={t('inventory.title')}
        description={t('inventory.subtitle')}
        actions={
          <>
            <SavedViews resource="parts" />
            <Can permission="purchase_orders:create">
              <Button variant="secondary" onClick={() => setOrdering(true)}>
                <ShoppingCart aria-hidden /> {t('lowStock.order')}
              </Button>
            </Can>
            <Can permission="inventory:view">
              <Button asChild variant="secondary">
                <Link to="/stock-counts">
                  <PackageCheck aria-hidden /> {t('counts.title')}
                </Link>
              </Button>
            </Can>
            <Can permission="inventory:edit">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('inventorySettings.title')}
                onClick={() => setSettings(true)}
              >
                <Settings2 />
              </Button>
            </Can>
            <Can permission="parts:create">
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden /> {t('parts.new')}
              </Button>
            </Can>
          </>
        }
      />
      <DataTable
        label={t('inventory.title')}
        persistKey="parts"
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
        onRowClick={(p) => navigate(`/inventory/parts/${p.id}`)}
        renderCard={(p) => {
          const qty = oneRestaurant ? (p.stock?.quantity ?? 0) : p.totalQuantity
          const low = oneRestaurant ? (p.stock?.low ?? false) : p.lowCount > 0
          return (
            <MListCard
              to={`/inventory/parts/${p.id}`}
              icon={MCpu}
              tone={low ? 'warning' : 'info'}
              borderColor={low ? 'rgba(245, 158, 11, 0.5)' : undefined}
              title={p.name}
              lines={[
                [p.partNumber, p.category].filter(Boolean).join(' · '),
                `${formatCurrency(p.unitCost)} / ${p.unit} · ${t('parts.minStock')} ${formatNumber(p.stock?.minStock ?? p.minStock)}`,
                p.preferredVendor ? p.preferredVendor.name : null,
              ]}
              trailing={
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-xl leading-tight font-semibold tabular-nums">
                    {formatNumber(qty)}
                  </span>
                  <span className="text-[12.5px] text-[#64748b]">{p.unit}</span>
                  {low && (
                    <MobilePill tone="warning" className="mt-1">
                      {t('stock.low')}
                    </MobilePill>
                  )}
                </span>
              }
            />
          )
        }}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('parts.search')}
            />
            {(restaurants.data?.length ?? 0) > 1 && (
              <FilterSelect
                label={t('wo.colRestaurant')}
                value={table.state.filters.restaurantId}
                onChange={(v) => table.setFilter('restaurantId', v)}
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
            {(categories.data?.length ?? 0) > 0 && (
              <FilterSelect
                label={t('parts.category')}
                value={table.state.filters.category}
                onChange={(v) => table.setFilter('category', v)}
                options={(categories.data ?? []).map((c) => ({ value: c, label: c }))}
              />
            )}
            <FilterSelect
              label={t('stock.level')}
              value={table.state.filters.low}
              onChange={(v) => table.setFilter('low', v)}
              options={[{ value: '1', label: t('stock.lowOnly') }]}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={Boxes}
            title={t('parts.emptyTitle')}
            description={t('parts.emptyBody')}
            action={
              <Can permission="parts:create">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus aria-hidden /> {t('parts.new')}
                </Button>
              </Can>
            }
          />
        }
      />
      {ordering && (
        <LowStockOrderDialog
          restaurantId={oneRestaurant ?? scope.restaurantId ?? undefined}
          onClose={() => setOrdering(false)}
        />
      )}
      {settings && <InventorySettingsDialog onClose={() => setSettings(false)} />}
      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('parts.new')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {creating && (
              <PartForm
                part={null}
                onCancel={() => setCreating(false)}
                onDone={(p) => {
                  setCreating(false)
                  navigate(`/inventory/parts/${p.id}`)
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}

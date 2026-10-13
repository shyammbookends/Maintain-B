import {
  ASSET_CRITICALITY,
  ASSET_SORT_FIELDS,
  ASSET_STATUS,
  type AssetListItem,
} from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { Package, Plus, Printer, Tags } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { AssetForm } from '@/components/assets/AssetForm'
import { WarrantyBadge } from '@/components/assets/WarrantyBadge'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { SavedViews } from '@/components/common/SavedViews'
import { StatusBadge } from '@/components/common/StatusBadge'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useTableState } from '@/hooks/useTableState'
import { useScopeRestaurantFilter } from '@/hooks/useScopeFilter'
import { useAssetCategories, useAssets } from '@/services/assets.service'
import { formatDate } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { CategoriesSheet } from './CategoriesSheet'
import { ListCard as MListCard } from '@/components/mobile/kit'
import { Package as MPackage } from 'lucide-react'

const FILTERS = ['restaurantId', 'categoryId', 'status', 'criticality', 'locationId'] as const
const TABLE_CONFIG = {
  sortFields: ASSET_SORT_FIELDS,
  defaultSort: { field: 'name', direction: 'asc' },
  filters: FILTERS,
} as const
const col = createColumnHelper<AssetListItem>()

export function AssetsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const table = useTableState<(typeof ASSET_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const restaurants = useRestaurants()
  const categories = useAssetCategories()
  const [creating, setCreating] = useState(false)
  const [managingCategories, setManagingCategories] = useState(false)

  // The top-bar restaurant switcher pre-filters the list (still changeable here).
  useScopeRestaurantFilter(table.state.filters.restaurantId, (id) =>
    table.setFilter('restaurantId', id),
  )

  const query = useAssets(table.apiQuery)
  const printParams = new URLSearchParams(
    Object.entries(table.state.filters).filter((e): e is [string, string] => !!e[1]),
  )
  if (table.state.q) printParams.set('q', table.state.q)

  const columns = [
    col.accessor('name', {
      header: t('assets.colAsset'),
      enableSorting: true,
      enableHiding: false,
      cell: ({ row: { original: a } }) => (
        <div className="min-w-48">
          <p className="font-medium">{a.name}</p>
          <p className="text-13 text-muted-foreground tabular">
            {a.assetCode}
            {a.serialNumber && ` · ${a.serialNumber}`}
          </p>
          {a.parent && (
            <p className="text-xs text-muted-foreground">
              {t('assets.partOf', { name: a.parent.name })}
            </p>
          )}
        </div>
      ),
    }),
    col.accessor((a) => a.category.name, {
      id: 'category',
      header: t('assets.colCategory'),
      meta: { hideBelow: 'md' },
    }),
    col.accessor((a) => a.restaurant.name, {
      id: 'restaurant',
      header: t('assets.colRestaurant'),
      meta: { hideBelow: 'lg' },
    }),
    col.accessor((a) => a.location?.name ?? '—', {
      id: 'location',
      header: t('assets.colLocation'),
      meta: { hideBelow: 'lg' },
    }),
    col.accessor('criticality', {
      header: t('assets.criticality'),
      meta: { hideBelow: 'md' },
      cell: (c) => <StatusBadge kind="assetCriticality" value={c.getValue()} />,
    }),
    col.accessor('status', {
      header: t('assets.colStatus'),
      cell: (c) => <StatusBadge kind="assetStatus" value={c.getValue()} />,
    }),
    col.accessor('warrantyEnd', {
      header: t('assets.colWarranty'),
      enableSorting: true,
      meta: { hideBelow: 'md' },
      cell: (c) => {
        const v = c.getValue()
        return (
          <div className="grid gap-0.5 whitespace-nowrap">
            <WarrantyBadge warrantyEnd={v} />
            {v && (
              <span className="text-xs text-muted-foreground">{formatDate(`${v}T00:00:00`)}</span>
            )}
          </div>
        )
      },
    }),
  ]

  return (
    <>
      <PageHeader
        title={t('assets.title')}
        description={t('assets.subtitle')}
        actions={
          <>
            <SavedViews resource="assets" />
            <Button variant="secondary" onClick={() => setManagingCategories(true)}>
              <Tags aria-hidden /> {t('assets.categories')}
            </Button>
            <Can permission="qr:view">
              <Button asChild variant="secondary">
                <Link to={`/assets/qr-print?${printParams.toString()}`}>
                  <Printer aria-hidden /> {t('assets.printQr')}
                </Link>
              </Button>
            </Can>
            <Can permission="assets:create">
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden /> {t('assets.new')}
              </Button>
            </Can>
          </>
        }
      />

      <DataTable
        label={t('assets.title')}
        persistKey="assets"
        columns={columns}
        data={query.data?.data}
        getRowId={(a) => a.id}
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
        onRowClick={(a) => navigate(`/assets/${a.id}`)}
        renderCard={(a) => (
          <MListCard
            to={`/assets/${a.id}`}
            icon={MPackage}
            tone={
              a.status === 'BROKEN' ? 'danger' : a.status === 'OPERATIONAL' ? 'info' : 'warning'
            }
            title={a.name}
            lines={[
              [a.assetCode, a.location?.name, a.restaurant.name].filter(Boolean).join(' · '),
              a.parent ? t('assets.partOf', { name: a.parent.name }) : null,
            ]}
            trailing={<StatusBadge kind="assetStatus" value={a.status} />}
          />
        )}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('assets.search')}
            />
            {(restaurants.data?.length ?? 0) > 1 && (
              <FilterSelect
                label={t('assets.filterRestaurant')}
                value={table.state.filters.restaurantId}
                onChange={(v) => table.setFilter('restaurantId', v)}
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
            <FilterSelect
              label={t('assets.filterCategory')}
              value={table.state.filters.categoryId}
              onChange={(v) => table.setFilter('categoryId', v)}
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
            <FilterSelect
              label={t('assets.filterStatus')}
              value={table.state.filters.status}
              onChange={(v) => table.setFilter('status', v)}
              options={ASSET_STATUS.map((s) => ({
                value: s,
                label: enumLabel(t, 'assetStatus', s),
              }))}
            />
            <FilterSelect
              label={t('assets.criticality')}
              value={table.state.filters.criticality}
              onChange={(v) => table.setFilter('criticality', v)}
              options={ASSET_CRITICALITY.map((c) => ({
                value: c,
                label: enumLabel(t, 'assetCriticality', c),
              }))}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={Package}
            title={t('assets.emptyTitle')}
            description={t('assets.emptyBody')}
            action={
              <Can permission="assets:create">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus aria-hidden /> {t('assets.new')}
                </Button>
              </Can>
            }
          />
        }
      />

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('assets.createTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {creating && (
              <AssetForm
                asset={null}
                restaurantId={table.state.filters.restaurantId}
                onCancel={() => setCreating(false)}
                onDone={(a) => {
                  setCreating(false)
                  navigate(`/assets/${a.id}`)
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <CategoriesSheet open={managingCategories} onOpenChange={setManagingCategories} />
    </>
  )
}

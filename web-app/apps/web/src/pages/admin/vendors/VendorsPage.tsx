import { VENDOR_CATEGORY, VENDOR_SORT_FIELDS, type VendorListItem } from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { Plus, Truck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { VendorForm } from '@/components/vendors/VendorForm'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useTableState } from '@/hooks/useTableState'
import { useVendors } from '@/services/purchasing.service'
import { enumLabel } from '@/utils/i18n'
import { ListCard as MListCard } from '@/components/mobile/kit'
import { Handshake as MHandshake } from 'lucide-react'

const FILTERS = ['category', 'restaurantId'] as const
const TABLE_CONFIG = {
  sortFields: VENDOR_SORT_FIELDS,
  defaultSort: { field: 'name', direction: 'asc' },
  filters: FILTERS,
} as const
const col = createColumnHelper<VendorListItem>()

export function VendorsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const table = useTableState<(typeof VENDOR_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const restaurants = useRestaurants()
  const query = useVendors(table.apiQuery)
  const [creating, setCreating] = useState(false)

  const columns = [
    col.accessor('name', {
      header: t('vendors.colVendor'),
      enableSorting: true,
      enableHiding: false,
      cell: ({ row: { original: v } }) => (
        <div className="min-w-48">
          <p className="font-medium">{v.name}</p>
          <p className="text-13 text-muted-foreground">
            {[v.contactName, v.phone].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      ),
    }),
    col.accessor('categories', {
      header: t('vendors.categories'),
      meta: { hideBelow: 'md' },
      cell: (c) => (
        <div className="flex max-w-72 flex-wrap gap-1">
          {c.getValue().map((x) => (
            <Badge key={x} tone="outline">
              {enumLabel(t, 'vendorCategory', x)}
            </Badge>
          ))}
        </div>
      ),
    }),
    col.accessor((v) => v.city ?? '—', {
      id: 'city',
      header: t('vendors.city'),
      meta: { hideBelow: 'lg' },
    }),
    col.display({
      id: 'serves',
      header: t('vendors.serves'),
      meta: { hideBelow: 'lg' },
      cell: ({ row: { original: v } }) =>
        v.restaurants.length === 0
          ? t('procedures.allRestaurants')
          : v.restaurants.map((r) => r.name).join(', '),
    }),
    col.accessor('openOrders', {
      header: t('vendors.openOrders'),
      cell: (c) => <span className="tabular">{c.getValue()}</span>,
    }),
  ]

  return (
    <>
      <PageHeader
        title={t('vendors.title')}
        description={t('vendors.subtitle')}
        actions={
          <Can permission="vendors:create">
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> {t('vendors.new')}
            </Button>
          </Can>
        }
      />
      <DataTable
        label={t('vendors.title')}
        persistKey="vendors"
        columns={columns}
        data={query.data?.data}
        getRowId={(v) => v.id}
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
        onRowClick={(v) => navigate(`/vendors/${v.id}`)}
        renderCard={(v) => (
          <MListCard
            to={`/vendors/${v.id}`}
            icon={MHandshake}
            title={v.name}
            lines={[
              [v.contactName, v.city].filter(Boolean).join(' · '),
              v.email,
              `${t('vendors.openOrders')}: ${v.openOrders}`,
            ]}
            chevron
          />
        )}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('vendors.search')}
            />
            <FilterSelect
              label={t('vendors.categories')}
              value={table.state.filters.category}
              onChange={(v) => table.setFilter('category', v)}
              options={VENDOR_CATEGORY.map((c) => ({
                value: c,
                label: enumLabel(t, 'vendorCategory', c),
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
          </>
        }
        emptyState={
          <EmptyState
            icon={Truck}
            title={t('vendors.emptyTitle')}
            description={t('vendors.emptyBody')}
            action={
              <Can permission="vendors:create">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus aria-hidden /> {t('vendors.new')}
                </Button>
              </Can>
            }
          />
        }
      />
      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('vendors.new')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {creating && (
              <VendorForm
                vendor={null}
                onCancel={() => setCreating(false)}
                onDone={(v) => {
                  setCreating(false)
                  navigate(`/vendors/${v.id}`)
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}

import {
  STOCK_COUNT_STATUS,
  createStockCountSchema,
  fullName,
  type StockCountListItem,
  type StockCountStatus,
} from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { PackageCheck, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import {
  Form,
  FormActions,
  FormRootError,
  SelectField,
  TextField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { DataTable } from '@/components/tables'
import { COUNT_TONE } from '@/components/inventory/count-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ViewSwitch } from '@/components/ui/view-switch'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import {
  buyKeys,
  stockCountsApi,
  usePartCategories,
  useStockCounts,
} from '@/services/purchasing.service'
import { describeError } from '@/utils/errors'
import { formatDate } from '@/utils/format'

const col = createColumnHelper<StockCountListItem>()
const PAGE_SIZES = [25, 50] as const
type View = 'all' | StockCountStatus

/** Cycle counts: compare what is on the shelf with what the system thinks. */
export function StockCountsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const scope = useRestaurantScope()
  const [view, setView] = useState<View>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(25)
  const [creating, setCreating] = useState(false)
  const query = useStockCounts({
    page,
    pageSize,
    status: view === 'all' ? undefined : view,
    restaurantId: scope.restaurantId,
  })

  const columns = [
    col.accessor('name', {
      header: t('counts.colCount'),
      enableHiding: false,
      cell: ({ row: { original: c } }) => (
        <div className="min-w-40">
          <p className="font-medium">{c.name}</p>
          <p className="text-13 text-muted-foreground tabular">{c.code}</p>
        </div>
      ),
    }),
    col.accessor('status', {
      header: t('wo.colStatus'),
      cell: (c) => (
        <Badge tone={COUNT_TONE[c.getValue()]}>{t(`counts.status_${c.getValue()}`)}</Badge>
      ),
    }),
    col.accessor((c) => c.restaurant.name, { id: 'restaurant', header: t('wo.colRestaurant') }),
    col.display({
      id: 'progress',
      header: t('counts.progress'),
      cell: ({ row: { original: c } }) => (
        <span className="tabular">
          {t('counts.countedOf', { counted: c.countedCount, total: c.lineCount })}
        </span>
      ),
    }),
    col.accessor('createdAt', {
      header: t('counts.started'),
      meta: { hideBelow: 'md' },
      cell: ({ row: { original: c } }) => (
        <span className="text-13">
          {formatDate(c.createdAt)} · {fullName(c.createdBy)}
        </span>
      ),
    }),
  ]

  return (
    <>
      <PageHeader
        title={t('counts.title')}
        description={t('counts.subtitle')}
        actions={
          <Can permission="inventory:edit">
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> {t('counts.new')}
            </Button>
          </Can>
        }
      />
      <ViewSwitch
        className="mb-4"
        label={t('counts.title')}
        value={view}
        onValueChange={(v) => {
          setView(v)
          setPage(1)
        }}
        options={[
          { value: 'all' as View, label: t('counts.viewAll') },
          ...STOCK_COUNT_STATUS.map((s) => ({ value: s as View, label: t(`counts.status_${s}`) })),
        ]}
      />
      <DataTable
        label={t('counts.title')}
        columns={columns}
        data={query.data?.data}
        getRowId={(c) => c.id}
        total={query.data?.meta.total}
        page={page}
        pageSize={pageSize}
        pageSizes={PAGE_SIZES}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n)
          setPage(1)
        }}
        sort={undefined}
        onSortChange={() => undefined}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(c) => navigate(`/stock-counts/${c.id}`)}
        emptyState={
          <EmptyState
            icon={PackageCheck}
            title={t('counts.emptyTitle')}
            description={t('counts.emptyBody')}
            action={
              <Can permission="inventory:edit">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus aria-hidden /> {t('counts.new')}
                </Button>
              </Can>
            }
          />
        }
      />
      {creating && (
        <NewCountDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/stock-counts/${id}`)}
        />
      )}
    </>
  )
}

const ALL = '__all__'

function NewCountDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useTranslation()
  const scope = useRestaurantScope()
  const restaurants = useRestaurants()
  const categories = usePartCategories()
  const list = restaurants.data ?? []
  const form = useZodForm(createStockCountSchema, {
    defaultValues: {
      restaurantId: scope.restaurantId ?? (list.length === 1 ? list[0]!.id : ''),
      name: t('counts.defaultName', { date: formatDate(new Date().toISOString()) }),
      category: ALL,
      storageLocation: '',
      notes: '',
    },
  })
  // The restaurant list may arrive after the form opens: pick the only one then.
  useEffect(() => {
    const only = restaurants.data?.length === 1 ? restaurants.data[0] : undefined
    if (only && !form.getValues('restaurantId')) form.setValue('restaurantId', only.id)
  }, [restaurants.data, form])
  const create = useInvalidatingMutation(stockCountsApi.create, [buyKeys.counts])
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const c = await create.mutateAsync({ ...v, category: v.category === ALL ? '' : v.category })
      onCreated(c.id)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('counts.new')}</DialogTitle>
          <DialogDescription>{t('counts.newHint')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <SelectField
              control={form.control}
              name="restaurantId"
              label={t('wo.fieldRestaurant')}
              required
              placeholder={t('validation.selectOption')}
              options={list.map((r) => ({ value: r.id, label: r.name }))}
            />
            <TextField control={form.control} name="name" label={t('counts.name')} required />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="category"
                label={t('parts.category')}
                options={[
                  { value: ALL, label: t('counts.allCategories') },
                  ...(categories.data ?? []).map((c) => ({ value: c, label: c })),
                ]}
              />
              <TextField
                control={form.control}
                name="storageLocation"
                label={t('parts.storage')}
                placeholder={t('counts.allShelves')}
                optional
              />
            </div>
            <TextareaField
              control={form.control}
              name="notes"
              label={t('vendors.notes')}
              optional
              rows={2}
            />
            <FormActions>
              <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('counts.start')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

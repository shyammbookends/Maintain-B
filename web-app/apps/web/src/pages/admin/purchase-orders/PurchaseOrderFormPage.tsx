import {
  lineTotal,
  purchaseOrderSchema,
  type PurchaseOrderDetail,
  type PurchaseOrderInput,
  type RestaurantDto,
} from '@maintainx/shared'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useFieldArray } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import {
  DateField,
  Form,
  FormActions,
  FormRootError,
  NumberField,
  SelectField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import {
  buyKeys,
  poApi,
  useParts,
  usePurchaseOrder,
  useVendorOptions,
} from '@/services/purchasing.service'
import { describeError } from '@/utils/errors'
import { formatCurrency, formatNumber } from '@/utils/format'

/** Create (/purchase-orders/new?vendorId=&restaurantId=&partId=) or edit a draft. */
export function PurchaseOrderFormPage() {
  const { t } = useTranslation()
  const { orderId } = useParams()
  const order = usePurchaseOrder(orderId)
  const restaurants = useRestaurants()
  const back = orderId
    ? { to: `/purchase-orders/${orderId}`, label: t('po.title') }
    : { to: '/purchase-orders', label: t('po.title') }

  if ((orderId && order.isPending) || !restaurants.data)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  if (orderId && order.isError)
    return (
      <>
        <PageHeader title={t('po.title')} back={back} />
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
      </>
    )
  return (
    <>
      <PageHeader
        back={back}
        title={orderId ? t('po.editTitle', { code: order.data!.code }) : t('po.new')}
      />
      <PoForm order={orderId ? order.data! : null} restaurants={restaurants.data} />
    </>
  )
}

function PoForm({
  order,
  restaurants,
}: {
  order: PurchaseOrderDetail | null
  restaurants: RestaurantDto[]
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const scope = useRestaurantScope()
  const [params] = useSearchParams()
  const presetPart = params.get('partId')

  const form = useZodForm(purchaseOrderSchema, {
    defaultValues: order
      ? {
          vendorId: order.vendor.id,
          restaurantId: order.restaurant.id,
          expectedAt: order.expectedAt ?? '',
          tax: order.tax,
          notes: order.notes ?? '',
          items: order.items.map((i) => ({
            partId: i.part.id,
            qtyOrdered: i.qtyOrdered,
            unitCost: i.unitCost,
            description: i.description ?? '',
          })),
        }
      : {
          vendorId: params.get('vendorId') ?? '',
          restaurantId:
            params.get('restaurantId') ??
            scope.restaurantId ??
            (restaurants.length === 1 ? restaurants[0]!.id : ''),
          expectedAt: '',
          tax: 0,
          notes: '',
          items: [{ partId: presetPart ?? '', qtyOrdered: 1, unitCost: 0, description: '' }],
        },
  })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const restaurantId = form.watch('restaurantId')
  const lines = form.watch('items')
  const tax = form.watch('tax')
  const vendors = useVendorOptions(restaurantId || undefined, !!restaurantId)
  const parts = useParts({
    restaurantId: restaurantId || undefined,
    pageSize: 100,
    sort: 'name:asc',
  })
  const partsById = useMemo(
    () => new Map((parts.data?.data ?? []).map((p) => [p.id, p])),
    [parts.data],
  )

  // A vendor that doesn't serve the chosen restaurant isn't valid any more.
  useEffect(() => {
    const v = form.getValues('vendorId')
    if (v && vendors.data && !vendors.data.some((x) => x.id === v)) form.setValue('vendorId', '')
  }, [vendors.data, form])
  // Picking a part fills in its last cost — once per line and part, never overwriting a typed cost.
  // form.watch() hands back the same (mutated) array when a line changes, so the
  // effect keys on the chosen parts themselves; otherwise it never re-runs.
  const chosenParts = lines.map((l) => l.partId).join(',')
  const filled = useRef(new Set<string>())
  useEffect(() => {
    form.getValues('items').forEach((l, i) => {
      const key = `${items.fields[i]?.id}:${l.partId}`
      const p = partsById.get(l.partId)
      if (!p || filled.current.has(key)) return
      filled.current.add(key)
      if (!l.unitCost && p.unitCost) form.setValue(`items.${i}.unitCost`, p.unitCost)
    })
  }, [chosenParts, partsById, items.fields, form])

  const subtotal = lines.reduce(
    (s, l) => s + lineTotal(Number(l.qtyOrdered) || 0, Number(l.unitCost) || 0),
    0,
  )
  const save = useInvalidatingMutation(
    (input: PurchaseOrderInput) => (order ? poApi.update(order.id, input) : poApi.create(input)),
    [buyKeys.pos, buyKeys.vendors],
  )
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const saved = await save.mutateAsync(v)
      toast.success(order ? t('po.saved') : t('po.created', { code: saved.code }))
      navigate(`/purchase-orders/${saved.id}`, { replace: true })
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid max-w-4xl gap-4">
        <FormRootError
          message={errors.root?.message ?? errors.items?.root?.message ?? errors.items?.message}
        />
        <Panel>
          <PanelBody className="grid gap-4 sm:grid-cols-3">
            <SelectField
              control={form.control}
              name="restaurantId"
              label={t('wo.fieldRestaurant')}
              required
              placeholder={t('validation.selectOption')}
              options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
            />
            <SelectField
              control={form.control}
              name="vendorId"
              label={t('po.vendor')}
              required
              disabled={!restaurantId}
              placeholder={t('validation.selectOption')}
              description={vendors.data?.length === 0 ? t('po.noVendors') : undefined}
              options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
            <DateField control={form.control} name="expectedAt" label={t('po.expected')} optional />
          </PanelBody>
        </Panel>

        <h2 className="text-sm font-semibold">{t('po.items')}</h2>
        <ol className="grid gap-3">
          {items.fields.map((field, i) => {
            const p = partsById.get(lines[i]?.partId ?? '')
            return (
              <li key={field.id}>
                <Panel>
                  <PanelBody className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_8rem_9rem_7rem_auto] sm:items-start">
                    <SelectField
                      control={form.control}
                      name={`items.${i}.partId`}
                      label={t('po.part')}
                      required
                      placeholder={t('validation.selectOption')}
                      description={
                        p?.stock
                          ? t('po.inStockHere', {
                              qty: formatNumber(p.stock.quantity),
                              unit: p.unit,
                            })
                          : undefined
                      }
                      options={(parts.data?.data ?? []).map((x) => ({
                        value: x.id,
                        label: `${x.name} · ${x.partNumber}`,
                      }))}
                    />
                    <NumberField
                      control={form.control}
                      name={`items.${i}.qtyOrdered`}
                      label={t('po.qty')}
                      required
                      min={0}
                      step={1}
                      suffix={p?.unit}
                    />
                    <NumberField
                      control={form.control}
                      name={`items.${i}.unitCost`}
                      label={t('parts.unitCost')}
                      min={0}
                      step={0.01}
                      suffix="₹"
                    />
                    <div className="grid gap-2">
                      <span className="text-sm font-medium">{t('po.lineTotal')}</span>
                      <span className="flex h-9 items-center tabular">
                        {formatCurrency(
                          lineTotal(
                            Number(lines[i]?.qtyOrdered) || 0,
                            Number(lines[i]?.unitCost) || 0,
                          ),
                        )}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="sm:mt-6"
                      aria-label={t('po.removeLine', { n: i + 1 })}
                      disabled={items.fields.length === 1}
                      onClick={() => items.remove(i)}
                    >
                      <Trash2 />
                    </Button>
                  </PanelBody>
                </Panel>
              </li>
            )
          })}
        </ol>
        <Button
          variant="secondary"
          className="justify-self-start"
          onClick={() => items.append({ partId: '', qtyOrdered: 1, unitCost: 0, description: '' })}
        >
          <Plus aria-hidden /> {t('po.addLine')}
        </Button>

        <Panel>
          <PanelBody className="grid gap-4 sm:grid-cols-[1fr_16rem]">
            <TextareaField
              control={form.control}
              name="notes"
              label={t('vendors.notes')}
              optional
              rows={3}
            />
            <div className="grid content-start gap-2 text-sm">
              <div className="flex justify-between">
                <span>{t('po.subtotal')}</span>
                <span className="tabular">{formatCurrency(subtotal)}</span>
              </div>
              <NumberField
                control={form.control}
                name="tax"
                label={t('po.tax')}
                min={0}
                step={0.01}
                suffix="₹"
              />
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>{t('po.total')}</span>
                <span className="tabular">{formatCurrency(subtotal + (Number(tax) || 0))}</span>
              </div>
            </div>
          </PanelBody>
        </Panel>

        <FormActions>
          <Button variant="secondary" onClick={() => navigate(-1)} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {order ? t('actions.saveChanges') : t('po.saveDraft')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

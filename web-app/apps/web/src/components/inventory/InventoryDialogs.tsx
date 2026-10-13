import {
  inventorySettingsSchema,
  lowStockOrderSchema,
  type InventorySettings,
  type LowStockOrderResult,
} from '@maintainx/shared'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Callout } from '@/components/common/Callout'
import {
  Form,
  FormActions,
  FormRootError,
  SelectField,
  SwitchField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import {
  buyKeys,
  inventorySettingsApi,
  poApi,
  useInventorySettings,
} from '@/services/purchasing.service'
import { describeError } from '@/utils/errors'

/**
 * Drafts purchase requests (one per preferred vendor) for everything low at
 * a restaurant, then shows what was created and what still needs a vendor.
 */
export function LowStockOrderDialog({
  restaurantId,
  onClose,
}: {
  restaurantId?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const restaurants = useRestaurants()
  const list = restaurants.data ?? []
  const [result, setResult] = useState<LowStockOrderResult | null>(null)
  const form = useZodForm(lowStockOrderSchema, {
    defaultValues: { restaurantId: restaurantId ?? (list.length === 1 ? list[0]!.id : '') },
  })
  // The restaurant list may arrive after the form opens: pick the only one then.
  useEffect(() => {
    const only = restaurants.data?.length === 1 ? restaurants.data[0] : undefined
    if (only && !form.getValues('restaurantId')) form.setValue('restaurantId', only.id)
  }, [restaurants.data, form])
  const order = useInvalidatingMutation(
    (rid: string) => poApi.fromLowStock(rid),
    [buyKeys.pos, buyKeys.parts],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      setResult(await order.mutateAsync(v.restaurantId))
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('lowStock.title')}</DialogTitle>
          <DialogDescription>{t('lowStock.body')}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-4">
            {result.created.length === 0 ? (
              <Callout tone="info">{t('lowStock.nothing')}</Callout>
            ) : (
              <ul className="divide-y rounded-md border">
                {result.created.map((po) => (
                  <li key={po.id} className="flex items-center gap-3 px-3 py-2">
                    <Link
                      to={`/purchase-orders/${po.id}`}
                      className="font-medium text-primary tabular hover:underline"
                    >
                      {po.code}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-sm">{po.vendor.name}</span>
                    <span className="text-13 text-muted-foreground">
                      {t('lowStock.items', { count: po.itemCount })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {result.alreadyOrdered > 0 && (
              <p className="text-13 text-muted-foreground">
                {t('lowStock.alreadyOrdered', { count: result.alreadyOrdered })}
              </p>
            )}
            {result.withoutVendor.length > 0 && (
              <Callout tone="warning" title={t('lowStock.noVendorTitle')}>
                <ul className="mt-1 grid gap-0.5">
                  {result.withoutVendor.map((p) => (
                    <li key={p.id}>
                      <Link to={`/inventory/parts/${p.id}`} className="hover:underline">
                        {p.name} · <span className="tabular">{p.partNumber}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
            <FormActions>
              <Button onClick={onClose}>{t('actions.done')}</Button>
            </FormActions>
          </div>
        ) : (
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
              <FormActions>
                <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
                  {t('actions.cancel')}
                </Button>
                <Button type="submit" loading={isSubmitting}>
                  {t('lowStock.create')}
                </Button>
              </FormActions>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Inventory automation switches. */
export function InventorySettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const query = useInventorySettings()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('inventorySettings.title')}</DialogTitle>
          <DialogDescription>{t('inventorySettings.body')}</DialogDescription>
        </DialogHeader>
        {query.data ? (
          <SettingsForm value={query.data} onClose={onClose} />
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SettingsForm({ value, onClose }: { value: InventorySettings; onClose: () => void }) {
  const { t } = useTranslation()
  const form = useZodForm(inventorySettingsSchema, { defaultValues: value })
  const save = useInvalidatingMutation(inventorySettingsApi.update, [buyKeys.inventorySettings])
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync(v)
      toast.success(t('inventorySettings.saved'))
      onClose()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <SwitchField
          control={form.control}
          name="autoPurchaseRequest"
          label={t('inventorySettings.autoPurchase')}
          description={t('inventorySettings.autoPurchaseHint')}
        />
        <FormActions>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('actions.save')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

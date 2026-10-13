import {
  STOCK_MOVEMENT_MODES,
  fullName,
  stockAdjustmentSchema,
  stockSettingsSchema,
  stockTransferSchema,
  type PartDetail,
  type StockLevel,
} from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import {
  Form,
  FormActions,
  FormRootError,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
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
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation, useUserOptions } from '@/hooks/useAdminQueries'
import { buyKeys, partsApi } from '@/services/purchasing.service'
import { describeError } from '@/utils/errors'
import { formatNumber } from '@/utils/format'

interface Base {
  part: PartDetail
  open: boolean
  onOpenChange: (o: boolean) => void
}

/** Stock in / issue / return / damaged / correct / count at one restaurant. */
export function AdjustStockDialog({
  part,
  open,
  onOpenChange,
  restaurants,
  restaurantId,
}: Base & { restaurants: Array<{ id: string; name: string }>; restaurantId?: string }) {
  const { t } = useTranslation()
  const form = useZodForm(stockAdjustmentSchema, {
    defaultValues: {
      restaurantId: restaurantId ?? (restaurants.length === 1 ? restaurants[0]!.id : ''),
      mode: 'RECEIVE',
      quantity: undefined as unknown as number,
      unitCost: part.unitCost,
      issuedToId: '',
      reason: '',
    },
  })
  const mode = form.watch('mode')
  const rid = form.watch('restaurantId')
  const current = part.stockLevels.find((l) => l.restaurant.id === rid)?.quantity ?? 0
  const people = useUserOptions(rid || undefined, mode === 'ISSUE' && !!rid)
  const save = useInvalidatingMutation(
    (v: Parameters<typeof partsApi.adjust>[1]) => partsApi.adjust(part.id, v),
    [buyKeys.parts, ['dashboard']],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        ...v,
        unitCost: v.mode === 'RECEIVE' ? v.unitCost : undefined,
        issuedToId: v.mode === 'ISSUE' ? v.issuedToId : undefined,
      })
      toast.success(t('stock.adjusted'))
      onOpenChange(false)
      form.reset({ ...v, quantity: undefined as unknown as number, reason: '' })
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('stock.adjustTitle')}</DialogTitle>
          <DialogDescription>
            {part.name} · {part.partNumber}
          </DialogDescription>
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
              options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
            />
            <SelectField
              control={form.control}
              name="mode"
              label={t('stock.mode')}
              options={STOCK_MOVEMENT_MODES.map((m) => ({
                value: m,
                label: t(`stock.mode_${m}`),
              }))}
            />
            {mode === 'ISSUE' && (
              <SelectField
                control={form.control}
                name="issuedToId"
                label={t('stock.issuedTo')}
                required
                placeholder={t('validation.selectOption')}
                options={(people.data ?? []).map((u) => ({ value: u.id, label: fullName(u) }))}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                control={form.control}
                name="quantity"
                label={mode === 'COUNT' ? t('stock.counted') : t('stock.quantity')}
                description={
                  rid
                    ? t('stock.currentQty', { qty: formatNumber(current), unit: part.unit })
                    : undefined
                }
                required
                min={0}
                step={1}
                suffix={part.unit}
              />
              {mode === 'RECEIVE' && (
                <NumberField
                  control={form.control}
                  name="unitCost"
                  label={t('parts.unitCost')}
                  min={0}
                  step={0.01}
                  suffix="₹"
                />
              )}
            </div>
            <TextareaField
              control={form.control}
              name="reason"
              label={t('stock.reason')}
              placeholder={t(`stock.reasonPlaceholder_${mode}`)}
              required
              rows={2}
            />
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('actions.save')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/** Per-restaurant minimum and shelf. */
export function StockSettingsDialog({
  part,
  open,
  onOpenChange,
  level,
}: Base & { level: StockLevel }) {
  const { t } = useTranslation()
  const form = useZodForm(stockSettingsSchema, {
    defaultValues: {
      restaurantId: level.restaurant.id,
      minStock: level.minOverride ?? undefined,
      storageLocation: level.storageLocation ?? '',
    },
  })
  const save = useInvalidatingMutation(
    (v: Parameters<typeof partsApi.settings>[1]) => partsApi.settings(part.id, v),
    [buyKeys.parts, ['dashboard']],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync(v)
      toast.success(t('stock.settingsSaved'))
      onOpenChange(false)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('stock.settingsTitle')}</DialogTitle>
          <DialogDescription>
            {part.name} · {level.restaurant.name}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <NumberField
              control={form.control}
              name="minStock"
              label={t('parts.minStock')}
              description={t('stock.minOverrideHint', { qty: formatNumber(part.minStock) })}
              min={0}
              step={1}
              suffix={part.unit}
            />
            <TextField control={form.control} name="storageLocation" label={t('parts.storage')} />
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('actions.save')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/** Move stock from this restaurant's store to another restaurant's. */
export function TransferStockDialog({
  part,
  open,
  onOpenChange,
  from,
  restaurants,
}: Base & { from: StockLevel; restaurants: Array<{ id: string; name: string }> }) {
  const { t } = useTranslation()
  const targets = restaurants.filter((r) => r.id !== from.restaurant.id)
  const form = useZodForm(stockTransferSchema, {
    defaultValues: {
      fromRestaurantId: from.restaurant.id,
      toRestaurantId: targets.length === 1 ? targets[0]!.id : '',
      quantity: undefined as unknown as number,
      reason: '',
    },
  })
  const save = useInvalidatingMutation(
    (v: Parameters<typeof partsApi.transfer>[1]) => partsApi.transfer(part.id, v),
    [buyKeys.parts, ['dashboard']],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync(v)
      toast.success(t('transfer.done'))
      onOpenChange(false)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('transfer.title')}</DialogTitle>
          <DialogDescription>
            {t('transfer.from', {
              name: from.restaurant.name,
              qty: formatNumber(from.available),
              unit: part.unit,
            })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <SelectField
              control={form.control}
              name="toRestaurantId"
              label={t('transfer.to')}
              required
              placeholder={t('validation.selectOption')}
              options={targets.map((r) => ({ value: r.id, label: r.name }))}
            />
            <NumberField
              control={form.control}
              name="quantity"
              label={t('stock.quantity')}
              required
              min={0}
              step={1}
              suffix={part.unit}
            />
            <TextField control={form.control} name="reason" label={t('transfer.reason')} optional />
            <FormActions>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('transfer.submit')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

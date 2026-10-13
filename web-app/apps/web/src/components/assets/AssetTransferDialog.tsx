import type { AssetDetail } from '@maintainx/shared'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import {
  Form,
  FormActions,
  FormRootError,
  SelectField,
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
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import { assetKeys, assetsApi, useLocations } from '@/services/assets.service'
import { describeError } from '@/utils/errors'

const NO_LOCATION = '__none__'

const schema = z.object({
  restaurantId: z.uuid(),
  locationId: z.string(),
  note: z.string().trim().min(3).max(500),
})

/**
 * Moves an asset to another restaurant or location with a reason. Its
 * components come along; the server refuses while the asset has open work.
 */
export function AssetTransferDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const restaurants = useRestaurants(open)
  const form = useZodForm(schema, {
    defaultValues: {
      restaurantId: asset.restaurant.id,
      locationId: asset.location?.id ?? NO_LOCATION,
      note: '',
    },
  })
  const restaurantId = form.watch('restaurantId')
  const locations = useLocations(restaurantId || undefined, open && !!restaurantId)
  useEffect(() => {
    const current = form.getValues('locationId')
    if (current !== NO_LOCATION && locations.data && !locations.data.some((l) => l.id === current))
      form.setValue('locationId', NO_LOCATION)
  }, [locations.data, form])

  const transfer = useInvalidatingMutation(
    (v: z.infer<typeof schema>) =>
      assetsApi.transfer(asset.id, {
        restaurantId: v.restaurantId,
        locationId: v.locationId === NO_LOCATION ? '' : v.locationId,
        note: v.note,
      }),
    [assetKeys.all, assetKeys.locationsAll],
  )
  const { errors, isSubmitting } = form.formState
  const submit = form.handleSubmit(async (v) => {
    try {
      await transfer.mutateAsync(v)
      toast.success(t('assets.transferred'))
      form.reset({ ...v, note: '' })
      onOpenChange(false)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assets.transferTitle', { name: asset.name })}</DialogTitle>
          <DialogDescription>
            {asset.children.length > 0
              ? t('assets.transferBodyComponents', { count: asset.children.length })
              : t('assets.transferBody')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="restaurantId"
                label={t('assets.restaurant')}
                required
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
              <SelectField
                control={form.control}
                name="locationId"
                label={t('assets.location')}
                options={[
                  { value: NO_LOCATION, label: t('assets.noLocation') },
                  ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.name })),
                ]}
              />
            </div>
            <TextareaField
              control={form.control}
              name="note"
              label={t('assets.transferNote')}
              required
              rows={3}
              maxLength={500}
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
                {t('assets.transfer')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

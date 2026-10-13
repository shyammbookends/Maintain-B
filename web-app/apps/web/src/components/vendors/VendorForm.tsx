import {
  VENDOR_CATEGORY,
  vendorSchema,
  type VendorDetail,
  type VendorInput,
} from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { MoreOptions } from '@/components/common/MoreOptions'
import {
  Form,
  FormActions,
  FormRootError,
  TextField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { CheckboxListField } from '@/components/forms/CheckboxListField'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useCurrentUser } from '@/contexts/AuthContext'
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import { buyKeys, vendorsApi } from '@/services/purchasing.service'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

export function VendorForm({
  vendor,
  onDone,
  onCancel,
}: {
  vendor: VendorDetail | null
  onDone: (v: VendorDetail) => void
  onCancel: () => void
}) {
  const restaurants = useRestaurants()
  if (!restaurants.data) return <Skeleton className="h-64 w-full" />
  return (
    <Inner vendor={vendor} onDone={onDone} onCancel={onCancel} restaurants={restaurants.data} />
  )
}

function Inner({
  vendor,
  onDone,
  onCancel,
  restaurants,
}: {
  vendor: VendorDetail | null
  onDone: (v: VendorDetail) => void
  onCancel: () => void
  restaurants: Array<{ id: string; name: string }>
}) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const form = useZodForm(vendorSchema, {
    defaultValues: vendor
      ? {
          name: vendor.name,
          contactName: vendor.contactName ?? '',
          email: vendor.email ?? '',
          phone: vendor.phone ?? '',
          altPhone: vendor.altPhone ?? '',
          address: vendor.address ?? '',
          city: vendor.city ?? '',
          categories: vendor.categories,
          taxId: vendor.taxId ?? '',
          notes: vendor.notes ?? '',
          restaurantIds: vendor.restaurants.map((r) => r.id),
        }
      : {
          name: '',
          contactName: '',
          email: '',
          phone: '',
          altPhone: '',
          address: '',
          city: '',
          categories: [],
          taxId: '',
          notes: '',
          restaurantIds: restaurants.length === 1 ? [restaurants[0]!.id] : [],
        },
  })
  const save = useInvalidatingMutation(
    (input: VendorInput) =>
      vendor ? vendorsApi.update(vendor.id, input) : vendorsApi.create(input),
    [buyKeys.vendors],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const saved = await save.mutateAsync(v)
      toast.success(vendor ? t('vendors.saved') : t('vendors.created'))
      onDone(saved)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField control={form.control} name="name" label={t('vendors.name')} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="contactName" label={t('vendors.contact')} />
          <TextField
            control={form.control}
            name="phone"
            label={t('vendors.phone')}
            type="tel"
            inputMode="tel"
          />
          <TextField control={form.control} name="email" label={t('vendors.email')} type="email" />
          <TextField control={form.control} name="city" label={t('vendors.city')} />
        </div>
        <CheckboxListField
          control={form.control}
          name="categories"
          label={t('vendors.categories')}
          options={VENDOR_CATEGORY.map((c) => ({
            value: c,
            label: enumLabel(t, 'vendorCategory', c),
          }))}
        />
        <CheckboxListField
          control={form.control}
          name="restaurantIds"
          label={t('vendors.serves')}
          description={user.isSuperAdmin ? t('vendors.servesHintAll') : t('vendors.servesHint')}
          required={!user.isSuperAdmin}
          options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
        />
        <MoreOptions
          defaultOpen={!!vendor}
          forceOpen={Boolean(errors.altPhone || errors.address || errors.taxId || errors.notes)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="altPhone"
              label={t('vendors.altPhone')}
              type="tel"
            />
            <TextField
              control={form.control}
              name="taxId"
              label={t('vendors.taxId')}
              placeholder="24ABCDE1234F1Z5"
            />
          </div>
          <TextareaField
            control={form.control}
            name="address"
            label={t('vendors.address')}
            rows={2}
          />
          <TextareaField control={form.control} name="notes" label={t('vendors.notes')} rows={3} />
        </MoreOptions>
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {vendor ? t('actions.saveChanges') : t('actions.create')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

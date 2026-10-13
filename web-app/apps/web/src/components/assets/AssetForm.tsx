import {
  ASSET_CRITICALITY,
  assetSchema,
  type AssetCategoryDto,
  type AssetDetail,
  type AssetInput,
  type RestaurantDto,
} from '@maintainx/shared'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { MoreOptions } from '@/components/common/MoreOptions'
import { CustomFieldInputs } from '@/components/common/CustomFieldInputs'
import {
  customFieldsFormSchema,
  fromCustomForm,
  useCustomFieldDefaults,
} from '@/components/common/custom-fields'
import { useCustomFields } from '@/services/customization.service'
import {
  DateField,
  Form,
  FormActions,
  FormRootError,
  SelectField,
  TextField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import {
  assetKeys,
  assetsApi,
  useAssetCategories,
  useAssets,
  useLocations,
} from '@/services/assets.service'
import { useVendorOptions } from '@/services/purchasing.service'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

const NO_LOCATION = '__none__'
const NO_VENDOR = '__none__'
const NO_PARENT = '__none__'

/**
 * The API schema, except the selects hold sentinel values (Radix Select can't
 * hold ''); they're mapped back to '' on submit.
 */
const formSchema = z
  .object({
    ...assetSchema.shape,
    locationId: z.string(),
    vendorId: z.string(),
    parentId: z.string(),
    criticality: z.enum(ASSET_CRITICALITY),
    installDate: z.string(),
    customFields: customFieldsFormSchema,
  })
  .refine((v) => !v.warrantyStart || !v.warrantyEnd || v.warrantyStart <= v.warrantyEnd, {
    message: 'validation.warrantyEndBeforeStart',
    path: ['warrantyEnd'],
  })

function toInput(a: AssetDetail): AssetInput {
  return {
    name: a.name,
    categoryId: a.category.id,
    restaurantId: a.restaurant.id,
    locationId: a.location?.id ?? '',
    manufacturer: a.manufacturer ?? '',
    model: a.model ?? '',
    serialNumber: a.serialNumber ?? '',
    purchaseDate: a.purchaseDate ?? '',
    purchaseCost: a.purchaseCost ?? '',
    warrantyStart: a.warrantyStart ?? '',
    warrantyEnd: a.warrantyEnd ?? '',
    notes: a.notes ?? '',
    vendorId: a.vendor?.id ?? '',
    parentId: a.parent?.id ?? '',
    criticality: a.criticality,
    installDate: a.installDate ?? '',
  }
}

interface AssetFormProps {
  asset: AssetDetail | null
  /** Preselect a restaurant (e.g. when adding from a restaurant page). */
  restaurantId?: string
  onDone: (asset: AssetDetail) => void
  onCancel: () => void
}

/**
 * Create / edit asset. Name, category, restaurant and location up front;
 * manufacturer, serial, purchase and warranty under "More options".
 */
/** Waits for restaurants and categories so selects get their values with options present. */
export function AssetForm(props: AssetFormProps) {
  const restaurants = useRestaurants()
  const categories = useAssetCategories()
  if (!restaurants.data || !categories.data) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }
  return <AssetFormInner {...props} restaurants={restaurants.data} categories={categories.data} />
}

function AssetFormInner({
  asset,
  restaurantId,
  onDone,
  onCancel,
  restaurants,
  categories,
}: AssetFormProps & { restaurants: RestaurantDto[]; categories: AssetCategoryDto[] }) {
  const { t } = useTranslation()
  const scope = useRestaurantScope()

  const form = useZodForm(formSchema, {
    defaultValues: asset
      ? {
          ...toInput(asset),
          locationId: asset.location?.id ?? NO_LOCATION,
          vendorId: asset.vendor?.id ?? NO_VENDOR,
          parentId: asset.parent?.id ?? NO_PARENT,
          criticality: asset.criticality,
          installDate: asset.installDate ?? '',
          customFields: asset.customFields,
        }
      : {
          name: '',
          categoryId: '',
          // Only one restaurant? Pick it.
          restaurantId:
            restaurantId ??
            scope.restaurantId ??
            (restaurants.length === 1 ? restaurants[0]!.id : ''),
          locationId: NO_LOCATION,
          vendorId: NO_VENDOR,
          parentId: NO_PARENT,
          criticality: 'MEDIUM',
          installDate: '',
          manufacturer: '',
          model: '',
          serialNumber: '',
          purchaseDate: '',
          purchaseCost: '',
          warrantyStart: '',
          warrantyEnd: '',
          notes: '',
          customFields: {},
        },
  })
  const customFields = useCustomFields('ASSET')
  useCustomFieldDefaults(form, customFields.data)
  const selectedRestaurant = form.watch('restaurantId')
  const vendors = useVendorOptions(selectedRestaurant || undefined)
  const locations = useLocations(selectedRestaurant || undefined, !!selectedRestaurant)
  const parents = useAssets(
    { restaurantId: selectedRestaurant, pageSize: 100, sort: 'name:asc' },
    !!selectedRestaurant,
  )
  useEffect(() => {
    const current = form.getValues('parentId')
    if (current !== NO_PARENT && parents.data && !parents.data.data.some((a) => a.id === current))
      form.setValue('parentId', NO_PARENT)
  }, [parents.data, form])

  // A location from another restaurant isn't valid after switching restaurants.
  useEffect(() => {
    const current = form.getValues('locationId')
    if (
      current !== NO_LOCATION &&
      locations.data &&
      !locations.data.some((l) => l.id === current)
    ) {
      form.setValue('locationId', NO_LOCATION)
    }
  }, [locations.data, form])

  const save = useInvalidatingMutation(
    (input: AssetInput) => (asset ? assetsApi.update(asset.id, input) : assetsApi.create(input)),
    [assetKeys.all, assetKeys.categories, assetKeys.locationsAll],
  )
  const { errors, isSubmitting } = form.formState
  const advancedError = Boolean(
    errors.manufacturer ||
    errors.model ||
    errors.serialNumber ||
    errors.purchaseDate ||
    errors.purchaseCost ||
    errors.warrantyStart ||
    errors.warrantyEnd ||
    errors.notes,
  )

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync({
        ...values,
        locationId: values.locationId === NO_LOCATION ? '' : values.locationId,
        vendorId: values.vendorId === NO_VENDOR ? '' : values.vendorId,
        parentId: values.parentId === NO_PARENT ? '' : values.parentId,
        customFields: customFields.data
          ? fromCustomForm(customFields.data, values.customFields)
          : undefined,
      })
      toast.success(asset ? t('assets.saved') : t('assets.created'))
      onDone(saved)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField
          control={form.control}
          name="name"
          label={t('assets.name')}
          required
          placeholder="Walk-in freezer"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="categoryId"
            label={t('assets.category')}
            required
            placeholder={t('validation.selectOption')}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectField
            control={form.control}
            name="criticality"
            label={t('assets.criticality')}
            description={t('assets.criticalityHint')}
            options={ASSET_CRITICALITY.map((c) => ({
              value: c,
              label: enumLabel(t, 'assetCriticality', c),
            }))}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="restaurantId"
            label={t('assets.restaurant')}
            required
            placeholder={t('validation.selectOption')}
            options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
          />
          <SelectField
            control={form.control}
            name="locationId"
            label={t('assets.location')}
            disabled={!selectedRestaurant}
            options={[
              { value: NO_LOCATION, label: t('assets.noLocation') },
              ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        </div>
        <CustomFieldInputs entity="ASSET" control={form.control} fields={customFields.data} />
        <MoreOptions forceOpen={advancedError} defaultOpen={!!asset}>
          <SelectField
            control={form.control}
            name="parentId"
            label={t('assets.parent')}
            description={t('assets.parentHint')}
            disabled={!selectedRestaurant}
            options={[
              { value: NO_PARENT, label: t('assets.noParent') },
              ...(parents.data?.data ?? [])
                .filter((a) => a.id !== asset?.id)
                .map((a) => ({ value: a.id, label: `${a.name} · ${a.assetCode}` })),
            ]}
          />
          <SelectField
            control={form.control}
            name="vendorId"
            label={t('assets.vendor')}
            description={t('assets.vendorHint')}
            options={[
              { value: NO_VENDOR, label: t('parts.noVendor') },
              ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              control={form.control}
              name="manufacturer"
              label={t('assets.manufacturer')}
            />
            <TextField control={form.control} name="model" label={t('assets.model')} />
            <TextField
              control={form.control}
              name="serialNumber"
              label={t('assets.serialNumber')}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              control={form.control}
              name="purchaseDate"
              label={t('assets.purchaseDate')}
            />
            <TextField
              control={form.control}
              name="purchaseCost"
              label={t('assets.purchaseCost')}
              inputMode="decimal"
              placeholder="₹"
            />
            <DateField
              control={form.control}
              name="warrantyStart"
              label={t('assets.warrantyStart')}
            />
            <DateField control={form.control} name="warrantyEnd" label={t('assets.warrantyEnd')} />
            <DateField control={form.control} name="installDate" label={t('assets.installDate')} />
          </div>
          <TextareaField control={form.control} name="notes" label={t('assets.notes')} rows={3} />
        </MoreOptions>
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {asset ? t('actions.saveChanges') : t('actions.create')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

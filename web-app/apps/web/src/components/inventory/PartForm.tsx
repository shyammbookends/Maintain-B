import { partSchema, type PartDetail, type PartInput } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { MoreOptions } from '@/components/common/MoreOptions'
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
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation } from '@/hooks/useAdminQueries'
import {
  buyKeys,
  partsApi,
  usePartCategories,
  useVendorOptions,
} from '@/services/purchasing.service'
import { describeError } from '@/utils/errors'

const NONE = '__none__'
const formSchema = partSchema.extend({ preferredVendorId: z.string() })

export function PartForm({
  part,
  onDone,
  onCancel,
}: {
  part: PartDetail | null
  onDone: (p: PartDetail) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const vendors = useVendorOptions()
  const categories = usePartCategories()
  const form = useZodForm(formSchema, {
    defaultValues: part
      ? {
          name: part.name,
          partNumber: part.partNumber,
          sku: part.sku ?? '',
          category: part.category ?? '',
          unit: part.unit,
          unitCost: part.unitCost,
          minStock: part.minStock,
          reorderQty: part.reorderQty ?? undefined,
          preferredVendorId: part.preferredVendor?.id ?? NONE,
          storageLocation: part.storageLocation ?? '',
          description: part.description ?? '',
        }
      : {
          name: '',
          partNumber: '',
          sku: '',
          category: '',
          unit: 'pcs',
          unitCost: 0,
          minStock: 0,
          preferredVendorId: NONE,
          storageLocation: '',
          description: '',
        },
  })
  const save = useInvalidatingMutation(
    (input: PartInput) => (part ? partsApi.update(part.id, input) : partsApi.create(input)),
    [buyKeys.parts],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const saved = await save.mutateAsync({
        ...v,
        preferredVendorId: v.preferredVendorId === NONE ? '' : v.preferredVendorId,
      })
      toast.success(part ? t('parts.saved') : t('parts.created'))
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
          label={t('parts.name')}
          placeholder={t('parts.namePlaceholder')}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="partNumber"
            label={t('parts.partNumber')}
            placeholder="GSK-200"
            required
          />
          <TextField
            control={form.control}
            name="sku"
            label={t('parts.sku')}
            description={t('parts.skuHint')}
            optional
          />
        </div>
        <TextField
          control={form.control}
          name="category"
          label={t('parts.category')}
          list="part-categories"
          optional
        />
        <datalist id="part-categories">
          {(categories.data ?? []).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            control={form.control}
            name="unit"
            label={t('parts.unit')}
            description={t('parts.unitHint')}
            required
          />
          <NumberField
            control={form.control}
            name="unitCost"
            label={t('parts.unitCost')}
            min={0}
            step={0.01}
            suffix="₹"
          />
          <NumberField
            control={form.control}
            name="minStock"
            label={t('parts.minStock')}
            description={t('parts.minStockHint')}
            min={0}
            step={1}
          />
        </div>
        <NumberField
          control={form.control}
          name="reorderQty"
          label={t('parts.reorderQty')}
          description={t('parts.reorderQtyHint')}
          optional
          min={0}
          step={1}
        />
        <SelectField
          control={form.control}
          name="preferredVendorId"
          label={t('parts.preferredVendor')}
          options={[
            { value: NONE, label: t('parts.noVendor') },
            ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })),
          ]}
        />
        <MoreOptions defaultOpen={!!part?.description || !!part?.storageLocation}>
          <TextField
            control={form.control}
            name="storageLocation"
            label={t('parts.storage')}
            placeholder={t('parts.storagePlaceholder')}
          />
          <TextareaField
            control={form.control}
            name="description"
            label={t('wo.fieldDescription')}
            rows={3}
          />
        </MoreOptions>
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {part ? t('actions.saveChanges') : t('actions.create')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

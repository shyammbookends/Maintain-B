import type { CustomFieldDto, CustomFieldEntity, CustomValue } from '@maintainx/shared'
import type { Control, FieldPath } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import {
  CheckboxField,
  DateField,
  NumberField,
  SelectField,
  TextField,
} from '@/components/forms'
import { useCustomFields } from '@/services/customization.service'
import { NONE, type CustomFieldsForm } from './custom-fields'

/*
 * The organisation's custom fields inside a form. Values live in the form as
 * `customFields.<fieldId>`, so server errors ("customFields.<id>") land on the
 * right input.
 */

export function CustomFieldInputs<T extends { customFields: CustomFieldsForm }, TT>({
  entity,
  control,
  fields: given,
}: {
  entity: CustomFieldEntity
  /** Any form with a `customFields` record. */
  control: Control<T, unknown, TT>
  fields?: CustomFieldDto[]
}) {
  const { t } = useTranslation()
  const query = useCustomFields(entity, !given)
  const fields = given ?? query.data ?? []
  if (fields.length === 0) return null
  return (
    <fieldset className="grid gap-4 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">{t('custom.sectionTitle')}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const name = `customFields.${f.id}` as FieldPath<T>
          const common = { control, name, label: f.label }
          switch (f.type) {
            case 'NUMBER':
              return <NumberField key={f.id} {...common} required={f.required} step={0.01} />
            case 'DATE':
              return <DateField key={f.id} {...common} required={f.required} optional={!f.required} />
            case 'SELECT':
              return (
                <SelectField
                  key={f.id}
                  {...common}
                  required={f.required}
                  options={[
                    { value: NONE, label: t('custom.notSet') },
                    ...f.options.map((o) => ({ value: o, label: o })),
                  ]}
                />
              )
            case 'CHECKBOX':
              return <CheckboxField key={f.id} {...common} className="self-end rounded-md border p-2.5" />
            default:
              return (
                <TextField
                  key={f.id}
                  {...common}
                  required={f.required}
                  optional={!f.required}
                  maxLength={500}
                />
              )
          }
        })}
      </div>
    </fieldset>
  )
}

/** Read-only list of filled custom fields (detail pages). */
export function CustomFieldValues({
  entity,
  values,
}: {
  entity: CustomFieldEntity
  values: Record<string, Exclude<CustomValue, null>>
}) {
  const { t } = useTranslation()
  const query = useCustomFields(entity)
  const filled = (query.data ?? []).filter((f) => values[f.id] !== undefined)
  if (filled.length === 0) return null
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {filled.map((f) => {
        const v = values[f.id]
        return (
          <div key={f.id}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd>{typeof v === 'boolean' ? (v ? t('common.yes') : t('common.no')) : String(v)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

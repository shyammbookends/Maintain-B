import type { CustomFieldDto, CustomValue, CustomValues } from '@maintainx/shared'
import { useEffect } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { z } from 'zod'

/** Form-side helpers for custom fields (values live under `customFields.<id>`). */

export const NONE = '__none__'

/** Form-side shape: strings, numbers, booleans (selects use NONE for empty). */
export const customFieldsFormSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.undefined()]),
)
export type CustomFieldsForm = z.infer<typeof customFieldsFormSchema>

function emptyValue(f: CustomFieldDto) {
  if (f.type === 'CHECKBOX') return false
  if (f.type === 'NUMBER') return undefined
  if (f.type === 'SELECT') return NONE
  return ''
}

/** Stored values → form values, with every defined field present. */
export function toCustomForm(
  fields: CustomFieldDto[],
  stored: Record<string, Exclude<CustomValue, null>> = {},
): CustomFieldsForm {
  const out: CustomFieldsForm = {}
  for (const f of fields) out[f.id] = stored[f.id] ?? emptyValue(f)
  return out
}

/** Form values → API values (empty → null so a cleared field is removed). */
export function fromCustomForm(fields: CustomFieldDto[], values: CustomFieldsForm): CustomValues {
  const out: CustomValues = {}
  for (const f of fields) {
    const v = values[f.id]
    if (v === undefined || v === '' || v === NONE) out[f.id] = null
    else out[f.id] = v
  }
  return out
}

/** Fills in fields that loaded after the form was created. */
export function useCustomFieldDefaults<T extends FieldValues>(
  form: UseFormReturn<T>,
  fields: CustomFieldDto[] | undefined,
) {
  useEffect(() => {
    if (!fields) return
    const current = (form.getValues('customFields' as never) ?? {}) as CustomFieldsForm
    const next = { ...toCustomForm(fields), ...current }
    if (Object.keys(next).length !== Object.keys(current).length)
      form.setValue('customFields' as never, next as never)
  }, [fields, form])
}

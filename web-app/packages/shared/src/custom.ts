import { z } from 'zod'
import {
  CUSTOM_FIELD_ENTITY,
  CUSTOM_FIELD_TYPE,
  type CustomFieldEntity,
  type CustomFieldType,
} from './enums.js'

// ---------------------------------------------------------------- custom fields

/** An organisation's extra field on work orders or assets ("Warranty no.", "Gas cylinder size"…). */
export const customFieldSchema = z
  .object({
    entity: z.enum(CUSTOM_FIELD_ENTITY),
    label: z.string().trim().min(2).max(60),
    type: z.enum(CUSTOM_FIELD_TYPE),
    /** SELECT choices (2–20). */
    options: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    required: z.boolean().default(false),
  })
  .superRefine((f, ctx) => {
    if (f.type !== 'SELECT') return
    if (f.options.length < 2)
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'validation.optionsRequired' })
    else if (new Set(f.options.map((o) => o.toLowerCase())).size !== f.options.length)
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'validation.duplicateOptions' })
  })
export type CustomFieldInput = z.infer<typeof customFieldSchema>

export const reorderCustomFieldsSchema = z.object({ ids: z.array(z.uuid()).max(50) })

export interface CustomFieldDto {
  id: string
  entity: CustomFieldEntity
  label: string
  type: CustomFieldType
  options: string[]
  required: boolean
  position: number
}

export type CustomValue = string | number | boolean | null

/** Values keyed by field id. Dates are 'YYYY-MM-DD'. */
export const customValuesSchema = z.record(
  z.uuid(),
  z.union([z.string().trim().max(500), z.number().finite(), z.boolean(), z.null()]),
)
export type CustomValues = z.infer<typeof customValuesSchema>

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Checks values against the field definitions: keeps only known fields,
 * coerces to the field's type, and reports required / wrong-type fields as
 * errors keyed `customFields.<id>`. Empty values are stored as absent.
 */
export function cleanCustomValues(
  fields: ReadonlyArray<Pick<CustomFieldDto, 'id' | 'type' | 'options' | 'required'>>,
  values: CustomValues,
): { values: Record<string, Exclude<CustomValue, null>>; errors: Record<string, string[]> } {
  const out: Record<string, Exclude<CustomValue, null>> = {}
  const errors: Record<string, string[]> = {}
  for (const f of fields) {
    const raw = values[f.id]
    const empty = raw === undefined || raw === null || raw === '' || (f.type === 'CHECKBOX' && raw === false)
    if (empty) {
      if (f.required) errors[`customFields.${f.id}`] = ['validation.required']
      continue
    }
    const bad = () => (errors[`customFields.${f.id}`] = ['validation.invalidValue'])
    switch (f.type) {
      case 'NUMBER': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'))
        if (Number.isFinite(n)) out[f.id] = n
        else bad()
        break
      }
      case 'CHECKBOX':
        out[f.id] = raw === true || raw === 'true'
        break
      case 'DATE':
        if (typeof raw === 'string' && DATE.test(raw)) out[f.id] = raw
        else bad()
        break
      case 'SELECT': {
        const match = f.options.find((o) => o.toLowerCase() === String(raw).toLowerCase())
        if (match) out[f.id] = match
        else bad()
        break
      }
      default:
        out[f.id] = String(raw)
    }
  }
  return { values: out, errors }
}

// ---------------------------------------------------------------- labels (custom categories)

export const LABEL_COLORS = ['blue', 'green', 'amber', 'red', 'violet', 'teal', 'pink', 'slate'] as const
export type LabelColor = (typeof LABEL_COLORS)[number]

export const labelSchema = z.object({
  name: z.string().trim().min(2).max(40),
  color: z.enum(LABEL_COLORS),
})
export type LabelInput = z.infer<typeof labelSchema>

export interface LabelDto {
  id: string
  name: string
  color: LabelColor
}

export interface LabelWithUsage extends LabelDto {
  /** Open and closed work orders carrying it. */
  workOrders: number
}

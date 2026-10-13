import {
  cleanCustomValues,
  type CustomFieldEntity,
  type CustomValue,
  type CustomValues,
  type LabelColor,
  type LabelDto,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { ValidationError } from './errors.js'
import { prisma } from './prisma.js'

/** The organisation's active custom fields for work orders or assets, in order. */
export function activeFields(organizationId: string, entity: CustomFieldEntity) {
  return prisma.customField.findMany({
    where: { organizationId, entity, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  })
}

/**
 * Checks submitted values against the field definitions. `undefined` input
 * means "unchanged" on update; on create pass `{}` so required fields are
 * enforced. Errors come back as `customFields.<id>` field errors.
 */
export async function resolveCustomValues(
  organizationId: string,
  entity: CustomFieldEntity,
  input: CustomValues | undefined,
): Promise<Prisma.InputJsonObject | undefined> {
  if (input === undefined) return undefined
  const fields = await activeFields(organizationId, entity)
  const { values, errors } = cleanCustomValues(fields, input)
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return values
}

/** Stored JSON → plain values (anything unexpected is dropped). */
export function storedValues(json: Prisma.JsonValue): Record<string, Exclude<CustomValue, null>> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const out: Record<string, Exclude<CustomValue, null>> = {}
  for (const [k, v] of Object.entries(json))
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
  return out
}

/** Label ids that exist in the organisation (unknown or archived → validation error). */
export async function assertLabels(organizationId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const found = await prisma.label.count({
    where: { organizationId, id: { in: unique }, archivedAt: null },
  })
  if (found !== unique.length) throw new ValidationError({ labelIds: ['validation.invalidValue'] })
  return unique
}

export const labelSelect = { label: { select: { id: true, name: true, color: true } } } as const

export const toLabels = (rows: Array<{ label: { id: string; name: string; color: string } }>) =>
  rows
    .map<LabelDto>((r) => ({ ...r.label, color: r.label.color as LabelColor }))
    .sort((a, b) => a.name.localeCompare(b.name))

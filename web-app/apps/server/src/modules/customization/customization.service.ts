import type {
  CustomFieldDto,
  CustomFieldEntity,
  CustomFieldInput,
  LabelColor,
  LabelInput,
  LabelWithUsage,
} from '@maintainx/shared'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { activeFields } from '../../core/custom-fields.js'
import { NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Organisation-wide customisation: extra fields on work orders and assets,
 * and labels (custom categories) for work orders. Removing either archives
 * it; values already stored on records are kept.
 */

const MAX_FIELDS = 30
const MAX_LABELS = 50

const toField = (f: Awaited<ReturnType<typeof activeFields>>[number]): CustomFieldDto => ({
  id: f.id,
  entity: f.entity,
  label: f.label,
  type: f.type,
  options: f.options,
  required: f.required,
  position: f.position,
})

export async function listCustomFields(auth: AuthContext, entity: CustomFieldEntity) {
  return (await activeFields(auth.organizationId, entity)).map(toField)
}

function audit(auth: AuthContext, action: string, id: string, value: object, req: Request) {
  return recordAudit(
    {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action,
      entityType: 'SETTING',
      entityId: id,
      newValue: { ...value },
    },
    req,
  )
}

async function assertLabelFree(auth: AuthContext, entity: CustomFieldEntity, label: string, exceptId?: string) {
  const clash = await prisma.customField.count({
    where: {
      organizationId: auth.organizationId,
      entity,
      archivedAt: null,
      label: { equals: label, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  })
  if (clash) throw new ValidationError({ label: ['validation.alreadyInUse'] })
}

export async function createCustomField(auth: AuthContext, input: CustomFieldInput, req: Request) {
  const count = await prisma.customField.count({
    where: { organizationId: auth.organizationId, entity: input.entity, archivedAt: null },
  })
  if (count >= MAX_FIELDS) throw new ValidationError({ label: ['validation.tooMany'] })
  await assertLabelFree(auth, input.entity, input.label)
  const f = await prisma.customField.create({
    data: {
      organizationId: auth.organizationId,
      entity: input.entity,
      label: input.label,
      type: input.type,
      options: input.type === 'SELECT' ? input.options : [],
      required: input.required,
      position: count,
    },
  })
  await audit(auth, 'custom_field.created', f.id, { label: f.label, entity: f.entity, type: f.type }, req)
  return listCustomFields(auth, input.entity)
}

async function loadField(auth: AuthContext, id: string) {
  const f = await prisma.customField.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null },
  })
  if (!f) throw new NotFoundError('Custom field')
  return f
}

/** Label, choices and "required" can change; the entity and type are fixed (values depend on them). */
export async function updateCustomField(
  auth: AuthContext,
  id: string,
  input: CustomFieldInput,
  req: Request,
) {
  const f = await loadField(auth, id)
  if (input.entity !== f.entity || input.type !== f.type)
    throw new ValidationError({ type: ['validation.cannotChangeType'] })
  await assertLabelFree(auth, f.entity, input.label, id)
  await prisma.customField.update({
    where: { id },
    data: {
      label: input.label,
      options: f.type === 'SELECT' ? input.options : [],
      required: input.required,
    },
  })
  await audit(auth, 'custom_field.updated', id, { label: input.label, required: input.required }, req)
  return listCustomFields(auth, f.entity)
}

export async function archiveCustomField(auth: AuthContext, id: string, req: Request) {
  const f = await loadField(auth, id)
  await prisma.customField.update({ where: { id }, data: { archivedAt: new Date() } })
  await audit(auth, 'custom_field.archived', id, { label: f.label }, req)
  return listCustomFields(auth, f.entity)
}

export async function reorderCustomFields(
  auth: AuthContext,
  entity: CustomFieldEntity,
  ids: string[],
) {
  const current = await activeFields(auth.organizationId, entity)
  const known = new Set(current.map((f) => f.id))
  if (ids.length !== known.size || !ids.every((i) => known.has(i)))
    throw new ValidationError({ ids: ['validation.invalidValue'] })
  await prisma.$transaction(
    ids.map((id, position) => prisma.customField.update({ where: { id }, data: { position } })),
  )
  return listCustomFields(auth, entity)
}

// ---------------------------------------------------------------- labels

export async function listLabels(auth: AuthContext): Promise<LabelWithUsage[]> {
  const rows = await prisma.label.findMany({
    where: { organizationId: auth.organizationId, archivedAt: null },
    select: { id: true, name: true, color: true, _count: { select: { workOrders: true } } },
    orderBy: { name: 'asc' },
  })
  return rows.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color as LabelColor,
    workOrders: l._count.workOrders,
  }))
}

async function assertNameFree(auth: AuthContext, name: string, exceptId?: string) {
  const clash = await prisma.label.findFirst({
    where: {
      organizationId: auth.organizationId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, archivedAt: true },
  })
  return clash
}

export async function createLabel(auth: AuthContext, input: LabelInput, req: Request) {
  const clash = await assertNameFree(auth, input.name)
  if (clash && !clash.archivedAt) throw new ValidationError({ name: ['validation.alreadyInUse'] })
  const count = await prisma.label.count({
    where: { organizationId: auth.organizationId, archivedAt: null },
  })
  if (count >= MAX_LABELS) throw new ValidationError({ name: ['validation.tooMany'] })
  // Re-creating a removed label brings it back (names are unique).
  const label = clash
    ? await prisma.label.update({
        where: { id: clash.id },
        data: { archivedAt: null, name: input.name, color: input.color },
      })
    : await prisma.label.create({
        data: { organizationId: auth.organizationId, name: input.name, color: input.color },
      })
  await audit(auth, 'label.created', label.id, { name: label.name, color: label.color }, req)
  return listLabels(auth)
}

async function loadLabel(auth: AuthContext, id: string) {
  const l = await prisma.label.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null },
  })
  if (!l) throw new NotFoundError('Label')
  return l
}

export async function updateLabel(auth: AuthContext, id: string, input: LabelInput, req: Request) {
  await loadLabel(auth, id)
  const clash = await assertNameFree(auth, input.name, id)
  if (clash) throw new ValidationError({ name: ['validation.alreadyInUse'] })
  await prisma.label.update({ where: { id }, data: { name: input.name, color: input.color } })
  await audit(auth, 'label.updated', id, { name: input.name, color: input.color }, req)
  return listLabels(auth)
}

/** Removes the label from the list and from every work order. */
export async function archiveLabel(auth: AuthContext, id: string, req: Request) {
  const l = await loadLabel(auth, id)
  await prisma.$transaction([
    prisma.workOrderLabel.deleteMany({ where: { labelId: id } }),
    prisma.label.update({ where: { id }, data: { archivedAt: new Date() } }),
  ])
  await audit(auth, 'label.archived', id, { name: l.name }, req)
  return listLabels(auth)
}

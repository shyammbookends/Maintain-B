import {
  PROCEDURE_LIBRARY,
  libraryProcedureInput,
  procedureSchema,
  type Locale,
  ERROR_CODES,
  type InspectionTemplateDto,
  type InspectionTemplateInput,
  type ProcedureDetail,
  type ProcedureInput,
  type ProcedureListItem,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { assertProcedureUsable, conditionOf } from '../../core/checklist.js'
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Procedures are reusable step lists. Organization-wide procedures
 * (restaurantId null) are visible to everyone but only Super Admins change
 * them; restaurant procedures belong to that restaurant's admins.
 */

const visible = (auth: AuthContext): Prisma.ProcedureWhereInput => ({
  organizationId: auth.organizationId,
  archivedAt: null,
  ...(auth.isSuperAdmin
    ? {}
    : { OR: [{ restaurantId: null }, { restaurantId: restaurantScope(auth) }] }),
})

const canManage = (auth: AuthContext, restaurantId: string | null) =>
  restaurantId === null ? auth.isSuperAdmin : canAccessRestaurant(auth, restaurantId)

const listInclude = {
  restaurant: { select: { id: true, name: true } },
  _count: {
    select: {
      steps: true,
      pmSchedules: { where: { archivedAt: null } },
      inspectionTemplates: { where: { archivedAt: null } },
    },
  },
} satisfies Prisma.ProcedureInclude

type ListRow = Prisma.ProcedureGetPayload<{ include: typeof listInclude }>

function toListItem(p: ListRow): ProcedureListItem {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    restaurant: p.restaurant,
    stepCount: p._count.steps,
    version: p.version,
    usedBy: { schedules: p._count.pmSchedules, templates: p._count.inspectionTemplates },
    updatedAt: p.updatedAt.toISOString(),
  }
}

export async function listProcedures(
  auth: AuthContext,
  q: { restaurantId?: string; q?: string },
): Promise<ProcedureListItem[]> {
  const rows = await prisma.procedure.findMany({
    where: {
      AND: [
        visible(auth),
        q.restaurantId ? { OR: [{ restaurantId: null }, { restaurantId: q.restaurantId }] } : {},
        q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {},
      ],
    },
    include: listInclude,
    orderBy: { name: 'asc' },
  })
  return rows.map(toListItem)
}

export async function getProcedure(auth: AuthContext, id: string): Promise<ProcedureDetail> {
  const p = await prisma.procedure.findFirst({
    where: { AND: [visible(auth), { id }] },
    include: { ...listInclude, steps: { orderBy: { position: 'asc' } } },
  })
  if (!p) throw new NotFoundError('Procedure')
  const manage = canManage(auth, p.restaurantId)
  return {
    ...toListItem(p),
    description: p.description,
    steps: p.steps.map((s) => ({
      id: s.id,
      position: s.position,
      title: s.title,
      instruction: s.instruction,
      inputType: s.inputType,
      unit: s.unit,
      minValue: s.minValue === null ? null : Number(s.minValue),
      maxValue: s.maxValue === null ? null : Number(s.maxValue),
      required: s.required,
      options: s.options,
      requirePhoto: s.requirePhoto,
      showIf: conditionOf(s),
    })),
    can: {
      edit: manage && hasPermission(auth, 'procedures:edit'),
      delete: manage && hasPermission(auth, 'procedures:delete'),
    },
  }
}

const stepRows = (input: ProcedureInput) =>
  input.steps.map((s, i) => ({
    position: i + 1,
    title: s.title,
    instruction: s.instruction || null,
    inputType: s.inputType,
    unit: s.inputType === 'NUMBER' ? s.unit || null : null,
    minValue: s.inputType === 'NUMBER' ? (s.minValue ?? null) : null,
    maxValue: s.inputType === 'NUMBER' ? (s.maxValue ?? null) : null,
    // Section headings are never answered.
    required: s.inputType === 'SECTION' ? false : s.required,
    options: s.inputType === 'MULTIPLE_CHOICE' ? (s.options ?? []) : [],
    requirePhoto:
      s.inputType === 'PHOTO' || s.inputType === 'SECTION' ? false : (s.requirePhoto ?? false),
    showIfPosition: s.showIf?.step ?? null,
    showIfAnswer: s.showIf?.answer ?? null,
  }))

async function assertNameFree(auth: AuthContext, name: string, exceptId?: string) {
  const clash = await prisma.procedure.findFirst({
    where: {
      organizationId: auth.organizationId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) throw new ValidationError({ name: ['validation.alreadyInUse'] })
}

function assertScope(auth: AuthContext, restaurantId: string | null) {
  if (!canManage(auth, restaurantId)) {
    throw new ValidationError({
      restaurantId: [
        restaurantId ? 'validation.restaurantOutOfScope' : 'validation.globalSuperAdminOnly',
      ],
    })
  }
}

export async function createProcedure(
  auth: AuthContext,
  input: ProcedureInput,
  req: Request,
): Promise<ProcedureDetail> {
  const restaurantId = input.restaurantId || null
  assertScope(auth, restaurantId)
  await assertNameFree(auth, input.name)
  const p = await prisma.$transaction(async (tx) => {
    const created = await tx.procedure.create({
      data: {
        organizationId: auth.organizationId,
        restaurantId,
        name: input.name,
        description: input.description || null,
        category: input.category || null,
        steps: { create: stepRows(input) },
      },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId,
        actorId: auth.userId,
        action: 'procedure.created',
        entityType: 'PROCEDURE',
        entityId: created.id,
        newValue: { name: input.name, steps: input.steps.length },
      },
      req,
      tx,
    )
    return created
  })
  return getProcedure(auth, p.id)
}

/**
 * Copies a ready-made restaurant procedure from the library into the
 * organisation, in the chosen language. A clashing name gets " (2)", " (3)"…
 */
export async function importLibraryProcedure(
  auth: AuthContext,
  key: string,
  input: { locale: Locale; restaurantId: string },
  req: Request,
): Promise<ProcedureDetail> {
  const entry = PROCEDURE_LIBRARY.find((p) => p.key === key)
  if (!entry) throw new NotFoundError('Library procedure')
  const base = procedureSchema.parse({
    ...libraryProcedureInput(entry, input.locale),
    restaurantId: input.restaurantId,
  })
  let name = base.name
  for (let n = 2; n < 50; n++) {
    const taken = await prisma.procedure.count({
      where: { organizationId: auth.organizationId, name: { equals: name, mode: 'insensitive' } },
    })
    if (!taken) break
    name = `${base.name} (${n})`
  }
  return createProcedure(auth, { ...base, name }, req)
}

export async function updateProcedure(
  auth: AuthContext,
  id: string,
  input: ProcedureInput,
  req: Request,
): Promise<ProcedureDetail> {
  const before = await getProcedure(auth, id)
  if (!before.can.edit) throw new NotFoundError('Procedure')
  const restaurantId = input.restaurantId || null
  assertScope(auth, restaurantId)
  await assertNameFree(auth, input.name, id)
  await prisma.$transaction(async (tx) => {
    // Steps are replaced wholesale; work already created keeps its own copy.
    await tx.procedureStep.deleteMany({ where: { procedureId: id } })
    await tx.procedure.update({
      where: { id },
      data: {
        restaurantId,
        name: input.name,
        description: input.description || null,
        category: input.category || null,
        version: { increment: 1 },
        steps: { create: stepRows(input) },
      },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId,
        actorId: auth.userId,
        action: 'procedure.updated',
        entityType: 'PROCEDURE',
        entityId: id,
        oldValue: { name: before.name, version: before.version, steps: before.stepCount },
        newValue: { name: input.name, version: before.version + 1, steps: input.steps.length },
      },
      req,
      tx,
    )
  })
  return getProcedure(auth, id)
}

export async function archiveProcedure(auth: AuthContext, id: string, req: Request) {
  const p = await getProcedure(auth, id)
  if (!p.can.delete) throw new NotFoundError('Procedure')
  if (p.usedBy.schedules > 0 || p.usedBy.templates > 0) {
    throw new ConflictError(
      'This procedure is used by maintenance schedules or inspection templates.',
      ERROR_CODES.PROCEDURE_IN_USE,
    )
  }
  await prisma.procedure.update({
    where: { id },
    // Frees the name so it can be reused.
    data: { archivedAt: new Date(), name: `${p.name} (archived ${id.slice(0, 8)})` },
  })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: p.restaurant?.id ?? null,
      actorId: auth.userId,
      action: 'procedure.archived',
      entityType: 'PROCEDURE',
      entityId: id,
      oldValue: { name: p.name },
    },
    req,
  )
}

// ---------------------------------------------------------------- inspection templates

const templateInclude = {
  restaurant: { select: { id: true, name: true } },
  procedure: { select: { id: true, name: true, _count: { select: { steps: true } } } },
} satisfies Prisma.InspectionTemplateInclude

type TemplateRow = Prisma.InspectionTemplateGetPayload<{ include: typeof templateInclude }>

const toTemplate = (t: TemplateRow): InspectionTemplateDto => ({
  id: t.id,
  name: t.name,
  type: t.type,
  procedure: { id: t.procedure.id, name: t.procedure.name, stepCount: t.procedure._count.steps },
  restaurant: t.restaurant,
  active: t.active,
})

const templatesVisible = (auth: AuthContext): Prisma.InspectionTemplateWhereInput => ({
  organizationId: auth.organizationId,
  archivedAt: null,
  ...(auth.isSuperAdmin
    ? {}
    : { OR: [{ restaurantId: null }, { restaurantId: restaurantScope(auth) }] }),
})

/** `forRestaurant` limits to templates usable there (workers starting a checklist). */
export async function listTemplates(
  auth: AuthContext,
  opts: { restaurantId?: string; activeOnly?: boolean } = {},
): Promise<InspectionTemplateDto[]> {
  const rows = await prisma.inspectionTemplate.findMany({
    where: {
      AND: [
        templatesVisible(auth),
        opts.restaurantId
          ? { OR: [{ restaurantId: null }, { restaurantId: opts.restaurantId }] }
          : {},
        opts.activeOnly ? { active: true } : {},
      ],
    },
    include: templateInclude,
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })
  return rows.map(toTemplate)
}

async function saveTemplate(
  auth: AuthContext,
  id: string | null,
  input: InspectionTemplateInput,
  req: Request,
): Promise<InspectionTemplateDto> {
  const restaurantId = input.restaurantId || null
  assertScope(auth, restaurantId)
  if (restaurantId) await assertProcedureUsable(auth, input.procedureId, restaurantId)
  else {
    const p = await prisma.procedure.findFirst({
      where: {
        id: input.procedureId,
        organizationId: auth.organizationId,
        archivedAt: null,
        restaurantId: null,
      },
    })
    if (!p) throw new ValidationError({ procedureId: ['validation.procedureNotAvailable'] })
  }
  const clash = await prisma.inspectionTemplate.findFirst({
    where: {
      organizationId: auth.organizationId,
      name: { equals: input.name, mode: 'insensitive' },
      ...(id ? { id: { not: id } } : {}),
    },
  })
  if (clash) throw new ValidationError({ name: ['validation.alreadyInUse'] })

  const data = {
    name: input.name,
    type: input.type,
    procedureId: input.procedureId,
    restaurantId,
    active: input.active,
  }
  const t = id
    ? await prisma.inspectionTemplate.update({ where: { id }, data, include: templateInclude })
    : await prisma.inspectionTemplate.create({
        data: { ...data, organizationId: auth.organizationId },
        include: templateInclude,
      })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId,
      actorId: auth.userId,
      action: id ? 'inspection_template.updated' : 'inspection_template.created',
      entityType: 'INSPECTION',
      entityId: t.id,
      newValue: data,
    },
    req,
  )
  return toTemplate(t)
}

async function loadManagedTemplate(auth: AuthContext, id: string) {
  const t = await prisma.inspectionTemplate.findFirst({
    where: { AND: [templatesVisible(auth), { id }] },
  })
  if (!t || !canManage(auth, t.restaurantId)) throw new NotFoundError('Template')
  return t
}

export const createTemplate = (auth: AuthContext, input: InspectionTemplateInput, req: Request) =>
  saveTemplate(auth, null, input, req)

export async function updateTemplate(
  auth: AuthContext,
  id: string,
  input: InspectionTemplateInput,
  req: Request,
) {
  await loadManagedTemplate(auth, id)
  return saveTemplate(auth, id, input, req)
}

export async function archiveTemplate(auth: AuthContext, id: string, req: Request) {
  const t = await loadManagedTemplate(auth, id)
  await prisma.inspectionTemplate.update({
    where: { id },
    data: { archivedAt: new Date(), active: false, name: `${t.name} (archived ${id.slice(0, 8)})` },
  })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: t.restaurantId,
      actorId: auth.userId,
      action: 'inspection_template.archived',
      entityType: 'INSPECTION',
      entityId: id,
      oldValue: { name: t.name },
    },
    req,
  )
}

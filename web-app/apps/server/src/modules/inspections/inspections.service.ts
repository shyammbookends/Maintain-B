import {
  ERROR_CODES,
  evaluateAnswer,
  type InspectionDetail,
  type InspectionListItem,
  type ListInspectionsQuery,
  type PagedResponse,
  type StartInspectionInput,
  type StepAnswerInput,
  type SubmitInspectionInput,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { attachmentsOf, listAttachments, saveAttachments } from '../../core/attachments.js'
import { runAutomations } from '../../core/automations.js'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import {
  createCorrectiveWorkOrder,
  copyStepsToInspection,
  failureDetails,
  toChecklistDto,
  stepPhotoCounts,
  unanswered,
} from '../../core/checklist.js'
import { nextCode } from '../../core/counters.js'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors.js'
import { notify, usersWithPermission } from '../../core/notify.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

const person = { select: { id: true, firstName: true, lastName: true } } as const

const listInclude = {
  template: { select: { name: true } },
  restaurant: { select: { id: true, name: true } },
  asset: { select: { id: true, name: true, assetCode: true } },
  performedBy: person,
  _count: { select: { items: true } },
} satisfies Prisma.InspectionInclude

type Row = Prisma.InspectionGetPayload<{ include: typeof listInclude }>

/** Reviewers see every inspection in their restaurants; workers see their own. */
const isReviewer = (auth: AuthContext) => auth.user.roleKind !== 'WORKER'

function visibleWhere(auth: AuthContext, mineOnly = false): Prisma.InspectionWhereInput {
  return {
    organizationId: auth.organizationId,
    restaurantId: restaurantScope(auth),
    ...(mineOnly || !isReviewer(auth) ? { performedById: auth.userId } : {}),
  }
}

function toListItem(r: Row): InspectionListItem {
  return {
    id: r.id,
    code: r.code,
    name: r.template.name,
    type: r.type,
    status: r.status,
    restaurant: r.restaurant,
    asset: r.asset,
    performedBy: r.performedBy,
    startedAt: r.startedAt.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null,
    passCount: r.passCount,
    failCount: r.failCount,
    naCount: r.naCount,
    itemCount: r._count.items,
  }
}

export async function listInspections(
  auth: AuthContext,
  q: ListInspectionsQuery,
): Promise<PagedResponse<InspectionListItem>> {
  if (q.restaurantId && !canAccessRestaurant(auth, q.restaurantId)) return toPagedResponse([], q, 0)
  const where: Prisma.InspectionWhereInput = {
    AND: [
      visibleWhere(auth, q.mine === '1'),
      q.restaurantId ? { restaurantId: q.restaurantId } : {},
      q.type ? { type: q.type } : {},
      q.status ? { status: q.status } : {},
      q.result === 'failed' ? { status: 'SUBMITTED', failCount: { gt: 0 } } : {},
      q.result === 'passed' ? { status: 'SUBMITTED', failCount: 0 } : {},
      q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { template: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {},
    ],
  }
  const sort = q.sort ?? { field: 'startedAt', direction: 'desc' as const }
  const [rows, total] = await Promise.all([
    prisma.inspection.findMany({
      where,
      include: listInclude,
      orderBy: [
        sort.field === 'submittedAt'
          ? { submittedAt: { sort: sort.direction, nulls: 'last' } }
          : { startedAt: sort.direction },
        { startedAt: 'desc' },
      ],
      ...toSkipTake(q),
    }),
    prisma.inspection.count({ where }),
  ])
  return toPagedResponse(rows.map(toListItem), q, total)
}

async function load(auth: AuthContext, id: string) {
  const r = await prisma.inspection.findFirst({
    where: { AND: [visibleWhere(auth), { id }] },
    include: listInclude,
  })
  if (!r) throw new NotFoundError('Inspection')
  return r
}

export async function getInspection(auth: AuthContext, id: string): Promise<InspectionDetail> {
  const r = await load(auth, id)
  const items = await prisma.inspectionItem.findMany({
    where: { inspectionId: id },
    include: { correctiveWorkOrder: { select: { id: true, code: true } } },
    orderBy: { position: 'asc' },
  })
  const mine = r.performedBy.id === auth.userId
  const open = r.status === 'IN_PROGRESS'
  const files = await listAttachments(
    items.map((i) => ({ type: 'INSPECTION_ITEM' as const, id: i.id })),
  )
  return {
    ...toListItem(r),
    notes: r.notes,
    items: items.map((i) =>
      toChecklistDto(
        { ...i, completedBy: mine ? r.performedBy : null },
        attachmentsOf(files, 'INSPECTION_ITEM', i.id),
      ),
    ),
    can: { answer: open && mine, submit: open && mine },
  }
}

export async function startInspection(
  auth: AuthContext,
  input: StartInspectionInput,
  req: Request,
): Promise<InspectionDetail> {
  if (!canAccessRestaurant(auth, input.restaurantId))
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  const template = await prisma.inspectionTemplate.findFirst({
    where: {
      id: input.templateId,
      organizationId: auth.organizationId,
      archivedAt: null,
      active: true,
      OR: [{ restaurantId: null }, { restaurantId: input.restaurantId }],
    },
  })
  if (!template) throw new ValidationError({ templateId: ['validation.invalidValue'] })
  if (input.assetId) {
    const a = await prisma.asset.findFirst({
      where: { id: input.assetId, archivedAt: null },
      select: { restaurantId: true },
    })
    if (a?.restaurantId !== input.restaurantId)
      throw new ValidationError({ assetId: ['validation.assetNotInRestaurant'] })
  }

  const created = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, auth.organizationId, 'INS', 6)
    const ins = await tx.inspection.create({
      data: {
        organizationId: auth.organizationId,
        code,
        templateId: template.id,
        restaurantId: input.restaurantId,
        assetId: input.assetId || null,
        type: template.type,
        performedById: auth.userId,
      },
    })
    await copyStepsToInspection(tx, template.procedureId, ins.id)
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: input.restaurantId,
        actorId: auth.userId,
        action: 'inspection.started',
        entityType: 'INSPECTION',
        entityId: ins.id,
        newValue: { code, template: template.name },
      },
      req,
      tx,
    )
    return ins
  })
  return getInspection(auth, created.id)
}

export async function answerInspectionItem(
  auth: AuthContext,
  id: string,
  itemId: string,
  input: StepAnswerInput,
): Promise<InspectionDetail> {
  const detail = await getInspection(auth, id)
  if (!detail.can.answer) {
    if (detail.status === 'SUBMITTED') {
      throw new ConflictError(
        'This inspection has been submitted.',
        ERROR_CODES.INSPECTION_SUBMITTED,
      )
    }
    throw new ForbiddenError()
  }
  const item = detail.items.find((i) => i.id === itemId)
  if (!item) throw new NotFoundError('Inspection step')
  if (item.inputType === 'SECTION') throw new ValidationError({ result: ['validation.invalidValue'] })
  const v = evaluateAnswer(item, input, item.attachments.length > 0)
  await prisma.inspectionItem.update({
    where: { id: itemId },
    data: {
      result: v.result,
      numericValue: v.numericValue,
      textValue: v.textValue,
      note: input.note || null,
      completedAt: v.result ? new Date() : null,
    },
  })
  return getInspection(auth, id)
}

export async function submitInspection(
  auth: AuthContext,
  id: string,
  input: SubmitInspectionInput,
  req: Request,
): Promise<InspectionDetail> {
  const r = await load(auth, id)
  if (r.performedBy.id !== auth.userId) throw new ForbiddenError()
  if (r.status !== 'IN_PROGRESS') {
    throw new ConflictError('This inspection has been submitted.', ERROR_CODES.INSPECTION_SUBMITTED)
  }
  const items = await prisma.inspectionItem.findMany({ where: { inspectionId: id } })
  const photos = await stepPhotoCounts(
    'INSPECTION_ITEM',
    items.map((i) => i.id),
  )
  if (unanswered(items, photos) > 0) {
    throw new AppError(409, ERROR_CODES.CHECKLIST_INCOMPLETE, 'Finish all required steps first.')
  }
  const count = (res: string) => items.filter((i) => i.result === res).length
  const failed = items.filter((i) => i.result === 'FAIL')

  const corrective = await prisma.$transaction(async (tx) => {
    // Guarded: a double tap can't submit (and create follow-ups) twice.
    const done = await tx.inspection.updateMany({
      where: { id, status: 'IN_PROGRESS' },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        passCount: count('PASS'),
        failCount: failed.length,
        naCount: count('NA'),
        notes: input.notes || null,
      },
    })
    if (done.count === 0) {
      throw new ConflictError(
        'This inspection has been submitted.',
        ERROR_CODES.INSPECTION_SUBMITTED,
      )
    }
    const fixes: Array<{ id: string; code: string; title: string }> = []
    for (const item of failed) {
      const fix = await createCorrectiveWorkOrder(tx, {
        organizationId: auth.organizationId,
        restaurantId: r.restaurant.id,
        locationId: null,
        assetId: r.asset?.id ?? null,
        createdById: auth.userId,
        stepTitle: item.title,
        details: `${failureDetails(item)}\nFrom inspection ${r.code} · ${r.template.name}`,
        source: r.code,
      })
      await tx.inspectionItem.update({
        where: { id: item.id },
        data: { correctiveWorkOrderId: fix.id },
      })
      fixes.push(fix)
    }
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: r.restaurant.id,
        actorId: auth.userId,
        action: 'inspection.submitted',
        entityType: 'INSPECTION',
        entityId: id,
        newValue: { pass: count('PASS'), fail: failed.length, na: count('NA') },
      },
      req,
      tx,
    )
    return fixes
  })

  if (corrective.length > 0) {
    await notify(
      await usersWithPermission(auth.organizationId, r.restaurant.id, 'work_orders:assign'),
      {
        organizationId: auth.organizationId,
        type: 'INSPECTION_FAILED',
        title: `${r.code} · ${r.template.name}`,
        body: corrective
          .map((c) => `${c.code} ${c.title}`)
          .join('\n')
          .slice(0, 1000),
        entityType: 'INSPECTION',
        entityId: id,
        actionUrl: `/inspections/${id}`,
        priority: 'HIGH',
      },
      { exclude: auth.userId },
    )
    await runAutomations('INSPECTION_FAILED', {
      organizationId: auth.organizationId,
      restaurantId: r.restaurant.id,
      inspectionId: id,
      assetId: r.asset?.id ?? null,
      label: `${r.code} · ${r.template.name}`,
    })
  }
  return getInspection(auth, id)
}

/** A photo or signature for one inspection step (only the inspector, while open). */
export async function uploadInspectionStepAttachment(
  auth: AuthContext,
  id: string,
  itemId: string,
  files: Express.Multer.File[] | undefined,
  req: Request,
): Promise<InspectionDetail> {
  const detail = await getInspection(auth, id)
  if (!detail.can.answer) throw new ForbiddenError()
  const item = detail.items.find((i) => i.id === itemId)
  if (!item) throw new NotFoundError('Inspection step')
  if (item.inputType === 'SECTION') throw new ValidationError({ result: ['validation.invalidValue'] })
  const ids = await saveAttachments(files, { type: 'INSPECTION_ITEM', id: itemId }, auth.userId)
  // One signature per step: the new one replaces the old, once it's been accepted
  // (a rejected upload must not lose the signature already there).
  if (item.inputType === 'SIGNATURE')
    await prisma.attachment.deleteMany({
      where: { ownerType: 'INSPECTION_ITEM', ownerId: itemId, id: { notIn: ids } },
    })
  if ((item.inputType === 'PHOTO' || item.inputType === 'SIGNATURE') && item.result !== 'PASS') {
    await prisma.inspectionItem.update({
      where: { id: itemId },
      data: { result: 'PASS', completedAt: new Date() },
    })
  }
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: detail.restaurant.id,
      actorId: auth.userId,
      action: 'inspection.step_photo_added',
      entityType: 'INSPECTION',
      entityId: id,
      metadata: { attachmentIds: ids, step: item.title },
    },
    req,
  )
  return getInspection(auth, id)
}

/** Workers may delete their own unfinished inspection (started by mistake). */
export async function discardInspection(auth: AuthContext, id: string, req: Request) {
  const r = await load(auth, id)
  const allowed =
    r.status === 'IN_PROGRESS' &&
    (r.performedBy.id === auth.userId || hasPermission(auth, 'inspections:delete'))
  if (!allowed) throw new ForbiddenError()
  await prisma.inspection.delete({ where: { id } })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: r.restaurant.id,
      actorId: auth.userId,
      action: 'inspection.discarded',
      entityType: 'INSPECTION',
      entityId: id,
      oldValue: { code: r.code },
    },
    req,
  )
}

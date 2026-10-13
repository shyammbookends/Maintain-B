import {
  hiddenSteps,
  stepIsDone,
  type AttachmentDto,
  type AttachmentOwnerType,
  type ChecklistItemDto,
  type Priority,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { AuthContext } from '../modules/auth/auth.context.js'
import { canAccessRestaurant } from './authz.js'
import { nextCode } from './counters.js'
import { ValidationError } from './errors.js'
import { prisma } from './prisma.js'

/*
 * Procedures are step templates. Work orders and inspections get their own
 * copy of the steps when they are created, so editing a procedure later never
 * changes work that is already under way or on record.
 */

type Tx = Prisma.TransactionClient

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d))

/** Stored condition columns → { step, answer } (or null). */
export const conditionOf = (r: { showIfPosition: number | null; showIfAnswer: string | null }) =>
  r.showIfPosition && r.showIfAnswer ? { step: r.showIfPosition, answer: r.showIfAnswer } : null

/** A procedure the user may attach to work in `restaurantId` (global or same restaurant). */
export async function assertProcedureUsable(
  auth: AuthContext,
  procedureId: string,
  restaurantId: string,
  field = 'procedureId',
) {
  const p = await prisma.procedure.findFirst({
    where: { id: procedureId, organizationId: auth.organizationId, archivedAt: null },
    select: { restaurantId: true },
  })
  const ok =
    p &&
    (p.restaurantId === null || p.restaurantId === restaurantId) &&
    canAccessRestaurant(auth, restaurantId)
  if (!ok) throw new ValidationError({ [field]: ['validation.procedureNotAvailable'] })
}

async function procedureSteps(tx: Tx, procedureId: string) {
  return tx.procedureStep.findMany({ where: { procedureId }, orderBy: { position: 'asc' } })
}

const stepCopy = (s: Awaited<ReturnType<typeof procedureSteps>>[number]) => ({
  position: s.position,
  title: s.title,
  instruction: s.instruction,
  inputType: s.inputType,
  unit: s.unit,
  minValue: s.minValue,
  maxValue: s.maxValue,
  required: s.required,
  options: s.options,
  requirePhoto: s.requirePhoto,
  showIfPosition: s.showIfPosition,
  showIfAnswer: s.showIfAnswer,
})

export async function copyStepsToWorkOrder(tx: Tx, procedureId: string, workOrderId: string) {
  const steps = await procedureSteps(tx, procedureId)
  if (steps.length === 0) return
  await tx.workOrderChecklistItem.createMany({
    data: steps.map((s) => ({ ...stepCopy(s), workOrderId })),
  })
}

export async function copyStepsToInspection(tx: Tx, procedureId: string, inspectionId: string) {
  const steps = await procedureSteps(tx, procedureId)
  await tx.inspectionItem.createMany({
    data: steps.map((s) => ({ ...stepCopy(s), inspectionId })),
  })
  return steps.length
}

const person = { select: { id: true, firstName: true, lastName: true } } as const

export const checklistInclude = {
  completedBy: person,
  correctiveWorkOrder: { select: { id: true, code: true } },
} satisfies Prisma.WorkOrderChecklistItemInclude

type ItemRow = {
  id: string
  position: number
  title: string
  instruction: string | null
  inputType: ChecklistItemDto['inputType']
  unit: string | null
  minValue: Prisma.Decimal | null
  maxValue: Prisma.Decimal | null
  required: boolean
  options: string[]
  requirePhoto: boolean
  showIfPosition: number | null
  showIfAnswer: string | null
  result: ChecklistItemDto['result']
  numericValue: Prisma.Decimal | null
  textValue: string | null
  note: string | null
  completedAt: Date | null
  completedBy?: { id: string; firstName: string; lastName: string } | null
  correctiveWorkOrder: { id: string; code: string } | null
}

export function toChecklistDto(i: ItemRow, attachments: AttachmentDto[] = []): ChecklistItemDto {
  return {
    id: i.id,
    attachments,
    options: i.options,
    requirePhoto: i.requirePhoto,
    showIf: conditionOf(i),
    position: i.position,
    title: i.title,
    instruction: i.instruction,
    inputType: i.inputType,
    unit: i.unit,
    minValue: num(i.minValue),
    maxValue: num(i.maxValue),
    required: i.required,
    result: i.result,
    numericValue: num(i.numericValue),
    textValue: i.textValue,
    note: i.note,
    completedAt: i.completedAt?.toISOString() ?? null,
    completedBy: i.completedBy ?? null,
    correctiveWorkOrder: i.correctiveWorkOrder,
  }
}

/** Photos per checklist step (work-order steps or inspection items). */
export async function stepPhotoCounts(
  ownerType: Extract<AttachmentOwnerType, 'CHECKLIST_ITEM' | 'INSPECTION_ITEM'>,
  ids: string[],
  db: Tx | typeof prisma = prisma,
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const rows = await db.attachment.groupBy({
    by: ['ownerId'],
    where: { ownerType, ownerId: { in: ids } },
    _count: { _all: true },
  })
  return new Map(rows.map((r) => [r.ownerId, r._count._all]))
}

/**
 * Steps that still block submission: required steps without an answer, and
 * steps that need a photo but have none.
 */
export function unanswered(
  items: Array<{
    id?: string
    position?: number
    inputType?: ChecklistItemDto['inputType']
    required: boolean
    requirePhoto?: boolean
    result: ChecklistItemDto['result'] | string | null
    textValue?: string | null
    showIfPosition?: number | null
    showIfAnswer?: string | null
  }>,
  photos: Map<string, number> = new Map(),
) {
  // Steps hidden by their condition (and section headings) never block.
  const hidden = hiddenSteps(
    items
      .filter((i) => i.position !== undefined)
      .map((i) => ({
        position: i.position!,
        showIf: conditionOf({
          showIfPosition: i.showIfPosition ?? null,
          showIfAnswer: i.showIfAnswer ?? null,
        }),
        result: i.result as ChecklistItemDto['result'],
        textValue: i.textValue ?? null,
      })),
  )
  return items.filter(
    (i) =>
      !(i.position !== undefined && hidden.has(i.position)) &&
      !stepIsDone({
        inputType: i.inputType,
        required: i.required,
        requirePhoto: i.requirePhoto ?? false,
        result: i.result as ChecklistItemDto['result'],
        photoCount: i.id ? (photos.get(i.id) ?? 0) : 0,
      }),
  ).length
}

/**
 * Opens an unassigned follow-up work order for a failed step. Admins see it in
 * the "Unassigned" view and assign it like any other job.
 */
export async function createCorrectiveWorkOrder(
  tx: Tx,
  v: {
    organizationId: string
    restaurantId: string
    locationId: string | null
    assetId: string | null
    createdById: string
    stepTitle: string
    details: string
    source: string
    priority?: Priority
  },
): Promise<{ id: string; code: string; title: string }> {
  const code = await nextCode(tx, v.organizationId, 'WO', 6)
  const title = `Fix: ${v.stepTitle}`.slice(0, 120)
  const wo = await tx.workOrder.create({
    data: {
      organizationId: v.organizationId,
      code,
      title,
      description: v.details.slice(0, 5000),
      type: 'INSPECTION_FOLLOWUP',
      category: 'OTHER',
      priority: v.priority ?? 'HIGH',
      status: 'OPEN',
      restaurantId: v.restaurantId,
      locationId: v.locationId,
      assetId: v.assetId,
      createdById: v.createdById,
    },
    select: { id: true, code: true, title: true },
  })
  await tx.workOrderStatusHistory.create({
    data: { workOrderId: wo.id, toStatus: 'OPEN', actorId: v.createdById, note: v.source },
  })
  return wo
}

/** Human-readable summary of a failed answer for the corrective work order. */
export function failureDetails(i: {
  title: string
  inputType: string
  numericValue: Prisma.Decimal | number | null
  unit: string | null
  minValue: Prisma.Decimal | number | null
  maxValue: Prisma.Decimal | number | null
  note: string | null
}): string {
  const lines = [`Failed check: ${i.title}`]
  if (i.inputType === 'NUMBER' && i.numericValue !== null) {
    const range = [i.minValue, i.maxValue].map((x) => (x === null ? '–' : Number(x))).join(' to ')
    lines.push(`Reading: ${Number(i.numericValue)}${i.unit ? ` ${i.unit}` : ''} (allowed ${range})`)
  }
  if (i.note) lines.push(`Note: ${i.note}`)
  return lines.join('\n')
}

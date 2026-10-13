import {
  ERROR_CODES,
  WORK_ORDER_ACTIVE_STATUSES,
  addDays,
  addRepeat,
  WORK_ORDER_CANCELLABLE_STATUSES,
  WORK_ORDER_DONE_STATUSES,
  WORK_ORDER_REOPENABLE_STATUSES,
  WORK_ORDER_STARTABLE_STATUSES,
  canTransitionWorkOrder,
  evaluateAnswer,
  fullName,
  type RepeatRule,
  isWorkOrderOverdue,
  type AssigneeWorkload,
  type AssignWorkOrderInput,
  type CancelWorkOrderInput,
  type CompleteWorkOrderInput,
  type CreateWorkOrderInput,
  type HoldWorkOrderInput,
  type ManualTimeInput,
  type RescheduleWorkOrderInput,
  type UploadMeta,
  type ListWorkOrdersQuery,
  type MessageInput,
  type NotificationType,
  type PagedResponse,
  type Priority,
  type RejectWorkOrderInput,
  type ReopenWorkOrderInput,
  type StepAnswerInput,
  type ReservePartInput,
  type RootCauseInput,
  type RootCauseDto,
  type UseWorkOrderPartInput,
  type UpdateWorkOrderInput,
  type VerifyWorkOrderInput,
  type WorkOrderActions,
  type WorkOrderCostInput,
  type WorkOrderDetail,
  type WorkOrderListItem,
  type WorkOrderStatus,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { attachmentsOf, listAttachments, saveAttachments } from '../../core/attachments.js'
import { recordAudit } from '../../core/audit.js'
import {
  assertProcedureUsable,
  checklistInclude,
  copyStepsToWorkOrder,
  createCorrectiveWorkOrder,
  failureDetails,
  stepPhotoCounts,
  toChecklistDto,
  unanswered,
} from '../../core/checklist.js'
import { costBreakdown } from '../../core/costs.js'
import { runAutomations } from '../../core/automations.js'
import { completionPolicy } from '../../core/settings.js'
import { applyStockChange, notifyLowStock, round3 } from '../../core/stock.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
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
import { formatDateTimeInZone, startOfDateInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'
import { guestOf } from '../requests/requests.service.js'
import {
  assertLabels,
  labelSelect,
  resolveCustomValues,
  storedValues,
  toLabels,
} from '../../core/custom-fields.js'
import { changeAssetStatus } from '../assets/assets.service.js'

/*
 * The work order engine. Lifecycle (see WORK_ORDER_TRANSITIONS):
 *   DRAFT → OPEN → ASSIGNED / SCHEDULED → IN_PROGRESS ⇄ ON_HOLD → COMPLETED
 *   → REVIEW (pending verification) → VERIFIED → CLOSED,  with REOPENED and CANCELLED.
 * Every status change writes a history row (who, when, from, to, why) and an
 * audit record in the same transaction. OVERDUE is derived, never stored.
 */

type Tx = Prisma.TransactionClient

const person = { select: { id: true, firstName: true, lastName: true } } as const

const listInclude = {
  restaurant: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  asset: { select: { id: true, name: true, assetCode: true, status: true, publicId: true } },
  assignedUser: person,
  assignedTeam: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  helpers: { select: { userId: true } },
  children: { where: { archivedAt: null }, select: { status: true } },
  labels: { select: labelSelect },
  completion: { select: { confirmedById: true } },
} satisfies Prisma.WorkOrderInclude

type ListRow = Prisma.WorkOrderGetPayload<{ include: typeof listInclude }>

/** Asset conditions anyone completing a job may report. */
const COMPLETION_ASSET_STATUSES = ['OPERATIONAL', 'WARNING', 'UNDER_MAINTENANCE', 'BROKEN'] as const

const blank = (v: string) => (v === '' ? null : v)
const isoOrNull = (d: Date | null) => d?.toISOString() ?? null
const DONE = WORK_ORDER_DONE_STATUSES as readonly string[]
const ACTIVE = WORK_ORDER_ACTIVE_STATUSES as readonly string[]

function toListItem(w: ListRow, now = new Date()): WorkOrderListItem {
  const children = w.children.filter((c) => c.status !== 'CANCELLED')
  return {
    id: w.id,
    code: w.code,
    title: w.title,
    type: w.type,
    category: w.category,
    priority: w.priority,
    status: w.status,
    dueDate: isoOrNull(w.dueDate),
    scheduledStart: isoOrNull(w.scheduledStart),
    overdue: isWorkOrderOverdue(w, now),
    restaurant: w.restaurant,
    location: w.location,
    asset: w.asset ? { id: w.asset.id, name: w.asset.name, assetCode: w.asset.assetCode } : null,
    assignedUser: w.assignedUser,
    assignedTeam: w.assignedTeam,
    vendor: w.vendor,
    parentId: w.parentId,
    subProgress: {
      done: children.filter((c) => DONE.includes(c.status)).length,
      total: children.length,
    },
    labels: toLabels(w.labels),
    createdAt: w.createdAt.toISOString(),
  }
}

async function myTeamIds(userId: string): Promise<string[]> {
  const rows = await prisma.teamMember.findMany({
    where: { userId, team: { archivedAt: null } },
    select: { teamId: true },
  })
  return rows.map((r) => r.teamId)
}

const isWorkerKind = (auth: AuthContext) => auth.user.roleKind === 'WORKER'

/**
 * What the user may see: managers see every work order in their restaurants;
 * workers see published work assigned to them, that they help on, or (when
 * unclaimed) that is assigned to one of their teams.
 */
export async function visibleWhere(auth: AuthContext): Promise<Prisma.WorkOrderWhereInput> {
  const base: Prisma.WorkOrderWhereInput = {
    organizationId: auth.organizationId,
    archivedAt: null,
    restaurantId: restaurantScope(auth),
  }
  if (!isWorkerKind(auth)) return base
  const teams = await myTeamIds(auth.userId)
  return {
    ...base,
    status: { not: 'DRAFT' },
    OR: [
      { assignedUserId: auth.userId },
      { helpers: { some: { userId: auth.userId } } },
      ...(teams.length ? [{ assignedUserId: null, assignedTeamId: { in: teams } }] : []),
    ],
  }
}

async function loadVisible(auth: AuthContext, id: string): Promise<ListRow> {
  const w = await prisma.workOrder.findFirst({
    where: { AND: [await visibleWhere(auth), { id }] },
    include: listInclude,
  })
  if (!w) throw new NotFoundError('Work order')
  return w
}

/** Assignee, helper, or member of the assigned team while nobody has claimed it. */
async function isOwner(auth: AuthContext, w: ListRow) {
  if (w.assignedUserId === auth.userId) return true
  if (w.helpers.some((h) => h.userId === auth.userId)) return true
  if (w.assignedUserId === null && w.assignedTeamId)
    return (await myTeamIds(auth.userId)).includes(w.assignedTeamId)
  return false
}

async function computeActions(auth: AuthContext, w: ListRow): Promise<WorkOrderActions> {
  const owner = await isOwner(auth, w)
  const managerKind = !isWorkerKind(auth)
  const manager = managerKind && hasPermission(auth, 'work_orders:edit')
  const doer = owner || manager
  const canComplete = hasPermission(auth, 'work_orders:complete') || manager
  const canAssign = managerKind && hasPermission(auth, 'work_orders:assign')
  const approver = managerKind && hasPermission(auth, 'work_orders:approve')
  const closer = managerKind && hasPermission(auth, 'work_orders:close')
  const s = w.status
  const finished = s === 'CLOSED' || s === 'CANCELLED'
  return {
    edit: manager && !finished,
    publish: manager && s === 'DRAFT',
    assign: canAssign && (s === 'DRAFT' || ACTIVE.includes(s)),
    unassign: canAssign && (s === 'ASSIGNED' || s === 'SCHEDULED'),
    start: doer && (WORK_ORDER_STARTABLE_STATUSES as readonly string[]).includes(s),
    hold: doer && s === 'IN_PROGRESS',
    resume: doer && s === 'ON_HOLD',
    complete: doer && canComplete && s === 'IN_PROGRESS',
    // Four eyes: whoever completed the job can't sign it off (Super Admin may override).
    verify:
      approver &&
      s === 'REVIEW' &&
      (auth.isSuperAdmin || w.completion?.confirmedById !== auth.userId),
    reject: approver && s === 'REVIEW',
    reopen: approver && (WORK_ORDER_REOPENABLE_STATUSES as readonly string[]).includes(s),
    cancel: closer && (WORK_ORDER_CANCELLABLE_STATUSES as readonly string[]).includes(s),
    costs: manager && !finished,
    time: manager && !finished && s !== 'DRAFT',
    reschedule: canAssign && (s === 'DRAFT' || (ACTIVE.includes(s) && s !== 'IN_PROGRESS')),
    upload: (doer || hasPermission(auth, 'work_orders:edit')) && !finished,
    message: !finished,
    checklist: doer && s === 'IN_PROGRESS',
    // Workers record parts while working; managers can also correct them during review.
    parts:
      hasPermission(auth, 'parts:view') &&
      ((owner && (s === 'IN_PROGRESS' || s === 'ON_HOLD')) ||
        (manager && s !== 'DRAFT' && s !== 'OPEN' && !finished)),
    rca: manager && s !== 'DRAFT' && s !== 'OPEN' && s !== 'CANCELLED',
    internalNotes: managerKind && hasPermission(auth, 'work_orders:edit'),
    // Planners set stock aside before the job starts.
    reserve:
      manager &&
      hasPermission(auth, 'parts:view') &&
      !finished &&
      s !== 'COMPLETED' &&
      s !== 'REVIEW' &&
      s !== 'VERIFIED',
  }
}

const invalidTransition = () =>
  new ConflictError(
    'That action isn’t available in the current status.',
    ERROR_CODES.INVALID_TRANSITION,
  )

function assertTransition(from: WorkOrderStatus, to: WorkOrderStatus) {
  if (!canTransitionWorkOrder(from, to)) throw invalidTransition()
}

/** Does this (active) user work at the restaurant? Super Admins work everywhere. */
async function worksAt(organizationId: string, userId: string, restaurantId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId, archivedAt: null, status: 'ACTIVE' },
    select: {
      userRestaurants: { select: { restaurantId: true } },
      userRoles: { select: { role: { select: { systemKey: true } } } },
    },
  })
  return (
    !!user &&
    (user.userRoles.some((r) => r.role.systemKey === 'SUPER_ADMIN') ||
      user.userRestaurants.some((r) => r.restaurantId === restaurantId))
  )
}

interface RefValues {
  restaurantId: string
  locationId: string | null
  assetId: string | null
  assignedUserId?: string | null
  assignedTeamId?: string | null
  helperIds?: string[]
  vendorId?: string | null
  supervisorId?: string | null
}

/**
 * Validates restaurant scope and that every reference belongs to the work
 * order's restaurant (location, asset, assignee, team, helpers, supervisor).
 */
async function validateRefs(auth: AuthContext, v: RefValues) {
  if (!canAccessRestaurant(auth, v.restaurantId)) {
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  }
  const errors: Record<string, string[]> = {}
  const org = auth.organizationId
  const [restaurant, location, asset, team, vendor] = await Promise.all([
    prisma.restaurant.count({
      where: { id: v.restaurantId, organizationId: org, archivedAt: null },
    }),
    v.locationId
      ? prisma.location.findFirst({
          where: { id: v.locationId, archivedAt: null },
          select: { restaurantId: true },
        })
      : null,
    v.assetId
      ? prisma.asset.findFirst({
          where: { id: v.assetId, archivedAt: null },
          select: { restaurantId: true },
        })
      : null,
    v.assignedTeamId
      ? prisma.team.findFirst({
          where: { id: v.assignedTeamId, organizationId: org, archivedAt: null },
          select: { restaurantId: true },
        })
      : null,
    v.vendorId
      ? prisma.vendor.count({ where: { id: v.vendorId, organizationId: org, archivedAt: null } })
      : 1,
  ])
  if (!restaurant) errors.restaurantId = ['validation.invalidValue']
  if (v.locationId && location?.restaurantId !== v.restaurantId)
    errors.locationId = ['validation.locationNotInRestaurant']
  if (v.assetId && asset?.restaurantId !== v.restaurantId)
    errors.assetId = ['validation.assetNotInRestaurant']
  if (v.assignedUserId && !(await worksAt(org, v.assignedUserId, v.restaurantId)))
    errors.assignedUserId = ['validation.assigneeNotInRestaurant']
  if (
    v.assignedTeamId &&
    (!team || (team.restaurantId !== null && team.restaurantId !== v.restaurantId))
  ) {
    errors.assignedTeamId = ['validation.teamNotInRestaurant']
  }
  for (const helper of v.helperIds ?? []) {
    if (!(await worksAt(org, helper, v.restaurantId))) {
      errors.helperIds = ['validation.assigneeNotInRestaurant']
      break
    }
  }
  if (!vendor) errors.vendorId = ['validation.invalidValue']
  if (v.supervisorId) {
    const approvers = await usersWithPermission(org, v.restaurantId, 'work_orders:approve')
    if (!approvers.includes(v.supervisorId))
      errors.supervisorId = ['validation.supervisorNotAllowed']
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
}

async function writeHistory(
  tx: Tx,
  workOrderId: string,
  from: WorkOrderStatus | null,
  to: WorkOrderStatus,
  actorId: string,
  note?: string | null,
) {
  await tx.workOrderStatusHistory.create({
    data: { workOrderId, fromStatus: from, toStatus: to, actorId, note: note ?? null },
  })
}

async function stopTimer(tx: Tx, workOrderId: string, at: Date) {
  const open = await tx.workOrderTimeEntry.findMany({ where: { workOrderId, endedAt: null } })
  for (const e of open) {
    const minutes = Math.max(0, Math.round((at.getTime() - e.startedAt.getTime()) / 60_000))
    await tx.workOrderTimeEntry.update({ where: { id: e.id }, data: { endedAt: at, minutes } })
  }
}

function audit(
  auth: AuthContext,
  w: { id: string; restaurantId: string },
  action: string,
  extra: Partial<Parameters<typeof recordAudit>[0]> = {},
) {
  return {
    organizationId: auth.organizationId,
    restaurantId: w.restaurantId,
    actorId: auth.userId,
    action,
    entityType: 'WORK_ORDER' as const,
    entityId: w.id,
    ...extra,
  }
}

const woUrl = (id: string, forWorker: boolean) =>
  forWorker ? `/w/tasks/${id}` : `/work-orders/${id}`

/** Repeat rule → columns (null clears it). */
function repeatData(r: RepeatRule | null) {
  return r
    ? { repeatEvery: r.every, repeatUnit: r.unit, repeatBasis: r.basis }
    : { repeatEvery: null, repeatUnit: null, repeatBasis: null }
}

/**
 * A repeating job was finished: create its next occurrence (once; the unique
 * repeatedFromId makes a second call a no-op). The due date counts from this
 * job's due date (skipping dates already past) or from when it was completed.
 */
async function createNextRepeat(auth: AuthContext, id: string, req: Request) {
  const w = await prisma.workOrder.findUnique({
    where: { id },
    include: {
      helpers: { select: { userId: true } },
      checklistItems: { orderBy: { position: 'asc' } },
      repeatedBy: { select: { id: true } },
      labels: { select: { labelId: true } },
    },
  })
  if (!w || !w.repeatEvery || !w.repeatUnit || !w.repeatBasis || w.repeatedBy) return
  const rule = { every: w.repeatEvery, unit: w.repeatUnit }
  const now = new Date()
  let due: Date
  if (w.repeatBasis === 'COMPLETION') due = addRepeat(w.completedAt ?? now, rule)
  else {
    due = addRepeat(w.dueDate ?? w.createdAt, rule)
    for (let i = 0; due <= now && i < 1000; i++) due = addRepeat(due, rule)
  }
  // Keep the same lead time between planned start and due date.
  const scheduledStart =
    w.scheduledStart && w.dueDate
      ? new Date(due.getTime() - (w.dueDate.getTime() - w.scheduledStart.getTime()))
      : null
  const helperIds = w.helpers.map((h) => h.userId)
  const status = placedStatus({ ...w, scheduledStart })
  let next
  try {
    next = await prisma.$transaction(async (tx) => {
      const code = await nextCode(tx, w.organizationId, 'WO', 6)
      const created = await tx.workOrder.create({
        data: {
          organizationId: w.organizationId,
          code,
          title: w.title,
          description: w.description,
          type: w.type,
          category: w.category,
          restaurantId: w.restaurantId,
          locationId: w.locationId,
          assetId: w.assetId,
          priority: w.priority,
          status,
          assignedUserId: w.assignedUserId,
          assignedTeamId: w.assignedTeamId,
          scheduledStart,
          dueDate: due,
          estimatedMinutes: w.estimatedMinutes,
          vendorId: w.vendorId,
          supervisorId: w.supervisorId,
          procedureId: w.procedureId,
          createdById: w.createdById,
          repeatEvery: w.repeatEvery,
          repeatUnit: w.repeatUnit,
          repeatBasis: w.repeatBasis,
          repeatedFromId: w.id,
          customFields: w.customFields ?? {},
          ...(w.labels.length
            ? { labels: { createMany: { data: w.labels.map((l) => ({ labelId: l.labelId })) } } }
            : {}),
        },
      })
      if (helperIds.length)
        await tx.workOrderAssignment.createMany({
          data: helperIds.map((userId) => ({
            workOrderId: created.id,
            userId,
            addedById: auth.userId,
          })),
        })
      if (w.checklistItems.length)
        await tx.workOrderChecklistItem.createMany({
          data: w.checklistItems.map((c) => ({
            workOrderId: created.id,
            position: c.position,
            title: c.title,
            instruction: c.instruction,
            inputType: c.inputType,
            unit: c.unit,
            minValue: c.minValue,
            maxValue: c.maxValue,
            required: c.required,
            options: c.options,
            requirePhoto: c.requirePhoto,
            showIfPosition: c.showIfPosition,
            showIfAnswer: c.showIfAnswer,
          })),
        })
      await writeHistory(tx, created.id, null, 'OPEN', auth.userId, w.code)
      if (status !== 'OPEN') await writeHistory(tx, created.id, 'OPEN', status, auth.userId)
      await recordAudit(
        audit(auth, created, 'work_order.repeated', {
          newValue: { code, dueDate: due.toISOString(), repeatedFrom: w.code },
        }),
        req,
        tx,
      )
      return created
    })
  } catch (err) {
    // Someone else created it a moment ago.
    if ((err as { code?: string }).code === 'P2002') return
    throw err
  }
  await notify(await crew({ ...next, helperIds }), {
    organizationId: auth.organizationId,
    type: 'TASK_ASSIGNED',
    title: `${next.code} · ${next.title}`,
    body: null,
    entityType: 'WORK_ORDER',
    entityId: next.id,
    actionUrl: woUrl(next.id, true),
    priority: next.priority,
  })
}

/** Status a published work order lands in from its assignment and planned start. */
function placedStatus(v: {
  assignedUserId: string | null
  assignedTeamId: string | null
  scheduledStart: Date | null
}): WorkOrderStatus {
  if (!v.assignedUserId && !v.assignedTeamId) return 'OPEN'
  return v.scheduledStart ? 'SCHEDULED' : 'ASSIGNED'
}

/** Everyone doing the job: assignee (or the team when unclaimed) plus helpers. */
async function crew(w: {
  assignedUserId: string | null
  assignedTeamId: string | null
  helperIds?: string[]
}): Promise<string[]> {
  const ids = new Set<string>(w.helperIds ?? [])
  if (w.assignedUserId) ids.add(w.assignedUserId)
  else if (w.assignedTeamId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: w.assignedTeamId },
      select: { userId: true },
    })
    members.forEach((m) => ids.add(m.userId))
  }
  return [...ids]
}

async function notifyCrew(
  auth: AuthContext,
  w: { id: string; code: string; title: string; priority: Priority },
  recipients: string[],
  type: NotificationType,
  body?: string | null,
) {
  await notify(
    recipients,
    {
      organizationId: auth.organizationId,
      type,
      title: `${w.code} · ${w.title}`,
      body: body ?? null,
      entityType: 'WORK_ORDER',
      entityId: w.id,
      actionUrl: woUrl(w.id, true),
      priority: w.priority,
    },
    { exclude: auth.userId },
  )
}

async function notifyCritical(auth: AuthContext, w: ListRow | Prisma.WorkOrderGetPayload<object>) {
  if (w.priority !== 'CRITICAL') return
  await notify(
    await usersWithPermission(auth.organizationId, w.restaurantId, 'work_orders:assign'),
    {
      organizationId: auth.organizationId,
      type: 'CRITICAL_ISSUE',
      title: `${w.code} · ${w.title}`,
      entityType: 'WORK_ORDER',
      entityId: w.id,
      actionUrl: woUrl(w.id, false),
      priority: 'CRITICAL',
    },
    { exclude: auth.userId },
  )
}

/** A sub work order hangs off a top-level job in the same restaurant that is still going. */
async function validateParent(auth: AuthContext, parentId: string, restaurantId: string) {
  const parent = await prisma.workOrder.findFirst({
    where: { AND: [await visibleWhere(auth), { id: parentId }] },
    select: { restaurantId: true, parentId: true, status: true },
  })
  if (
    !parent ||
    parent.restaurantId !== restaurantId ||
    parent.parentId !== null ||
    parent.status === 'CLOSED' ||
    parent.status === 'CANCELLED'
  ) {
    throw new ValidationError({ parentId: ['validation.invalidParentWorkOrder'] })
  }
}

// ---------------------------------------------------------------------------

const SORT: Record<string, (d: Prisma.SortOrder) => Prisma.WorkOrderOrderByWithRelationInput> = {
  code: (d) => ({ code: d }),
  dueDate: (d) => ({ dueDate: { sort: d, nulls: 'last' } }),
  priority: (d) => ({ priority: d }),
  createdAt: (d) => ({ createdAt: d }),
  status: (d) => ({ status: d }),
}

export async function listWorkOrders(
  auth: AuthContext,
  q: ListWorkOrdersQuery,
): Promise<PagedResponse<WorkOrderListItem>> {
  if (q.restaurantId && !canAccessRestaurant(auth, q.restaurantId)) return toPagedResponse([], q, 0)
  const and: Prisma.WorkOrderWhereInput[] = [await visibleWhere(auth)]
  if (q.restaurantId) and.push({ restaurantId: q.restaurantId })
  if (q.status) and.push({ status: q.status })
  if (q.priority) and.push({ priority: q.priority })
  if (q.category) and.push({ category: q.category })
  if (q.type) and.push({ type: q.type })
  if (q.locationId) and.push({ locationId: q.locationId })
  if (q.assetId) and.push({ assetId: q.assetId })
  if (q.assignedUserId)
    and.push({
      OR: [
        { assignedUserId: q.assignedUserId },
        { helpers: { some: { userId: q.assignedUserId } } },
      ],
    })
  if (q.assignedTeamId) and.push({ assignedTeamId: q.assignedTeamId })
  if (q.vendorId) and.push({ vendorId: q.vendorId })
  if (q.parentId) and.push({ parentId: q.parentId })
  if (q.labelId) and.push({ labels: { some: { labelId: q.labelId } } })
  if (q.from || q.to) {
    // Calendar days of the organization (IST), not UTC days.
    const { timezone } = await prisma.organization.findUniqueOrThrow({
      where: { id: auth.organizationId },
      select: { timezone: true },
    })
    if (q.from) and.push({ createdAt: { gte: startOfDateInZone(timezone, q.from) } })
    if (q.to) and.push({ createdAt: { lt: startOfDateInZone(timezone, addDays(q.to, 1)) } })
  }
  const active = { status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } }
  if (q.view === 'active') and.push(active)
  if (q.view === 'overdue') and.push({ ...active, dueDate: { lt: new Date() } })
  if (q.view === 'review') and.push({ status: 'REVIEW' })
  if (q.view === 'scheduled') and.push({ status: 'SCHEDULED' })
  if (q.view === 'draft') and.push({ status: 'DRAFT' })
  if (q.view === 'done') and.push({ status: { in: [...WORK_ORDER_DONE_STATUSES] } })
  if (q.view === 'unassigned')
    and.push({ status: 'OPEN', assignedUserId: null, assignedTeamId: null })
  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: 'insensitive' } },
        { code: { contains: q.q, mode: 'insensitive' } },
        { asset: { name: { contains: q.q, mode: 'insensitive' } } },
        { asset: { assetCode: { contains: q.q, mode: 'insensitive' } } },
      ],
    })
  }
  const where = { AND: and }
  // Priority enum order is LOW…CRITICAL, so "desc" puts critical first.
  const sort = q.sort ?? { field: 'createdAt', direction: 'desc' as const }
  const [rows, total] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      include: listInclude,
      orderBy: [SORT[sort.field]!(sort.direction), { createdAt: 'desc' }],
      ...toSkipTake(q),
    }),
    prisma.workOrder.count({ where }),
  ])
  const now = new Date()
  return toPagedResponse(
    rows.map((r) => toListItem(r, now)),
    q,
    total,
  )
}

export async function getWorkOrder(auth: AuthContext, id: string): Promise<WorkOrderDetail> {
  const base = await loadVisible(auth, id)
  const w = await prisma.workOrder.findUniqueOrThrow({
    where: { id },
    include: {
      ...listInclude,
      createdBy: { select: { ...person.select, phone: true } },
      closedBy: person,
      verifiedBy: person,
      supervisor: { select: { ...person.select, phone: true } },
      restaurant: {
        select: {
          id: true,
          name: true,
          phone: true,
          manager: { select: { firstName: true, lastName: true, phone: true } },
        },
      },
      helpers: { include: { user: person }, orderBy: { addedAt: 'asc' } },
      parent: { select: { id: true, code: true, title: true, status: true } },
      repeatedFrom: { select: { id: true, code: true } },
      repeatedBy: { select: { id: true, code: true, dueDate: true } },
      children: {
        where: { archivedAt: null },
        select: { id: true, code: true, title: true, status: true, assignedUser: person },
        orderBy: { createdAt: 'asc' },
      },
      costs: {
        include: { vendor: { select: { id: true, name: true } }, createdBy: person },
        orderBy: { createdAt: 'asc' },
      },
      completion: { include: { confirmedBy: person } },
      sourceRequest: {
        select: {
          id: true,
          code: true,
          description: true,
          requestedBy: person,
          guestName: true,
          guestPhone: true,
        },
      },
      messages: {
        // Internal notes are for managers only.
        where: {
          deletedAt: null,
          ...(isWorkerKind(auth) || !hasPermission(auth, 'work_orders:edit')
            ? { internal: false }
            : {}),
        },
        include: { author: person },
        orderBy: { createdAt: 'asc' },
      },
      rootCause: {
        include: {
          createdBy: person,
          asset: { select: { id: true, name: true } },
        },
      },
      statusHistory: { include: { actor: person }, orderBy: { createdAt: 'desc' } },
      timeEntries: { include: { user: person }, orderBy: { startedAt: 'asc' } },
      procedure: { select: { id: true, name: true } },
      pmSchedule: { select: { id: true, name: true } },
      checklistItems: { include: checklistInclude, orderBy: { position: 'asc' } },
      parts: {
        include: { part: { select: { id: true, name: true, partNumber: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
      partReservations: {
        where: { status: 'ACTIVE' },
        include: {
          part: { select: { id: true, name: true, partNumber: true, unit: true } },
          createdBy: person,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  const stepIds = w.checklistItems.map((i) => i.id)
  const mentionIds = [...new Set(w.messages.flatMap((m) => m.mentionIds))]
  const [files, cost, policy, mentioned] = await Promise.all([
    listAttachments([
      { type: 'WORK_ORDER', id },
      ...(w.sourceRequest ? [{ type: 'REQUEST' as const, id: w.sourceRequest.id }] : []),
      ...stepIds.map((s) => ({ type: 'CHECKLIST_ITEM' as const, id: s })),
      ...w.messages.map((m) => ({ type: 'MESSAGE' as const, id: m.id })),
    ]),
    costBreakdown({ organizationId: auth.organizationId, workOrderId: id }),
    completionPolicy(auth.organizationId),
    mentionIds.length
      ? prisma.user.findMany({
          where: { id: { in: mentionIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
  ])
  const people = new Map(mentioned.map((u) => [u.id, u]))
  const now = Date.now()
  const minutesWorked = w.timeEntries.reduce(
    (sum, e) =>
      sum + (e.endedAt ? (e.minutes ?? 0) : Math.round((now - e.startedAt.getTime()) / 60_000)),
    0,
  )
  const attachments = attachmentsOf(files, 'WORK_ORDER', id)
  const evidence = { BEFORE: 0, DURING: 0, AFTER: 0 }
  for (const a of attachments) if (a.stage) evidence[a.stage]++
  const stepPhotos = new Map(
    stepIds.map((s) => [s, attachmentsOf(files, 'CHECKLIST_ITEM', s).length]),
  )
  const contacts: WorkOrderDetail['contacts'] = []
  if (w.restaurant.phone)
    contacts.push({ role: 'restaurant', name: w.restaurant.name, phone: w.restaurant.phone })
  if (w.restaurant.manager)
    contacts.push({
      role: 'manager',
      name: fullName(w.restaurant.manager),
      phone: w.restaurant.manager.phone,
    })
  if (w.supervisor)
    contacts.push({ role: 'supervisor', name: fullName(w.supervisor), phone: w.supervisor.phone })
  contacts.push({ role: 'creator', name: fullName(w.createdBy), phone: w.createdBy.phone })

  return {
    ...toListItem(base),
    description: w.description,
    customFields: storedValues(w.customFields),
    repeat:
      w.repeatEvery && w.repeatUnit && w.repeatBasis
        ? { every: w.repeatEvery, unit: w.repeatUnit, basis: w.repeatBasis }
        : null,
    repeatedFrom: w.repeatedFrom,
    repeatedBy: w.repeatedBy
      ? { id: w.repeatedBy.id, code: w.repeatedBy.code, dueDate: isoOrNull(w.repeatedBy.dueDate) }
      : null,
    estimatedMinutes: w.estimatedMinutes,
    minutesWorked,
    timerRunning: w.timeEntries.some((e) => e.endedAt === null),
    startedAt: isoOrNull(w.startedAt),
    completedAt: isoOrNull(w.completedAt),
    closedAt: isoOrNull(w.closedAt),
    verifiedAt: isoOrNull(w.verifiedAt),
    verifiedBy: w.verifiedBy,
    cancelledAt: isoOrNull(w.cancelledAt),
    cancelReason: w.cancelReason,
    rejectionReason: w.rejectionReason,
    holdReason: w.holdReason,
    completionNotes: w.completionNotes,
    reopenCount: w.reopenCount,
    createdBy: {
      id: w.createdBy.id,
      firstName: w.createdBy.firstName,
      lastName: w.createdBy.lastName,
    },
    closedBy: w.closedBy,
    supervisor: w.supervisor
      ? { id: w.supervisor.id, firstName: w.supervisor.firstName, lastName: w.supervisor.lastName }
      : null,
    helpers: w.helpers.map((h) => h.user),
    parent: w.parent,
    children: w.children,
    // Money stays with managers: labour cost ÷ logged minutes would reveal a
    // colleague's hourly rate to a User.
    cost: isWorkerKind(auth) ? { parts: 0, labour: 0, vendor: 0, other: 0, total: 0 } : cost,
    costLines: (isWorkerKind(auth) ? [] : w.costs).map((c) => ({
      id: c.id,
      type: c.type,
      description: c.description,
      amount: Number(c.amount),
      vendor: c.vendor,
      createdBy: c.createdBy,
      createdAt: c.createdAt.toISOString(),
    })),
    completion: w.completion
      ? {
          problemFound: w.completion.problemFound,
          rootCause: w.completion.rootCause,
          workPerformed: w.completion.workPerformed,
          newPartsInstalled: w.completion.newPartsInstalled,
          oldPartsRemoved: w.completion.oldPartsRemoved,
          quantityRepaired: w.completion.quantityRepaired,
          quantityReplaced: w.completion.quantityReplaced,
          additionalMaterials: w.completion.additionalMaterials,
          additionalIssue: w.completion.additionalIssue,
          recommendation: w.completion.recommendation,
          finalCondition: w.completion.finalCondition,
          noPartsUsed: w.completion.noPartsUsed,
          labourMinutes: w.completion.labourMinutes,
          confirmedBy: w.completion.confirmedBy,
          confirmedAt: w.completion.confirmedAt.toISOString(),
        }
      : null,
    completionCheck: {
      stepsLeft: unanswered(w.checklistItems, stepPhotos),
      needsBeforePhoto: policy.requireBeforePhoto && evidence.BEFORE === 0,
      needsAfterPhoto: policy.requireAfterPhoto && evidence.AFTER === 0,
      reportRequired: policy.requireRepairReport,
      verificationRequired: policy.requireVerification,
      subWorkOrdersOpen: w.children.filter((c) => ACTIVE.includes(c.status) || c.status === 'DRAFT')
        .length,
      evidence,
    },
    timeEntries: w.timeEntries.map((e) => ({
      id: e.id,
      user: e.user,
      startedAt: e.startedAt.toISOString(),
      endedAt: isoOrNull(e.endedAt),
      minutes: e.minutes,
      manual: e.manual,
      note: e.note,
    })),
    contacts,
    asset: w.asset,
    procedure: w.procedure,
    pmSchedule: w.pmSchedule,
    checklist: w.checklistItems.map((i) =>
      toChecklistDto(i, attachmentsOf(files, 'CHECKLIST_ITEM', i.id)),
    ),
    parts: w.parts.map((p) => ({
      id: p.id,
      part: p.part,
      qtyUsed: Number(p.qtyUsed),
      unitCost: p.unitCostSnapshot === null ? null : Number(p.unitCostSnapshot),
      condition: p.condition,
    })),
    reservations: w.partReservations.map((r) => ({
      id: r.id,
      part: r.part,
      quantity: Number(r.quantity),
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    })),
    sourceRequest: w.sourceRequest
      ? {
          id: w.sourceRequest.id,
          code: w.sourceRequest.code,
          description: w.sourceRequest.description,
          requestedBy: w.sourceRequest.requestedBy,
          guest: guestOf(w.sourceRequest),
          attachments: attachmentsOf(files, 'REQUEST', w.sourceRequest.id),
        }
      : null,
    attachments,
    messages: w.messages.map((m) => ({
      id: m.id,
      body: m.body,
      author: m.author,
      createdAt: m.createdAt.toISOString(),
      mine: m.authorId === auth.userId,
      parentId: m.parentId,
      internal: m.internal,
      mentions: m.mentionIds.flatMap((u) => (people.has(u) ? [people.get(u)!] : [])),
      attachments: attachmentsOf(files, 'MESSAGE', m.id),
    })),
    rootCause: w.rootCause ? toRootCause(w.rootCause, w) : null,
    history: w.statusHistory.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      actor: h.actor,
      note: h.note,
      createdAt: h.createdAt.toISOString(),
    })),
    actions: await computeActions(auth, base),
  }
}

export async function createWorkOrder(
  auth: AuthContext,
  input: CreateWorkOrderInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const helperIds = [...new Set(input.helperIds ?? [])]
  const data = {
    title: input.title,
    description: blank(input.description),
    category: input.category,
    priority: input.priority,
    type: input.type ?? 'REACTIVE',
    restaurantId: input.restaurantId,
    locationId: blank(input.locationId),
    assetId: blank(input.assetId),
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
    estimatedMinutes: input.estimatedMinutes ?? null,
    assignedUserId: blank(input.assignedUserId),
    assignedTeamId: blank(input.assignedTeamId),
    vendorId: input.vendorId ? input.vendorId : null,
    supervisorId: input.supervisorId ? input.supervisorId : null,
    parentId: input.parentId ? input.parentId : null,
    ...repeatData(input.repeat ?? null),
  }
  const assigning = !!(data.assignedUserId || data.assignedTeamId || helperIds.length)
  if (assigning && !hasPermission(auth, 'work_orders:assign')) throw new ForbiddenError()
  await validateRefs(auth, { ...data, helperIds })
  if (data.parentId) await validateParent(auth, data.parentId, data.restaurantId)
  const procedureId = input.procedureId || null
  if (procedureId) await assertProcedureUsable(auth, procedureId, data.restaurantId)
  const customFields = await resolveCustomValues(
    auth.organizationId,
    'WORK_ORDER',
    input.customFields ?? {},
  )
  const labelIds = await assertLabels(auth.organizationId, input.labelIds ?? [])

  const request = input.requestId
    ? await prisma.request.findFirst({
        where: {
          id: input.requestId,
          organizationId: auth.organizationId,
          restaurantId: restaurantScope(auth),
        },
      })
    : null
  if (input.requestId) {
    if (!request) throw new NotFoundError('Request')
    if (!hasPermission(auth, 'requests:approve')) throw new ForbiddenError()
    // The job is for the place the problem was reported.
    if (request.restaurantId !== data.restaurantId)
      throw new ValidationError({ restaurantId: ['validation.invalidValue'] })
    if (request.status !== 'NEW' && request.status !== 'APPROVED') {
      throw new ConflictError(
        'This request has already been handled.',
        ERROR_CODES.ALREADY_CONVERTED,
      )
    }
  }

  const draft = input.asDraft === true
  const status: WorkOrderStatus = draft ? 'DRAFT' : placedStatus(data)
  const wo = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, auth.organizationId, 'WO', 6)
    const created = await tx.workOrder.create({
      data: {
        ...data,
        procedureId,
        organizationId: auth.organizationId,
        code,
        status,
        createdById: auth.userId,
        customFields,
        ...(labelIds.length
          ? { labels: { createMany: { data: labelIds.map((labelId) => ({ labelId })) } } }
          : {}),
      },
    })
    if (helperIds.length) {
      await tx.workOrderAssignment.createMany({
        data: helperIds.map((userId) => ({
          workOrderId: created.id,
          userId,
          addedById: auth.userId,
        })),
      })
    }
    if (procedureId) await copyStepsToWorkOrder(tx, procedureId, created.id)
    const first: WorkOrderStatus = draft ? 'DRAFT' : 'OPEN'
    await writeHistory(tx, created.id, null, first, auth.userId, request ? request.code : null)
    if (status !== first) await writeHistory(tx, created.id, first, status, auth.userId)
    if (request) {
      // Guarded update: a concurrent conversion can't create a second work order.
      const done = await tx.request.updateMany({
        where: { id: request.id, status: { in: ['NEW', 'APPROVED'] } },
        data: {
          status: 'CONVERTED',
          convertedWorkOrderId: created.id,
          reviewedById: auth.userId,
          reviewedAt: new Date(),
        },
      })
      if (done.count === 0)
        throw new ConflictError(
          'This request has already been handled.',
          ERROR_CODES.ALREADY_CONVERTED,
        )
    }
    await recordAudit(
      audit(auth, created, 'work_order.created', {
        newValue: {
          code,
          title: data.title,
          priority: data.priority,
          status,
          fromRequest: request?.code ?? null,
          parentId: data.parentId,
        },
      }),
      req,
      tx,
    )
    return created
  })

  if (!draft) {
    await notifyCrew(auth, wo, await crew({ ...wo, helperIds }), 'TASK_ASSIGNED')
    await notifyCritical(auth, wo)
    await runAutomations('WORK_ORDER_CREATED', {
      organizationId: auth.organizationId,
      restaurantId: wo.restaurantId,
      workOrderId: wo.id,
      assetId: wo.assetId,
      priority: wo.priority,
      category: wo.category,
      type: wo.type,
      label: `${wo.code} · ${wo.title}`,
    })
  }
  if (request?.requestedById) {
    await notify(
      [request.requestedById],
      {
        organizationId: auth.organizationId,
        type: 'REQUEST_APPROVED',
        title: `${request.code} · ${request.title}`,
        body: wo.code,
        entityType: 'REQUEST',
        entityId: request.id,
        actionUrl: '/w/reports',
      },
      { exclude: auth.userId },
    )
  }
  return getWorkOrder(auth, wo.id)
}

/** DRAFT → OPEN / ASSIGNED / SCHEDULED, and tell the people doing it. */
export async function publishWorkOrder(auth: AuthContext, id: string, req: Request) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).publish) throw new ForbiddenError()
  const to = placedStatus(w)
  await transition(auth, w, to, req, { action: 'work_order.published' })
  await notifyCrew(
    auth,
    w,
    await crew({ ...w, helperIds: w.helpers.map((h) => h.userId) }),
    'TASK_ASSIGNED',
  )
  await notifyCritical(auth, w)
  return getWorkOrder(auth, id)
}

export async function updateWorkOrder(
  auth: AuthContext,
  id: string,
  input: UpdateWorkOrderInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const before = await loadVisible(auth, id)
  if (!(await computeActions(auth, before)).edit) throw new ForbiddenError()
  const data = {
    title: input.title,
    description: blank(input.description),
    category: input.category,
    priority: input.priority,
    restaurantId: input.restaurantId,
    locationId: blank(input.locationId),
    assetId: blank(input.assetId),
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    estimatedMinutes: input.estimatedMinutes ?? null,
    ...(input.scheduledStart !== undefined
      ? { scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null }
      : {}),
    ...(input.vendorId !== undefined ? { vendorId: input.vendorId || null } : {}),
    ...(input.supervisorId !== undefined ? { supervisorId: input.supervisorId || null } : {}),
    ...(input.repeat !== undefined ? repeatData(input.repeat) : {}),
  }
  // Moving restaurants would invalidate the assignee; reassign instead.
  if (
    data.restaurantId !== before.restaurantId &&
    (before.assignedUserId || before.assignedTeamId || before.helpers.length)
  ) {
    throw new ValidationError({ restaurantId: ['validation.unassignBeforeMove'] })
  }
  if (data.restaurantId !== before.restaurantId && (before.parentId || before.children.length)) {
    throw new ValidationError({ restaurantId: ['validation.invalidValue'] })
  }
  if (data.restaurantId !== before.restaurantId) {
    // Reserved or used stock belongs to the old restaurant's store.
    const [reserved, used] = await Promise.all([
      prisma.partReservation.count({ where: { workOrderId: id, status: 'ACTIVE' } }),
      prisma.workOrderPart.count({ where: { workOrderId: id } }),
    ])
    if (reserved || used) throw new ValidationError({ restaurantId: ['validation.invalidValue'] })
  }
  await validateRefs(auth, data)
  const customFields = await resolveCustomValues(
    auth.organizationId,
    'WORK_ORDER',
    input.customFields,
  )
  const labelIds =
    input.labelIds === undefined ? undefined : await assertLabels(auth.organizationId, input.labelIds)

  // Setting or clearing the planned start moves ASSIGNED ⇄ SCHEDULED.
  const scheduledStart =
    'scheduledStart' in data ? (data.scheduledStart ?? null) : before.scheduledStart
  let nextStatus: WorkOrderStatus = before.status
  if (before.status === 'ASSIGNED' && scheduledStart) nextStatus = 'SCHEDULED'
  if (before.status === 'SCHEDULED' && !scheduledStart) nextStatus = 'ASSIGNED'

  await prisma.$transaction(async (tx) => {
    const done = await tx.workOrder.updateMany({
      where: { id, status: before.status },
      data: { ...data, status: nextStatus, ...(customFields ? { customFields } : {}) },
    })
    if (done.count === 0) throw invalidTransition()
    if (labelIds) {
      await tx.workOrderLabel.deleteMany({ where: { workOrderId: id } })
      if (labelIds.length)
        await tx.workOrderLabel.createMany({
          data: labelIds.map((labelId) => ({ workOrderId: id, labelId })),
        })
    }
    if (nextStatus !== before.status)
      await writeHistory(tx, id, before.status, nextStatus, auth.userId)
    await recordAudit(
      audit(auth, { id, restaurantId: data.restaurantId }, 'work_order.updated', {
        oldValue: {
          title: before.title,
          priority: before.priority,
          dueDate: isoOrNull(before.dueDate),
          scheduledStart: isoOrNull(before.scheduledStart),
          vendorId: before.vendorId,
          supervisorId: before.supervisorId,
        },
        newValue: {
          title: data.title,
          priority: data.priority,
          dueDate: isoOrNull(data.dueDate),
          scheduledStart: isoOrNull(scheduledStart),
          vendorId: 'vendorId' in data ? data.vendorId : before.vendorId,
          supervisorId: 'supervisorId' in data ? data.supervisorId : before.supervisorId,
        },
      }),
      req,
      tx,
    )
  })
  if (before.priority !== 'CRITICAL' && data.priority === 'CRITICAL' && before.status !== 'DRAFT')
    await notifyCritical(auth, { ...before, priority: 'CRITICAL' })
  return getWorkOrder(auth, id)
}

/**
 * (Re)assigns the job: one person and/or a team, optional helpers and planned
 * start. OPEN/ASSIGNED/SCHEDULED settle on ASSIGNED or SCHEDULED; work already
 * under way keeps its status (that is a reassignment).
 */
export async function assignWorkOrder(
  auth: AuthContext,
  id: string,
  input: AssignWorkOrderInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).assign) throw new ForbiddenError()
  const assignedUserId = blank(input.assignedUserId)
  const assignedTeamId = blank(input.assignedTeamId)
  const helperIds =
    input.helperIds === undefined
      ? w.helpers.map((h) => h.userId)
      : [...new Set(input.helperIds)].filter((h) => h !== assignedUserId)
  const scheduledStart =
    input.scheduledStart === undefined
      ? w.scheduledStart
      : input.scheduledStart
        ? new Date(input.scheduledStart)
        : null
  await validateRefs(auth, {
    restaurantId: w.restaurantId,
    locationId: null,
    assetId: null,
    assignedUserId,
    assignedTeamId,
    helperIds,
  })
  const settles = w.status === 'OPEN' || w.status === 'ASSIGNED' || w.status === 'SCHEDULED'
  const next: WorkOrderStatus = settles
    ? placedStatus({ assignedUserId, assignedTeamId, scheduledStart })
    : w.status
  const before = await crew({ ...w, helperIds: w.helpers.map((h) => h.userId) })

  await prisma.$transaction(async (tx) => {
    const done = await tx.workOrder.updateMany({
      where: { id, status: w.status },
      data: { assignedUserId, assignedTeamId, scheduledStart, status: next },
    })
    if (done.count === 0) throw invalidTransition()
    if (input.helperIds !== undefined) {
      await tx.workOrderAssignment.deleteMany({ where: { workOrderId: id } })
      if (helperIds.length) {
        await tx.workOrderAssignment.createMany({
          data: helperIds.map((userId) => ({ workOrderId: id, userId, addedById: auth.userId })),
        })
      }
    }
    if (next !== w.status) await writeHistory(tx, id, w.status, next, auth.userId)
    await recordAudit(
      audit(auth, w, 'work_order.assigned', {
        oldValue: {
          assignedUserId: w.assignedUserId,
          assignedTeamId: w.assignedTeamId,
          helperIds: w.helpers.map((h) => h.userId),
          scheduledStart: isoOrNull(w.scheduledStart),
        },
        newValue: {
          assignedUserId,
          assignedTeamId,
          helperIds,
          scheduledStart: isoOrNull(scheduledStart),
        },
      }),
      req,
      tx,
    )
  })
  if (w.status !== 'DRAFT') {
    // Only newcomers hear about it.
    const after = await crew({ assignedUserId, assignedTeamId, helperIds })
    const fresh = after.filter((u) => !before.includes(u))
    await notifyCrew(auth, w, fresh, 'TASK_ASSIGNED')
    const removed = before.filter((u) => !after.includes(u))
    await notifyCrew(auth, w, removed, 'WORK_REASSIGNED')
  }
  return getWorkOrder(auth, id)
}

export async function unassignWorkOrder(
  auth: AuthContext,
  id: string,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).unassign) throw new ForbiddenError()
  assertTransition(w.status, 'OPEN')
  await prisma.$transaction(async (tx) => {
    const done = await tx.workOrder.updateMany({
      where: { id, status: w.status },
      data: { assignedUserId: null, assignedTeamId: null, status: 'OPEN' },
    })
    if (done.count === 0) throw invalidTransition()
    await tx.workOrderAssignment.deleteMany({ where: { workOrderId: id } })
    await writeHistory(tx, id, w.status, 'OPEN', auth.userId)
    await recordAudit(audit(auth, w, 'work_order.unassigned'), req, tx)
  })
  return getWorkOrder(auth, id)
}

/** Assignable people for a restaurant with their current open work, busiest last. */
export async function assigneeWorkload(
  auth: AuthContext,
  restaurantId: string,
): Promise<AssigneeWorkload[]> {
  if (!hasPermission(auth, 'work_orders:assign')) throw new ForbiddenError()
  if (!canAccessRestaurant(auth, restaurantId)) throw new NotFoundError('Restaurant')
  const users = await prisma.user.findMany({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      status: 'ACTIVE',
      userRestaurants: { some: { restaurantId } },
      userRoles: {
        some: {
          role: { rolePermissions: { some: { permission: { key: 'work_orders:complete' } } } },
        },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      teamMemberships: {
        where: { team: { archivedAt: null } },
        select: { team: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 200,
  })
  const ids = users.map((u) => u.id)
  const open = await prisma.workOrder.findMany({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      status: { in: [...WORK_ORDER_ACTIVE_STATUSES] },
      OR: [{ assignedUserId: { in: ids } }, { helpers: { some: { userId: { in: ids } } } }],
    },
    select: {
      assignedUserId: true,
      status: true,
      dueDate: true,
      estimatedMinutes: true,
      helpers: { select: { userId: true } },
    },
  })
  const now = new Date()
  const rows = users.map<AssigneeWorkload>((u) => {
    const mine = open.filter(
      (w) => w.assignedUserId === u.id || w.helpers.some((h) => h.userId === u.id),
    )
    return {
      user: { id: u.id, firstName: u.firstName, lastName: u.lastName },
      teams: u.teamMemberships.map((m) => m.team),
      openCount: mine.length,
      overdueCount: mine.filter((w) => isWorkOrderOverdue(w, now)).length,
      inProgressCount: mine.filter((w) => w.status === 'IN_PROGRESS').length,
      plannedMinutes: mine.reduce((s, w) => s + (w.estimatedMinutes ?? 0), 0),
    }
  })
  return rows.sort((a, b) => a.openCount - b.openCount || a.overdueCount - b.overdueCount)
}

/**
 * Applies a status change with its side effects. The update is guarded on the
 * current status, so two people pressing a button at once can't both win.
 */
async function transition(
  auth: AuthContext,
  w: ListRow,
  to: WorkOrderStatus,
  req: Request,
  opts: {
    data?: Prisma.WorkOrderUncheckedUpdateInput
    note?: string | null
    action: string
    effects?: (tx: Tx, at: Date) => Promise<void>
  },
) {
  assertTransition(w.status, to)
  const at = new Date()
  await prisma.$transaction(async (tx) => {
    const done = await tx.workOrder.updateMany({
      where: { id: w.id, status: w.status },
      data: { status: to, ...opts.data },
    })
    if (done.count === 0) throw invalidTransition()
    await writeHistory(tx, w.id, w.status, to, auth.userId, opts.note)
    await opts.effects?.(tx, at)
    await recordAudit(
      audit(auth, w, opts.action, {
        oldValue: { status: w.status },
        newValue: { status: to },
        metadata: opts.note ? { note: opts.note } : undefined,
      }),
      req,
      tx,
    )
  })
}

export async function startWorkOrder(auth: AuthContext, id: string, req: Request) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).start) throw new ForbiddenError()
  // A team member who starts an unclaimed team task takes it over.
  const claim =
    w.assignedUserId === null && isWorkerKind(auth) ? { assignedUserId: auth.userId } : {}
  await transition(auth, w, 'IN_PROGRESS', req, {
    action: 'work_order.started',
    data: { ...claim, startedAt: w.startedAt ? undefined : new Date(), holdReason: null },
    effects: async (tx, at) => {
      await tx.workOrderTimeEntry.create({
        data: { workOrderId: id, userId: auth.userId, startedAt: at },
      })
    },
  })
  // The person who raised it and the supervisor hear that work has begun.
  await notify(
    [w.createdById, ...(w.supervisorId ? [w.supervisorId] : [])],
    {
      organizationId: auth.organizationId,
      type: 'WORK_STARTED',
      title: `${w.code} · ${w.title}`,
      body: `${auth.user.firstName} ${auth.user.lastName}`,
      entityType: 'WORK_ORDER',
      entityId: id,
      actionUrl: woUrl(id, false),
      priority: w.priority,
    },
    { exclude: auth.userId },
  )
  return getWorkOrder(auth, id)
}

export async function holdWorkOrder(
  auth: AuthContext,
  id: string,
  input: HoldWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).hold) throw new ForbiddenError()
  await transition(auth, w, 'ON_HOLD', req, {
    action: 'work_order.on_hold',
    note: input.reason,
    data: { holdReason: input.reason },
    effects: (tx, at) => stopTimer(tx, id, at),
  })
  return getWorkOrder(auth, id)
}

export async function resumeWorkOrder(auth: AuthContext, id: string, req: Request) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).resume) throw new ForbiddenError()
  await transition(auth, w, 'IN_PROGRESS', req, {
    action: 'work_order.resumed',
    data: { holdReason: null },
    effects: async (tx, at) => {
      await tx.workOrderTimeEntry.create({
        data: { workOrderId: id, userId: auth.userId, startedAt: at },
      })
    },
  })
  return getWorkOrder(auth, id)
}

const subWorkOrdersOpen = () =>
  new AppError(409, ERROR_CODES.SUB_WORK_ORDERS_OPEN, 'Finish or cancel the sub work orders first.')

/** Technician submits the job: COMPLETED, then straight into REVIEW (pending verification). */
export async function completeWorkOrder(
  auth: AuthContext,
  id: string,
  input: CompleteWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).complete) throw new ForbiddenError()
  if (input.assetStatus && !w.asset)
    throw new ValidationError({ assetStatus: ['validation.invalidValue'] })
  if (w.children.some((c) => ACTIVE.includes(c.status) || c.status === 'DRAFT'))
    throw subWorkOrdersOpen()
  const items = await prisma.workOrderChecklistItem.findMany({ where: { workOrderId: id } })
  const photos = await stepPhotoCounts(
    'CHECKLIST_ITEM',
    items.map((i) => i.id),
  )
  if (unanswered(items, photos) > 0) {
    throw new AppError(
      409,
      ERROR_CODES.CHECKLIST_INCOMPLETE,
      'Finish all required checklist steps first.',
    )
  }
  // Completing a job reports the asset's condition; retiring it or taking it
  // out of service stays with people who manage assets.
  if (
    input.assetStatus &&
    !hasPermission(auth, 'assets:edit') &&
    !(COMPLETION_ASSET_STATUSES as readonly string[]).includes(input.assetStatus)
  )
    throw new ValidationError({ assetStatus: ['validation.invalidValue'] })
  // Evidence: the policy decides which photos are mandatory.
  const [policy, evidence, partLines] = await Promise.all([
    completionPolicy(auth.organizationId),
    prisma.attachment.groupBy({
      by: ['stage'],
      where: { ownerType: 'WORK_ORDER', ownerId: id, stage: { not: null } },
      _count: { _all: true },
    }),
    prisma.workOrderPart.count({ where: { workOrderId: id } }),
  ])
  const has = (stage: 'BEFORE' | 'AFTER') => evidence.some((e) => e.stage === stage)
  const missing = [
    ...(policy.requireBeforePhoto && !has('BEFORE') ? ['BEFORE'] : []),
    ...(policy.requireAfterPhoto && !has('AFTER') ? ['AFTER'] : []),
  ]
  if (missing.length > 0) {
    throw new AppError(
      409,
      ERROR_CODES.EVIDENCE_REQUIRED,
      'Take the before and after photos first.',
      { details: { missing } },
    )
  }
  if (policy.requireRepairReport) {
    // The full report: what was found, what was done, the result, a confirmation,
    // and parts either recorded on the job or explicitly "none needed".
    const errors: Record<string, string[]> = {}
    if (!input.problemFound) errors.problemFound = ['validation.required']
    if (!input.workPerformed) errors.workPerformed = ['validation.required']
    if (!input.finalCondition) errors.finalCondition = ['validation.required']
    if (input.confirmed !== true) errors.confirmed = ['validation.confirmRequired']
    if (partLines === 0 && !input.noPartsUsed) errors.noPartsUsed = ['validation.partsInfoRequired']
    if (Object.keys(errors).length) throw new ValidationError(errors)
  }
  // One-tap completion (MaintainX default): sensible values for the record.
  const problemFound = input.problemFound || w.title
  const workPerformed = input.workPerformed || input.notes || 'Completed'
  const finalCondition = input.finalCondition ?? 'FULLY_WORKING'
  const notes = input.notes || input.workPerformed || null
  // With verification off the job is done straight away.
  const finalStatus: WorkOrderStatus = policy.requireVerification ? 'REVIEW' : 'CLOSED'
  const corrective: Array<{ id: string; code: string; title: string }> = []

  await transition(auth, w, 'COMPLETED', req, {
    action: 'work_order.completed',
    note: notes,
    data: { completedAt: new Date(), completionNotes: notes, rejectionReason: null },
    effects: async (tx, at) => {
      await stopTimer(tx, id, at)
      const entries = await tx.workOrderTimeEntry.findMany({
        where: { workOrderId: id },
        select: { minutes: true },
      })
      const labourMinutes = entries.reduce((s, e) => s + (e.minutes ?? 0), 0)
      await tx.workOrder.update({
        where: { id },
        data: {
          status: finalStatus,
          actualMinutes: labourMinutes,
          ...(finalStatus === 'CLOSED' ? { closedAt: at, closedById: auth.userId } : {}),
        },
      })
      const report = {
        problemFound,
        rootCause: input.rootCause || null,
        workPerformed,
        newPartsInstalled: input.newPartsInstalled || null,
        oldPartsRemoved: input.oldPartsRemoved || null,
        quantityRepaired: input.quantityRepaired ?? null,
        quantityReplaced: input.quantityReplaced ?? null,
        additionalMaterials: input.additionalMaterials || null,
        additionalIssue: input.additionalIssue || null,
        recommendation: input.recommendation || null,
        finalCondition,
        noPartsUsed: partLines === 0,
        labourMinutes,
        confirmedById: auth.userId,
        confirmedAt: at,
      }
      await tx.workOrderCompletion.upsert({
        where: { workOrderId: id },
        create: { workOrderId: id, ...report },
        update: report,
      })
      await writeHistory(tx, id, 'COMPLETED', finalStatus, auth.userId)
      // Whatever was reserved and not used goes back to the shelf.
      await releaseReservations(tx, id, at)
      // Every failed step gets its own follow-up job.
      for (const item of items.filter((i) => i.result === 'FAIL' && !i.correctiveWorkOrderId)) {
        const fix = await createCorrectiveWorkOrder(tx, {
          organizationId: auth.organizationId,
          restaurantId: w.restaurantId,
          locationId: w.locationId,
          assetId: w.assetId,
          createdById: auth.userId,
          stepTitle: item.title,
          details: `${failureDetails(item)}
From ${w.code} · ${w.title}`,
          source: w.code,
        })
        await tx.workOrderChecklistItem.update({
          where: { id: item.id },
          data: { correctiveWorkOrderId: fix.id },
        })
        corrective.push(fix)
      }
      if (w.asset) {
        await tx.assetHistory.create({
          data: {
            assetId: w.asset.id,
            eventType: 'WORK_ORDER_COMPLETED',
            workOrderId: id,
            actorId: auth.userId,
            newValue: {
              code: w.code,
              title: w.title,
              problemFound,
              rootCause: input.rootCause || null,
              finalCondition,
            },
            note: notes,
          },
        })
      }
    },
  })

  if (input.assetStatus && w.asset && input.assetStatus !== w.asset.status) {
    await changeAssetStatus(
      auth,
      w.asset.id,
      { status: input.assetStatus, note: `${w.code}: ${notes ?? workPerformed}`.slice(0, 500) },
      req,
      id,
    )
  }
  // To verify: the named supervisor, or anyone who may approve. Without
  // verification, whoever raised the job hears that it is done.
  const verifiers = !policy.requireVerification
    ? [w.createdById]
    : w.supervisorId
      ? [w.supervisorId]
      : await usersWithPermission(auth.organizationId, w.restaurantId, 'work_orders:approve')
  await notify(
    verifiers,
    {
      organizationId: auth.organizationId,
      type: 'TASK_COMPLETED',
      title: `${w.code} · ${w.title}`,
      body: notes ?? workPerformed,
      entityType: 'WORK_ORDER',
      entityId: id,
      actionUrl: woUrl(id, false),
    },
    { exclude: auth.userId },
  )
  if (corrective.length > 0) {
    const admins = await usersWithPermission(
      auth.organizationId,
      w.restaurantId,
      'work_orders:assign',
    )
    for (const fix of corrective) {
      await notify(
        admins,
        {
          organizationId: auth.organizationId,
          type: 'INSPECTION_FAILED',
          title: `${fix.code} · ${fix.title}`,
          body: `${w.code} · ${w.title}`,
          entityType: 'WORK_ORDER',
          entityId: fix.id,
          actionUrl: woUrl(fix.id, false),
          priority: 'HIGH',
        },
        { exclude: auth.userId },
      )
    }
  }
  await createNextRepeat(auth, id, req)
  await runAutomations('WORK_ORDER_COMPLETED', {
    organizationId: auth.organizationId,
    restaurantId: w.restaurantId,
    workOrderId: id,
    assetId: w.assetId,
    priority: w.priority,
    category: w.category,
    type: w.type,
    label: `${w.code} · ${w.title}`,
  })
  return getWorkOrder(auth, id)
}

/** Supervisor approves: REVIEW → VERIFIED → CLOSED in one step, both recorded. */
export async function verifyWorkOrder(
  auth: AuthContext,
  id: string,
  input: VerifyWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).verify) throw new ForbiddenError()
  const now = new Date()
  await transition(auth, w, 'VERIFIED', req, {
    action: 'work_order.verified',
    note: input.note || null,
    data: { verifiedAt: now, verifiedById: auth.userId },
    effects: async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: now, closedById: auth.userId },
      })
      await writeHistory(tx, id, 'VERIFIED', 'CLOSED', auth.userId)
    },
  })
  return getWorkOrder(auth, id)
}

/** Supervisor sends the work back with a reason: REVIEW → REOPENED. */
export async function rejectWorkOrder(
  auth: AuthContext,
  id: string,
  input: RejectWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).reject) throw new ForbiddenError()
  await transition(auth, w, 'REOPENED', req, {
    action: 'work_order.rejected',
    note: input.reason,
    data: {
      rejectionReason: input.reason,
      reopenCount: { increment: 1 },
      completedAt: null,
    },
  })
  await notifyCrew(
    auth,
    w,
    await crew({ ...w, helperIds: w.helpers.map((h) => h.userId) }),
    'WORK_REJECTED',
    input.reason,
  )
  return getWorkOrder(auth, id)
}

/** A finished job turns out not to be: back to REOPENED for the same people. */
export async function reopenWorkOrder(
  auth: AuthContext,
  id: string,
  input: ReopenWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).reopen) throw new ForbiddenError()
  await transition(auth, w, 'REOPENED', req, {
    action: 'work_order.reopened',
    note: input.reason,
    data: {
      reopenCount: { increment: 1 },
      rejectionReason: input.reason,
      completedAt: null,
      closedAt: null,
      closedById: null,
      verifiedAt: null,
      verifiedById: null,
    },
  })
  await notifyCrew(
    auth,
    w,
    await crew({ ...w, helperIds: w.helpers.map((h) => h.userId) }),
    'WORK_REOPENED',
    input.reason,
  )
  return getWorkOrder(auth, id)
}

export async function cancelWorkOrder(
  auth: AuthContext,
  id: string,
  input: CancelWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).cancel) throw new ForbiddenError()
  if (w.children.some((c) => ACTIVE.includes(c.status) || c.status === 'DRAFT'))
    throw subWorkOrdersOpen()
  await transition(auth, w, 'CANCELLED', req, {
    action: 'work_order.cancelled',
    note: input.reason,
    data: { cancelledAt: new Date(), cancelReason: input.reason },
    effects: async (tx, at) => {
      await stopTimer(tx, id, at)
      await releaseReservations(tx, id, at)
    },
  })
  if (w.status !== 'DRAFT') {
    await notifyCrew(
      auth,
      w,
      await crew({ ...w, helperIds: w.helpers.map((h) => h.userId) }),
      'WORK_CANCELLED',
      input.reason,
    )
  }
  return getWorkOrder(auth, id)
}

// ------------------------------------------------------------------- costs

export async function addCostLine(
  auth: AuthContext,
  id: string,
  input: WorkOrderCostInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).costs) throw new ForbiddenError()
  const vendorId = input.vendorId || null
  if (vendorId) {
    const ok = await prisma.vendor.count({
      where: { id: vendorId, organizationId: auth.organizationId, archivedAt: null },
    })
    if (!ok) throw new ValidationError({ vendorId: ['validation.invalidValue'] })
  }
  await prisma.$transaction(async (tx) => {
    const line = await tx.workOrderCost.create({
      data: {
        workOrderId: id,
        type: input.type,
        description: input.description,
        amount: input.amount,
        vendorId,
        createdById: auth.userId,
      },
    })
    await recordAudit(
      audit(auth, w, 'work_order.cost_added', {
        newValue: { type: input.type, description: input.description, amount: input.amount },
        metadata: { costId: line.id },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}

export async function removeCostLine(auth: AuthContext, id: string, costId: string, req: Request) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).costs) throw new ForbiddenError()
  const line = await prisma.workOrderCost.findFirst({ where: { id: costId, workOrderId: id } })
  if (!line) throw new NotFoundError('Cost line')
  await prisma.$transaction(async (tx) => {
    await tx.workOrderCost.delete({ where: { id: costId } })
    await recordAudit(
      audit(auth, w, 'work_order.cost_removed', {
        oldValue: { type: line.type, description: line.description, amount: Number(line.amount) },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}

// ------------------------------------------------------------ communication

export async function addMessage(auth: AuthContext, id: string, input: MessageInput, req: Request) {
  const w = await loadVisible(auth, id)
  const actions = await computeActions(auth, w)
  if (!actions.message) throw new ForbiddenError()
  const internal = input.internal === true
  if (internal && !actions.internalNotes) throw new ForbiddenError()
  if (input.parentId) {
    const parent = await prisma.message.findFirst({
      where: { id: input.parentId, workOrderId: id, deletedAt: null },
      select: { internal: true },
    })
    // Technicians can't reply to (or learn about) internal notes.
    if (!parent || (parent.internal && !actions.internalNotes))
      throw new ValidationError({ parentId: ['validation.invalidValue'] })
  }
  // Only people who work at the restaurant can be mentioned; internal notes
  // only reach people who can read them.
  const wanted = [...new Set(input.mentionIds ?? [])].filter((u) => u !== auth.userId)
  const mentionIds: string[] = []
  for (const userId of wanted) {
    if (!(await worksAt(auth.organizationId, userId, w.restaurantId))) continue
    if (internal && !(await canEditWorkOrders(auth.organizationId, userId, w.restaurantId)))
      continue
    mentionIds.push(userId)
  }
  const m = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        workOrderId: id,
        authorId: auth.userId,
        body: input.body,
        parentId: input.parentId ?? null,
        internal,
        mentionIds,
      },
    })
    await recordAudit(
      audit(auth, w, internal ? 'work_order.internal_note' : 'work_order.message', {
        metadata: { messageId: created.id, replyTo: input.parentId ?? null, mentions: mentionIds },
      }),
      req,
      tx,
    )
    return created
  })
  if (mentionIds.length)
    await notify(
      mentionIds,
      {
        organizationId: auth.organizationId,
        type: 'MENTION',
        title: `${w.code} · ${auth.user.firstName} ${auth.user.lastName}`,
        body: input.body.slice(0, 300),
        entityType: 'WORK_ORDER',
        entityId: w.id,
        actionUrl: woUrl(w.id, false),
      },
      { exclude: auth.userId },
    )
  await notifyMessage(auth, w, input.body, internal, [...mentionIds, auth.userId], m.id)
  return getWorkOrder(auth, id)
}

/** Does this user hold work_orders:edit at the restaurant (can read internal notes)? */
async function canEditWorkOrders(organizationId: string, userId: string, restaurantId: string) {
  return (await usersWithPermission(organizationId, restaurantId, 'work_orders:edit')).includes(
    userId,
  )
}

/** Photos / files on a message; only its author may add them. */
export async function uploadMessageAttachments(
  auth: AuthContext,
  id: string,
  messageId: string,
  files: Express.Multer.File[] | undefined,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  const m = await prisma.message.findFirst({
    where: { id: messageId, workOrderId: id, deletedAt: null },
    select: { authorId: true },
  })
  if (!m) throw new NotFoundError('Message')
  if (m.authorId !== auth.userId) throw new ForbiddenError()
  const ids = await saveAttachments(files, { type: 'MESSAGE', id: messageId }, auth.userId, prisma)
  await recordAudit(
    audit(auth, w, 'work_order.attachment_added', { metadata: { messageId, count: ids.length } }),
    req,
  )
  return getWorkOrder(auth, id)
}

// ------------------------------------------------------------ root cause analysis

type RcaRow = Prisma.RootCauseAnalysisGetPayload<{
  include: {
    createdBy: { select: { id: true; firstName: true; lastName: true } }
    asset: { select: { id: true; name: true } }
  }
}>

function toRootCause(r: RcaRow, w: { id: string; code: string; title: string }): RootCauseDto {
  return {
    id: r.id,
    failure: r.failure,
    cause: r.cause,
    rootCause: r.rootCause,
    category: r.category,
    correctiveAction: r.correctiveAction,
    preventiveAction: r.preventiveAction,
    createdBy: r.createdBy,
    updatedAt: r.updatedAt.toISOString(),
    workOrder: { id: w.id, code: w.code, title: w.title },
    asset: r.asset,
  }
}

/** Records (or updates) why the failure happened and how to prevent it. */
export async function saveRootCause(
  auth: AuthContext,
  id: string,
  input: RootCauseInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).rca) throw new ForbiddenError()
  const data = {
    failure: input.failure,
    cause: blank(input.cause),
    rootCause: input.rootCause,
    category: input.category,
    correctiveAction: blank(input.correctiveAction),
    preventiveAction: blank(input.preventiveAction),
  }
  await prisma.$transaction(async (tx) => {
    const before = await tx.rootCauseAnalysis.findUnique({ where: { workOrderId: id } })
    await tx.rootCauseAnalysis.upsert({
      where: { workOrderId: id },
      create: {
        ...data,
        organizationId: auth.organizationId,
        workOrderId: id,
        assetId: w.assetId,
        createdById: auth.userId,
      },
      update: { ...data, updatedById: auth.userId },
    })
    if (w.assetId && !before) {
      await tx.assetHistory.create({
        data: {
          assetId: w.assetId,
          eventType: 'NOTE',
          workOrderId: id,
          actorId: auth.userId,
          newValue: { rootCause: input.rootCause, category: input.category },
          note: `Root cause (${w.code}): ${input.rootCause}`.slice(0, 1000),
        },
      })
    }
    await recordAudit(
      audit(auth, w, before ? 'work_order.rca_updated' : 'work_order.rca_created', {
        oldValue: before ? { rootCause: before.rootCause, category: before.category } : undefined,
        newValue: { rootCause: input.rootCause, category: input.category },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}

/**
 * A note from the people doing the job goes to the restaurant's admins; a note
 * from an admin goes to whoever is doing it (or the team, if nobody claimed it).
 */
async function notifyMessage(
  auth: AuthContext,
  w: ListRow,
  body: string,
  internal = false,
  skip: string[] = [],
  _messageId?: string,
) {
  const fromDoer = await isOwner(auth, w)
  const managers = () =>
    usersWithPermission(auth.organizationId, w.restaurantId, 'work_orders:assign')
  const recipients = (
    internal || fromDoer
      ? await managers()
      : await crew({ ...w, helperIds: w.helpers.map((h) => h.userId) })
  ).filter((u) => !skip.includes(u))
  await notify(
    recipients,
    {
      organizationId: auth.organizationId,
      type: 'NEW_MESSAGE',
      title: `${w.code} · ${auth.user.firstName} ${auth.user.lastName}`,
      body: body.slice(0, 300),
      entityType: 'WORK_ORDER',
      entityId: w.id,
      actionUrl: woUrl(w.id, false),
    },
    { exclude: auth.userId },
  )
}

/** Photos, videos and voice notes; `stage` marks before / during / after evidence. */
export async function uploadAttachments(
  auth: AuthContext,
  id: string,
  files: Express.Multer.File[] | undefined,
  meta: UploadMeta,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).upload) throw new ForbiddenError()
  const stage = meta.stage || null
  const ids = await saveAttachments(files, { type: 'WORK_ORDER', id }, auth.userId, prisma, {
    stage,
    caption: meta.caption || null,
  })
  await recordAudit(
    audit(auth, w, 'work_order.attachment_added', {
      metadata: { attachmentIds: ids, stage, assetId: w.assetId },
    }),
    req,
  )
  return getWorkOrder(auth, id)
}

/**
 * A photo (or the signature image) for one checklist step. PHOTO and
 * SIGNATURE steps count as done as soon as their picture is attached.
 */
export async function uploadStepAttachment(
  auth: AuthContext,
  id: string,
  itemId: string,
  files: Express.Multer.File[] | undefined,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).checklist) throw new ForbiddenError()
  const item = await prisma.workOrderChecklistItem.findFirst({
    where: { id: itemId, workOrderId: id },
  })
  if (!item) throw new NotFoundError('Checklist step')
  // Section headings have nothing to answer.
  if (item.inputType === 'SECTION') throw new ValidationError({ result: ['validation.invalidValue'] })
  const ids = await saveAttachments(files, { type: 'CHECKLIST_ITEM', id: itemId }, auth.userId)
  if (item.inputType === 'SIGNATURE') {
    // One signature per step: the new one replaces the old, once it's been
    // accepted (a rejected upload must not lose the signature already there).
    await prisma.attachment.deleteMany({
      where: { ownerType: 'CHECKLIST_ITEM', ownerId: itemId, id: { notIn: ids } },
    })
  }
  if ((item.inputType === 'PHOTO' || item.inputType === 'SIGNATURE') && item.result !== 'PASS') {
    await prisma.workOrderChecklistItem.update({
      where: { id: itemId },
      data: { result: 'PASS', completedById: auth.userId, completedAt: new Date() },
    })
  }
  await recordAudit(
    audit(auth, w, 'work_order.step_photo_added', {
      metadata: { attachmentIds: ids, step: item.title },
    }),
    req,
  )
  return getWorkOrder(auth, id)
}

// ---------------------------------------------------------------- checklist

/** Records one checklist answer. Numbers are judged against the step's range on the server. */
export async function answerChecklistItem(
  auth: AuthContext,
  id: string,
  itemId: string,
  input: StepAnswerInput,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).checklist) throw new ForbiddenError()
  const item = await prisma.workOrderChecklistItem.findFirst({
    where: { id: itemId, workOrderId: id },
  })
  if (!item) throw new NotFoundError('Checklist step')
  // Section headings have nothing to answer.
  if (item.inputType === 'SECTION') throw new ValidationError({ result: ['validation.invalidValue'] })
  const media = await prisma.attachment.count({
    where: { ownerType: 'CHECKLIST_ITEM', ownerId: itemId },
  })
  const v = evaluateAnswer(
    {
      inputType: item.inputType,
      minValue: item.minValue === null ? null : Number(item.minValue),
      maxValue: item.maxValue === null ? null : Number(item.maxValue),
      options: item.options,
    },
    input,
    media > 0,
  )
  await prisma.workOrderChecklistItem.update({
    where: { id: itemId },
    data: {
      result: v.result,
      numericValue: v.numericValue,
      textValue: v.textValue,
      note: input.note || null,
      completedById: v.result ? auth.userId : null,
      completedAt: v.result ? new Date() : null,
    },
  })
  return getWorkOrder(auth, id)
}

// -------------------------------------------------------------------- parts

/**
 * Records parts used on the job. Stock at the work order's restaurant goes
 * down straight away; using the same part again adds to the line.
 */
export async function useWorkOrderPart(
  auth: AuthContext,
  id: string,
  input: UseWorkOrderPartInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).parts) throw new ForbiddenError()
  const part = await prisma.part.findFirst({
    where: { id: input.partId, organizationId: auth.organizationId, archivedAt: null },
    select: { id: true, unitCost: true, name: true },
  })
  if (!part) throw new ValidationError({ partId: ['validation.invalidValue'] })
  const result = await prisma.$transaction(async (tx) => {
    const line = await tx.workOrderPart.upsert({
      where: { workOrderId_partId: { workOrderId: id, partId: part.id } },
      create: {
        workOrderId: id,
        partId: part.id,
        qtyUsed: input.quantity,
        unitCostSnapshot: part.unitCost,
        condition: input.condition ?? 'NEW',
      },
      update: {
        qtyUsed: { increment: input.quantity },
        ...(input.condition ? { condition: input.condition } : {}),
      },
    })
    await fulfilReservation(tx, id, part.id, input.quantity)
    const stock = await applyStockChange(tx, {
      organizationId: auth.organizationId,
      partId: part.id,
      restaurantId: w.restaurantId,
      delta: -input.quantity,
      type: 'CONSUMPTION',
      unitCost: Number(part.unitCost),
      referenceType: 'WORK_ORDER',
      referenceId: id,
      actorId: auth.userId,
      reason: w.code,
    })
    if (w.assetId) {
      await tx.assetHistory.create({
        data: {
          assetId: w.assetId,
          eventType: 'PART_REPLACED',
          workOrderId: id,
          actorId: auth.userId,
          newValue: {
            part: part.name,
            quantity: input.quantity,
            condition: input.condition ?? 'NEW',
          },
        },
      })
    }
    await recordAudit(
      audit(auth, w, 'work_order.part_used', {
        metadata: { part: part.name, quantity: input.quantity, lineQty: Number(line.qtyUsed) },
      }),
      req,
      tx,
    )
    return stock
  })
  await notifyLowStock(auth.organizationId, [result], auth.userId)
  return getWorkOrder(auth, id)
}

/** Using a reserved part draws down (and eventually fulfils) its reservation. */
async function fulfilReservation(tx: Tx, workOrderId: string, partId: string, used: number) {
  const r = await tx.partReservation.findFirst({
    where: { workOrderId, partId, status: 'ACTIVE' },
  })
  if (!r) return
  const left = round3(Number(r.quantity) - used)
  await tx.partReservation.update({
    where: { id: r.id },
    data: left > 0 ? { quantity: left } : { status: 'FULFILLED', closedAt: new Date() },
  })
}

/** Frees everything still reserved for a job (completed or cancelled). */
async function releaseReservations(tx: Tx, workOrderId: string, at: Date) {
  await tx.partReservation.updateMany({
    where: { workOrderId, status: 'ACTIVE' },
    data: { status: 'RELEASED', closedAt: at },
  })
}

/**
 * Sets stock aside for the job. Only what is available (on hand minus other
 * reservations) at the job's restaurant can be reserved.
 */
export async function reservePart(
  auth: AuthContext,
  id: string,
  input: ReservePartInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).reserve) throw new ForbiddenError()
  const part = await prisma.part.findFirst({
    where: { id: input.partId, organizationId: auth.organizationId, archivedAt: null },
    select: { id: true, name: true, unit: true },
  })
  if (!part) throw new ValidationError({ partId: ['validation.invalidValue'] })
  await prisma.$transaction(async (tx) => {
    // Serialise reservations of this part at this restaurant.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${part.id}:${w.restaurantId}`}))`
    const [inv, held] = await Promise.all([
      tx.inventory.findUnique({
        where: { partId_restaurantId: { partId: part.id, restaurantId: w.restaurantId } },
        select: { quantity: true },
      }),
      tx.partReservation.aggregate({
        where: { partId: part.id, restaurantId: w.restaurantId, status: 'ACTIVE' },
        _sum: { quantity: true },
      }),
    ])
    const available = round3(Number(inv?.quantity ?? 0) - Number(held._sum.quantity ?? 0))
    if (input.quantity > available) {
      throw new AppError(409, ERROR_CODES.INSUFFICIENT_STOCK, 'Not enough stock to reserve.', {
        fieldErrors: { quantity: ['validation.notEnoughStock'] },
        details: { available: Math.max(0, available), unit: part.unit },
      })
    }
    const existing = await tx.partReservation.findFirst({
      where: { workOrderId: id, partId: part.id, status: 'ACTIVE' },
      select: { id: true },
    })
    if (existing)
      await tx.partReservation.update({
        where: { id: existing.id },
        data: { quantity: { increment: input.quantity } },
      })
    else
      await tx.partReservation.create({
        data: {
          organizationId: auth.organizationId,
          partId: part.id,
          restaurantId: w.restaurantId,
          workOrderId: id,
          quantity: input.quantity,
          createdById: auth.userId,
        },
      })
    await recordAudit(
      audit(auth, w, 'work_order.part_reserved', {
        metadata: { part: part.name, quantity: input.quantity },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}

export async function releaseReservation(
  auth: AuthContext,
  id: string,
  reservationId: string,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).reserve) throw new ForbiddenError()
  const r = await prisma.partReservation.findFirst({
    where: { id: reservationId, workOrderId: id, status: 'ACTIVE' },
    include: { part: { select: { name: true } } },
  })
  if (!r) throw new NotFoundError('Reservation')
  await prisma.$transaction(async (tx) => {
    await tx.partReservation.update({
      where: { id: r.id },
      data: { status: 'RELEASED', closedAt: new Date() },
    })
    await recordAudit(
      audit(auth, w, 'work_order.reservation_released', {
        metadata: { part: r.part.name, quantity: Number(r.quantity) },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}

/** Removes a part line and puts the quantity back into stock. */
export async function removeWorkOrderPart(
  auth: AuthContext,
  id: string,
  lineId: string,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).parts) throw new ForbiddenError()
  const line = await prisma.workOrderPart.findFirst({
    where: { id: lineId, workOrderId: id },
    include: { part: { select: { name: true } } },
  })
  if (!line) throw new NotFoundError('Part line')
  await prisma.$transaction(async (tx) => {
    const qtyBack = round3(Number(line.qtyUsed))
    await tx.workOrderPart.delete({ where: { id: lineId } })
    if (qtyBack > 0) {
      await applyStockChange(tx, {
        organizationId: auth.organizationId,
        partId: line.partId,
        restaurantId: w.restaurantId,
        delta: qtyBack,
        type: 'RETURN',
        unitCost: line.unitCostSnapshot === null ? null : Number(line.unitCostSnapshot),
        referenceType: 'WORK_ORDER',
        referenceId: id,
        actorId: auth.userId,
        reason: w.code,
      })
    }
    await recordAudit(
      audit(auth, w, 'work_order.part_returned', {
        metadata: { part: line.part.name, quantity: qtyBack },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}

// ------------------------------------------------------------------- time

/** A manager records time by hand (forgotten timer, work done without the app). */
export async function addManualTime(
  auth: AuthContext,
  id: string,
  input: ManualTimeInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).time) throw new ForbiddenError()
  if (!(await worksAt(auth.organizationId, input.userId, w.restaurantId)))
    throw new ValidationError({ userId: ['validation.assigneeNotInRestaurant'] })
  const startedAt = new Date(input.startedAt)
  if (startedAt.getTime() > Date.now())
    throw new ValidationError({ startedAt: ['validation.notInFuture'] })
  await prisma.$transaction(async (tx) => {
    const entry = await tx.workOrderTimeEntry.create({
      data: {
        workOrderId: id,
        userId: input.userId,
        startedAt,
        endedAt: new Date(startedAt.getTime() + input.minutes * 60_000),
        minutes: input.minutes,
        note: input.note,
        manual: true,
        createdById: auth.userId,
      },
    })
    await recordAudit(
      audit(auth, w, 'work_order.time_added', {
        newValue: { userId: input.userId, minutes: input.minutes, note: input.note },
        metadata: { entryId: entry.id },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}

/** Only hand-entered time can be removed; timer records are history. */
export async function removeManualTime(
  auth: AuthContext,
  id: string,
  entryId: string,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).time) throw new ForbiddenError()
  const entry = await prisma.workOrderTimeEntry.findFirst({
    where: { id: entryId, workOrderId: id },
  })
  if (!entry) throw new NotFoundError('Time entry')
  if (!entry.manual) throw new ForbiddenError('Timer records can’t be removed.')
  await prisma.$transaction(async (tx) => {
    await tx.workOrderTimeEntry.delete({ where: { id: entryId } })
    await recordAudit(
      audit(auth, w, 'work_order.time_removed', {
        oldValue: { userId: entry.userId, minutes: entry.minutes, note: entry.note },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}

// ------------------------------------------------------------- scheduling

/**
 * Calendar drag-and-drop: moves the planned start. The due date keeps its
 * distance from the start unless a new one is given. With someone assigned,
 * the job becomes SCHEDULED; the crew is told.
 */
export async function rescheduleWorkOrder(
  auth: AuthContext,
  id: string,
  input: RescheduleWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).reschedule) throw new ForbiddenError()
  const start = new Date(input.scheduledStart)
  let dueDate: Date | null = w.dueDate
  if (input.dueDate !== undefined) dueDate = input.dueDate ? new Date(input.dueDate) : null
  // Already planned: the due date keeps its distance from the start.
  else if (w.dueDate && w.scheduledStart)
    dueDate = new Date(w.dueDate.getTime() + (start.getTime() - w.scheduledStart.getTime()))
  // A deadline can't come before the work starts: allow the estimated time (min. 1 hour).
  if (dueDate && dueDate < start)
    dueDate = new Date(start.getTime() + Math.max(60, w.estimatedMinutes ?? 0) * 60_000)
  const next: WorkOrderStatus = w.status === 'ASSIGNED' ? 'SCHEDULED' : w.status

  await prisma.$transaction(async (tx) => {
    const done = await tx.workOrder.updateMany({
      where: { id, status: w.status },
      data: { scheduledStart: start, dueDate, status: next },
    })
    if (done.count === 0) throw invalidTransition()
    if (next !== w.status) await writeHistory(tx, id, w.status, next, auth.userId, 'Rescheduled')
    await recordAudit(
      audit(auth, w, 'work_order.rescheduled', {
        oldValue: { scheduledStart: isoOrNull(w.scheduledStart), dueDate: isoOrNull(w.dueDate) },
        newValue: { scheduledStart: start.toISOString(), dueDate: isoOrNull(dueDate) },
      }),
      req,
      tx,
    )
  })
  if (w.status !== 'DRAFT') {
    await notifyCrew(
      auth,
      w,
      await crew({ ...w, helperIds: w.helpers.map((h) => h.userId) }),
      'WORK_RESCHEDULED',
      formatDateTimeInZone(
        (
          await prisma.organization.findUniqueOrThrow({
            where: { id: auth.organizationId },
            select: { timezone: true },
          })
        ).timezone,
        start,
      ),
    )
  }
  return getWorkOrder(auth, id)
}

/** People who can be @mentioned on this job: active users of its restaurant. */
export async function mentionablePeople(auth: AuthContext, id: string) {
  const w = await loadVisible(auth, id)
  return prisma.user.findMany({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      status: 'ACTIVE',
      id: { not: auth.userId },
      OR: [
        { userRestaurants: { some: { restaurantId: w.restaurantId } } },
        { userRoles: { some: { role: { systemKey: 'SUPER_ADMIN' } } } },
      ],
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 200,
  })
}

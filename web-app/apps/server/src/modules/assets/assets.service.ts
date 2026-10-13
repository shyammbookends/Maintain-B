import { visibleWhere as visibleWorkOrders } from '../work-orders/work-orders.service.js'
import {
  WORK_ORDER_ACTIVE_STATUSES,
  WORK_ORDER_DONE_STATUSES,
  type AssetDetail,
  type AssetInput,
  type AssetListItem,
  type AssetStatusChangeInput,
  type AssetTransferInput,
  type ListAssetsQuery,
  type PagedResponse,
} from '@maintainx/shared'
import type { AssetStatus, Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { costBreakdown } from '../../core/costs.js'
import { nextCode } from '../../core/counters.js'
import { NotFoundError, ValidationError } from '../../core/errors.js'
import { generatePublicId } from '../../core/ids.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import { resolveCustomValues, storedValues } from '../../core/custom-fields.js'
import type { AuthContext } from '../auth/auth.context.js'

/** An asset in one of these states isn't doing its job: downtime is counted. */
export const DOWN_STATUSES: ReadonlySet<AssetStatus> = new Set(['BROKEN', 'UNDER_MAINTENANCE'])
const HISTORY_LIMIT = 50
const DAY = 86_400_000

const listInclude = {
  category: { select: { id: true, name: true } },
  restaurant: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, name: true } },
  parent: { select: { id: true, name: true, assetCode: true } },
} satisfies Prisma.AssetInclude

type ListRow = Prisma.AssetGetPayload<{ include: typeof listInclude }>

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const toDate = (v: string) => (v ? new Date(`${v}T00:00:00Z`) : null)
const blank = (v: string) => (v === '' ? null : v)

function toListItem(a: ListRow): AssetListItem {
  return {
    id: a.id,
    publicId: a.publicId,
    assetCode: a.assetCode,
    name: a.name,
    status: a.status,
    criticality: a.criticality,
    category: a.category,
    restaurant: a.restaurant,
    location: a.location,
    parent: a.parent,
    manufacturer: a.manufacturer,
    model: a.model,
    serialNumber: a.serialNumber,
    warrantyEnd: dateOnly(a.warrantyEnd),
  }
}

/** Plain field values used for create/update and for history diffs. */
function toData(input: AssetInput) {
  return {
    name: input.name,
    categoryId: input.categoryId,
    restaurantId: input.restaurantId,
    locationId: input.locationId || null,
    manufacturer: blank(input.manufacturer),
    model: blank(input.model),
    serialNumber: blank(input.serialNumber),
    purchaseDate: toDate(input.purchaseDate),
    purchaseCost: input.purchaseCost === '' ? null : input.purchaseCost,
    warrantyStart: toDate(input.warrantyStart),
    warrantyEnd: toDate(input.warrantyEnd),
    notes: blank(input.notes),
    // Omitted = unchanged (older clients don't send these).
    ...(input.vendorId !== undefined ? { vendorId: input.vendorId || null } : {}),
    ...(input.parentId !== undefined ? { parentId: input.parentId || null } : {}),
    ...(input.criticality !== undefined ? { criticality: input.criticality } : {}),
    ...(input.installDate !== undefined ? { installDate: toDate(input.installDate) } : {}),
  }
}

type AssetData = ReturnType<typeof toData>

function comparable(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

/** Walks up from `parentId`; true when `selfId` is found (would create a loop). */
async function isDescendant(parentId: string, selfId: string): Promise<boolean> {
  let cursor: string | null = parentId
  for (let depth = 0; cursor && depth < 20; depth++) {
    if (cursor === selfId) return true
    const p: { parentId: string | null } | null = await prisma.asset.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    })
    cursor = p?.parentId ?? null
  }
  return false
}

/** Validates category, restaurant scope, location and parent asset belong to the restaurant. */
async function validateRefs(auth: AuthContext, data: AssetData, selfId?: string) {
  if (!canAccessRestaurant(auth, data.restaurantId)) {
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  }
  const [category, restaurant, location] = await Promise.all([
    prisma.assetCategory.count({
      where: { id: data.categoryId, organizationId: auth.organizationId, archivedAt: null },
    }),
    prisma.restaurant.count({
      where: { id: data.restaurantId, organizationId: auth.organizationId, archivedAt: null },
    }),
    data.locationId
      ? prisma.location.findFirst({
          where: { id: data.locationId, organizationId: auth.organizationId, archivedAt: null },
          select: { restaurantId: true },
        })
      : Promise.resolve(null),
  ])
  const errors: Record<string, string[]> = {}
  if (!category) errors.categoryId = ['validation.selectOption']
  if (!restaurant) errors.restaurantId = ['validation.invalidValue']
  if (data.locationId && location?.restaurantId !== data.restaurantId) {
    errors.locationId = ['validation.locationNotInRestaurant']
  }
  if (data.vendorId) {
    const vendor = await prisma.vendor.count({
      where: { id: data.vendorId, organizationId: auth.organizationId, archivedAt: null },
    })
    if (!vendor) errors.vendorId = ['validation.invalidValue']
  }
  if (data.parentId) {
    const parent = await prisma.asset.findFirst({
      where: { id: data.parentId, organizationId: auth.organizationId, archivedAt: null },
      select: { restaurantId: true },
    })
    if (!parent || parent.restaurantId !== data.restaurantId)
      errors.parentId = ['validation.assetNotInRestaurant']
    else if (selfId && (await isDescendant(data.parentId, selfId)))
      errors.parentId = ['validation.assetCycle']
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
}

function scopedWhere(auth: AuthContext): Prisma.AssetWhereInput {
  return {
    organizationId: auth.organizationId,
    archivedAt: null,
    restaurantId: restaurantScope(auth),
  }
}

// ---------------------------------------------------------------------------

const SORT: Record<string, (d: Prisma.SortOrder) => Prisma.AssetOrderByWithRelationInput> = {
  name: (d) => ({ name: d }),
  assetCode: (d) => ({ assetCode: d }),
  warrantyEnd: (d) => ({ warrantyEnd: { sort: d, nulls: 'last' } }),
  createdAt: (d) => ({ createdAt: d }),
}

export async function listAssets(
  auth: AuthContext,
  query: ListAssetsQuery,
): Promise<PagedResponse<AssetListItem>> {
  if (query.restaurantId && !canAccessRestaurant(auth, query.restaurantId))
    return toPagedResponse([], query, 0)
  const where: Prisma.AssetWhereInput = {
    ...scopedWhere(auth),
    ...(query.restaurantId ? { restaurantId: query.restaurantId } : {}),
    locationId: query.locationId,
    categoryId: query.categoryId,
    status: query.status,
    criticality: query.criticality,
    ...(query.topLevel ? { parentId: null } : {}),
    ...(query.parentId ? { parentId: query.parentId } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { assetCode: { contains: query.q, mode: 'insensitive' } },
            { serialNumber: { contains: query.q, mode: 'insensitive' } },
            { manufacturer: { contains: query.q, mode: 'insensitive' } },
            { model: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const sort = query.sort ?? { field: 'name', direction: 'asc' as const }
  const [rows, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: listInclude,
      orderBy: [SORT[sort.field]!(sort.direction), { id: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.asset.count({ where }),
  ])
  return toPagedResponse(rows.map(toListItem), query, total)
}

async function buildDetail(auth: AuthContext, where: Prisma.AssetWhereInput): Promise<AssetDetail> {
  const a = await prisma.asset.findFirst({
    where: { ...scopedWhere(auth), ...where },
    include: {
      ...listInclude,
      vendor: { select: { id: true, name: true, phone: true } },
      children: {
        where: { archivedAt: null },
        select: { id: true, name: true, assetCode: true, status: true },
        orderBy: { name: 'asc' },
      },
      history: {
        orderBy: { occurredAt: 'desc' },
        take: HISTORY_LIMIT,
        include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      },
      workOrders: {
        where: { archivedAt: null, status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } },
        select: { id: true, code: true, title: true, status: true, priority: true, dueDate: true },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }],
        take: 20,
      },
      downtimes: {
        where: { OR: [{ endedAt: null }, { endedAt: { gte: new Date(Date.now() - 90 * DAY) } }] },
        select: { startedAt: true, endedAt: true },
      },
    },
  })
  if (!a) throw new NotFoundError('Asset')

  const [cost, total, reactive, completed, recent] = await Promise.all([
    costBreakdown({ organizationId: auth.organizationId, assetId: a.id }),
    prisma.workOrder.count({ where: { assetId: a.id, archivedAt: null } }),
    prisma.workOrder.count({
      where: { assetId: a.id, archivedAt: null, type: { not: 'PREVENTIVE' } },
    }),
    prisma.workOrder.count({
      where: { assetId: a.id, archivedAt: null, status: { in: [...WORK_ORDER_DONE_STATUSES] } },
    }),
    prisma.workOrder.findMany({
      where: { assetId: a.id, archivedAt: null, status: { in: [...WORK_ORDER_DONE_STATUSES] } },
      select: { id: true, code: true, title: true, status: true, priority: true, dueDate: true },
      orderBy: { completedAt: { sort: 'desc', nulls: 'last' } },
      take: 10,
    }),
  ])

  // A User sees only work they could open themselves, and no money figures.
  const worker = auth.user.roleKind === 'WORKER'
  const visibleIds = worker
    ? new Set(
        (
          await prisma.workOrder.findMany({
            where: { AND: [await visibleWorkOrders(auth), { assetId: a.id }] },
            select: { id: true },
          })
        ).map((w) => w.id),
      )
    : null
  const visible = <T extends { id: string }>(rows: T[]) =>
    visibleIds ? rows.filter((r) => visibleIds.has(r.id)) : rows

  const now = Date.now()
  const windowStart = now - 90 * DAY
  const downMs = a.downtimes.reduce((sum, d) => {
    const start = Math.max(d.startedAt.getTime(), windowStart)
    const end = d.endedAt ? d.endedAt.getTime() : now
    return sum + Math.max(0, end - start)
  }, 0)
  const open = a.downtimes.find((d) => d.endedAt === null)

  return {
    ...toListItem(a),
    customFields: storedValues(a.customFields),
    purchaseDate: dateOnly(a.purchaseDate),
    purchaseCost: worker ? null : (a.purchaseCost?.toString() ?? null),
    vendor: a.vendor,
    installDate: dateOnly(a.installDate),
    children: a.children,
    cost: worker ? { parts: 0, labour: 0, vendor: 0, other: 0, total: 0 } : cost,
    workOrderStats: { total, reactive, completed },
    recentWorkOrders: visible(recent).map((w) => ({ ...w, dueDate: w.dueDate?.toISOString() ?? null })),
    warrantyStart: dateOnly(a.warrantyStart),
    notes: a.notes,
    createdAt: a.createdAt.toISOString(),
    downtimeHours90d: Math.round((downMs / 3_600_000) * 10) / 10,
    downSince: open?.startedAt.toISOString() ?? null,
    openWorkOrders: visible(a.workOrders).map((w) => ({ ...w, dueDate: w.dueDate?.toISOString() ?? null })),
    history: a.history.map((h) => ({
      id: h.id,
      eventType: h.eventType,
      actor: h.actor,
      oldValue: h.oldValue,
      newValue: h.newValue,
      note: h.note,
      occurredAt: h.occurredAt.toISOString(),
    })),
    can: {
      edit: hasPermission(auth, 'assets:edit'),
      delete: hasPermission(auth, 'assets:delete'),
      transfer: hasPermission(auth, 'assets:edit') && auth.user.roleKind !== 'WORKER',
    },
  }
}

export const getAsset = (auth: AuthContext, id: string) => buildDetail(auth, { id })

/** QR landing: out-of-scope or unknown codes look the same (404). */
export const getAssetByPublicId = (auth: AuthContext, publicId: string) =>
  buildDetail(auth, { publicId })

export async function createAsset(
  auth: AuthContext,
  input: AssetInput,
  req: Request,
): Promise<AssetDetail> {
  const data = toData(input)
  await validateRefs(auth, data)
  const customFields = await resolveCustomValues(
    auth.organizationId,
    'ASSET',
    input.customFields ?? {},
  )

  const id = await prisma.$transaction(async (tx) => {
    const assetCode = await nextCode(tx, auth.organizationId, 'AST', 4)
    const asset = await tx.asset.create({
      data: {
        ...data,
        customFields,
        organizationId: auth.organizationId,
        assetCode,
        publicId: generatePublicId(),
      },
    })
    await tx.assetHistory.create({
      data: {
        assetId: asset.id,
        eventType: 'CREATED',
        actorId: auth.userId,
        newValue: { assetCode, name: data.name },
      },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: data.restaurantId,
        actorId: auth.userId,
        action: 'asset.created',
        entityType: 'ASSET',
        entityId: asset.id,
        newValue: { assetCode, name: data.name },
      },
      req,
      tx,
    )
    return asset.id
  })
  return getAsset(auth, id)
}

export async function updateAsset(
  auth: AuthContext,
  id: string,
  input: AssetInput,
  req: Request,
): Promise<AssetDetail> {
  const before = await prisma.asset.findFirst({
    where: { ...scopedWhere(auth), id },
    include: listInclude,
  })
  if (!before) throw new NotFoundError('Asset')
  const data: AssetData = toData(input)
  if (data.parentId === id) throw new ValidationError({ parentId: ['validation.assetCycle'] })
  if (data.restaurantId !== before.restaurantId) {
    // Changing restaurant is a transfer: same rules, components come along.
    await assertTransferable(auth, id)
    // Like transferAsset: the old parent stays behind in the old restaurant.
    if (input.parentId === undefined && before.parentId) data.parentId = null
  }
  await validateRefs(auth, data, id)
  const customFields = await resolveCustomValues(auth.organizationId, 'ASSET', input.customFields)
  const customChanged =
    customFields !== undefined &&
    JSON.stringify(customFields) !== JSON.stringify(storedValues(before.customFields))

  const changed: Record<string, { from: string | null; to: string | null }> = {}
  for (const key of Object.keys(data) as Array<keyof AssetData>) {
    const from = comparable(before[key])
    const to = comparable(data[key])
    if (from !== to) changed[key] = { from, to }
  }
  if (Object.keys(changed).length === 0 && !customChanged) return getAsset(auth, id)

  const transferred = 'restaurantId' in changed
  const moved = transferred || 'locationId' in changed
  const otherChanges = Object.keys(changed).filter(
    (k) => k !== 'restaurantId' && k !== 'locationId',
  )

  await prisma.$transaction(async (tx) => {
    await tx.asset.update({
      where: { id },
      data: { ...data, ...(customChanged ? { customFields } : {}) },
    })
    if (transferred) await moveComponents(tx, id, data.restaurantId)
    if (moved) {
      const [restaurant, location] = await Promise.all([
        tx.restaurant.findUnique({ where: { id: data.restaurantId }, select: { name: true } }),
        data.locationId
          ? tx.location.findUnique({ where: { id: data.locationId }, select: { name: true } })
          : null,
      ])
      await tx.assetHistory.create({
        data: {
          assetId: id,
          eventType: transferred ? 'TRANSFERRED' : 'MOVED',
          actorId: auth.userId,
          oldValue: { restaurant: before.restaurant.name, location: before.location?.name ?? null },
          newValue: { restaurant: restaurant?.name ?? null, location: location?.name ?? null },
        },
      })
    }
    if (otherChanges.length > 0) {
      await tx.assetHistory.create({
        data: {
          assetId: id,
          eventType: 'UPDATED',
          actorId: auth.userId,
          newValue: { fields: otherChanges },
        },
      })
    }
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: data.restaurantId,
        actorId: auth.userId,
        action: 'asset.updated',
        entityType: 'ASSET',
        entityId: id,
        oldValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
        newValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
      },
      req,
      tx,
    )
  })
  return getAsset(auth, id)
}

/** A transfer is refused while the asset has open work (it belongs to the old restaurant). */
async function assertTransferable(auth: AuthContext, id: string) {
  if (!hasPermission(auth, 'assets:edit') || auth.user.roleKind === 'WORKER')
    throw new ValidationError({ restaurantId: ['validation.invalidValue'] })
  const open = await prisma.workOrder.count({
    where: {
      archivedAt: null,
      status: { in: [...WORK_ORDER_ACTIVE_STATUSES] },
      OR: [{ assetId: id }, { asset: { parentId: id } }],
    },
  })
  if (open > 0) throw new ValidationError({ restaurantId: ['validation.assetHasOpenWork'] })
}

/** Components follow their parent; they lose their location (it belonged to the old site). */
async function moveComponents(
  tx: Prisma.TransactionClient,
  parentId: string,
  restaurantId: string,
) {
  let level = [parentId]
  for (let depth = 0; level.length && depth < 20; depth++) {
    const kids = await tx.asset.findMany({
      where: { parentId: { in: level }, archivedAt: null },
      select: { id: true },
    })
    if (!kids.length) break
    await tx.asset.updateMany({
      where: { id: { in: kids.map((k) => k.id) } },
      data: { restaurantId, locationId: null },
    })
    level = kids.map((k) => k.id)
  }
}

/** Moves an asset (and its components) to another restaurant or location, with a reason. */
export async function transferAsset(
  auth: AuthContext,
  id: string,
  input: AssetTransferInput,
  req: Request,
): Promise<AssetDetail> {
  const before = await prisma.asset.findFirst({
    where: { ...scopedWhere(auth), id },
    include: listInclude,
  })
  if (!before) throw new NotFoundError('Asset')
  const restaurantChanges = input.restaurantId !== before.restaurantId
  if (restaurantChanges) await assertTransferable(auth, id)
  const data = {
    restaurantId: input.restaurantId,
    locationId: input.locationId || null,
    // A component moved to another site is no longer part of its old parent.
    ...(restaurantChanges ? { parentId: null } : {}),
  }
  await validateRefs(auth, { ...toData(assetInputOf(before)), ...data }, id)
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data })
    if (restaurantChanges) await moveComponents(tx, id, input.restaurantId)
    const [restaurant, location] = await Promise.all([
      tx.restaurant.findUnique({ where: { id: data.restaurantId }, select: { name: true } }),
      data.locationId
        ? tx.location.findUnique({ where: { id: data.locationId }, select: { name: true } })
        : null,
    ])
    await tx.assetHistory.create({
      data: {
        assetId: id,
        eventType: restaurantChanges ? 'TRANSFERRED' : 'MOVED',
        actorId: auth.userId,
        oldValue: { restaurant: before.restaurant.name, location: before.location?.name ?? null },
        newValue: { restaurant: restaurant?.name ?? null, location: location?.name ?? null },
        note: input.note,
      },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: data.restaurantId,
        actorId: auth.userId,
        action: 'asset.transferred',
        entityType: 'ASSET',
        entityId: id,
        oldValue: { restaurantId: before.restaurantId, locationId: before.locationId },
        newValue: { restaurantId: data.restaurantId, locationId: data.locationId },
        metadata: { note: input.note },
      },
      req,
      tx,
    )
  })
  return getAsset(auth, id)
}

/** Current values in form shape, for re-validating a partial change. */
function assetInputOf(a: ListRow): AssetInput {
  const d = (v: Date | null) => dateOnly(v) ?? ''
  return {
    name: a.name,
    categoryId: a.categoryId,
    restaurantId: a.restaurantId,
    locationId: a.locationId ?? '',
    manufacturer: a.manufacturer ?? '',
    model: a.model ?? '',
    serialNumber: a.serialNumber ?? '',
    purchaseDate: d(a.purchaseDate),
    purchaseCost: a.purchaseCost?.toString() ?? '',
    warrantyStart: d(a.warrantyStart),
    warrantyEnd: d(a.warrantyEnd),
    notes: a.notes ?? '',
  }
}

export async function changeAssetStatus(
  auth: AuthContext,
  id: string,
  input: AssetStatusChangeInput,
  req: Request,
  /** Set when the change comes from a work order (Phase 9). */
  workOrderId?: string,
): Promise<AssetDetail> {
  const before = await prisma.asset.findFirst({ where: { ...scopedWhere(auth), id } })
  if (!before) throw new NotFoundError('Asset')
  if (before.status === input.status) return getAsset(auth, id)

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data: { status: input.status } })
    await tx.assetHistory.create({
      data: {
        assetId: id,
        eventType: 'STATUS_CHANGED',
        actorId: auth.userId,
        workOrderId,
        oldValue: { status: before.status },
        newValue: { status: input.status },
        note: input.note || null,
      },
    })
    const wasDown = DOWN_STATUSES.has(before.status)
    const isDown = DOWN_STATUSES.has(input.status)
    if (!wasDown && isDown) {
      await tx.assetDowntime.create({
        data: { assetId: id, workOrderId, startedAt: now, reason: input.note || input.status },
      })
    } else if (wasDown && !isDown) {
      await tx.assetDowntime.updateMany({
        where: { assetId: id, endedAt: null },
        data: { endedAt: now },
      })
    }
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: before.restaurantId,
        actorId: auth.userId,
        action: 'asset.status_changed',
        entityType: 'ASSET',
        entityId: id,
        oldValue: { status: before.status },
        newValue: { status: input.status },
        metadata: input.note ? { note: input.note } : undefined,
      },
      req,
      tx,
    )
  })
  return getAsset(auth, id)
}

export async function archiveAsset(auth: AuthContext, id: string, req: Request): Promise<void> {
  const before = await prisma.asset.findFirst({ where: { ...scopedWhere(auth), id } })
  if (!before) throw new NotFoundError('Asset')
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data: { archivedAt: new Date() } })
    // Components stay, as top-level assets.
    await tx.asset.updateMany({ where: { parentId: id }, data: { parentId: null } })
    await tx.assetDowntime.updateMany({
      where: { assetId: id, endedAt: null },
      data: { endedAt: new Date() },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: before.restaurantId,
        actorId: auth.userId,
        action: 'asset.archived',
        entityType: 'ASSET',
        entityId: id,
        oldValue: { assetCode: before.assetCode, name: before.name },
      },
      req,
      tx,
    )
  })
}

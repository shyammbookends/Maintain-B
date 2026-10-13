import {
  ERROR_CODES,
  countVariance,
  type CreateStockCountInput,
  type InventorySettings,
  type ListStockCountsQuery,
  type PagedResponse,
  type SaveStockCountInput,
  type StockCountDetail,
  type StockCountListItem,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { nextCode } from '../../core/counters.js'
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import { INVENTORY_SETTINGS_KEY, inventorySettings, setOrgSetting } from '../../core/settings.js'
import { applyStockChange, notifyLowStock, round3, type StockResult } from '../../core/stock.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Cycle counts: snapshot the parts at one restaurant, people type in what is
 * physically on the shelf, and completing the count books the differences
 * (counted - system) into the stock ledger as CYCLE_COUNT movements.
 *
 * The system quantity of a line is refreshed whenever it is counted, so stock
 * used between starting the count and counting that shelf isn't mistaken for
 * a variance.
 */

const person = { select: { id: true, firstName: true, lastName: true } } as const
const money = (n: number) => Math.round(n * 100) / 100

const listInclude = {
  restaurant: { select: { id: true, name: true } },
  createdBy: person,
  _count: { select: { lines: true } },
} satisfies Prisma.StockCountInclude
type ListRow = Prisma.StockCountGetPayload<{ include: typeof listInclude }>

const toListItem = (c: ListRow, counted: number): StockCountListItem => ({
  id: c.id,
  code: c.code,
  name: c.name,
  status: c.status,
  restaurant: c.restaurant,
  createdBy: c.createdBy,
  createdAt: c.createdAt.toISOString(),
  completedAt: c.completedAt?.toISOString() ?? null,
  lineCount: c._count.lines,
  countedCount: counted,
})

async function countedByCount(ids: string[]) {
  if (ids.length === 0) return new Map<string, number>()
  const rows = await prisma.stockCountLine.groupBy({
    by: ['stockCountId'],
    where: { stockCountId: { in: ids }, countedQty: { not: null } },
    _count: { _all: true },
  })
  return new Map(rows.map((r) => [r.stockCountId, r._count._all]))
}

const visibleWhere = (auth: AuthContext): Prisma.StockCountWhereInput => ({
  organizationId: auth.organizationId,
  restaurantId: restaurantScope(auth),
})

export async function listStockCounts(
  auth: AuthContext,
  q: ListStockCountsQuery,
): Promise<PagedResponse<StockCountListItem>> {
  const where: Prisma.StockCountWhereInput = {
    AND: [
      visibleWhere(auth),
      q.status ? { status: q.status } : {},
      q.restaurantId ? { restaurantId: q.restaurantId } : {},
    ],
  }
  const [rows, total] = await Promise.all([
    prisma.stockCount.findMany({
      where,
      include: listInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...toSkipTake(q),
    }),
    prisma.stockCount.count({ where }),
  ])
  const counted = await countedByCount(rows.map((r) => r.id))
  return toPagedResponse(
    rows.map((r) => toListItem(r, counted.get(r.id) ?? 0)),
    q,
    total,
  )
}

export async function getStockCount(auth: AuthContext, id: string): Promise<StockCountDetail> {
  const c = await prisma.stockCount.findFirst({
    where: { AND: [{ id }, visibleWhere(auth)] },
    include: {
      ...listInclude,
      completedBy: person,
      lines: {
        include: {
          part: {
            select: { id: true, name: true, partNumber: true, unit: true, storageLocation: true },
          },
          countedBy: person,
        },
      },
    },
  })
  if (!c) throw new NotFoundError('Stock count')
  const shelves = new Map(
    (
      await prisma.inventory.findMany({
        where: { restaurantId: c.restaurantId, partId: { in: c.lines.map((l) => l.partId) } },
        select: { partId: true, storageLocation: true },
      })
    ).map((i) => [i.partId, i.storageLocation]),
  )
  const lines = c.lines
    .map((l) => {
      const systemQty = Number(l.systemQty)
      const countedQty = l.countedQty === null ? null : Number(l.countedQty)
      return {
        id: l.id,
        part: {
          id: l.part.id,
          name: l.part.name,
          partNumber: l.part.partNumber,
          unit: l.part.unit,
        },
        storageLocation: shelves.get(l.partId) ?? l.part.storageLocation,
        systemQty,
        countedQty,
        variance:
          l.variance !== null
            ? Number(l.variance)
            : countedQty === null
              ? null
              : countVariance(countedQty, systemQty),
        unitCost: Number(l.unitCost),
        countedBy: l.countedBy,
        countedAt: l.countedAt?.toISOString() ?? null,
      }
    })
    // Walk the store room shelf by shelf.
    .sort(
      (a, b) =>
        (a.storageLocation ?? '￿').localeCompare(b.storageLocation ?? '￿') ||
        a.part.name.localeCompare(b.part.name),
    )
  const counted = lines.filter((l) => l.countedQty !== null)
  const off = counted.filter((l) => l.variance !== 0)
  const open = c.status === 'IN_PROGRESS'
  const editor =
    open && hasPermission(auth, 'inventory:edit') && canAccessRestaurant(auth, c.restaurantId)
  return {
    ...toListItem(c, counted.length),
    category: c.category,
    storageLocation: c.storageLocation,
    notes: c.notes,
    completedBy: c.completedBy,
    cancelledAt: c.cancelledAt?.toISOString() ?? null,
    lines,
    summary: {
      varianceLines: off.length,
      netQuantity: round3(off.reduce((s, l) => s + l.variance!, 0)),
      varianceValue: money(off.reduce((s, l) => s + l.variance! * l.unitCost, 0)),
    },
    actions: { count: editor, complete: editor && counted.length > 0, cancel: editor },
  }
}

const auditCount = (
  auth: AuthContext,
  c: { id: string; restaurantId: string },
  action: string,
  extra: object = {},
) => ({
  organizationId: auth.organizationId,
  restaurantId: c.restaurantId,
  actorId: auth.userId,
  action,
  entityType: 'STOCK_COUNT' as const,
  entityId: c.id,
  ...extra,
})

/** Starts a count for the parts stocked at a restaurant (optionally one category / shelf). */
export async function createStockCount(
  auth: AuthContext,
  input: CreateStockCountInput,
  req: Request,
): Promise<StockCountDetail> {
  if (!canAccessRestaurant(auth, input.restaurantId))
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  const shelf = input.storageLocation
    ? { equals: input.storageLocation, mode: 'insensitive' as const }
    : undefined
  const stock = await prisma.inventory.findMany({
    where: {
      restaurantId: input.restaurantId,
      part: {
        organizationId: auth.organizationId,
        archivedAt: null,
        ...(input.category
          ? { category: { equals: input.category, mode: 'insensitive' as const } }
          : {}),
      },
      ...(shelf
        ? {
            OR: [
              { storageLocation: shelf },
              { storageLocation: null, part: { storageLocation: shelf } },
            ],
          }
        : {}),
    },
    select: { partId: true, quantity: true, part: { select: { unitCost: true } } },
  })
  if (stock.length === 0) throw new ValidationError({ restaurantId: ['validation.nothingToCount'] })
  const created = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, auth.organizationId, 'SC', 6)
    const c = await tx.stockCount.create({
      data: {
        organizationId: auth.organizationId,
        code,
        restaurantId: input.restaurantId,
        name: input.name,
        category: input.category || null,
        storageLocation: input.storageLocation || null,
        notes: input.notes || null,
        createdById: auth.userId,
        lines: {
          create: stock.map((s) => ({
            partId: s.partId,
            systemQty: s.quantity,
            unitCost: s.part.unitCost,
          })),
        },
      },
    })
    await recordAudit(
      auditCount(auth, c, 'stock_count.created', {
        newValue: { code, name: input.name, lines: stock.length },
      }),
      req,
      tx,
    )
    return c
  })
  return getStockCount(auth, created.id)
}

async function loadOpen(auth: AuthContext, id: string) {
  const d = await getStockCount(auth, id)
  if (!d.actions.count) {
    if (d.status !== 'IN_PROGRESS')
      throw new ConflictError('This count is already finished.', ERROR_CODES.INVALID_TRANSITION)
    throw new NotFoundError('Stock count')
  }
  return d
}

/** Saves counted quantities (several lines at once, e.g. one shelf). */
export async function saveCounts(
  auth: AuthContext,
  id: string,
  input: SaveStockCountInput,
): Promise<StockCountDetail> {
  const d = await loadOpen(auth, id)
  const byId = new Map(d.lines.map((l) => [l.id, l]))
  const errors: Record<string, string[]> = {}
  input.lines.forEach((l, i) => {
    if (!byId.has(l.lineId)) errors[`lines.${i}.lineId`] = ['validation.invalidValue']
  })
  if (Object.keys(errors).length) throw new ValidationError(errors)
  const restaurantId = d.restaurant.id
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    // Same row lock as completing: counts can't land on a count that was just
    // completed (the stored lines would no longer match what was booked).
    const open = await tx.stockCount.updateMany({
      where: { id, status: 'IN_PROGRESS' },
      data: { updatedAt: now },
    })
    if (open.count === 0)
      throw new ConflictError('This count is already finished.', ERROR_CODES.INVALID_TRANSITION)
    const current = new Map(
      (
        await tx.inventory.findMany({
          where: {
            restaurantId,
            partId: { in: input.lines.map((l) => byId.get(l.lineId)!.part.id) },
          },
          select: { partId: true, quantity: true },
        })
      ).map((r) => [r.partId, r.quantity]),
    )
    for (const l of input.lines) {
      const line = byId.get(l.lineId)!
      await tx.stockCountLine.update({
        where: { id: l.lineId },
        data:
          l.countedQty === null
            ? { countedQty: null, countedById: null, countedAt: null }
            : {
                countedQty: l.countedQty,
                countedById: auth.userId,
                countedAt: now,
                systemQty: current.get(line.part.id) ?? 0,
              },
      })
    }
  })
  return getStockCount(auth, id)
}

/** Books every counted difference into stock and closes the count. */
export async function completeStockCount(
  auth: AuthContext,
  id: string,
  req: Request,
): Promise<StockCountDetail> {
  const d = await loadOpen(auth, id)
  if (!d.actions.complete) throw new ValidationError({ lines: ['validation.countSomething'] })
  const restaurantId = d.restaurant.id
  const results: StockResult[] = []
  await prisma.$transaction(async (tx) => {
    const locked = await tx.stockCount.updateMany({
      where: { id, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', completedAt: new Date(), completedById: auth.userId },
    })
    if (locked.count === 0)
      throw new ConflictError('This count is already finished.', ERROR_CODES.INVALID_TRANSITION)
    // Lines as they are now that the count is locked (counts saved after the
    // page was loaded are included).
    const lines = (
      await tx.stockCountLine.findMany({ where: { stockCountId: id } })
    ).map((l) => ({
      id: l.id,
      part: { id: l.partId },
      countedQty: l.countedQty === null ? null : Number(l.countedQty),
      systemQty: Number(l.systemQty),
      unitCost: Number(l.unitCost),
    }))
    for (const l of lines) {
      if (l.countedQty === null) continue
      const variance = countVariance(l.countedQty, l.systemQty)
      await tx.stockCountLine.update({ where: { id: l.id }, data: { variance } })
      if (variance === 0) continue
      // Stock used after the shelf was counted can't push the balance below zero.
      const onHand = Number(
        (
          await tx.inventory.findUnique({
            where: { partId_restaurantId: { partId: l.part.id, restaurantId } },
            select: { quantity: true },
          })
        )?.quantity ?? 0,
      )
      const delta = Math.max(variance, -onHand)
      if (delta === 0) continue
      const r = await applyStockChange(tx, {
        organizationId: auth.organizationId,
        partId: l.part.id,
        restaurantId,
        delta,
        type: 'CYCLE_COUNT',
        unitCost: l.unitCost,
        referenceType: 'STOCK_COUNT',
        referenceId: id,
        actorId: auth.userId,
        reason: `${d.code}: counted ${l.countedQty}, system ${l.systemQty}`,
      })
      results.push(r)
      await recordAudit(
        {
          organizationId: auth.organizationId,
          restaurantId,
          actorId: auth.userId,
          action: 'inventory.cycle_count',
          entityType: 'INVENTORY',
          entityId: l.part.id,
          oldValue: { quantity: r.before },
          newValue: { quantity: r.after },
          metadata: { stockCount: d.code, counted: l.countedQty, system: l.systemQty, variance },
        },
        req,
        tx,
      )
    }
    await recordAudit(
      auditCount(auth, { id, restaurantId }, 'stock_count.completed', {
        oldValue: { status: 'IN_PROGRESS' },
        newValue: { status: 'COMPLETED' },
        metadata: d.summary,
      }),
      req,
      tx,
    )
  })
  await notifyLowStock(auth.organizationId, results, auth.userId)
  return getStockCount(auth, id)
}

export async function cancelStockCount(
  auth: AuthContext,
  id: string,
  req: Request,
): Promise<StockCountDetail> {
  const d = await loadOpen(auth, id)
  await prisma.$transaction(async (tx) => {
    const locked = await tx.stockCount.updateMany({
      where: { id, status: 'IN_PROGRESS' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })
    if (locked.count === 0)
      throw new ConflictError('This count is already finished.', ERROR_CODES.INVALID_TRANSITION)
    await recordAudit(
      auditCount(auth, { id, restaurantId: d.restaurant.id }, 'stock_count.cancelled', {
        oldValue: { status: 'IN_PROGRESS' },
        newValue: { status: 'CANCELLED' },
      }),
      req,
      tx,
    )
  })
  return getStockCount(auth, id)
}

// ------------------------------------------------------------------ settings

export const getInventorySettings = (auth: AuthContext): Promise<InventorySettings> =>
  inventorySettings(auth.organizationId)

export async function updateInventorySettings(
  auth: AuthContext,
  input: InventorySettings,
  req: Request,
): Promise<InventorySettings> {
  const before = await inventorySettings(auth.organizationId)
  await setOrgSetting(auth.organizationId, INVENTORY_SETTINGS_KEY, { ...input }, auth.userId)
  await recordAudit(
    {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'setting.updated',
      entityType: 'SETTING',
      entityId: null,
      oldValue: { ...before },
      newValue: { ...input },
      metadata: { key: INVENTORY_SETTINGS_KEY },
    },
    req,
  )
  return inventorySettings(auth.organizationId)
}

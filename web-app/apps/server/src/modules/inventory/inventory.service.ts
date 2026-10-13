import {
  ERROR_CODES,
  isLowStock,
  type ListPartsQuery,
  type PagedResponse,
  type PartDetail,
  type PartInput,
  type PartListItem,
  type StockAdjustmentInput,
  type StockLevel,
  type StockMovementMode,
  type StockSettingsInput,
  type StockTransferInput,
} from '@maintainx/shared'
import { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission } from '../../core/authz.js'
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { generatePublicId } from '../../core/ids.js'
import { prisma } from '../../core/prisma.js'
import { applyStockChange, notifyLowStock, reservedQuantities, round3 } from '../../core/stock.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * The parts catalogue is organization-wide; stock is per restaurant and only
 * shown for restaurants the user can access.
 */

const blank = (v: string) => (v === '' ? null : v)

/** Restaurants whose stock the user may see. */
async function visibleRestaurantIds(auth: AuthContext): Promise<string[]> {
  if (!auth.isSuperAdmin) return [...auth.restaurantIds]
  const rows = await prisma.restaurant.findMany({
    where: { organizationId: auth.organizationId, archivedAt: null },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

const partInclude = {
  preferredVendor: { select: { id: true, name: true } },
} satisfies Prisma.PartInclude

type PartRow = Prisma.PartGetPayload<{ include: typeof partInclude }>

const stockInclude = {
  restaurant: { select: { id: true, name: true } },
} satisfies Prisma.InventoryInclude
type StockRow = Prisma.InventoryGetPayload<{ include: typeof stockInclude }>

function toLevel(row: StockRow, partMin: number, reserved = 0): StockLevel {
  const quantity = Number(row.quantity)
  const override = row.minStock === null ? null : Number(row.minStock)
  const minStock = override ?? partMin
  return {
    restaurant: row.restaurant,
    quantity,
    minStock,
    minOverride: override,
    storageLocation: row.storageLocation,
    low: isLowStock(quantity, minStock),
    reserved,
    available: round3(Math.max(0, quantity - reserved)),
  }
}

const levelsOf = (rows: StockRow[], partMin: number, reserved: Map<string, number>) =>
  rows.map((s) => toLevel(s, partMin, reserved.get(`${s.partId}:${s.restaurantId}`) ?? 0))

function toListItem(p: PartRow, levels: StockLevel[], restaurantId?: string): PartListItem {
  return {
    id: p.id,
    publicId: p.publicId,
    name: p.name,
    partNumber: p.partNumber,
    sku: p.sku,
    category: p.category,
    unit: p.unit,
    unitCost: Number(p.unitCost),
    minStock: Number(p.minStock),
    reorderQty: p.reorderQty === null ? null : Number(p.reorderQty),
    preferredVendor: p.preferredVendor,
    totalQuantity: round3(levels.reduce((s, l) => s + l.quantity, 0)),
    lowCount: levels.filter((l) => l.low).length,
    stock: restaurantId ? (levels.find((l) => l.restaurant.id === restaurantId) ?? null) : null,
  }
}

/** Part ids at or below their minimum in any of `restaurantIds`. */
async function lowPartIds(organizationId: string, restaurantIds: string[]): Promise<string[]> {
  if (restaurantIds.length === 0) return []
  const rows = await prisma.$queryRaw<Array<{ part_id: string }>>`
    SELECT DISTINCT i.part_id
      FROM inventory i JOIN parts p ON p.id = i.part_id
     WHERE i.organization_id = ${organizationId}::uuid
       AND p.archived_at IS NULL
       AND i.restaurant_id IN (${Prisma.join(restaurantIds.map((id) => Prisma.sql`${id}::uuid`))})
       AND COALESCE(i.min_stock, p.min_stock) > 0
       AND i.quantity <= COALESCE(i.min_stock, p.min_stock)`
  return rows.map((r) => r.part_id)
}

export async function listParts(
  auth: AuthContext,
  q: ListPartsQuery,
): Promise<PagedResponse<PartListItem>> {
  if (q.restaurantId && !canAccessRestaurant(auth, q.restaurantId)) return toPagedResponse([], q, 0)
  const restaurants = q.restaurantId ? [q.restaurantId] : await visibleRestaurantIds(auth)
  const and: Prisma.PartWhereInput[] = [{ organizationId: auth.organizationId, archivedAt: null }]
  if (q.category) and.push({ category: { equals: q.category, mode: 'insensitive' } })
  if (q.vendorId) and.push({ preferredVendorId: q.vendorId })
  if (q.low) and.push({ id: { in: await lowPartIds(auth.organizationId, restaurants) } })
  if (q.q)
    and.push({
      OR: [
        { name: { contains: q.q, mode: 'insensitive' } },
        { partNumber: { contains: q.q, mode: 'insensitive' } },
        { sku: { contains: q.q, mode: 'insensitive' } },
        { category: { contains: q.q, mode: 'insensitive' } },
      ],
    })
  const where = { AND: and }
  const sort = q.sort ?? { field: 'name', direction: 'asc' as const }
  const [rows, total] = await Promise.all([
    prisma.part.findMany({
      where,
      include: partInclude,
      orderBy: [{ [sort.field]: sort.direction }, { id: 'asc' }],
      ...toSkipTake(q),
    }),
    prisma.part.count({ where }),
  ])
  const ids = rows.map((r) => r.id)
  const [stock, reserved] = await Promise.all([
    prisma.inventory.findMany({
      where: { partId: { in: ids }, restaurantId: { in: restaurants } },
      include: stockInclude,
    }),
    reservedQuantities(ids, restaurants),
  ])
  return toPagedResponse(
    rows.map((p) =>
      toListItem(
        p,
        levelsOf(
          stock.filter((s) => s.partId === p.id),
          Number(p.minStock),
          reserved,
        ),
        q.restaurantId,
      ),
    ),
    q,
    total,
  )
}

export async function getPart(auth: AuthContext, id: string): Promise<PartDetail> {
  const p = await prisma.part.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null },
    include: partInclude,
  })
  if (!p) throw new NotFoundError('Part')
  const restaurants = await visibleRestaurantIds(auth)
  const person = { select: { id: true, firstName: true, lastName: true } } as const
  const [stock, txns, reservations, reserved] = await Promise.all([
    prisma.inventory.findMany({
      where: { partId: id, restaurantId: { in: restaurants } },
      include: stockInclude,
      orderBy: { restaurant: { name: 'asc' } },
    }),
    prisma.inventoryTransaction.findMany({
      where: { partId: id, restaurantId: { in: restaurants } },
      include: {
        restaurant: { select: { id: true, name: true } },
        actor: person,
        issuedTo: person,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.partReservation.findMany({
      where: { partId: id, restaurantId: { in: restaurants }, status: 'ACTIVE' },
      include: {
        restaurant: { select: { id: true, name: true } },
        workOrder: { select: { id: true, code: true, title: true } },
        createdBy: person,
      },
      orderBy: { createdAt: 'desc' },
    }),
    reservedQuantities([id], restaurants),
  ])
  // Codes for the work orders / purchase orders the ledger refers to.
  const ids = (type: string) =>
    txns.filter((t) => t.referenceType === type && t.referenceId).map((t) => t.referenceId!)
  const [wos, pos, counts] = await Promise.all([
    prisma.workOrder.findMany({
      where: { id: { in: ids('WORK_ORDER') } },
      select: { id: true, code: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { id: { in: ids('PURCHASE_ORDER') } },
      select: { id: true, code: true },
    }),
    prisma.stockCount.findMany({
      where: { id: { in: ids('STOCK_COUNT') } },
      select: { id: true, code: true },
    }),
  ])
  const codes = new Map([...wos, ...pos, ...counts].map((x) => [x.id, x.code]))
  const levels = levelsOf(stock, Number(p.minStock), reserved)
  return {
    ...toListItem(p, levels),
    description: p.description,
    storageLocation: p.storageLocation,
    stockLevels: levels,
    transactions: txns.map((t) => ({
      id: t.id,
      type: t.type,
      quantityDelta: Number(t.quantityDelta),
      balanceAfter: Number(t.balanceAfter),
      unitCost: t.unitCost === null ? null : Number(t.unitCost),
      restaurant: t.restaurant,
      reference:
        t.referenceType && t.referenceId && t.referenceType !== 'MANUAL'
          ? { type: t.referenceType, id: t.referenceId, code: codes.get(t.referenceId) ?? null }
          : null,
      actor: t.actor,
      issuedTo: t.issuedTo,
      reason: t.reason,
      createdAt: t.createdAt.toISOString(),
    })),
    reservations: reservations.map((r) => ({
      id: r.id,
      quantity: Number(r.quantity),
      status: r.status,
      restaurant: r.restaurant,
      workOrder: r.workOrder,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    })),
    can: {
      edit: hasPermission(auth, 'parts:edit'),
      delete: hasPermission(auth, 'parts:delete'),
      adjust: hasPermission(auth, 'inventory:edit'),
    },
  }
}

async function validatePart(auth: AuthContext, input: PartInput, exceptId?: string) {
  const errors: Record<string, string[]> = {}
  const clash = await prisma.part.findFirst({
    where: {
      organizationId: auth.organizationId,
      partNumber: { equals: input.partNumber, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) errors.partNumber = ['validation.alreadyInUse']
  if (input.sku) {
    const skuClash = await prisma.part.findFirst({
      where: {
        organizationId: auth.organizationId,
        sku: { equals: input.sku, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    })
    if (skuClash) errors.sku = ['validation.alreadyInUse']
  }
  if (input.preferredVendorId) {
    const v = await prisma.vendor.count({
      where: { id: input.preferredVendorId, organizationId: auth.organizationId, archivedAt: null },
    })
    if (!v) errors.preferredVendorId = ['validation.invalidValue']
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
}

const partData = (input: PartInput) => ({
  name: input.name,
  partNumber: input.partNumber,
  sku: blank(input.sku ?? ''),
  category: blank(input.category),
  unit: input.unit,
  unitCost: input.unitCost,
  minStock: input.minStock,
  reorderQty: input.reorderQty ?? null,
  preferredVendorId: blank(input.preferredVendorId),
  storageLocation: blank(input.storageLocation),
  description: blank(input.description),
})

const auditPart = (auth: AuthContext, id: string, action: string, extra: object = {}) => ({
  organizationId: auth.organizationId,
  restaurantId: null,
  actorId: auth.userId,
  action,
  entityType: 'PART' as const,
  entityId: id,
  ...extra,
})

export async function createPart(auth: AuthContext, input: PartInput, req: Request) {
  await validatePart(auth, input)
  const p = await prisma.part.create({
    data: { ...partData(input), organizationId: auth.organizationId, publicId: generatePublicId() },
  })
  await recordAudit(auditPart(auth, p.id, 'part.created', { newValue: partData(input) }), req)
  return getPart(auth, p.id)
}

export async function updatePart(auth: AuthContext, id: string, input: PartInput, req: Request) {
  const before = await getPart(auth, id)
  await validatePart(auth, input, id)
  await prisma.part.update({ where: { id }, data: partData(input) })
  await recordAudit(
    auditPart(auth, id, 'part.updated', {
      oldValue: { name: before.name, partNumber: before.partNumber, unitCost: before.unitCost },
      newValue: { name: input.name, partNumber: input.partNumber, unitCost: input.unitCost },
    }),
    req,
  )
  return getPart(auth, id)
}

/** Only parts with no stock anywhere and no open purchase orders can be archived. */
export async function archivePart(auth: AuthContext, id: string, req: Request) {
  const p = await prisma.part.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null },
  })
  if (!p) throw new NotFoundError('Part')
  const [inStock, openPo] = await Promise.all([
    prisma.inventory.count({ where: { partId: id, quantity: { gt: 0 } } }),
    prisma.purchaseOrderItem.count({
      where: {
        partId: id,
        purchaseOrder: { status: { notIn: ['RECEIVED', 'CANCELLED'] } },
      },
    }),
  ])
  if (inStock || openPo) {
    throw new ConflictError(
      'This part still has stock or open purchase orders.',
      ERROR_CODES.PART_IN_USE,
    )
  }
  await prisma.part.update({
    where: { id },
    // Frees the part number and SKU for reuse.
    data: {
      archivedAt: new Date(),
      partNumber: `${p.partNumber}~${id.slice(0, 8)}`,
      sku: p.sku ? `${p.sku}~${id.slice(0, 8)}` : null,
    },
  })
  await recordAudit(auditPart(auth, id, 'part.archived', { oldValue: { name: p.name } }), req)
}

const INCREASES: readonly StockMovementMode[] = ['RECEIVE', 'RETURN']

const TXN_TYPE = {
  RECEIVE: 'RECEIPT',
  ISSUE: 'ISSUE',
  RETURN: 'RETURN',
  DAMAGED: 'DAMAGED',
  REMOVE: 'ADJUSTMENT',
  COUNT: 'ADJUSTMENT',
} as const satisfies Record<StockMovementMode, string>

const AUDIT_ACTION: Record<StockMovementMode, string> = {
  RECEIVE: 'inventory.stock_in',
  ISSUE: 'inventory.issued',
  RETURN: 'inventory.returned',
  DAMAGED: 'inventory.damaged',
  REMOVE: 'inventory.adjusted',
  COUNT: 'inventory.adjusted',
}

/** Stock in / out / returned / damaged / corrected, typed in by a person. */
export async function adjustStock(
  auth: AuthContext,
  partId: string,
  input: StockAdjustmentInput,
  req: Request,
): Promise<PartDetail> {
  if (!canAccessRestaurant(auth, input.restaurantId))
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  const part = await getPart(auth, partId)
  const current =
    part.stockLevels.find((l) => l.restaurant.id === input.restaurantId)?.quantity ?? 0
  const delta = INCREASES.includes(input.mode)
    ? input.quantity
    : input.mode === 'COUNT'
      ? round3(input.quantity - current)
      : -input.quantity
  if (delta === 0) return part
  if (input.mode === 'ISSUE') {
    const to = await prisma.user.count({
      where: {
        id: input.issuedToId!,
        organizationId: auth.organizationId,
        archivedAt: null,
        status: 'ACTIVE',
        // Issued to someone who works at this restaurant (or a Super Admin).
        OR: [
          { userRestaurants: { some: { restaurantId: input.restaurantId } } },
          { userRoles: { some: { role: { systemKey: 'SUPER_ADMIN' } } } },
        ],
      },
    })
    if (!to) throw new ValidationError({ issuedToId: ['validation.invalidValue'] })
  }
  const result = await prisma.$transaction(async (tx) => {
    // A count sets the quantity: work out the change from the locked current
    // row, not the one read before, or stock used in between would be lost.
    let change = delta
    if (input.mode === 'COUNT') {
      const [row] = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal }>>`
        SELECT quantity FROM inventory
         WHERE part_id = ${partId}::uuid AND restaurant_id = ${input.restaurantId}::uuid
         FOR UPDATE`
      change = round3(input.quantity - Number(row?.quantity ?? 0))
      if (change === 0) return null
    }
    const r = await applyStockChange(tx, {
      organizationId: auth.organizationId,
      partId,
      restaurantId: input.restaurantId,
      delta: change,
      type: TXN_TYPE[input.mode],
      unitCost: input.mode === 'RECEIVE' ? (input.unitCost ?? part.unitCost) : part.unitCost,
      referenceType: 'MANUAL',
      actorId: auth.userId,
      reason: input.reason,
      issuedToId: input.mode === 'ISSUE' ? input.issuedToId : null,
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: input.restaurantId,
        actorId: auth.userId,
        action: AUDIT_ACTION[input.mode],
        entityType: 'INVENTORY',
        entityId: partId,
        oldValue: { quantity: r.before },
        newValue: { quantity: r.after },
        metadata: { mode: input.mode, reason: input.reason },
      },
      req,
      tx,
    )
    return r
  })
  if (result) await notifyLowStock(auth.organizationId, [result], auth.userId)
  return getPart(auth, partId)
}

/**
 * Moves stock from one restaurant's store to another's: one transfer-out and
 * one transfer-in line in the ledger, in a single transaction.
 */
export async function transferStock(
  auth: AuthContext,
  partId: string,
  input: StockTransferInput,
  req: Request,
): Promise<PartDetail> {
  for (const [field, id] of [
    ['fromRestaurantId', input.fromRestaurantId],
    ['toRestaurantId', input.toRestaurantId],
  ] as const)
    if (!canAccessRestaurant(auth, id))
      throw new ValidationError({ [field]: ['validation.restaurantOutOfScope'] })
  const part = await getPart(auth, partId)
  const results = await prisma.$transaction(async (tx) => {
    const base = {
      organizationId: auth.organizationId,
      partId,
      type: 'TRANSFER' as const,
      unitCost: part.unitCost,
      referenceType: 'MANUAL' as const,
      actorId: auth.userId,
      reason: input.reason || null,
    }
    const out = await applyStockChange(tx, {
      ...base,
      restaurantId: input.fromRestaurantId,
      delta: -input.quantity,
    })
    const into = await applyStockChange(tx, {
      ...base,
      restaurantId: input.toRestaurantId,
      delta: input.quantity,
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: input.fromRestaurantId,
        actorId: auth.userId,
        action: 'inventory.transferred',
        entityType: 'INVENTORY',
        entityId: partId,
        oldValue: { from: out.before, to: into.before },
        newValue: { from: out.after, to: into.after },
        metadata: {
          quantity: input.quantity,
          toRestaurantId: input.toRestaurantId,
          reason: input.reason,
        },
      },
      req,
      tx,
    )
    return [out, into]
  })
  await notifyLowStock(auth.organizationId, results, auth.userId)
  return getPart(auth, partId)
}

export async function updateStockSettings(
  auth: AuthContext,
  partId: string,
  input: StockSettingsInput,
  req: Request,
): Promise<PartDetail> {
  if (!canAccessRestaurant(auth, input.restaurantId))
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  await getPart(auth, partId)
  const data = {
    minStock: input.minStock ?? null,
    storageLocation: blank(input.storageLocation),
  }
  await prisma.inventory.upsert({
    where: { partId_restaurantId: { partId, restaurantId: input.restaurantId } },
    create: {
      organizationId: auth.organizationId,
      partId,
      restaurantId: input.restaurantId,
      ...data,
    },
    update: data,
  })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: input.restaurantId,
      actorId: auth.userId,
      action: 'inventory.settings_changed',
      entityType: 'INVENTORY',
      entityId: partId,
      newValue: data,
    },
    req,
  )
  return getPart(auth, partId)
}

/** Distinct categories for filters and the part form. */
/** Part QR landing: same view as the part page, found by its printed code. */
export async function getPartByPublicId(auth: AuthContext, publicId: string): Promise<PartDetail> {
  const p = await prisma.part.findFirst({
    where: { publicId, organizationId: auth.organizationId, archivedAt: null },
    select: { id: true },
  })
  if (!p) throw new NotFoundError('Part')
  return getPart(auth, p.id)
}

export async function partCategories(auth: AuthContext): Promise<string[]> {
  const rows = await prisma.part.findMany({
    where: { organizationId: auth.organizationId, archivedAt: null, category: { not: null } },
    distinct: ['category'],
    select: { category: true },
    orderBy: { category: 'asc' },
  })
  return rows.map((r) => r.category!)
}

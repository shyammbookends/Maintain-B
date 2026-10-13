import {
  ERROR_CODES,
  canTransitionPurchaseOrder,
  lineTotal,
  type ListPurchaseOrdersQuery,
  type LowStockOrderInput,
  type LowStockOrderResult,
  type PagedResponse,
  type PurchaseOrderActions,
  type PurchaseOrderDetail,
  type PurchaseOrderInput,
  type PurchaseOrderListItem,
  type PurchaseOrderStatus,
  type ReceivePoInput,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
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
import { draftLowStockOrders } from '../../core/purchasing.js'
import { applyStockChange, notifyLowStock, round3, type StockResult } from '../../core/stock.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * DRAFT → PENDING_APPROVAL → APPROVED → ORDERED → (PARTIALLY_)RECEIVED.
 * Rejection sends it back to DRAFT; cancelling is possible until anything is
 * received. The requester can't approve their own order (Super Admins can,
 * so a one-person organization isn't stuck). Receiving adds stock.
 */

const person = { select: { id: true, firstName: true, lastName: true } } as const
const money = (n: number) => Math.round(n * 100) / 100

const listInclude = {
  vendor: { select: { id: true, name: true } },
  restaurant: { select: { id: true, name: true } },
  requestedBy: person,
  _count: { select: { items: true } },
} satisfies Prisma.PurchaseOrderInclude

type ListRow = Prisma.PurchaseOrderGetPayload<{ include: typeof listInclude }>

const toListItem = (p: ListRow): PurchaseOrderListItem => ({
  id: p.id,
  code: p.code,
  status: p.status,
  vendor: p.vendor,
  restaurant: p.restaurant,
  total: Number(p.total),
  itemCount: p._count.items,
  requestedBy: p.requestedBy,
  expectedAt: p.expectedAt?.toISOString().slice(0, 10) ?? null,
  createdAt: p.createdAt.toISOString(),
})

const visibleWhere = (auth: AuthContext): Prisma.PurchaseOrderWhereInput => ({
  organizationId: auth.organizationId,
  restaurantId: restaurantScope(auth),
})

export async function listPurchaseOrders(
  auth: AuthContext,
  q: ListPurchaseOrdersQuery,
): Promise<PagedResponse<PurchaseOrderListItem>> {
  if (q.restaurantId && !canAccessRestaurant(auth, q.restaurantId)) return toPagedResponse([], q, 0)
  const and: Prisma.PurchaseOrderWhereInput[] = [visibleWhere(auth)]
  if (q.restaurantId) and.push({ restaurantId: q.restaurantId })
  if (q.vendorId) and.push({ vendorId: q.vendorId })
  if (q.status) and.push({ status: q.status })
  if (q.view === 'approval') {
    and.push({ status: 'PENDING_APPROVAL' })
    if (!auth.isSuperAdmin) and.push({ requestedById: { not: auth.userId } })
  }
  if (q.view === 'open') and.push({ status: { in: ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'] } })
  if (q.q)
    and.push({
      OR: [
        { code: { contains: q.q, mode: 'insensitive' } },
        { vendor: { name: { contains: q.q, mode: 'insensitive' } } },
        { items: { some: { part: { name: { contains: q.q, mode: 'insensitive' } } } } },
      ],
    })
  const where = { AND: and }
  const sort = q.sort ?? { field: 'createdAt', direction: 'desc' as const }
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: listInclude,
      orderBy: [
        sort.field === 'expectedAt'
          ? { expectedAt: { sort: sort.direction, nulls: 'last' } }
          : { [sort.field]: sort.direction },
        { createdAt: 'desc' },
      ],
      ...toSkipTake(q),
    }),
    prisma.purchaseOrder.count({ where }),
  ])
  return toPagedResponse(rows.map(toListItem), q, total)
}

async function load(auth: AuthContext, id: string): Promise<ListRow> {
  const p = await prisma.purchaseOrder.findFirst({
    where: { AND: [visibleWhere(auth), { id }] },
    include: listInclude,
  })
  if (!p) throw new NotFoundError('Purchase order')
  return p
}

/**
 * Did the user shape this order (create, edit or submit it)? Four-eyes rule:
 * nobody approves an order they wrote, not just the original requester (an
 * approver could otherwise edit someone else's draft, e.g. an automatic
 * low-stock draft, submit it and approve it themselves).
 */
async function authoredBy(auth: AuthContext, p: { id: string; requestedById: string }) {
  if (p.requestedById === auth.userId) return true
  const n = await prisma.auditLog.count({
    where: {
      organizationId: auth.organizationId,
      entityType: 'PURCHASE_ORDER',
      entityId: p.id,
      actorId: auth.userId,
      action: {
        in: ['purchase_order.created', 'purchase_order.updated', 'purchase_order.submitted'],
      },
    },
  })
  return n > 0
}

function computeActions(
  auth: AuthContext,
  p: { status: PurchaseOrderStatus; requestedById: string },
  hasReceipts: boolean,
  authored = p.requestedById === auth.userId,
): { actions: PurchaseOrderActions; selfBlocked: boolean } {
  const s = p.status
  const editor = hasPermission(auth, 'purchase_orders:edit')
  const approver = hasPermission(auth, 'purchase_orders:approve')
  const selfBlocked = approver && s === 'PENDING_APPROVAL' && authored && !auth.isSuperAdmin
  return {
    selfBlocked,
    actions: {
      edit: editor && s === 'DRAFT',
      submit: editor && s === 'DRAFT',
      approve: approver && s === 'PENDING_APPROVAL' && !selfBlocked,
      reject: approver && s === 'PENDING_APPROVAL' && !selfBlocked,
      order: editor && s === 'APPROVED',
      receive:
        (editor || hasPermission(auth, 'inventory:edit')) &&
        (s === 'ORDERED' || s === 'PARTIALLY_RECEIVED'),
      cancel:
        hasPermission(auth, 'purchase_orders:delete') &&
        ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED'].includes(s) &&
        !hasReceipts,
    },
  }
}

export async function getPurchaseOrder(
  auth: AuthContext,
  id: string,
): Promise<PurchaseOrderDetail> {
  await load(auth, id)
  const p = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: {
      ...listInclude,
      approvedBy: person,
      items: {
        include: { part: { select: { id: true, name: true, partNumber: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
      receipts: {
        include: {
          receivedBy: person,
          lines: {
            include: { purchaseOrderItem: { include: { part: { select: { name: true } } } } },
          },
        },
        orderBy: { receivedAt: 'desc' },
      },
    },
  })
  const authored = p.status === 'PENDING_APPROVAL' ? await authoredBy(auth, p) : false
  const { actions, selfBlocked } = computeActions(auth, p, p.receipts.length > 0, authored)
  return {
    ...toListItem(p),
    notes: p.notes,
    subtotal: Number(p.subtotal),
    tax: Number(p.tax),
    approvedBy: p.approvedBy,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    orderedAt: p.orderedAt?.toISOString() ?? null,
    receivedAt: p.receivedAt?.toISOString() ?? null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    cancellationReason: p.cancellationReason,
    items: p.items.map((i) => ({
      id: i.id,
      part: i.part,
      description: i.description,
      qtyOrdered: Number(i.qtyOrdered),
      qtyReceived: Number(i.qtyReceived),
      unitCost: Number(i.unitCost),
      lineTotal: lineTotal(Number(i.qtyOrdered), Number(i.unitCost)),
    })),
    receipts: p.receipts.map((r) => ({
      id: r.id,
      receivedBy: r.receivedBy,
      receivedAt: r.receivedAt.toISOString(),
      notes: r.notes,
      lines: r.lines.map((l) => ({
        itemId: l.purchaseOrderItemId,
        partName: l.purchaseOrderItem.part.name,
        quantity: Number(l.quantity),
      })),
    })),
    selfApprovalBlocked: selfBlocked,
    actions,
  }
}

async function validate(auth: AuthContext, input: PurchaseOrderInput) {
  if (!canAccessRestaurant(auth, input.restaurantId))
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  const errors: Record<string, string[]> = {}
  const vendor = await prisma.vendor.findFirst({
    where: { id: input.vendorId, organizationId: auth.organizationId, archivedAt: null },
    include: { vendorRestaurants: { select: { restaurantId: true } } },
  })
  if (!vendor) errors.vendorId = ['validation.invalidValue']
  else if (
    vendor.vendorRestaurants.length > 0 &&
    !vendor.vendorRestaurants.some((r) => r.restaurantId === input.restaurantId)
  )
    errors.vendorId = ['validation.vendorNotForRestaurant']
  const partIds = input.items.map((i) => i.partId)
  const parts = await prisma.part.findMany({
    where: { id: { in: partIds }, organizationId: auth.organizationId, archivedAt: null },
    select: { id: true },
  })
  const ok = new Set(parts.map((p) => p.id))
  input.items.forEach((it, i) => {
    if (!ok.has(it.partId)) errors[`items.${i}.partId`] = ['validation.invalidValue']
  })
  if (Object.keys(errors).length) throw new ValidationError(errors)
}

function totals(input: PurchaseOrderInput) {
  const subtotal = money(input.items.reduce((s, i) => s + lineTotal(i.qtyOrdered, i.unitCost), 0))
  return { subtotal, tax: money(input.tax), total: money(subtotal + input.tax) }
}

const itemRows = (input: PurchaseOrderInput) =>
  input.items.map((i) => ({
    partId: i.partId,
    qtyOrdered: i.qtyOrdered,
    unitCost: i.unitCost,
    description: i.description || null,
  }))

const auditPo = (
  auth: AuthContext,
  p: { id: string; restaurantId: string },
  action: string,
  extra: object = {},
) => ({
  organizationId: auth.organizationId,
  restaurantId: p.restaurantId,
  actorId: auth.userId,
  action,
  entityType: 'PURCHASE_ORDER' as const,
  entityId: p.id,
  ...extra,
})

export async function createPurchaseOrder(
  auth: AuthContext,
  input: PurchaseOrderInput,
  req: Request,
): Promise<PurchaseOrderDetail> {
  await validate(auth, input)
  const po = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, auth.organizationId, 'PO', 6)
    const created = await tx.purchaseOrder.create({
      data: {
        organizationId: auth.organizationId,
        code,
        vendorId: input.vendorId,
        restaurantId: input.restaurantId,
        requestedById: auth.userId,
        expectedAt: input.expectedAt ? new Date(`${input.expectedAt}T00:00:00Z`) : null,
        notes: input.notes || null,
        ...totals(input),
        items: { create: itemRows(input) },
      },
    })
    await recordAudit(
      auditPo(auth, created, 'purchase_order.created', {
        newValue: { code, total: Number(created.total), items: input.items.length },
      }),
      req,
      tx,
    )
    return created
  })
  return getPurchaseOrder(auth, po.id)
}

export async function updatePurchaseOrder(
  auth: AuthContext,
  id: string,
  input: PurchaseOrderInput,
  req: Request,
): Promise<PurchaseOrderDetail> {
  const before = await getPurchaseOrder(auth, id)
  if (!before.actions.edit) throw new ForbiddenError()
  await validate(auth, input)
  await prisma.$transaction(async (tx) => {
    const done = await tx.purchaseOrder.updateMany({
      where: { id, status: 'DRAFT' },
      data: {
        vendorId: input.vendorId,
        restaurantId: input.restaurantId,
        expectedAt: input.expectedAt ? new Date(`${input.expectedAt}T00:00:00Z`) : null,
        notes: input.notes || null,
        ...totals(input),
      },
    })
    if (done.count === 0) throw invalidTransition()
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } })
    await tx.purchaseOrderItem.createMany({
      data: itemRows(input).map((r) => ({ ...r, purchaseOrderId: id })),
    })
    await recordAudit(
      auditPo(auth, { id, restaurantId: input.restaurantId }, 'purchase_order.updated', {
        oldValue: { total: before.total },
        newValue: { total: totals(input).total, items: input.items.length },
      }),
      req,
      tx,
    )
  })
  return getPurchaseOrder(auth, id)
}

const invalidTransition = () =>
  new ConflictError(
    'That action isn’t available in the current status.',
    ERROR_CODES.INVALID_TRANSITION,
  )

/** Status change guarded on the current status (double clicks and races do nothing twice). */
async function move(
  auth: AuthContext,
  id: string,
  to: PurchaseOrderStatus,
  action: string,
  data: Prisma.PurchaseOrderUncheckedUpdateManyInput,
  req: Request,
  extra: object = {},
) {
  const p = await load(auth, id)
  if (!canTransitionPurchaseOrder(p.status, to)) throw invalidTransition()
  await prisma.$transaction(async (tx) => {
    const done = await tx.purchaseOrder.updateMany({
      where: { id, status: p.status },
      data: { ...data, status: to },
    })
    if (done.count === 0) throw invalidTransition()
    await recordAudit(
      auditPo(auth, p, action, {
        oldValue: { status: p.status },
        newValue: { status: to },
        ...extra,
      }),
      req,
      tx,
    )
  })
  return p
}

export async function submitPurchaseOrder(auth: AuthContext, id: string, req: Request) {
  if (!(await getPurchaseOrder(auth, id)).actions.submit) throw new ForbiddenError()
  const p = await move(
    auth,
    id,
    'PENDING_APPROVAL',
    'purchase_order.submitted',
    { submittedAt: new Date() },
    req,
  )
  await notify(
    await usersWithPermission(auth.organizationId, p.restaurantId, 'purchase_orders:approve'),
    {
      organizationId: auth.organizationId,
      type: 'PO_APPROVAL',
      title: `${p.code} · ${p.vendor.name}`,
      body: `₹${Number(p.total).toLocaleString('en-IN')} · ${p.restaurant.name}`,
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      actionUrl: `/purchase-orders/${id}`,
    },
    { exclude: auth.userId },
  )
  return getPurchaseOrder(auth, id)
}

export async function approvePurchaseOrder(auth: AuthContext, id: string, req: Request) {
  const d = await getPurchaseOrder(auth, id)
  if (d.selfApprovalBlocked) {
    throw new AppError(
      403,
      ERROR_CODES.SELF_APPROVAL_NOT_ALLOWED,
      'You can’t approve your own purchase order.',
    )
  }
  if (!d.actions.approve) throw new ForbiddenError()
  await move(
    auth,
    id,
    'APPROVED',
    'purchase_order.approved',
    { approvedById: auth.userId, approvedAt: new Date() },
    req,
  )
  await notify(
    [d.requestedBy.id],
    {
      organizationId: auth.organizationId,
      type: 'PO_APPROVAL',
      title: `${d.code} approved`,
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      actionUrl: `/purchase-orders/${id}`,
    },
    { exclude: auth.userId },
  )
  return getPurchaseOrder(auth, id)
}

export async function rejectPurchaseOrder(
  auth: AuthContext,
  id: string,
  reason: string,
  req: Request,
) {
  const d = await getPurchaseOrder(auth, id)
  if (d.selfApprovalBlocked) {
    throw new AppError(
      403,
      ERROR_CODES.SELF_APPROVAL_NOT_ALLOWED,
      'You can’t approve your own purchase order.',
    )
  }
  if (!d.actions.reject) throw new ForbiddenError()
  // Back to draft so the requester can fix and resubmit; the reason is noted on the order.
  const note = `Returned for changes: ${reason}`
  await move(
    auth,
    id,
    'DRAFT',
    'purchase_order.rejected',
    { submittedAt: null, notes: d.notes ? `${note}\n\n${d.notes}`.slice(0, 2000) : note },
    req,
    { metadata: { reason } },
  )
  await notify(
    [d.requestedBy.id],
    {
      organizationId: auth.organizationId,
      type: 'PO_APPROVAL',
      title: `${d.code} returned for changes`,
      body: reason,
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      actionUrl: `/purchase-orders/${id}`,
    },
    { exclude: auth.userId },
  )
  return getPurchaseOrder(auth, id)
}

export async function markOrdered(auth: AuthContext, id: string, req: Request) {
  if (!(await getPurchaseOrder(auth, id)).actions.order) throw new ForbiddenError()
  await move(auth, id, 'ORDERED', 'purchase_order.ordered', { orderedAt: new Date() }, req)
  return getPurchaseOrder(auth, id)
}

export async function cancelPurchaseOrder(
  auth: AuthContext,
  id: string,
  reason: string,
  req: Request,
) {
  if (!(await getPurchaseOrder(auth, id)).actions.cancel) throw new ForbiddenError()
  await move(
    auth,
    id,
    'CANCELLED',
    'purchase_order.cancelled',
    { cancelledAt: new Date(), cancellationReason: reason },
    req,
  )
  return getPurchaseOrder(auth, id)
}

/** Receives some or all of the remaining quantities; each line adds stock. */
export async function receivePurchaseOrder(
  auth: AuthContext,
  id: string,
  input: ReceivePoInput,
  req: Request,
): Promise<PurchaseOrderDetail> {
  const d = await getPurchaseOrder(auth, id)
  if (!d.actions.receive) throw new ForbiddenError()
  const errors: Record<string, string[]> = {}
  const lines = input.lines.filter((l) => l.quantity > 0)
  lines.forEach((l) => {
    const item = d.items.find((i) => i.id === l.itemId)
    const index = input.lines.indexOf(l)
    if (!item) errors[`lines.${index}.itemId`] = ['validation.invalidValue']
    else if (round3(item.qtyReceived + l.quantity) > item.qtyOrdered)
      errors[`lines.${index}.quantity`] = ['validation.receiveTooMuch']
  })
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const stock: StockResult[] = []
  await prisma.$transaction(async (tx) => {
    // Lock in the status: only one receipt is processed at a time per order.
    const locked = await tx.purchaseOrder.updateMany({
      where: { id, status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] } },
      data: { updatedAt: new Date() },
    })
    if (locked.count === 0) throw invalidTransition()
    const receipt = await tx.poReceipt.create({
      data: { purchaseOrderId: id, receivedById: auth.userId, notes: input.notes || null },
    })
    for (const l of lines) {
      const item = d.items.find((i) => i.id === l.itemId)!
      // Guarded increment: concurrent receipts can't exceed the ordered quantity.
      const updated = await tx.$executeRaw`
        UPDATE purchase_order_items
           SET qty_received = qty_received + ${l.quantity}::numeric, updated_at = now()
         WHERE id = ${item.id}::uuid AND qty_received + ${l.quantity}::numeric <= qty_ordered`
      if (updated === 0)
        throw new ValidationError({
          [`lines.${input.lines.indexOf(l)}.quantity`]: ['validation.receiveTooMuch'],
        })
      await tx.poReceiptLine.create({
        data: { receiptId: receipt.id, purchaseOrderItemId: item.id, quantity: l.quantity },
      })
      stock.push(
        await applyStockChange(tx, {
          organizationId: auth.organizationId,
          partId: item.part.id,
          restaurantId: d.restaurant.id,
          delta: l.quantity,
          type: 'RECEIPT',
          unitCost: item.unitCost,
          referenceType: 'PURCHASE_ORDER',
          referenceId: id,
          actorId: auth.userId,
          reason: d.code,
        }),
      )
      // The latest purchase price becomes the part's cost.
      await tx.part.update({ where: { id: item.part.id }, data: { unitCost: item.unitCost } })
    }
    const items = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: id },
      select: { qtyOrdered: true, qtyReceived: true },
    })
    const complete = items.every((i) => Number(i.qtyReceived) >= Number(i.qtyOrdered))
    await tx.purchaseOrder.update({
      where: { id },
      data: complete
        ? { status: 'RECEIVED', receivedAt: new Date() }
        : { status: 'PARTIALLY_RECEIVED' },
    })
    await recordAudit(
      auditPo(auth, { id, restaurantId: d.restaurant.id }, 'purchase_order.received', {
        newValue: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
        metadata: { lines: lines.length },
      }),
      req,
      tx,
    )
  })
  await notifyLowStock(auth.organizationId, stock, auth.userId)
  const after = await getPurchaseOrder(auth, id)
  // The requester and the stock keepers learn the goods are in.
  const stockKeepers = await usersWithPermission(
    auth.organizationId,
    d.restaurant.id,
    'inventory:edit',
  )
  await notify(
    [...new Set([d.requestedBy.id, ...stockKeepers])],
    {
      organizationId: auth.organizationId,
      type: 'PO_RECEIVED',
      title: `${d.code} ${after.status === 'RECEIVED' ? 'received' : 'partly received'} · ${d.vendor.name}`,
      body: `${lines.length} line(s) added to stock at ${d.restaurant.name}`,
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      actionUrl: `/purchase-orders/${id}`,
      priority: 'LOW',
    },
    { exclude: auth.userId },
  )
  return after
}

/** Purchase requests for every low part at a restaurant, grouped by preferred vendor. */
export async function orderLowStock(
  auth: AuthContext,
  input: LowStockOrderInput,
  req: Request,
): Promise<LowStockOrderResult> {
  if (!canAccessRestaurant(auth, input.restaurantId))
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  return draftLowStockOrders(auth.organizationId, input.restaurantId, auth.userId, { req })
}

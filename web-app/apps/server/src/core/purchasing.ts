import { lineTotal, reorderQuantity, type LowStockOrderResult } from '@maintainx/shared'
import { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from './audit.js'
import { nextCode } from './counters.js'
import { prisma } from './prisma.js'

/*
 * Purchase requests for low stock: every part at or below its minimum at one
 * restaurant, not already on an open purchase order, is drafted onto one
 * DRAFT purchase order per preferred vendor. A person still reviews, submits
 * and gets it approved; nothing is ordered automatically.
 */

const money = (n: number) => Math.round(n * 100) / 100

export const LOW_STOCK_PO_NOTE = 'Purchase request raised for low stock.'

interface LowRow {
  part_id: string
  name: string
  part_number: string
  quantity: Prisma.Decimal
  min_stock: Prisma.Decimal
  reorder_qty: Prisma.Decimal | null
  unit_cost: Prisma.Decimal
  vendor_id: string | null
  vendor_name: string | null
}

export async function draftLowStockOrders(
  organizationId: string,
  restaurantId: string,
  actorId: string,
  opts: { partIds?: string[]; req?: Request } = {},
): Promise<LowStockOrderResult> {
  // One run per restaurant at a time: a double click (or the automatic and the
  // manual request together) would otherwise both see "not on order" and draft
  // the same parts twice.
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`low-stock:${restaurantId}`}))`
      return draftInLock(tx, organizationId, restaurantId, actorId, opts)
    },
    { timeout: 30_000, maxWait: 30_000 },
  )
}

async function draftInLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  restaurantId: string,
  actorId: string,
  opts: { partIds?: string[]; req?: Request },
): Promise<LowStockOrderResult> {
  const onlyParts =
    opts.partIds && opts.partIds.length
      ? Prisma.sql`AND p.id IN (${Prisma.join(opts.partIds.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.empty
  const low = await tx.$queryRaw<LowRow[]>`
    SELECT p.id AS part_id, p.name, p.part_number, i.quantity,
           COALESCE(i.min_stock, p.min_stock) AS min_stock, p.reorder_qty, p.unit_cost,
           v.id AS vendor_id, v.name AS vendor_name
      FROM inventory i
      JOIN parts p ON p.id = i.part_id
      LEFT JOIN vendors v ON v.id = p.preferred_vendor_id AND v.archived_at IS NULL
           -- A vendor limited to some restaurants must serve this one.
           AND (NOT EXISTS (SELECT 1 FROM vendor_restaurants vr WHERE vr.vendor_id = v.id)
                OR EXISTS (SELECT 1 FROM vendor_restaurants vr
                            WHERE vr.vendor_id = v.id AND vr.restaurant_id = ${restaurantId}::uuid))
     WHERE i.organization_id = ${organizationId}::uuid
       AND i.restaurant_id = ${restaurantId}::uuid
       AND p.archived_at IS NULL
       AND COALESCE(i.min_stock, p.min_stock) > 0
       AND i.quantity <= COALESCE(i.min_stock, p.min_stock)
       ${onlyParts}
     ORDER BY p.name`
  const onOrder = new Set(
    (
      await tx.purchaseOrderItem.findMany({
        where: {
          partId: { in: low.map((r) => r.part_id) },
          purchaseOrder: { restaurantId, status: { notIn: ['RECEIVED', 'CANCELLED'] } },
        },
        select: { partId: true },
      })
    ).map((r) => r.partId),
  )
  const result: LowStockOrderResult = { created: [], withoutVendor: [], alreadyOrdered: 0 }
  const byVendor = new Map<string, { name: string; rows: LowRow[] }>()
  for (const r of low) {
    if (onOrder.has(r.part_id)) result.alreadyOrdered++
    else if (!r.vendor_id)
      result.withoutVendor.push({ id: r.part_id, name: r.name, partNumber: r.part_number })
    else {
      const g = byVendor.get(r.vendor_id) ?? { name: r.vendor_name!, rows: [] }
      g.rows.push(r)
      byVendor.set(r.vendor_id, g)
    }
  }

  for (const [vendorId, g] of byVendor) {
    const items = g.rows.map((r) => ({
      partId: r.part_id,
      qtyOrdered: reorderQuantity(
        Number(r.quantity),
        Number(r.min_stock),
        r.reorder_qty === null ? null : Number(r.reorder_qty),
      ),
      unitCost: Number(r.unit_cost),
      description: null,
    }))
    const subtotal = money(items.reduce((s, i) => s + lineTotal(i.qtyOrdered, i.unitCost), 0))
    const po = await (async () => {
      const code = await nextCode(tx, organizationId, 'PO', 6)
      const created = await tx.purchaseOrder.create({
        data: {
          organizationId,
          code,
          vendorId,
          restaurantId,
          requestedById: actorId,
          notes: LOW_STOCK_PO_NOTE,
          subtotal,
          tax: 0,
          total: subtotal,
          items: { create: items },
        },
      })
      await recordAudit(
        {
          organizationId,
          restaurantId,
          actorId,
          action: 'purchase_order.created',
          entityType: 'PURCHASE_ORDER',
          entityId: created.id,
          newValue: { code, total: subtotal, items: items.length },
          metadata: { source: 'low_stock' },
        },
        opts.req,
        tx,
      )
      return created
    })()
    result.created.push({
      id: po.id,
      code: po.code,
      vendor: { id: vendorId, name: g.name },
      itemCount: items.length,
    })
  }
  return result
}

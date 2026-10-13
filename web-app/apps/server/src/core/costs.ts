import type { CostBreakdown } from '@maintainx/shared'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

/*
 * One place that prices maintenance work, so a work order, its asset and the
 * dashboards always agree:
 *   parts   = quantity used × unit cost at the time of use
 *   labour  = minutes logged × the technician's hourly rate (running timers count so far)
 *   vendor  = vendor invoices + work-order cost lines of type VENDOR
 *   other   = every other work-order cost line (materials, travel, …)
 * Each cost is dated when it happened: part use, time entry start, cost line
 * creation, invoice date.
 */

export interface CostFilter {
  organizationId: string
  /** Undefined = every restaurant. */
  restaurantIds?: readonly string[]
  assetId?: string
  workOrderId?: string
  from?: Date
  to?: Date
}

type Kind = 'parts' | 'labour' | 'vendor' | 'other'

export const emptyCost = (): CostBreakdown => ({
  parts: 0,
  labour: 0,
  vendor: 0,
  other: 0,
  total: 0,
})

const round2 = (n: number) => Math.round(n * 100) / 100

function woWhere(f: CostFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`w.organization_id = ${f.organizationId}::uuid`]
  if (f.restaurantIds)
    parts.push(Prisma.sql`w.restaurant_id = ANY(${[...f.restaurantIds]}::uuid[])`)
  if (f.assetId) parts.push(Prisma.sql`w.asset_id = ${f.assetId}::uuid`)
  if (f.workOrderId) parts.push(Prisma.sql`w.id = ${f.workOrderId}::uuid`)
  return Prisma.join(parts, ' AND ')
}

function range(column: Prisma.Sql, f: CostFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = []
  if (f.from) parts.push(Prisma.sql`${column} >= ${f.from}`)
  if (f.to) parts.push(Prisma.sql`${column} < ${f.to}`)
  return parts.length ? Prisma.sql` AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty
}

/** Cost rows grouped by restaurant and kind. */
async function rows(f: CostFilter) {
  const w = woWhere(f)
  const invoiceRestaurant = Prisma.sql`COALESCE(w.restaurant_id, i.restaurant_id)`
  const invoiceWhere: Prisma.Sql[] = [Prisma.sql`i.organization_id = ${f.organizationId}::uuid`]
  if (f.restaurantIds)
    invoiceWhere.push(Prisma.sql`${invoiceRestaurant} = ANY(${[...f.restaurantIds]}::uuid[])`)
  if (f.assetId) invoiceWhere.push(Prisma.sql`w.asset_id = ${f.assetId}::uuid`)
  if (f.workOrderId) invoiceWhere.push(Prisma.sql`i.work_order_id = ${f.workOrderId}::uuid`)

  return prisma.$queryRaw<Array<{ restaurant_id: string | null; kind: Kind; amount: string }>>`
    SELECT w.restaurant_id, 'parts' AS kind,
           SUM(p.qty_used * COALESCE(p.unit_cost_snapshot, 0))::text AS amount
      FROM work_order_parts p JOIN work_orders w ON w.id = p.work_order_id
     WHERE ${w}${range(Prisma.sql`p.created_at`, f)}
     GROUP BY 1
    UNION ALL
    SELECT w.restaurant_id, 'labour',
           SUM(COALESCE(t.minutes, EXTRACT(EPOCH FROM (now() - t.started_at)) / 60)
               * COALESCE(u.hourly_rate, 0) / 60)::text
      FROM work_order_time_entries t
      JOIN work_orders w ON w.id = t.work_order_id
      JOIN users u ON u.id = t.user_id
     WHERE ${w}${range(Prisma.sql`t.started_at`, f)}
     GROUP BY 1
    UNION ALL
    SELECT w.restaurant_id, CASE WHEN c.type = 'VENDOR' THEN 'vendor' ELSE 'other' END,
           SUM(c.amount)::text
      FROM work_order_costs c JOIN work_orders w ON w.id = c.work_order_id
     WHERE ${w}${range(Prisma.sql`c.created_at`, f)}
     GROUP BY 1, 2
    UNION ALL
    SELECT ${invoiceRestaurant}, 'vendor', SUM(i.amount)::text
      FROM vendor_invoices i LEFT JOIN work_orders w ON w.id = i.work_order_id
     WHERE ${Prisma.join(invoiceWhere, ' AND ')}${range(Prisma.sql`i.invoice_date`, f)}
     GROUP BY 1
  `
}

function add(into: CostBreakdown, kind: Kind, amount: number) {
  into[kind] = round2(into[kind] + amount)
  into.total = round2(into.parts + into.labour + into.vendor + into.other)
}

export async function costBreakdown(f: CostFilter): Promise<CostBreakdown> {
  const out = emptyCost()
  for (const r of await rows(f)) add(out, r.kind, Number(r.amount ?? 0))
  return out
}

/** Same numbers split by restaurant (org-level invoices without a restaurant are left out). */
export async function costByRestaurant(f: CostFilter): Promise<Map<string, CostBreakdown>> {
  const out = new Map<string, CostBreakdown>()
  for (const r of await rows(f)) {
    if (!r.restaurant_id) continue
    const c = out.get(r.restaurant_id) ?? emptyCost()
    add(c, r.kind, Number(r.amount ?? 0))
    out.set(r.restaurant_id, c)
  }
  return out
}

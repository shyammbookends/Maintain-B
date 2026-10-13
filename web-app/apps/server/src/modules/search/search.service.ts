import { visibleWhere as vendorVisibleWhere } from '../vendors/vendors.service.js'
import type { SearchHit, SearchResults } from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { hasPermission, restaurantScope } from '../../core/authz.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'
import { visibleWhere as workOrdersVisible } from '../work-orders/work-orders.service.js'

/** Hits per kind: enough to jump somewhere; the list pages do the deep search. */
const PER_KIND = 5

const has = (q: string) => ({ contains: q, mode: 'insensitive' as const })

/**
 * One search box for the admin app: work orders, requests, assets, parts,
 * locations, vendors and procedures — only what this person may see, in
 * their restaurants. Each kind is one small indexed query, run in parallel.
 */
export async function globalSearch(auth: AuthContext, q: string): Promise<SearchResults> {
  const org = auth.organizationId
  const scope = restaurantScope(auth)
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(auth, p)
  const none = Promise.resolve([] as SearchHit[])

  const workOrders = can('work_orders:view')
    ? workOrdersVisible(auth).then((visible) =>
        prisma.workOrder
          .findMany({
            where: {
              AND: [visible, { archivedAt: null }],
              OR: [{ code: has(q) }, { title: has(q) }],
            } satisfies Prisma.WorkOrderWhereInput,
            select: {
              id: true,
              code: true,
              title: true,
              status: true,
              restaurant: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: PER_KIND,
          })
          .then((rows) =>
            rows.map<SearchHit>((w) => ({
              kind: 'workOrder',
              id: w.id,
              title: `${w.code} · ${w.title}`,
              subtitle: w.restaurant.name,
              url: `/work-orders/${w.id}`,
            })),
          ),
      )
    : none

  const requests =
    can('requests:view') && auth.user.roleKind !== 'WORKER'
      ? prisma.request
          .findMany({
            where: {
              organizationId: org,
              restaurantId: scope,
              OR: [{ code: has(q) }, { title: has(q) }, { guestName: has(q) }],
            },
            select: { id: true, code: true, title: true, restaurant: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: PER_KIND,
          })
          .then((rows) =>
            rows.map<SearchHit>((r) => ({
              kind: 'request',
              id: r.id,
              title: `${r.code} · ${r.title}`,
              subtitle: r.restaurant.name,
              url: `/requests?open=${r.id}`,
            })),
          )
      : none

  const assets = can('assets:view')
    ? prisma.asset
        .findMany({
          where: {
            organizationId: org,
            restaurantId: scope,
            archivedAt: null,
            OR: [{ name: has(q) }, { assetCode: has(q) }, { serialNumber: has(q) }],
          },
          select: {
            id: true,
            name: true,
            assetCode: true,
            restaurant: { select: { name: true } },
          },
          orderBy: { name: 'asc' },
          take: PER_KIND,
        })
        .then((rows) =>
          rows.map<SearchHit>((a) => ({
            kind: 'asset',
            id: a.id,
            title: a.name,
            subtitle: `${a.assetCode} · ${a.restaurant.name}`,
            url: `/assets/${a.id}`,
          })),
        )
    : none

  const parts = can('parts:view')
    ? prisma.part
        .findMany({
          where: {
            organizationId: org,
            archivedAt: null,
            OR: [{ name: has(q) }, { partNumber: has(q) }, { sku: has(q) }],
          },
          select: { id: true, name: true, partNumber: true },
          orderBy: { name: 'asc' },
          take: PER_KIND,
        })
        .then((rows) =>
          rows.map<SearchHit>((p) => ({
            kind: 'part',
            id: p.id,
            title: p.name,
            subtitle: p.partNumber,
            url: `/inventory/parts/${p.id}`,
          })),
        )
    : none

  const locations = can('locations:view')
    ? prisma.location
        .findMany({
          where: {
            organizationId: org,
            restaurantId: scope,
            archivedAt: null,
            name: has(q),
          },
          select: { id: true, name: true, restaurant: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
          take: PER_KIND,
        })
        .then((rows) =>
          rows.map<SearchHit>((l) => ({
            kind: 'location',
            id: l.id,
            title: l.name,
            subtitle: l.restaurant.name,
            url: `/restaurants/${l.restaurant.id}`,
          })),
        )
    : none

  const vendors = can('vendors:view')
    ? prisma.vendor
        .findMany({
          // Same visibility as the vendor list: no names of other restaurants' vendors.
          where: {
            AND: [vendorVisibleWhere(auth), { OR: [{ name: has(q) }, { contactName: has(q) }] }],
          },
          select: { id: true, name: true, contactName: true },
          orderBy: { name: 'asc' },
          take: PER_KIND,
        })
        .then((rows) =>
          rows.map<SearchHit>((v) => ({
            kind: 'vendor',
            id: v.id,
            title: v.name,
            subtitle: v.contactName,
            url: `/vendors/${v.id}`,
          })),
        )
    : none

  const procedures = can('procedures:view')
    ? prisma.procedure
        .findMany({
          where: {
            organizationId: org,
            archivedAt: null,
            name: has(q),
            ...(scope ? { OR: [{ restaurantId: null }, { restaurantId: scope }] } : {}),
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: PER_KIND,
        })
        .then((rows) =>
          rows.map<SearchHit>((p) => ({
            kind: 'procedure',
            id: p.id,
            title: p.name,
            subtitle: null,
            url: `/procedures/${p.id}`,
          })),
        )
    : none

  const groups = await Promise.all([
    workOrders,
    requests,
    assets,
    parts,
    locations,
    vendors,
    procedures,
  ])
  return { q, hits: groups.flat() }
}

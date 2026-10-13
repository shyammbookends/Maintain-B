import {
  ERROR_CODES,
  WORK_ORDER_ACTIVE_STATUSES,
  type RestaurantDto,
  type RestaurantInput,
  type RestaurantStats,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { type Restaurant } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { assertRestaurantAccess, restaurantScope } from '../../core/authz.js'
import { costBreakdown } from '../../core/costs.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

const blank = (v: string) => (v === '' ? null : v)
const DAY = 86_400_000

const withManager = {
  manager: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.RestaurantInclude

type Row = Restaurant & { manager?: { id: string; firstName: string; lastName: string } | null }

export function toRestaurantDto(r: Row): RestaurantDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    addressLine1: r.addressLine1,
    addressLine2: r.addressLine2,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    phone: r.phone,
    email: r.email,
    opensAt: r.opensAt,
    closesAt: r.closesAt,
    status: r.status,
    manager: r.manager ?? null,
    contactName: r.contactName,
    portalId: r.portalId,
    createdAt: r.createdAt.toISOString(),
  }
}

function toData(input: RestaurantInput) {
  return {
    code: input.code,
    name: input.name,
    addressLine1: blank(input.addressLine1),
    addressLine2: blank(input.addressLine2),
    city: blank(input.city),
    state: blank(input.state),
    postalCode: blank(input.postalCode),
    phone: blank(input.phone),
    email: blank(input.email),
    opensAt: blank(input.opensAt),
    closesAt: blank(input.closesAt),
    status: input.status,
    ...(input.managerId !== undefined ? { managerId: input.managerId || null } : {}),
    ...(input.contactName !== undefined ? { contactName: blank(input.contactName) } : {}),
  } satisfies Prisma.RestaurantUncheckedUpdateInput
}

/**
 * The manager must be an active admin-side user. A Super Admin may pick anyone
 * such; an Admin only someone who works at this restaurant (not an Admin of
 * another restaurant, whom they can't even see).
 */
async function assertManager(
  auth: AuthContext,
  managerId: string | null | undefined,
  restaurantId?: string,
) {
  if (!managerId) return
  const ok = await prisma.user.count({
    where: {
      id: managerId,
      organizationId: auth.organizationId,
      archivedAt: null,
      status: 'ACTIVE',
      userRoles: { some: { role: { kind: 'ADMIN' } } },
      ...(auth.isSuperAdmin ? {} : { userRestaurants: { some: { restaurantId } } }),
    },
  })
  if (!ok) throw new ValidationError({ managerId: ['validation.invalidValue'] })
}

async function assertCodeFree(organizationId: string, code: string, exceptId?: string) {
  const clash = await prisma.restaurant.findFirst({
    where: { organizationId, code, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) throw new ValidationError({ code: ['validation.alreadyInUse'] })
}

export async function listRestaurants(
  auth: AuthContext,
  query: { q?: string; status?: 'ACTIVE' | 'INACTIVE' },
): Promise<RestaurantDto[]> {
  const rows = await prisma.restaurant.findMany({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      id: restaurantScope(auth),
      status: query.status,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
              { city: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: withManager,
    orderBy: { name: 'asc' },
  })
  return rows.map(toRestaurantDto)
}

export async function getRestaurant(auth: AuthContext, id: string): Promise<RestaurantDto> {
  assertRestaurantAccess(auth, id, 'Restaurant')
  const r = await prisma.restaurant.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null },
    include: withManager,
  })
  if (!r) throw new NotFoundError('Restaurant')
  return toRestaurantDto(r)
}

export async function createRestaurant(
  auth: AuthContext,
  input: RestaurantInput,
  req: Request,
): Promise<RestaurantDto> {
  await assertCodeFree(auth.organizationId, input.code)
  await assertManager(auth, input.managerId)
  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.restaurant.create({
      data: { organizationId: auth.organizationId, ...toData(input) },
      include: withManager,
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: r.id,
        actorId: auth.userId,
        action: 'restaurant.created',
        entityType: 'RESTAURANT',
        entityId: r.id,
        newValue: toRestaurantDto(r) as unknown as Prisma.InputJsonValue,
      },
      req,
      tx,
    )
    return r
  })
  return toRestaurantDto(created)
}

export async function updateRestaurant(
  auth: AuthContext,
  id: string,
  input: RestaurantInput,
  req: Request,
): Promise<RestaurantDto> {
  const before = await getRestaurant(auth, id)
  // Deactivating takes the restaurant out of every Admin's and User's scope
  // (an archive in all but name): Super Admin only.
  if (input.status !== before.status && !auth.isSuperAdmin)
    throw new ForbiddenError('Only a Super Admin can activate or deactivate a restaurant.')
  await assertCodeFree(auth.organizationId, input.code, id)
  if (input.managerId && input.managerId !== before.manager?.id)
    await assertManager(auth, input.managerId, id)
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.restaurant.update({
      where: { id },
      data: toData(input),
      include: withManager,
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: id,
        actorId: auth.userId,
        action: 'restaurant.updated',
        entityType: 'RESTAURANT',
        entityId: id,
        oldValue: before as unknown as Prisma.InputJsonValue,
        newValue: toRestaurantDto(r) as unknown as Prisma.InputJsonValue,
      },
      req,
      tx,
    )
    return r
  })
  return toRestaurantDto(updated)
}

/**
 * Archives a restaurant (Super Admin). Refused while it still has open work;
 * its history stays for reports, and it disappears from every picker.
 */
export async function archiveRestaurant(auth: AuthContext, id: string, req: Request) {
  const before = await getRestaurant(auth, id)
  const open = await prisma.workOrder.count({
    where: { restaurantId: id, archivedAt: null, status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } },
  })
  if (open > 0) {
    throw new ConflictError(
      'Finish or cancel the open work orders of this restaurant first.',
      ERROR_CODES.RESTAURANT_HAS_OPEN_WORK,
      { openWorkOrders: open },
    )
  }
  await prisma.$transaction(async (tx) => {
    await tx.restaurant.update({
      where: { id },
      data: { archivedAt: new Date(), status: 'INACTIVE' },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: id,
        actorId: auth.userId,
        action: 'restaurant.archived',
        entityType: 'RESTAURANT',
        entityId: id,
        oldValue: { code: before.code, name: before.name, status: before.status },
      },
      req,
      tx,
    )
  })
}

export async function restaurantStats(auth: AuthContext, id: string): Promise<RestaurantStats> {
  await getRestaurant(auth, id)
  const since = new Date(Date.now() - 30 * DAY)
  const live = { restaurantId: id, archivedAt: null }
  const [
    locations,
    assets,
    assetsDown,
    users,
    workers,
    teams,
    vendors,
    parts,
    lowStock,
    procedures,
    openRequests,
    openWorkOrders,
    overdueWorkOrders,
    completed30d,
    inspections30d,
    failedInspections30d,
    cost,
  ] = await Promise.all([
    prisma.location.count({ where: live }),
    prisma.asset.count({ where: live }),
    prisma.asset.count({ where: { ...live, status: { in: ['BROKEN', 'UNDER_MAINTENANCE'] } } }),
    prisma.user.count({
      where: {
        archivedAt: null,
        status: 'ACTIVE',
        userRestaurants: { some: { restaurantId: id } },
      },
    }),
    prisma.user.count({
      where: {
        archivedAt: null,
        status: 'ACTIVE',
        userRestaurants: { some: { restaurantId: id } },
        userRoles: { some: { role: { kind: 'WORKER' } } },
      },
    }),
    prisma.team.count({ where: { restaurantId: id, archivedAt: null } }),
    prisma.vendorRestaurant.count({ where: { restaurantId: id, vendor: { archivedAt: null } } }),
    prisma.inventory.count({ where: { restaurantId: id, part: { archivedAt: null } } }),
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM inventory i JOIN parts p ON p.id = i.part_id
       WHERE i.restaurant_id = ${id}::uuid AND p.archived_at IS NULL
         AND COALESCE(i.min_stock, p.min_stock) > 0
         AND i.quantity <= COALESCE(i.min_stock, p.min_stock)`.then((r) => Number(r[0]?.n ?? 0)),
    prisma.procedure.count({
      where: {
        organizationId: auth.organizationId,
        archivedAt: null,
        OR: [{ restaurantId: id }, { restaurantId: null }],
      },
    }),
    prisma.request.count({ where: { restaurantId: id, status: { in: ['NEW', 'APPROVED'] } } }),
    prisma.workOrder.count({ where: { ...live, status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } } }),
    prisma.workOrder.count({
      where: {
        ...live,
        status: { in: [...WORK_ORDER_ACTIVE_STATUSES] },
        dueDate: { lt: new Date() },
      },
    }),
    prisma.workOrder.count({ where: { ...live, completedAt: { gte: since } } }),
    prisma.inspection.count({
      where: { restaurantId: id, status: 'SUBMITTED', submittedAt: { gte: since } },
    }),
    prisma.inspection.count({
      where: {
        restaurantId: id,
        status: 'SUBMITTED',
        submittedAt: { gte: since },
        items: { some: { result: 'FAIL' } },
      },
    }),
    costBreakdown({ organizationId: auth.organizationId, restaurantIds: [id], from: since }),
  ])
  return {
    locations,
    assets,
    assetsDown,
    users,
    workers,
    teams,
    vendors,
    parts,
    lowStock,
    procedures,
    openRequests,
    openWorkOrders,
    overdueWorkOrders,
    completed30d,
    inspections30d,
    failedInspections30d,
    cost30d: cost.total,
  }
}

import {
  ERROR_CODES,
  WORK_ORDER_ACTIVE_STATUSES,
  type LocationDto,
  type LocationInput,
  type LocationLanding,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import {
  assertRestaurantAccess,
  canAccessRestaurant,
  hasPermission,
  restaurantScope,
} from '../../core/authz.js'
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js'
import { generatePublicId } from '../../core/ids.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Sites are a tree inside each restaurant: building → floor → area → room,
 * or simply kitchen / store / bar at the top level. Any depth is allowed;
 * a location can never be its own ancestor and never leaves its restaurant.
 */

const withCount = {
  _count: {
    select: {
      assets: { where: { archivedAt: null } },
      children: { where: { archivedAt: null } },
    },
  },
} satisfies Prisma.LocationInclude

type Row = Prisma.LocationGetPayload<{ include: typeof withCount }>

function toDto(l: Row): LocationDto {
  return {
    id: l.id,
    restaurantId: l.restaurantId,
    parentId: l.parentId,
    publicId: l.publicId,
    name: l.name,
    type: l.type,
    description: l.description,
    assetCount: l._count.assets,
  }
}

function scoped(auth: AuthContext): Prisma.LocationWhereInput {
  return {
    organizationId: auth.organizationId,
    archivedAt: null,
    restaurantId: restaurantScope(auth),
  }
}

async function load(auth: AuthContext, id: string): Promise<Row> {
  const l = await prisma.location.findFirst({ where: { ...scoped(auth), id }, include: withCount })
  if (!l) throw new NotFoundError('Location')
  return l
}

async function assertRestaurant(auth: AuthContext, restaurantId: string) {
  if (!canAccessRestaurant(auth, restaurantId)) {
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  }
  const ok = await prisma.restaurant.count({
    where: { id: restaurantId, organizationId: auth.organizationId, archivedAt: null },
  })
  if (!ok) throw new ValidationError({ restaurantId: ['validation.invalidValue'] })
}

/** Ancestors of a location, nearest first (bounded walk, guards against bad data). */
async function ancestors(id: string | null) {
  const out: Array<{ id: string; name: string; type: Row['type']; parentId: string | null }> = []
  let cursor = id
  for (let depth = 0; cursor && depth < 20; depth++) {
    const l = await prisma.location.findUnique({
      where: { id: cursor },
      select: { id: true, name: true, type: true, parentId: true },
    })
    if (!l) break
    out.push(l)
    cursor = l.parentId
  }
  return out
}

/** The parent must be a live location in the same restaurant and not a descendant of `selfId`. */
async function assertParent(
  auth: AuthContext,
  restaurantId: string,
  parentId: string | null,
  selfId?: string,
) {
  if (!parentId) return
  const parent = await prisma.location.findFirst({
    where: { id: parentId, organizationId: auth.organizationId, archivedAt: null },
    select: { restaurantId: true },
  })
  if (!parent || parent.restaurantId !== restaurantId)
    throw new ValidationError({ parentId: ['validation.locationNotInRestaurant'] })
  if (selfId && (await ancestors(parentId)).some((a) => a.id === selfId))
    throw new ValidationError({ parentId: ['validation.locationCycle'] })
}

export async function listLocations(
  auth: AuthContext,
  restaurantId?: string,
): Promise<LocationDto[]> {
  if (restaurantId && !canAccessRestaurant(auth, restaurantId)) return []
  const rows = await prisma.location.findMany({
    where: { ...scoped(auth), ...(restaurantId ? { restaurantId } : {}) },
    include: withCount,
    orderBy: [{ restaurantId: 'asc' }, { name: 'asc' }],
  })
  return rows.map(toDto)
}

export async function createLocation(
  auth: AuthContext,
  input: LocationInput,
  req: Request,
): Promise<LocationDto> {
  await assertRestaurant(auth, input.restaurantId)
  const parentId = input.parentId || null
  await assertParent(auth, input.restaurantId, parentId)
  const existing = await prisma.location.findFirst({
    where: { restaurantId: input.restaurantId, name: { equals: input.name, mode: 'insensitive' } },
  })
  if (existing && !existing.archivedAt)
    throw new ValidationError({ name: ['validation.alreadyInUse'] })

  const id = await prisma.$transaction(async (tx) => {
    const data = {
      name: input.name,
      type: input.type,
      description: input.description || null,
      parentId,
    }
    // Re-adding an archived location brings it back instead of failing on the unique name.
    const loc = existing
      ? await tx.location.update({
          where: { id: existing.id },
          data: { ...data, archivedAt: null },
        })
      : await tx.location.create({
          data: {
            ...data,
            organizationId: auth.organizationId,
            restaurantId: input.restaurantId,
            publicId: generatePublicId(),
          },
        })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: input.restaurantId,
        actorId: auth.userId,
        action: existing ? 'location.restored' : 'location.created',
        entityType: 'LOCATION',
        entityId: loc.id,
        newValue: data,
      },
      req,
      tx,
    )
    return loc.id
  })
  return toDto(await load(auth, id))
}

export async function updateLocation(
  auth: AuthContext,
  id: string,
  input: LocationInput,
  req: Request,
): Promise<LocationDto> {
  const before = await load(auth, id)
  // A location stays in its restaurant; moving would orphan the assets inside it.
  if (input.restaurantId !== before.restaurantId) {
    throw new ValidationError({ restaurantId: ['validation.invalidValue'] })
  }
  const parentId = input.parentId === undefined ? before.parentId : input.parentId || null
  if (parentId === id) throw new ValidationError({ parentId: ['validation.locationCycle'] })
  await assertParent(auth, before.restaurantId, parentId, id)
  const clash = await prisma.location.findFirst({
    where: {
      restaurantId: before.restaurantId,
      name: { equals: input.name, mode: 'insensitive' },
      NOT: { id },
    },
    select: { id: true },
  })
  if (clash) throw new ValidationError({ name: ['validation.alreadyInUse'] })

  await prisma.$transaction(async (tx) => {
    const data = {
      name: input.name,
      type: input.type,
      description: input.description || null,
      parentId,
    }
    await tx.location.update({ where: { id }, data })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: before.restaurantId,
        actorId: auth.userId,
        action: 'location.updated',
        entityType: 'LOCATION',
        entityId: id,
        oldValue: {
          name: before.name,
          type: before.type,
          description: before.description,
          parentId: before.parentId,
        },
        newValue: data,
      },
      req,
      tx,
    )
  })
  return toDto(await load(auth, id))
}

export async function archiveLocation(auth: AuthContext, id: string, req: Request): Promise<void> {
  const before = await load(auth, id)
  assertRestaurantAccess(auth, before.restaurantId, 'Location')
  if (before._count.assets > 0 || before._count.children > 0) {
    throw new ConflictError(
      'Move the assets and sub-locations in this location first.',
      ERROR_CODES.LOCATION_IN_USE,
      { assetCount: before._count.assets, childCount: before._count.children },
    )
  }
  await prisma.$transaction(async (tx) => {
    await tx.location.update({ where: { id }, data: { archivedAt: new Date() } })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: before.restaurantId,
        actorId: auth.userId,
        action: 'location.archived',
        entityType: 'LOCATION',
        entityId: id,
        oldValue: { name: before.name },
      },
      req,
      tx,
    )
  })
}

/** Location QR landing. Unknown and out-of-scope codes both look like 404. */
export async function getLocationByPublicId(
  auth: AuthContext,
  publicId: string,
): Promise<LocationLanding> {
  const l = await prisma.location.findFirst({
    where: { ...scoped(auth), publicId },
    include: {
      restaurant: { select: { id: true, code: true, name: true } },
      // Same restaurant as the location itself, so already in scope.
      children: {
        where: { archivedAt: null },
        select: { id: true, publicId: true, name: true, type: true },
        orderBy: { name: 'asc' },
      },
      assets: {
        where: { archivedAt: null },
        select: {
          id: true,
          publicId: true,
          assetCode: true,
          name: true,
          status: true,
          criticality: true,
        },
        orderBy: { name: 'asc' },
        take: 100,
      },
      workOrders:
        hasPermission(auth, 'work_orders:view') && auth.user.roleKind !== 'WORKER'
          ? {
              where: { archivedAt: null, status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } },
              select: {
                id: true,
                code: true,
                title: true,
                status: true,
                priority: true,
                dueDate: true,
              },
              orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }],
              take: 20,
            }
          : false,
    },
  })
  if (!l) throw new NotFoundError('Location')
  const path = (await ancestors(l.parentId)).reverse()
  return {
    id: l.id,
    publicId: l.publicId,
    name: l.name,
    type: l.type,
    description: l.description,
    restaurant: l.restaurant,
    path: path.map(({ id, name, type }) => ({ id, name, type })),
    children: l.children,
    assets: l.assets,
    openWorkOrders: (l.workOrders ?? []).map((w) => ({
      ...w,
      dueDate: w.dueDate?.toISOString() ?? null,
    })),
    can: { report: hasPermission(auth, 'requests:create') },
  }
}

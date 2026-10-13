import {
  guessCategory,
  normalizePhone,
  type PortalInfo,
  type PortalRequestInput,
  type PortalRequestStatus,
} from '@maintainx/shared'
import type { Request as HttpRequest } from 'express'
import { saveAttachments } from '../../core/attachments.js'
import { recordAudit } from '../../core/audit.js'
import { runAutomations } from '../../core/automations.js'
import { nextCode } from '../../core/counters.js'
import { NotFoundError, ValidationError } from '../../core/errors.js'
import { notify, usersWithPermission } from '../../core/notify.js'
import { prisma } from '../../core/prisma.js'
import { workflowSettings } from '../../core/settings.js'

/*
 * The public request portal. The link token is a restaurant's portalId or a
 * location's publicId (the QR on the wall). Nothing works unless the
 * organisation turned the portal on; guests only ever see their own reports.
 */

interface Target {
  organizationId: string
  organization: string
  restaurantId: string
  restaurant: { name: string; city: string | null }
  location: { id: string; name: string } | null
}

const restaurantSelect = {
  id: true,
  name: true,
  city: true,
  organizationId: true,
  organization: { select: { name: true } },
} as const

async function resolve(token: string): Promise<Target> {
  if (!/^[a-zA-Z0-9]{8,64}$/.test(token)) throw new NotFoundError('Portal')
  const active = { status: 'ACTIVE', archivedAt: null } as const
  let target: Target | null = null
  const restaurant = await prisma.restaurant.findFirst({
    where: { portalId: token, ...active },
    select: restaurantSelect,
  })
  if (restaurant) {
    target = {
      organizationId: restaurant.organizationId,
      organization: restaurant.organization.name,
      restaurantId: restaurant.id,
      restaurant: { name: restaurant.name, city: restaurant.city },
      location: null,
    }
  } else {
    const location = await prisma.location.findFirst({
      where: { publicId: token, archivedAt: null, restaurant: active },
      select: { id: true, name: true, restaurant: { select: restaurantSelect } },
    })
    if (location)
      target = {
        organizationId: location.restaurant.organizationId,
        organization: location.restaurant.organization.name,
        restaurantId: location.restaurant.id,
        restaurant: { name: location.restaurant.name, city: location.restaurant.city },
        location: { id: location.id, name: location.name },
      }
  }
  // A switched-off portal looks exactly like a wrong link.
  if (!target || !(await workflowSettings(target.organizationId)).requestPortal)
    throw new NotFoundError('Portal')
  return target
}

/** Unmutable critical alerts a public portal may send per restaurant per hour. */
export const GUEST_CRITICAL_ALERTS_PER_HOUR = 3

export async function portalInfo(token: string): Promise<PortalInfo> {
  const t = await resolve(token)
  const locations = await prisma.location.findMany({
    where: { restaurantId: t.restaurantId, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 200,
  })
  return {
    organization: t.organization,
    restaurant: t.restaurant,
    location: t.location,
    locations,
  }
}

export async function submitPortalRequest(
  token: string,
  input: PortalRequestInput,
  files: Express.Multer.File[] | undefined,
  req: HttpRequest,
): Promise<{ code: string }> {
  const t = await resolve(token)
  let locationId = t.location?.id ?? null
  if (input.locationId) {
    const loc = await prisma.location.findFirst({
      where: { id: input.locationId, restaurantId: t.restaurantId, archivedAt: null },
      select: { id: true },
    })
    if (!loc) throw new ValidationError({ locationId: ['validation.locationNotInRestaurant'] })
    locationId = loc.id
  }
  const phone = normalizePhone(input.phone)
  const description = input.description || input.title

  const created = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, t.organizationId, 'REQ', 6)
    const r = await tx.request.create({
      data: {
        organizationId: t.organizationId,
        code,
        restaurantId: t.restaurantId,
        locationId,
        category: guessCategory(`${input.title} ${input.description}`),
        title: input.title,
        description,
        priority: input.priority,
        requestedById: null,
        guestName: input.name,
        guestPhone: phone,
      },
    })
    await recordAudit(
      {
        organizationId: t.organizationId,
        restaurantId: t.restaurantId,
        actorId: null,
        action: 'request.created',
        entityType: 'REQUEST',
        entityId: r.id,
        newValue: { code, title: r.title, priority: r.priority, via: 'portal', guest: input.name },
      },
      req,
      tx,
    )
    return r
  })
  if (files?.length) {
    try {
      await saveAttachments(files, { type: 'REQUEST', id: created.id }, null)
    } catch (err) {
      // A refused photo (wrong type, too big, unreadable) must not leave a
      // request without its photos behind: the guest retries and would create
      // a duplicate. Nobody has been notified yet, so undo the request.
      await prisma.request.delete({ where: { id: created.id } }).catch(() => undefined)
      throw err
    }
  }

  const reviewers = await usersWithPermission(t.organizationId, t.restaurantId, 'requests:approve')
  const message = {
    organizationId: t.organizationId,
    title: `${created.code} · ${created.title}`,
    body: `${input.name}: ${description}`.slice(0, 300),
    entityType: 'REQUEST',
    entityId: created.id,
    actionUrl: `/requests?open=${created.id}`,
    priority: created.priority,
  }
  await notify(reviewers, { ...message, type: 'NEW_REQUEST' })
  // CRITICAL_ISSUE pages every manager and can't be muted. Anonymous guests
  // can only trigger a few per restaurant per hour; beyond that the request
  // still arrives (NEW_REQUEST, marked critical) but doesn't page anyone.
  if (created.priority === 'CRITICAL') {
    const recentGuestCriticals = await prisma.request.count({
      where: {
        restaurantId: t.restaurantId,
        requestedById: null,
        priority: 'CRITICAL',
        createdAt: { gt: new Date(Date.now() - 3_600_000) },
      },
    })
    if (recentGuestCriticals <= GUEST_CRITICAL_ALERTS_PER_HOUR)
      await notify(reviewers, { ...message, type: 'CRITICAL_ISSUE' })
  }
  await runAutomations('REQUEST_CREATED', {
    organizationId: t.organizationId,
    restaurantId: t.restaurantId,
    requestId: created.id,
    assetId: null,
    priority: created.priority,
    category: created.category,
    label: `${created.code} · ${created.title}`,
  })
  return { code: created.code }
}

const STATUS_DAYS = 180

/** A guest's own reports at this restaurant (by phone), newest first. */
export async function portalStatus(
  token: string,
  rawPhone: string,
): Promise<PortalRequestStatus[]> {
  const t = await resolve(token)
  const rows = await prisma.request.findMany({
    where: {
      restaurantId: t.restaurantId,
      guestPhone: normalizePhone(rawPhone),
      createdAt: { gte: new Date(Date.now() - STATUS_DAYS * 86_400_000) },
    },
    select: {
      code: true,
      title: true,
      category: true,
      priority: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      convertedWorkOrder: { select: { status: true, updatedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return rows.map((r) => ({
    code: r.code,
    title: r.title,
    category: r.category,
    priority: r.priority,
    status: r.status,
    workOrderStatus: r.convertedWorkOrder?.status ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: (r.convertedWorkOrder && r.convertedWorkOrder.updatedAt > r.updatedAt
      ? r.convertedWorkOrder.updatedAt
      : r.updatedAt
    ).toISOString(),
  }))
}

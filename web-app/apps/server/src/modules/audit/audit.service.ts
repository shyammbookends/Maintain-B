import type { AuditLogDto, ListAuditQuery, PagedResponse } from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { canAccessRestaurant, restaurantScope } from '../../core/authz.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import { startOfDateInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Read-only view of the audit trail. Super Admins see everything; anyone else
 * granted audit access sees entries for their restaurants.
 */

const MAX_EXPORT = 20_000

async function whereFor(auth: AuthContext, q: ListAuditQuery): Promise<Prisma.AuditLogWhereInput> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: auth.organizationId },
    select: { timezone: true },
  })
  const and: Prisma.AuditLogWhereInput[] = [{ organizationId: auth.organizationId }]
  if (!auth.isSuperAdmin) and.push({ restaurantId: restaurantScope(auth) })
  if (q.restaurantId)
    and.push({
      restaurantId: canAccessRestaurant(auth, q.restaurantId)
        ? q.restaurantId
        : '00000000-0000-0000-0000-000000000000',
    })
  if (q.entityType) and.push({ entityType: q.entityType })
  if (q.entityId) and.push({ entityId: q.entityId })
  if (q.actorId) and.push({ actorId: q.actorId })
  if (q.q) and.push({ action: { contains: q.q, mode: 'insensitive' } })
  if (q.from) and.push({ createdAt: { gte: startOfDateInZone(org.timezone, q.from) } })
  if (q.to) {
    const next = new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    and.push({ createdAt: { lt: startOfDateInZone(org.timezone, next) } })
  }
  return { AND: and }
}

const include = {
  actor: { select: { id: true, firstName: true, lastName: true } },
  restaurant: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogInclude

const toDto = (a: Prisma.AuditLogGetPayload<{ include: typeof include }>): AuditLogDto => ({
  id: a.id,
  action: a.action,
  entityType: a.entityType,
  entityId: a.entityId,
  actor: a.actor,
  restaurant: a.restaurant,
  oldValue: a.oldValue,
  newValue: a.newValue,
  metadata: a.metadata,
  ip: a.ip,
  userAgent: a.userAgent,
  requestId: a.requestId,
  createdAt: a.createdAt.toISOString(),
})

export async function listAudit(
  auth: AuthContext,
  q: ListAuditQuery,
): Promise<PagedResponse<AuditLogDto>> {
  const where = await whereFor(auth, q)
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include, orderBy: { createdAt: 'desc' }, ...toSkipTake(q) }),
    prisma.auditLog.count({ where }),
  ])
  return toPagedResponse(rows.map(toDto), q, total)
}

export async function exportAudit(auth: AuthContext, q: ListAuditQuery): Promise<AuditLogDto[]> {
  const rows = await prisma.auditLog.findMany({
    where: await whereFor(auth, q),
    include,
    orderBy: { createdAt: 'desc' },
    take: MAX_EXPORT,
  })
  return rows.map(toDto)
}

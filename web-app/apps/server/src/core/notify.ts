import {
  SYSTEM_ROLES,
  UNMUTABLE_NOTIFICATIONS,
  type NotificationType,
  type Permission,
  type Priority,
} from '@maintainx/shared'
import type { Prisma, PrismaClient } from '@prisma/client'
import { deliverExternally } from './delivery.js'
import { signalUsers } from './live.js'
import { prisma } from './prisma.js'

type Db = PrismaClient | Prisma.TransactionClient

export interface NotificationInput {
  organizationId: string
  type: NotificationType
  title: string
  body?: string | null
  entityType: string
  entityId: string
  actionUrl: string
  priority?: Priority
}

/**
 * Stores in-app notifications. The notification centre (Phase 15) reads these;
 * creating them at the source means nothing is missed in the meantime.
 * The actor is never notified about their own action, and users who muted a
 * type in their preferences don't receive it.
 */
export async function notify(
  recipientIds: Iterable<string>,
  input: NotificationInput,
  options: { exclude?: string; db?: Db } = {},
): Promise<void> {
  const db = options.db ?? prisma
  let ids = [...new Set(recipientIds)].filter((id) => id !== options.exclude)
  if (ids.length === 0) return
  // People who muted this type don't get it (critical alerts can't be muted).
  if (!UNMUTABLE_NOTIFICATIONS.includes(input.type)) {
    const muted = await db.notificationPreference.findMany({
      where: { userId: { in: ids }, type: input.type, inApp: false },
      select: { userId: true },
    })
    const skip = new Set(muted.map((m) => m.userId))
    ids = ids.filter((id) => !skip.has(id))
    if (ids.length === 0) return
  }
  await db.notification.createMany({
    data: ids.map((recipientId) => ({
      organizationId: input.organizationId,
      recipientId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      actionUrl: input.actionUrl,
      priority: input.priority ?? 'MEDIUM',
    })),
  })
  deliverExternally(ids, {
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    actionUrl: input.actionUrl,
  })
  // Wake the phones waiting on /push-feed. Slightly later, because notify() can run
  // inside a transaction that hasn't committed yet.
  setTimeout(() => signalUsers(ids), 400)
}

/**
 * Active users who hold `permission` for `restaurantId`: Super Admins, plus
 * anyone assigned to that restaurant through a role granting the permission.
 */
export async function usersWithPermission(
  organizationId: string,
  restaurantId: string,
  permission: Permission,
  db: Db = prisma,
): Promise<string[]> {
  const rows = await db.user.findMany({
    where: {
      organizationId,
      archivedAt: null,
      status: 'ACTIVE',
      OR: [
        { userRoles: { some: { role: { systemKey: SYSTEM_ROLES.SUPER_ADMIN } } } },
        {
          userRestaurants: { some: { restaurantId } },
          userRoles: {
            some: {
              role: {
                kind: 'ADMIN',
                rolePermissions: { some: { permission: { key: permission } } },
              },
            },
          },
        },
      ],
    },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

import {
  NOTIFICATION_TYPE,
  UNMUTABLE_NOTIFICATIONS,
  type ListNotificationsQuery,
  type NotificationDto,
  type NotificationPreferences,
  type NotificationPreferencesInput,
  type PushSubscriptionInput,
  type PagedResponse,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { NotFoundError } from '../../core/errors.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { env } from '../../config/env.js'
import { emailEnabled, pushEnabled } from '../../core/delivery.js'
import { signalUsers } from '../../core/live.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/** Everyone sees only their own notifications. */

const toDto = (n: Prisma.NotificationGetPayload<object>): NotificationDto => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  actionUrl: n.actionUrl,
  priority: n.priority,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
})

export async function listNotifications(
  auth: AuthContext,
  q: ListNotificationsQuery,
): Promise<PagedResponse<NotificationDto> & { unread: number }> {
  const where: Prisma.NotificationWhereInput = {
    recipientId: auth.userId,
    ...(q.unread ? { readAt: null } : {}),
  }
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(q) }),
    prisma.notification.count({ where }),
    unreadCount(auth),
  ])
  return { ...toPagedResponse(rows.map(toDto), q, total), unread }
}

export function unreadCount(auth: AuthContext): Promise<number> {
  return prisma.notification.count({ where: { recipientId: auth.userId, readAt: null } })
}

export async function markRead(auth: AuthContext, id: string): Promise<NotificationDto> {
  const n = await prisma.notification.findFirst({ where: { id, recipientId: auth.userId } })
  if (!n) throw new NotFoundError('Notification')
  if (n.readAt) return toDto(n)
  const updated = await prisma.notification.update({ where: { id }, data: { readAt: new Date() } })
  signalUsers([auth.userId]) // the user's other devices update their badge
  return toDto(updated)
}

export async function markAllRead(auth: AuthContext): Promise<{ updated: number }> {
  const r = await prisma.notification.updateMany({
    where: { recipientId: auth.userId, readAt: null },
    data: { readAt: new Date() },
  })
  if (r.count > 0) signalUsers([auth.userId])
  return { updated: r.count }
}

export async function getPreferences(auth: AuthContext): Promise<NotificationPreferences> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: auth.userId, OR: [{ inApp: false }, { email: true }] },
    select: { type: true, inApp: true, email: true },
  })
  return {
    muted: rows.filter((r) => !r.inApp).map((r) => r.type),
    email: rows.filter((r) => r.email).map((r) => r.type),
    channels: {
      email: emailEnabled(),
      push: pushEnabled(),
      pushKey: pushEnabled() ? (env.VAPID_PUBLIC_KEY ?? null) : null,
    },
  }
}

export async function setPreferences(
  auth: AuthContext,
  input: NotificationPreferencesInput,
): Promise<NotificationPreferences> {
  const muted = new Set(input.muted.filter((t) => !UNMUTABLE_NOTIFICATIONS.includes(t)))
  const current = input.email ? null : await getPreferences(auth)
  const email = new Set(input.email ?? current!.email)
  await prisma.$transaction(
    NOTIFICATION_TYPE.map((type) =>
      prisma.notificationPreference.upsert({
        where: { userId_type: { userId: auth.userId, type } },
        create: { userId: auth.userId, type, inApp: !muted.has(type), email: email.has(type) },
        update: { inApp: !muted.has(type), email: email.has(type) },
      }),
    ),
  )
  return getPreferences(auth)
}

/** Old read notifications are removed so the table stays small (run daily). */
export async function pruneNotifications(now = new Date()): Promise<number> {
  const r = await prisma.notification.deleteMany({
    where: {
      readAt: { lt: new Date(now.getTime() - 90 * 86_400_000) },
      // Overdue alerts are the job's record of "already alerted" (once per work
      // order per year); pruning them early would re-alert (and re-run the
      // overdue automations for) every long-overdue job.
      NOT: {
        type: 'TASK_OVERDUE',
        createdAt: { gte: new Date(now.getTime() - 365 * 86_400_000) },
      },
    },
  })
  return r.count
}

/** Remembers this browser for Web Push (an endpoint belongs to one user at a time). */
export async function subscribePush(
  auth: AuthContext,
  input: PushSubscriptionInput,
  userAgent?: string,
) {
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId: auth.userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
    update: { userId: auth.userId, p256dh: input.keys.p256dh, auth: input.keys.auth },
  })
}

export async function unsubscribePush(auth: AuthContext, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: auth.userId } })
}

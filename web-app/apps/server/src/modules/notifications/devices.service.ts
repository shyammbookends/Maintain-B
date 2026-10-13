import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { UnauthenticatedError } from '../../core/errors.js'
import { waitForUser } from '../../core/live.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Phone app notifications without Firebase. The Android app registers a device
 * and gets a secret key; its background service polls the feed with that key
 * (no access/refresh token, so it never races the app's own session). Devices
 * live in push_subscriptions with an endpoint of `native:<id>`; Web Push skips them.
 */

export const NATIVE_PREFIX = 'native:'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export async function registerDevice(auth: AuthContext, userAgent?: string) {
  const id = randomUUID()
  const secret = randomBytes(32).toString('base64url')
  await prisma.pushSubscription.create({
    data: {
      userId: auth.userId,
      endpoint: `${NATIVE_PREFIX}${id}`,
      p256dh: 'native',
      auth: sha256(secret),
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
  })
  return { deviceId: id, key: `${id}.${secret}` }
}

/**
 * Phone device keys are credentials too: "sign out everywhere", a password
 * change/reset, disable and archive remove them, so a stolen session can't keep
 * reading notifications through a device it registered. The real phone gets a
 * 401 on its next poll and registers again after signing in.
 */
export async function revokeNativeDevices(
  db: Pick<typeof prisma, 'pushSubscription'>,
  userId: string,
): Promise<void> {
  await db.pushSubscription.deleteMany({
    where: { userId, endpoint: { startsWith: NATIVE_PREFIX } },
  })
}

export async function removeDevice(auth: AuthContext, deviceId: string) {
  await prisma.pushSubscription.deleteMany({
    where: { userId: auth.userId, endpoint: `${NATIVE_PREFIX}${deviceId}` },
  })
}

/** The user a device key belongs to (active accounts only). */
async function userForKey(key: string | undefined) {
  const [id, secret] = (key ?? '').split('.')
  if (!id || !secret || !/^[0-9a-f-]{36}$/.test(id)) throw new UnauthenticatedError()
  const sub = await prisma.pushSubscription.findUnique({
    where: { endpoint: `${NATIVE_PREFIX}${id}` },
    include: { user: { select: { id: true, status: true, archivedAt: true } } },
  })
  const expected = Buffer.from(sub?.auth ?? '0'.repeat(64), 'hex')
  const given = Buffer.from(sha256(secret), 'hex')
  if (!sub || expected.length !== given.length || !timingSafeEqual(expected, given))
    throw new UnauthenticatedError()
  if (sub.user.status !== 'ACTIVE' || sub.user.archivedAt) throw new UnauthenticatedError()
  return sub.user.id
}

async function feedFor(userId: string, since: Date) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientId: userId, readAt: null, createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        actionUrl: true,
        priority: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { recipientId: userId, readAt: null } }),
  ])
  return {
    unread,
    items: items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    serverTime: new Date().toISOString(),
  }
}

/**
 * Unread notifications newer than `after` (oldest first) plus the unread total.
 * Long-poll: with `waitMs`, when nothing is new and the unread total still equals
 * `knownUnread`, the answer is held until a notification arrives or one is read
 * (signalUsers) or the time is up — so phones get alerts within a second.
 */
export async function deviceFeed(
  key: string | undefined,
  after: string | undefined,
  options: { waitMs?: number; knownUnread?: number; signal?: AbortSignal } = {},
) {
  const userId = await userForKey(key)
  const since =
    after && !Number.isNaN(Date.parse(after)) ? new Date(after) : new Date(Date.now() - 10 * 60_000)
  const changed = (f: Awaited<ReturnType<typeof feedFor>>) =>
    f.items.length > 0 || (options.knownUnread !== undefined && f.unread !== options.knownUnread)
  let feed = await feedFor(userId, since)
  const until = Date.now() + (options.waitMs ?? 0)
  // Keep waiting through wake-ups that brought nothing new for this phone.
  while (!changed(feed) && !options.signal?.aborted && Date.now() < until) {
    await waitForUser(userId, until - Date.now(), options.signal)
    if (options.signal?.aborted) break
    feed = await feedFor(userId, since)
  }
  return feed
}

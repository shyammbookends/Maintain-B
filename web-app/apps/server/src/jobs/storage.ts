import type { StorageUsage } from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { env } from '../config/env.js'
import { compactPhoto } from '../core/images.js'
import { logger } from '../core/logger.js'
import { notify } from '../core/notify.js'
import { prisma } from '../core/prisma.js'
import { storagePolicy } from '../core/settings.js'
import { storage } from '../storage/index.js'

/*
 * Keeps file storage small enough for the plan, without losing records:
 *   1. photos older than `compactPhotosAfterDays` are re-saved smaller;
 *   2. videos older than `keepVideosDays` are removed;
 *   3. any file older than `keepFilesYears` is removed.
 * Work orders, requests, reports and history (text) are never deleted here;
 * a removed file shows as "removed by retention" where it used to be.
 * Each run handles a bounded batch so it fits in a serverless cron call.
 */

const DAY = 86_400_000
const BATCH = 40

async function readAll(key: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of await storage.getStream(key)) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function removeFiles(a: { id: string; storageKey: string; thumbKey: string | null }) {
  await storage.delete(a.storageKey).catch(() => undefined)
  if (a.thumbKey) await storage.delete(a.thumbKey).catch(() => undefined)
  await prisma.attachment.update({
    where: { id: a.id },
    data: { fileRemovedAt: new Date(), sizeBytes: 0 },
  })
}

async function orgsOf() {
  return prisma.organization.findMany({ select: { id: true } })
}

/**
 * Files of an organization (attachments have no organization column): by the
 * uploader, plus portal guests' photos, which belong to the organization of
 * the request they were sent with. (Matching every uploader-less file would
 * apply one organization's retention policy to another's guest photos.)
 */
async function inOrg(organizationId: string): Promise<Prisma.AttachmentWhereInput> {
  const guest = await prisma.$queryRaw<Array<{ owner_id: string }>>`
    SELECT DISTINCT a.owner_id FROM attachments a
    JOIN requests r ON r.id = a.owner_id
    WHERE a.uploaded_by_id IS NULL AND a.owner_type = 'REQUEST'
      AND r.organization_id = ${organizationId}::uuid`
  return {
    OR: [
      { uploadedBy: { organizationId } },
      ...(guest.length
        ? [
            {
              uploadedById: null,
              ownerType: 'REQUEST' as const,
              ownerId: { in: guest.map((g) => g.owner_id) },
            },
          ]
        : []),
    ],
  }
}

export async function compactOldPhotos(now = new Date()): Promise<number> {
  let done = 0
  for (const org of await orgsOf()) {
    const policy = await storagePolicy(org.id)
    const rows = await prisma.attachment.findMany({
      where: {
        ...(await inOrg(org.id)),
        kind: 'PHOTO',
        compactedAt: null,
        fileRemovedAt: null,
        createdAt: { lt: new Date(now.getTime() - policy.compactPhotosAfterDays * DAY) },
      },
      select: { id: true, storageKey: true, thumbKey: true, sizeBytes: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    })
    for (const r of rows) {
      try {
        const original = await readAll(r.storageKey)
        const smaller = await compactPhoto(original)
        if (smaller) await storage.put(r.storageKey, smaller, { mimeType: 'image/webp' })
        const thumbBytes = Math.max(0, r.sizeBytes - original.length)
        await prisma.attachment.update({
          where: { id: r.id },
          data: {
            compactedAt: now,
            ...(smaller ? { sizeBytes: smaller.length + thumbBytes, mimeType: 'image/webp' } : {}),
          },
        })
        done++
      } catch (err) {
        // A missing or unreadable file is marked so it isn't retried forever.
        logger.warn({ err, attachmentId: r.id }, 'photo compaction failed')
        await prisma.attachment.update({ where: { id: r.id }, data: { compactedAt: now } })
      }
    }
  }
  return done
}

export async function expireOldFiles(now = new Date()): Promise<{ videos: number; files: number }> {
  let videos = 0
  let files = 0
  for (const org of await orgsOf()) {
    const policy = await storagePolicy(org.id)
    const oldVideos = await prisma.attachment.findMany({
      where: {
        ...(await inOrg(org.id)),
        kind: 'VIDEO',
        fileRemovedAt: null,
        createdAt: { lt: new Date(now.getTime() - policy.keepVideosDays * DAY) },
      },
      select: { id: true, storageKey: true, thumbKey: true },
      take: BATCH,
    })
    for (const v of oldVideos) {
      await removeFiles(v)
      videos++
    }
    const cutoff = new Date(now)
    cutoff.setFullYear(cutoff.getFullYear() - policy.keepFilesYears)
    const old = await prisma.attachment.findMany({
      where: { ...(await inOrg(org.id)), fileRemovedAt: null, createdAt: { lt: cutoff } },
      select: { id: true, storageKey: true, thumbKey: true },
      take: BATCH,
    })
    for (const a of old) {
      await removeFiles(a)
      files++
    }
  }
  return { videos, files }
}

export async function storageUsage(organizationId: string): Promise<StorageUsage> {
  const scope = await inOrg(organizationId)
  const sumKind = (kind: 'PHOTO' | 'VIDEO' | 'AUDIO' | 'FILE') =>
    prisma.attachment.aggregate({
      where: { ...scope, kind, fileRemovedAt: null },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    })
  const since = new Date(Date.now() - 30 * DAY)
  const [photos, videos, audio, files, documents, recent, db, policy] = await Promise.all([
    sumKind('PHOTO'),
    sumKind('VIDEO'),
    sumKind('AUDIO'),
    sumKind('FILE'),
    prisma.document.aggregate({
      where: { organizationId, archivedAt: null },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    }),
    prisma.attachment.aggregate({
      where: { ...scope, createdAt: { gte: since } },
      _sum: { sizeBytes: true },
    }),
    prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`,
    storagePolicy(organizationId),
  ])
  const p = photos._sum.sizeBytes ?? 0
  const v = videos._sum.sizeBytes ?? 0
  const a = audio._sum.sizeBytes ?? 0
  const d = (documents._sum.sizeBytes ?? 0) + (files._sum.sizeBytes ?? 0)
  const total = p + v + a + d
  const quota = env.STORAGE_QUOTA_MB * 1024 * 1024
  const daily = Math.round((recent._sum.sizeBytes ?? 0) / 30)
  return {
    files: { photos: p, videos: v, audio: a, documents: d, total },
    counts: {
      photos: photos._count._all,
      videos: videos._count._all,
      audio: audio._count._all,
      documents: documents._count._all + files._count._all,
    },
    databaseBytes: Number(db[0]?.size ?? 0),
    fileQuotaBytes: quota,
    databaseQuotaBytes: env.DATABASE_QUOTA_MB * 1024 * 1024,
    dailyGrowthBytes: daily,
    daysUntilFull: daily > 0 ? Math.max(0, Math.floor((quota - total) / daily)) : null,
    policy,
    driver: env.STORAGE_DRIVER,
  }
}

/** Tells Super Admins when files or the database pass 80% / 95% of the plan (once a week). */
export async function storageAlerts(now = new Date()): Promise<number> {
  let sent = 0
  for (const org of await orgsOf()) {
    const u = await storageUsage(org.id)
    const filePct = u.files.total / u.fileQuotaBytes
    const dbPct = u.databaseBytes / u.databaseQuotaBytes
    const worst = Math.max(filePct, dbPct)
    if (worst < 0.8) continue
    const recent = await prisma.notification.count({
      where: {
        organizationId: org.id,
        type: 'STORAGE_ALERT',
        createdAt: { gte: new Date(now.getTime() - 7 * DAY) },
      },
    })
    if (recent) continue
    const admins = await prisma.user.findMany({
      where: {
        organizationId: org.id,
        archivedAt: null,
        status: 'ACTIVE',
        userRoles: { some: { role: { systemKey: 'SUPER_ADMIN' } } },
      },
      select: { id: true },
    })
    const which = filePct >= dbPct ? 'File storage' : 'Database'
    await notify(
      admins.map((x) => x.id),
      {
        organizationId: org.id,
        type: 'STORAGE_ALERT',
        title: `${which} ${Math.round(worst * 100)}% full`,
        body:
          worst >= 0.95
            ? 'Almost full: shorten the retention settings or move to a paid plan.'
            : 'Getting full: check the storage page.',
        entityType: 'SETTING',
        entityId: org.id,
        actionUrl: '/storage',
        priority: worst >= 0.95 ? 'CRITICAL' : 'HIGH',
      },
    )
    sent++
  }
  return sent
}

export async function runStorageJobs(now = new Date()) {
  return {
    compacted: await compactOldPhotos(now),
    expired: await expireOldFiles(now),
    alerts: await storageAlerts(now),
  }
}

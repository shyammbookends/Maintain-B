import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type StorageUsage,
  type WorkOrderDetail,
} from '@maintainx/shared'
import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { compactOldPhotos, expireOldFiles, storageAlerts, storageUsage } from '../jobs/storage.js'
import { storage } from '../storage/index.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'

/* Photos are stored small with thumbnails; old files shrink or expire; Super Admins see usage. */

const app = createApp()
let fx: Fixture
let boss: string
let admin: string
let workerId: string
let camera: Buffer

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}

beforeAll(async () => {
  // A 3000×2000 "phone photo" with detail so it compresses realistically.
  const noise = Buffer.alloc(3000 * 2000 * 3)
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24
  camera = await sharp(noise, { raw: { width: 3000, height: 2000, channels: 3 } })
    .blur(1.2)
    .jpeg({ quality: 90 })
    .toBuffer()
})

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 1 })
  await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
  await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: fx.restaurantIds })
  workerId = (
    await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: fx.restaurantIds })
  ).id
  boss = await tokenFor('boss')
  admin = await tokenFor('admin')
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function jobWithPhoto() {
  const w = (
    await request(app).post('/api/v1/work-orders').set('Authorization', `Bearer ${admin}`).send({
      title: 'Fridge',
      description: '',
      category: 'REFRIGERATION',
      priority: 'MEDIUM',
      restaurantId: fx.restaurantIds[0],
      locationId: '',
      assetId: '',
      dueDate: '',
      assignedUserId: workerId,
      assignedTeamId: '',
      requestId: '',
    })
  ).body.data as WorkOrderDetail
  const res = await request(app)
    .post(`/api/v1/work-orders/${w.id}/attachments`)
    .set('Authorization', `Bearer ${admin}`)
    .attach('files', camera, 'photo.jpg')
  return res.body.data as WorkOrderDetail
}

describe('storage and retention', () => {
  it('stores photos as small WebP with a thumbnail', async () => {
    const d = await jobWithPhoto()
    const a = d.attachments[0]!
    expect(a).toMatchObject({ mimeType: 'image/webp', removed: false })
    expect(a.thumbUrl).toBeTruthy()
    const row = await prisma.attachment.findFirstOrThrow()
    expect(row.width).toBeLessThanOrEqual(1280)
    expect(row.thumbKey).toMatch(/-thumb\.webp$/)
    expect(await storage.exists(row.thumbKey!)).toBe(true)
    expect(row.sizeBytes).toBeLessThan(camera.length / 2)
  })

  it('drops location and other metadata even from small photos', { timeout: 60_000 }, async () => {
    // Noisy and already heavily compressed: re-encoding doesn't make it smaller.
    const noise = Buffer.alloc(300 * 300 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24
    const small = await sharp(noise, { raw: { width: 300, height: 300, channels: 3 } })
      .jpeg({ quality: 20 })
      .withExif({ IFD0: { Copyright: 'SECRET-GPS-MARKER' } })
      .toBuffer()
    expect(small.includes('SECRET-GPS-MARKER')).toBe(true)
    const w = (await jobWithPhoto()) as WorkOrderDetail
    await request(app)
      .post(`/api/v1/work-orders/${w.id}/attachments`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('files', small, 'tiny.jpg')
    const row = await prisma.attachment.findFirstOrThrow({ where: { fileName: { startsWith: 'tiny' } } })
    const chunks: Buffer[] = []
    for await (const c of await storage.getStream(row.storageKey)) chunks.push(Buffer.from(c))
    expect(Buffer.concat(chunks).includes('SECRET-GPS-MARKER')).toBe(false)
  })

  it(
    'shrinks old photos and removes expired videos and files, keeping the records',
    { timeout: 60_000 },
    async () => {
      await jobWithPhoto()
      const photo = await prisma.attachment.findFirstOrThrow()
      const day = 86_400_000
      await prisma.attachment.update({
        where: { id: photo.id },
        data: { createdAt: new Date(Date.now() - 200 * day) },
      })
      expect(await compactOldPhotos()).toBe(1)
      const compacted = await prisma.attachment.findUniqueOrThrow({ where: { id: photo.id } })
      expect(compacted.compactedAt).not.toBeNull()
      expect(compacted.sizeBytes).toBeLessThan(photo.sizeBytes)
      expect(await compactOldPhotos()).toBe(0)

      const video = await prisma.attachment.create({
        data: {
          ownerType: photo.ownerType,
          ownerId: photo.ownerId,
          kind: 'VIDEO',
          storageKey: 'attachments/2025/01/old-video.mp4',
          fileName: 'clip.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 5_000_000,
          uploadedById: photo.uploadedById,
          createdAt: new Date(Date.now() - 400 * day),
        },
      })
      await storage.put(video.storageKey, Buffer.from('fake video'), { mimeType: 'video/mp4' })
      await prisma.attachment.update({
        where: { id: photo.id },
        data: { createdAt: new Date(Date.now() - 6 * 365 * day) },
      })
      expect(await expireOldFiles()).toEqual({ videos: 1, files: 1 })
      expect(await storage.exists(video.storageKey)).toBe(false)
      const rows = await prisma.attachment.findMany({ orderBy: { createdAt: 'asc' } })
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.fileRemovedAt && r.sizeBytes === 0)).toBe(true)
      // The job still shows the record, marked removed.
      const d = (
        await request(app)
          .get(`/api/v1/work-orders/${photo.ownerId}`)
          .set('Authorization', `Bearer ${admin}`)
      ).body.data as WorkOrderDetail
      expect(d.attachments.every((x) => x.removed && x.url === '')).toBe(true)
    },
  )

  it(
    'shows usage to Super Admins, saves the policy and warns near the limit',
    { timeout: 60_000 },
    async () => {
      await jobWithPhoto()
      const res = await request(app).get('/api/v1/storage').set('Authorization', `Bearer ${boss}`)
      expect(res.status).toBe(200)
      const u = res.body.data as StorageUsage
      expect(u.counts.photos).toBe(1)
      expect(u.files.photos).toBeGreaterThan(0)
      expect(u.databaseBytes).toBeGreaterThan(0)
      expect(u.policy).toEqual({
        compactPhotosAfterDays: 180,
        keepVideosDays: 365,
        keepFilesYears: 5,
      })
      expect(
        (await request(app).get('/api/v1/storage').set('Authorization', `Bearer ${admin}`)).status,
      ).toBe(403)

      const saved = await request(app)
        .put('/api/v1/storage/policy')
        .set('Authorization', `Bearer ${boss}`)
        .send({ compactPhotosAfterDays: 90, keepVideosDays: 180, keepFilesYears: 5 })
      expect(saved.body.data.policy.compactPhotosAfterDays).toBe(90)

      // Pretend the plan is nearly full.
      await prisma.attachment.updateMany({ data: { sizeBytes: 1000 * 1024 * 1024 } })
      expect(await storageAlerts()).toBe(1)
      expect(await storageAlerts()).toBe(0)
      expect(await prisma.notification.count({ where: { type: 'STORAGE_ALERT' } })).toBe(1)
    },
  )

  it("one organization's retention policy never touches another's portal (guest) photos", { timeout: 60_000 }, async () => {
    // Org B keeps videos for 30 days only; org A (the fixture) keeps them a year.
    const orgB = await prisma.organization.create({ data: { name: 'Other', slug: 'other' } })
    await prisma.setting.create({
      data: {
        organizationId: orgB.id,
        scope: 'ORGANIZATION',
        scopeKey: 'org',
        key: 'storage.policy',
        value: { compactPhotosAfterDays: 180, keepVideosDays: 30, keepFilesYears: 5 },
      },
    })
    const req = await prisma.request.create({
      data: {
        organizationId: fx.orgId,
        code: 'REQ-000001',
        restaurantId: fx.restaurantIds[0]!,
        title: 'Leak',
        description: 'Guest report',
        guestName: 'Guest',
      },
    })
    const twoMonthsAgo = new Date(Date.now() - 60 * 86_400_000)
    const guestVideo = await prisma.attachment.create({
      data: {
        ownerType: 'REQUEST',
        ownerId: req.id,
        kind: 'VIDEO',
        storageKey: 'test/guest-video.mp4',
        fileName: 'guest.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 5000,
        uploadedById: null,
        createdAt: twoMonthsAgo,
      },
    })
    expect((await storageUsage(orgB.id)).counts.videos).toBe(0)
    expect((await storageUsage(fx.orgId)).counts.videos).toBe(1)
    await expireOldFiles()
    const after = await prisma.attachment.findUniqueOrThrow({ where: { id: guestVideo.id } })
    expect(after.fileRemovedAt).toBeNull()
  })
})

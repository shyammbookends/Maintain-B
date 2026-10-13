import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type DocumentDto,
  type NotificationDto,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { notify } from '../../core/notify.js'
import { prisma } from '../../core/prisma.js'
import { dueSoonAlerts, overdueWorkOrderAlerts, runAlerts } from '../../jobs/alerts.js'
import { pruneNotifications } from './notifications.service.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'

const app = createApp()
let fx: Fixture
let R: string[]
let ids: Record<'boss' | 'admin' | 'admin2' | 'worker', string>
let boss: ReturnType<typeof api>
let admin: ReturnType<typeof api>
let admin2: ReturnType<typeof api>
let worker: ReturnType<typeof api>

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}

function api(token: string) {
  const h = { Authorization: `Bearer ${token}` }
  return {
    get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
    post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b),
    put: (u: string, b?: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
    del: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
    upload: (u: string, fields: Record<string, string>, file: { buf: Buffer; name: string }) => {
      const r = request(app).post(`/api/v1${u}`).set(h)
      for (const [k, v] of Object.entries(fields)) r.field(k, v)
      return r.attach('file', file.buf, file.name)
    },
  }
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const DAY = 86_400_000

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  const users = {
    boss: await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' }),
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    admin2: await fx.createUser({ role: 'ADMIN', username: 'admin2', restaurants: [R[1]!] }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  boss = api(await tokenFor('boss'))
  admin = api(await tokenFor('admin'))
  admin2 = api(await tokenFor('admin2'))
  worker = api(await tokenFor('worker'))
})

afterAll(async () => {
  await prisma.$disconnect()
})

const ping = (recipientId: string, type: 'PM_DUE' | 'CRITICAL_ISSUE' = 'PM_DUE') =>
  notify([recipientId], {
    organizationId: fx.orgId,
    type,
    title: 'Hello',
    entityType: 'WORK_ORDER',
    entityId: '00000000-0000-4000-8000-000000000001',
    actionUrl: '/work-orders/00000000-0000-4000-8000-000000000001',
  })

describe('notification centre', () => {
  it('lists my notifications only, counts unread and marks them read', async () => {
    await ping(ids.worker)
    await ping(ids.worker)
    await ping(ids.admin)
    const list = (await worker.get('/notifications')).body
    expect(list.meta.total).toBe(2)
    expect(list.unread).toBe(2)
    const first = list.data[0] as NotificationDto
    expect((await admin.post(`/notifications/${first.id}/read`)).status).toBe(404)
    expect((await worker.post(`/notifications/${first.id}/read`)).body.data.readAt).toBeTruthy()
    expect((await worker.get('/notifications/unread-count')).body.data.count).toBe(1)
    expect((await worker.get('/notifications?unread=1')).body.meta.total).toBe(1)
    expect((await worker.post('/notifications/read-all')).body.data.updated).toBe(1)
    expect((await worker.get('/notifications/unread-count')).body.data.count).toBe(0)
  })

  it('respects muted types, except critical alerts', async () => {
    const res = await worker.put('/notifications/preferences', {
      muted: ['PM_DUE', 'CRITICAL_ISSUE'],
    })
    expect(res.body.data.muted).toEqual(['PM_DUE'])
    await ping(ids.worker, 'PM_DUE')
    await ping(ids.worker, 'CRITICAL_ISSUE')
    const list = (await worker.get('/notifications')).body.data as NotificationDto[]
    expect(list.map((n) => n.type)).toEqual(['CRITICAL_ISSUE'])
    expect((await worker.get('/notifications/preferences')).body.data.muted).toEqual(['PM_DUE'])
  })

  it('a message on a task reaches the other side', async () => {
    const w = (
      await admin.post('/work-orders', {
        title: 'Fix tap',
        description: '',
        category: 'PLUMBING',
        priority: 'MEDIUM',
        restaurantId: R[0],
        locationId: '',
        assetId: '',
        dueDate: '',
        assignedUserId: ids.worker,
        assignedTeamId: '',
        requestId: '',
      })
    ).body.data as WorkOrderDetail
    await admin.post(`/work-orders/${w.id}/messages`, { body: 'Please check the valve' })
    await worker.post(`/work-orders/${w.id}/messages`, { body: 'Valve replaced' })
    const forWorker = await prisma.notification.findMany({
      where: { recipientId: ids.worker, type: 'NEW_MESSAGE' },
    })
    const forAdmin = await prisma.notification.findMany({
      where: { recipientId: ids.admin, type: 'NEW_MESSAGE' },
    })
    expect(forWorker.map((n) => n.body)).toEqual(['Please check the valve'])
    expect(forAdmin.map((n) => n.body)).toEqual(['Valve replaced'])
  })
})

describe('alerts job', () => {
  it('reports overdue work, ending warranties and expiring documents once each', async () => {
    const now = new Date()
    await admin.post('/work-orders', {
      title: 'Clean hood',
      description: '',
      category: 'CLEANING',
      priority: 'HIGH',
      restaurantId: R[0],
      locationId: '',
      assetId: '',
      dueDate: new Date(now.getTime() - DAY).toISOString(),
      assignedUserId: ids.worker,
      assignedTeamId: '',
      requestId: '',
    })
    const cat = await prisma.assetCategory.create({
      data: { organizationId: fx.orgId, name: 'Fridge' },
    })
    await prisma.asset.create({
      data: {
        organizationId: fx.orgId,
        restaurantId: R[0]!,
        categoryId: cat.id,
        name: 'Freezer',
        assetCode: 'AST-0001',
        publicId: 'abcdefabcdef',
        warrantyEnd: new Date(now.getTime() + 10 * DAY),
      },
    })
    await admin.upload(
      '/documents',
      {
        ownerType: 'RESTAURANT',
        ownerId: R[0]!,
        title: 'FSSAI licence',
        docType: 'LICENSE',
        issuedAt: '',
        expiresAt: new Date(now.getTime() + 5 * DAY).toISOString().slice(0, 10),
      },
      { buf: PDF, name: 'fssai.pdf' },
    )

    expect(await runAlerts(now)).toMatchObject({
      overdue: 1,
      warranty: 1,
      documents: 1,
      contracts: 0,
    })
    expect(await runAlerts(now)).toEqual({
      overdue: 0,
      dueSoon: 0,
      warranty: 0,
      documents: 0,
      contracts: 0,
    })

    const forWorker = await prisma.notification.findMany({ where: { recipientId: ids.worker } })
    expect(forWorker.map((n) => n.type)).toContain('TASK_OVERDUE')
    expect(forWorker.find((n) => n.type === 'TASK_OVERDUE')!.actionUrl).toMatch(/^\/w\/tasks\//)
    const adminTypes = (
      await prisma.notification.findMany({ where: { recipientId: ids.admin } })
    ).map((n) => n.type)
    expect(adminTypes).toEqual(
      expect.arrayContaining(['TASK_OVERDUE', 'WARRANTY_EXPIRY', 'DOCUMENT_EXPIRY']),
    )
    expect(await prisma.notification.count({ where: { recipientId: ids.admin2 } })).toBe(0)
  })
})

describe('documents', () => {
  it('uploads by content type, scopes by restaurant and archives', async () => {
    const up = await admin.upload(
      '/documents',
      {
        ownerType: 'RESTAURANT',
        ownerId: R[0]!,
        title: 'Fire NOC',
        docType: 'CERTIFICATE',
        issuedAt: '2026-01-01',
        expiresAt: '2025-12-31',
      },
      { buf: PDF, name: 'noc.pdf' },
    )
    expect(up.body.error.fieldErrors).toEqual({ expiresAt: ['validation.endBeforeStart'] })

    const ok = await admin.upload(
      '/documents',
      {
        ownerType: 'RESTAURANT',
        ownerId: R[0]!,
        title: 'Fire NOC',
        docType: 'CERTIFICATE',
        issuedAt: '',
        expiresAt: '2020-01-01',
      },
      { buf: PDF, name: 'noc.pdf' },
    )
    expect(ok.status).toBe(201)
    const d = ok.body.data as DocumentDto
    expect(d).toMatchObject({
      mimeType: 'application/pdf',
      fileName: 'noc.pdf',
      expiry: 'expired',
      owner: { name: 'Restaurant R1' },
    })
    expect(d.downloadUrl).toContain('dl=1')

    const fake = await admin.upload(
      '/documents',
      {
        ownerType: 'RESTAURANT',
        ownerId: R[0]!,
        title: 'Evil',
        docType: 'OTHER',
        issuedAt: '',
        expiresAt: '',
      },
      { buf: Buffer.from('MZ\x90\x00binary'), name: 'evil.pdf' },
    )
    expect(fake.status).toBe(415)

    expect(
      (
        await admin.upload(
          '/documents',
          {
            ownerType: 'RESTAURANT',
            ownerId: R[1]!,
            title: 'X1',
            docType: 'OTHER',
            issuedAt: '',
            expiresAt: '',
          },
          { buf: PDF, name: 'x.pdf' },
        )
      ).body.error.fieldErrors,
    ).toEqual({ ownerId: ['validation.invalidValue'] })

    expect((await admin2.get('/documents')).body.meta.total).toBe(0)
    expect((await boss.get('/documents?expiry=expired')).body.meta.total).toBe(1)
    expect(
      (await worker.get(`/documents?ownerType=RESTAURANT&ownerId=${R[0]}`)).body.meta.total,
    ).toBe(1)
    expect((await worker.del(`/documents/${d.id}`)).status).toBe(404) // not theirs, no delete permission

    const renamed = await admin.put(`/documents/${d.id}`, {
      title: 'Fire NOC 2026',
      docType: 'CERTIFICATE',
      issuedAt: '',
      expiresAt: '2030-01-01',
    })
    expect(renamed.body.data).toMatchObject({ title: 'Fire NOC 2026', expiry: 'valid' })
    expect((await admin.del(`/documents/${d.id}`)).status).toBe(204)
    expect((await admin.get('/documents')).body.meta.total).toBe(0)
  })
})

describe('overdue alerts at scale', () => {
  it('keeps alerting newly overdue work when hundreds were already alerted, and only once', async () => {
    const now = new Date()
    const due = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000)
    // 520 long-overdue jobs that were alerted (and read) months ago.
    await prisma.workOrder.createMany({
      data: Array.from({ length: 520 }, (_, i) => ({
        organizationId: fx.orgId,
        code: `WO-OLD-${i}`,
        title: 'Old job',
        restaurantId: R[0]!,
        createdById: ids.admin,
        status: 'OPEN' as const,
        dueDate: due(200),
      })),
    })
    const old = await prisma.workOrder.findMany({ select: { id: true } })
    await prisma.notification.createMany({
      data: old.map((w) => ({
        organizationId: fx.orgId,
        recipientId: ids.admin,
        type: 'TASK_OVERDUE' as const,
        title: 'old',
        entityType: 'WORK_ORDER',
        entityId: w.id,
        readAt: due(150),
        createdAt: due(199),
      })),
    })
    // Read alerts are pruned after 90 days, but an overdue alert must still count as sent.
    await pruneNotifications(now)
    const fresh = await prisma.workOrder.create({
      data: {
        organizationId: fx.orgId,
        code: 'WO-NEW',
        title: 'Just overdue',
        restaurantId: R[0]!,
        createdById: ids.admin,
        status: 'OPEN',
        dueDate: due(0.1),
      },
    })
    expect(await overdueWorkOrderAlerts(now)).toBe(1)
    expect(
      await prisma.notification.count({ where: { entityId: fresh.id, type: 'TASK_OVERDUE' } }),
    ).toBeGreaterThan(0)
    expect(await overdueWorkOrderAlerts(now)).toBe(0)
  })
})

describe('documents follow the visibility of what they are attached to', () => {
  it("a User doesn't see (or attach to) other people's work orders' documents", async () => {
    const wo = (title: string, assignedUserId: string) =>
      admin.post('/work-orders', {
        title,
        description: '',
        category: 'PLUMBING',
        priority: 'MEDIUM',
        restaurantId: R[0],
        locationId: '',
        assetId: '',
        dueDate: '',
        assignedUserId,
        assignedTeamId: '',
        requestId: '',
      })
    const mine = (await wo('My job', ids.worker)).body.data as WorkOrderDetail
    const other = (await wo('Secret job', '')).body.data as WorkOrderDetail
    const doc = (ownerId: string, title: string) =>
      admin.upload(
        '/documents',
        { ownerType: 'WORK_ORDER', ownerId, title, docType: 'OTHER', issuedAt: '', expiresAt: '' },
        { buf: PDF, name: 'q.pdf' },
      )
    expect((await doc(mine.id, 'Quote for my job')).status).toBe(201)
    expect((await doc(other.id, 'Quote for the secret job')).status).toBe(201)

    const list = (await worker.get('/documents')).body.data as DocumentDto[]
    expect(list.map((d) => d.title)).toEqual(['Quote for my job'])
    expect(
      (await worker.get(`/documents?ownerType=WORK_ORDER&ownerId=${other.id}`)).status,
    ).toBe(400)
    const attach = await worker.upload(
      '/documents',
      { ownerType: 'WORK_ORDER', ownerId: other.id, title: 'x', docType: 'OTHER', issuedAt: '', expiresAt: '' },
      { buf: PDF, name: 'x.pdf' },
    )
    expect(attach.status).toBe(400)
    // Admins still see both.
    expect((await admin.get('/documents')).body.meta.total).toBe(2)
  })
})

describe('due-soon reminder text', () => {
  it('shows the due time in the organization time zone, readable', async () => {
    await prisma.workOrder.create({
      data: {
        organizationId: fx.orgId,
        code: 'WO-SOON',
        title: 'Descale',
        restaurantId: R[0]!,
        createdById: ids.admin,
        status: 'ASSIGNED',
        assignedUserId: ids.worker,
        dueDate: new Date('2026-10-11T12:09:18.124Z'),
      },
    })
    expect(await dueSoonAlerts(new Date('2026-10-11T06:00:00Z'))).toBe(1)
    const n = await prisma.notification.findFirstOrThrow({ where: { type: 'DUE_SOON' } })
    expect(n.body).toBe('Due 11 Oct 2026, 5:39 pm')
  })
})

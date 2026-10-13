import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  DEFAULT_WORKFLOW,
  addRepeat,
  type PortalRequestStatus,
  type SavedViewDto,
  type SearchResults,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'
import { GUEST_CRITICAL_ALERTS_PER_HOUR } from './portal/portal.service.js'

/* Phase A: public request portal, repeating work orders, global search, saved views. */

const app = createApp()
let fx: Fixture
let tokens: Record<string, string>
let workerId: string
let portalId: string

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}
const as = (who: string) => {
  const h = { Authorization: `Bearer ${tokens[who]}` }
  return {
    get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
    post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b),
    put: (u: string, b?: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
    delete: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
  }
}
const guest = {
  get: (u: string) => request(app).get(`/api/v1${u}`),
  post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).send(b),
}

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2, workflow: 'simple' })
  await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
  await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [fx.restaurantIds[0]!] })
  workerId = (
    await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [fx.restaurantIds[0]!] })
  ).id
  tokens = {
    boss: await tokenFor('boss'),
    admin: await tokenFor('admin'),
    worker: await tokenFor('worker'),
  }
  portalId = (await prisma.restaurant.findUniqueOrThrow({ where: { id: fx.restaurantIds[0] } }))
    .portalId
})

afterAll(async () => {
  await prisma.$disconnect()
})

const enablePortal = () =>
  as('boss').put('/settings/workflow', { ...DEFAULT_WORKFLOW, requestPortal: true })

describe('public request portal', () => {
  it('guests can page managers with CRITICAL only a few times an hour', async () => {
    await enablePortal()
    const send = () =>
      request(app)
        .post(`/api/v1/public/portal/${portalId}/requests`)
        .field('name', 'Prankster')
        .field('phone', '98765 43210')
        .field('title', 'Gas leak!!')
        .field('description', 'Smells like gas')
        .field('priority', 'CRITICAL')
    for (let i = 0; i < GUEST_CRITICAL_ALERTS_PER_HOUR + 2; i++)
      expect((await send()).status).toBe(201)
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } })
    const count = (type: string) =>
      prisma.notification.count({ where: { recipientId: admin.id, type: type as never } })
    // Every report still arrives; only the unmutable page is capped.
    expect(await count('NEW_REQUEST')).toBe(GUEST_CRITICAL_ALERTS_PER_HOUR + 2)
    expect(await count('CRITICAL_ISSUE')).toBe(GUEST_CRITICAL_ALERTS_PER_HOUR)
  })

  it('a refused photo leaves no request behind (no duplicates on retry)', async () => {
    await enablePortal()
    const res = await request(app)
      .post(`/api/v1/public/portal/${portalId}/requests`)
      .field('name', 'Asha')
      .field('phone', '98765 43210')
      .field('title', 'Broken photo')
      .field('description', 'The photo is corrupt')
      .field('priority', 'HIGH')
      // JPEG magic bytes followed by garbage: passes the type sniff, can't be decoded.
      .attach(
        'files',
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]),
        {
          filename: 'bad.jpg',
          contentType: 'image/jpeg',
        },
      )
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(await prisma.request.count({ where: { title: 'Broken photo' } })).toBe(0)
    expect(await prisma.attachment.count()).toBe(0)
  })

  it('is closed until an admin turns it on', async () => {
    expect((await guest.get(`/public/portal/${portalId}`)).status).toBe(404)
    await enablePortal()
    const info = await guest.get(`/public/portal/${portalId}`)
    expect(info.status).toBe(200)
    expect(info.body.data.restaurant.name).toBe('Restaurant R1')
    expect((await guest.get('/public/portal/nottherealtoken1')).status).toBe(404)
  })

  it('takes a guest report with a photo, tells reviewers, and shows status by phone', async () => {
    await enablePortal()
    const loc = await prisma.location.create({
      data: { organizationId: fx.orgId, restaurantId: fx.restaurantIds[0]!, name: 'Kitchen' },
    })
    // The location's QR code opens the portal with the location already chosen.
    expect((await guest.get(`/public/portal/${loc.publicId}`)).body.data.location.name).toBe(
      'Kitchen',
    )
    const res = await request(app)
      .post(`/api/v1/public/portal/${loc.publicId}/requests`)
      .field('name', 'Asha')
      .field('phone', '98765 43210')
      .field('title', 'Sink leaking')
      .field('description', 'Water under the dish sink')
      .field('priority', 'HIGH')
      .attach(
        'files',
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'base64',
        ),
        'leak.png',
      )
    expect(res.status).toBe(201)
    const code = res.body.data.code as string
    const saved = await prisma.request.findFirstOrThrow({ where: { code } })
    expect(saved).toMatchObject({
      requestedById: null,
      guestName: 'Asha',
      guestPhone: '+919876543210',
      locationId: loc.id,
      category: 'PLUMBING',
    })
    expect(await prisma.attachment.count({ where: { ownerId: saved.id } })).toBe(1)
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } })
    expect(
      await prisma.notification.count({ where: { recipientId: admin.id, type: 'NEW_REQUEST' } }),
    ).toBe(1)

    // Admins see the guest as the reporter.
    const list = await as('admin').get('/requests')
    expect(list.body.data[0]).toMatchObject({ requestedBy: null, guest: { name: 'Asha' } })

    // Status: only with the same phone, only at this restaurant.
    const mine = await guest.post(`/public/portal/${portalId}/status`, { phone: '9876543210' })
    expect((mine.body.data as PortalRequestStatus[]).map((r) => r.code)).toEqual([code])
    const other = await guest.post(`/public/portal/${portalId}/status`, { phone: '9000000000' })
    expect(other.body.data).toEqual([])
    const otherPortal = (
      await prisma.restaurant.findUniqueOrThrow({ where: { id: fx.restaurantIds[1] } })
    ).portalId
    expect(
      (await guest.post(`/public/portal/${otherPortal}/status`, { phone: '9876543210' })).body.data,
    ).toEqual([])

    // Converting it to a work order works without a requester account.
    const wo = await as('admin').post('/work-orders', {
      title: 'Sink leaking',
      description: '',
      category: 'PLUMBING',
      priority: 'HIGH',
      restaurantId: fx.restaurantIds[0],
      locationId: loc.id,
      assetId: '',
      dueDate: '',
      assignedUserId: '',
      assignedTeamId: '',
      requestId: saved.id,
    })
    expect(wo.status).toBe(201)
    expect((wo.body.data as WorkOrderDetail).sourceRequest?.guest).toEqual({
      name: 'Asha',
      phone: '+919876543210',
    })
  })

  it('rejects bots filling the hidden field and bad phone numbers', async () => {
    await enablePortal()
    const base = { name: 'Bot', phone: '98765 43210', title: 'Buy now', description: '' }
    expect(
      (await guest.post(`/public/portal/${portalId}/requests`, { ...base, website: 'spam' }))
        .status,
    ).toBe(400)
    expect(
      (await guest.post(`/public/portal/${portalId}/requests`, { ...base, phone: 'call me' }))
        .status,
    ).toBe(400)
    expect(await prisma.request.count()).toBe(0)
  })
})

describe('repeating work orders', () => {
  async function create(repeat: object | null, dueDate: string) {
    return (
      await as('admin').post('/work-orders', {
        title: 'Clean hood filters',
        description: '',
        category: 'CLEANING',
        priority: 'MEDIUM',
        restaurantId: fx.restaurantIds[0],
        locationId: '',
        assetId: '',
        dueDate,
        assignedUserId: workerId,
        assignedTeamId: '',
        requestId: '',
        repeat,
      })
    ).body.data as WorkOrderDetail
  }
  async function finish(id: string) {
    await as('worker').post(`/work-orders/${id}/start`)
    return (await as('worker').post(`/work-orders/${id}/complete`, { notes: 'Done' })).body
      .data as WorkOrderDetail
  }

  it('creates the next job from the schedule when one is done, once', async () => {
    const due = new Date(Date.now() + 2 * 86_400_000)
    const w = await create({ every: 1, unit: 'WEEK', basis: 'SCHEDULE' }, due.toISOString())
    expect(w.repeat).toEqual({ every: 1, unit: 'WEEK', basis: 'SCHEDULE' })
    const done = await finish(w.id)
    expect(done.repeatedBy).not.toBeNull()
    const next = (await as('admin').get(`/work-orders/${done.repeatedBy!.id}`)).body
      .data as WorkOrderDetail
    expect(next).toMatchObject({
      title: 'Clean hood filters',
      status: 'ASSIGNED',
      assignedUser: { id: workerId },
      repeat: { every: 1, unit: 'WEEK', basis: 'SCHEDULE' },
      repeatedFrom: { id: w.id },
    })
    expect(next.dueDate).toBe(addRepeat(due, { every: 1, unit: 'WEEK' }).toISOString())
    // The worker hears about the next one.
    expect(
      await prisma.notification.count({
        where: { recipientId: workerId, entityId: next.id, type: 'TASK_ASSIGNED' },
      }),
    ).toBe(1)
    expect(await prisma.workOrder.count()).toBe(2)
  })

  it('counts from completion, skips past dates on a schedule, and stops when removed', async () => {
    const fromDone = await create({ every: 3, unit: 'DAY', basis: 'COMPLETION' }, '')
    const done = await finish(fromDone.id)
    const next = await prisma.workOrder.findUniqueOrThrow({ where: { id: done.repeatedBy!.id } })
    const expected = addRepeat(new Date(done.completedAt!), { every: 3, unit: 'DAY' })
    expect(Math.abs(next.dueDate!.getTime() - expected.getTime())).toBeLessThan(5_000)

    // A due date long past: the next one lands in the future, not in the past.
    const old = await create(
      { every: 1, unit: 'DAY', basis: 'SCHEDULE' },
      new Date(Date.now() - 10 * 86_400_000).toISOString(),
    )
    const late = await finish(old.id)
    expect(new Date(late.repeatedBy!.dueDate!).getTime()).toBeGreaterThan(Date.now())

    // Turning repeat off: no follow-up.
    const once = await create({ every: 1, unit: 'MONTH', basis: 'SCHEDULE' }, '')
    await as('admin').put(`/work-orders/${once.id}`, {
      title: once.title,
      description: '',
      category: once.category,
      priority: once.priority,
      restaurantId: fx.restaurantIds[0],
      locationId: '',
      assetId: '',
      dueDate: '',
      repeat: null,
    })
    expect((await finish(once.id)).repeatedBy).toBeNull()
  })

  it('month steps keep the day, clamped to the month end', () => {
    expect(
      addRepeat(new Date('2026-01-31T10:00:00Z'), { every: 1, unit: 'MONTH' }).toISOString(),
    ).toBe('2026-02-28T10:00:00.000Z')
  })
})

describe('global search', () => {
  it('finds work orders, assets and parts in my restaurants only', async () => {
    const mk = (restaurantId: string, title: string) =>
      as('boss').post('/work-orders', {
        title,
        description: '',
        category: 'REFRIGERATION',
        priority: 'MEDIUM',
        restaurantId,
        locationId: '',
        assetId: '',
        dueDate: '',
        assignedUserId: '',
        assignedTeamId: '',
        requestId: '',
      })
    await mk(fx.restaurantIds[0]!, 'Walk-in freezer alarm')
    await mk(fx.restaurantIds[1]!, 'Freezer door at R2')
    await prisma.part.create({
      data: { organizationId: fx.orgId, name: 'Freezer gasket', partNumber: 'FG-1', unit: 'pcs' },
    })
    const res = await as('admin').get('/search?q=freezer')
    expect(res.status).toBe(200)
    const hits = (res.body.data as SearchResults).hits
    expect(hits.filter((h) => h.kind === 'workOrder').map((h) => h.title)).toEqual([
      expect.stringContaining('Walk-in freezer alarm'),
    ])
    expect(hits.find((h) => h.kind === 'part')?.url).toMatch(/^\/inventory\/parts\//)
    expect((await as('admin').get('/search?q=f')).status).toBe(400)
  })
})

describe('saved views', () => {
  it('saves private and shared views; only owners (or settings admins) delete', async () => {
    const mine = await as('admin').post('/saved-views', {
      resource: 'work_orders',
      name: 'My urgent',
      query: 'priority=HIGH&page=3',
    })
    expect(mine.status).toBe(201)
    expect((mine.body.data as SavedViewDto[])[0]).toMatchObject({
      name: 'My urgent',
      query: 'priority=HIGH',
      mine: true,
      shared: false,
    })
    await as('boss').post('/saved-views', {
      resource: 'work_orders',
      name: 'Team: overdue',
      query: 'overdue=1',
      shared: true,
    })
    const seen = (await as('admin').get('/saved-views?resource=work_orders')).body
      .data as SavedViewDto[]
    expect(seen.map((v) => v.name)).toEqual(['My urgent', 'Team: overdue'])
    const shared = seen.find((v) => v.shared)!
    expect((await as('admin').delete(`/saved-views/${shared.id}`)).status).toBe(403)
    // Someone else's private view is invisible.
    expect((await as('worker').get('/saved-views?resource=work_orders')).body.data).toHaveLength(1)
    expect((await as('boss').delete(`/saved-views/${shared.id}`)).status).toBe(200)
    // Users (workers) keep views for themselves; they can't publish one to everybody.
    const spam = await as('worker').post('/saved-views', {
      resource: 'work_orders',
      name: 'Click here',
      query: 'q=x',
      shared: true,
    })
    expect(spam.status).toBe(403)
    expect(await prisma.savedView.count({ where: { shared: true } })).toBe(0)
  })
})

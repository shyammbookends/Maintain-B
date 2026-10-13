import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type AssetMeterDto,
  type AutomationDto,
  type AutomationLogDto,
  type NotificationPreferences,
  type RootCauseDto,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { dueSoonAlerts, overdueWorkOrderAlerts } from '../jobs/alerts.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'

/*
 * Phases 11–12: meters and readings, the automation engine, root cause
 * analysis, internal notes / replies / mentions, notification channels.
 */

const app = createApp()
let fx: Fixture
let R: string[]
let admin: ReturnType<typeof api>
let worker: ReturnType<typeof api>
let ids: Record<'admin' | 'worker' | 'tech2', string>
let assetId: string

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
    del: (u: string, b?: object) => request(app).delete(`/api/v1${u}`).set(h).send(b),
  }
}

const wo = (o: Record<string, unknown> = {}) => ({
  title: 'Generator check',
  description: '',
  category: 'ELECTRICAL',
  priority: 'MEDIUM',
  restaurantId: R[0],
  locationId: '',
  assetId: '',
  dueDate: '',
  assignedUserId: ids.worker,
  assignedTeamId: '',
  requestId: '',
  ...o,
})

const rule = (o: Record<string, unknown> = {}) => ({
  name: 'Rule',
  description: '',
  trigger: 'WORK_ORDER_CREATED',
  restaurantId: R[0],
  conditions: {},
  actions: [{ type: 'NOTIFY', recipients: 'MANAGERS', message: '' }],
  active: true,
  ...o,
})

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  const users = {
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
    tech2: await fx.createUser({ role: 'WORKER', username: 'tech2', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  admin = api(await tokenFor('admin'))
  worker = api(await tokenFor('worker'))
  const cat = await prisma.assetCategory.create({
    data: { organizationId: fx.orgId, name: 'Generator' },
  })
  assetId = (
    await prisma.asset.create({
      data: {
        organizationId: fx.orgId,
        restaurantId: R[0]!,
        categoryId: cat.id,
        publicId: 'GenQr000001',
        assetCode: 'AST-0001',
        name: 'Generator',
      },
    })
  ).id
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function newMeter() {
  const res = await admin.post(`/assets/${assetId}/meters`, {
    name: 'Runtime',
    type: 'RUNTIME_HOURS',
    unit: 'h',
  })
  expect(res.status).toBe(201)
  return (res.body.data as AssetMeterDto[])[0]!
}

const read = (meterId: string, value: number, who = worker) =>
  who.post(`/assets/${assetId}/meters/${meterId}/readings`, { value, note: '' })

// ---------------------------------------------------------------------------

describe('Phase 11 — meters', () => {
  it("a User can only link a reading to their own work", async () => {
    const m = await newMeter()
    const mine = (await admin.post('/work-orders', wo())).body.data as WorkOrderDetail
    const notMine = (await admin.post('/work-orders', wo({ assignedUserId: '' }))).body
      .data as WorkOrderDetail
    const link = (workOrderId: string) =>
      worker.post(`/assets/${assetId}/meters/${m.id}/readings`, { value: 5, note: '', workOrderId })
    expect((await link(notMine.id)).status).toBe(400)
    expect((await link(mine.id)).status).toBe(201)
  })

  it('records readings with the previous value; only managers add meters', async () => {
    expect(
      (await worker.post(`/assets/${assetId}/meters`, { name: 'X', type: 'OTHER', unit: 'u' }))
        .status,
    ).toBe(403)
    const m = await newMeter()
    await read(m.id, 120)
    const res = await read(m.id, 135.5)
    expect(res.status).toBe(201)
    const [meter] = res.body.data as AssetMeterDto[]
    expect(meter).toMatchObject({ currentValue: 135.5, previousValue: 120 })
    expect(meter!.readings[0]).toMatchObject({ value: 135.5, previousValue: 120, delta: 15.5 })
    expect(meter!.readings[1]).toMatchObject({ value: 120, previousValue: null, delta: null })
    expect(await prisma.auditLog.count({ where: { action: 'meter.reading' } })).toBe(2)
    // Other restaurants' assets are out of reach.
    const outsider = await fx.createUser({ role: 'ADMIN', username: 'far', restaurants: [R[1]!] })
    expect(outsider).toBeDefined()
    const far = api(await tokenFor('far'))
    expect((await far.get(`/assets/${assetId}/meters`)).status).toBe(404)
  })
})

describe('Phase 11 — automations', () => {
  it('creates a PM work order every 500 runtime hours', async () => {
    const m = await newMeter()
    const res = await admin.post(
      '/automations',
      rule({
        name: 'Generator service every 500 h',
        trigger: 'METER_READING',
        conditions: { meterId: m.id, meterOperator: 'EVERY', meterValue: 500 },
        actions: [
          {
            type: 'CREATE_WORK_ORDER',
            title: 'Generator 500 h service',
            priority: 'HIGH',
            category: 'ELECTRICAL',
            workType: 'PREVENTIVE',
            assignedUserId: ids.worker,
            dueInHours: 48,
          },
          { type: 'NOTIFY', recipients: 'MANAGERS', message: 'Service due' },
        ],
      }),
    )
    expect(res.status).toBe(201)
    const a = res.body.data as AutomationDto

    for (const v of [100, 450, 520, 900]) await read(m.id, v)
    let jobs = await prisma.workOrder.findMany({ where: { title: 'Generator 500 h service' } })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      type: 'PREVENTIVE',
      status: 'ASSIGNED',
      assetId,
      assignedUserId: ids.worker,
      priority: 'HIGH',
    })
    expect(jobs[0]!.dueDate).not.toBeNull()
    await read(m.id, 1010)
    jobs = await prisma.workOrder.findMany({ where: { title: 'Generator 500 h service' } })
    expect(jobs).toHaveLength(2)

    const logs = (await admin.get(`/automations/${a.id}/logs`)).body.data as AutomationLogDto[]
    expect(logs).toHaveLength(2)
    expect(logs[0]).toMatchObject({ status: 'SUCCESS', trigger: 'METER_READING' })
    expect(logs[0]!.message).toContain('created WO-')
    expect((await admin.get(`/automations/${a.id}`)).body.data).toMatchObject({ runCount: 2 })
    expect(
      await prisma.notification.count({
        where: { recipientId: ids.worker, type: 'TASK_ASSIGNED' },
      }),
    ).toBe(2)
  })

  it('handles critical work: notifies a person and assigns, but not for other priorities', async () => {
    await admin.post(
      '/automations',
      rule({
        name: 'Critical → Ravi',
        conditions: { priorities: ['CRITICAL'] },
        actions: [
          { type: 'NOTIFY', recipients: 'USER', userId: ids.tech2, message: 'Critical job' },
          { type: 'ASSIGN', userId: ids.tech2 },
        ],
      }),
    )
    await admin.post('/work-orders', wo({ assignedUserId: '', priority: 'HIGH' }))
    expect(await prisma.notification.count({ where: { type: 'AUTOMATION' } })).toBe(0)

    const w = (await admin.post('/work-orders', wo({ assignedUserId: '', priority: 'CRITICAL' })))
      .body.data as WorkOrderDetail
    const fresh = await prisma.workOrder.findUniqueOrThrow({ where: { id: w.id } })
    expect(fresh).toMatchObject({ assignedUserId: ids.tech2, status: 'ASSIGNED' })
    expect(
      await prisma.notification.count({ where: { recipientId: ids.tech2, type: 'AUTOMATION' } }),
    ).toBe(1)
  })

  it("a rule can't hand work to another restaurant's team or use its procedure", async () => {
    const farTeam = await prisma.team.create({
      data: { organizationId: fx.orgId, name: 'R2 crew', restaurantId: R[1]! },
    })
    const farProcedure = await prisma.procedure.create({
      data: { organizationId: fx.orgId, name: 'R2 checklist', restaurantId: R[1]! },
    })
    const res = await admin.post(
      '/automations',
      rule({
        name: 'Send to R2',
        actions: [
          { type: 'ASSIGN', teamId: farTeam.id },
          {
            type: 'CREATE_WORK_ORDER',
            title: 'Far job',
            priority: 'LOW',
            category: 'OTHER',
            workType: 'REACTIVE',
            procedureId: farProcedure.id,
          },
        ],
      }),
    )
    expect(res.status).toBe(400)
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual([
      'actions.0.teamId',
      'actions.1.procedureId',
    ])
  })

  it('never loops: work created by a rule does not trigger "work order created" rules', async () => {
    await admin.post(
      '/automations',
      rule({
        name: 'Follow-up for every job',
        actions: [
          {
            type: 'CREATE_WORK_ORDER',
            title: 'Follow-up',
            priority: 'LOW',
            category: 'OTHER',
            workType: 'REACTIVE',
          },
        ],
      }),
    )
    await admin.post('/work-orders', wo())
    expect(await prisma.workOrder.count()).toBe(2)
  })

  it('runs on overdue work and on low stock', async () => {
    await admin.post(
      '/automations',
      rule({
        name: 'Overdue → managers',
        trigger: 'WORK_ORDER_OVERDUE',
        actions: [{ type: 'NOTIFY', recipients: 'MANAGERS', message: 'Overdue' }],
      }),
    )
    await admin.post(
      '/automations',
      rule({
        name: 'Low stock → stock keepers',
        trigger: 'LOW_STOCK',
        actions: [{ type: 'NOTIFY', recipients: 'STOCK_KEEPERS', message: 'Reorder' }],
      }),
    )
    await admin.post(
      '/work-orders',
      wo({ dueDate: new Date(Date.now() - 3_600_000).toISOString() }),
    )
    await overdueWorkOrderAlerts()
    expect(
      await prisma.notification.count({
        where: { recipientId: ids.admin, type: 'AUTOMATION', title: 'Overdue → managers' },
      }),
    ).toBe(1)

    const part = (
      await admin.post('/parts', {
        name: 'Fuse',
        partNumber: 'FUS-1',
        category: '',
        unit: 'pcs',
        unitCost: 10,
        minStock: 2,
        preferredVendorId: '',
        storageLocation: '',
        description: '',
      })
    ).body.data
    await admin.post(`/parts/${part.id}/adjust`, {
      restaurantId: R[0],
      mode: 'RECEIVE',
      quantity: 5,
      reason: 'Opening',
    })
    // The worker uses stock: the admin (a stock keeper) hears from the rule.
    await prisma.inventory.updateMany({ data: {} })
    const tech = (await admin.post('/work-orders', wo({ title: 'Fuse swap' }))).body
      .data as WorkOrderDetail
    await worker.post(`/work-orders/${tech.id}/start`)
    await worker.post(`/work-orders/${tech.id}/parts`, { partId: part.id, quantity: 4 })
    expect(
      await prisma.notification.count({
        where: { recipientId: ids.admin, type: 'AUTOMATION', title: 'Low stock → stock keepers' },
      }),
    ).toBe(1)
  })

  it('validates rules and keeps them to the right people', async () => {
    const bad = await admin.post(
      '/automations',
      rule({ trigger: 'LOW_STOCK', actions: [{ type: 'SET_PRIORITY', priority: 'HIGH' }] }),
    )
    expect(bad.body.error.fieldErrors).toEqual({
      'actions.0.type': ['validation.actionNotForTrigger'],
    })
    const orgWide = await admin.post('/automations', rule({ restaurantId: '' }))
    expect(orgWide.body.error.fieldErrors).toEqual({
      restaurantId: ['validation.restaurantRequired'],
    })
    const meterless = await admin.post('/automations', rule({ trigger: 'METER_READING' }))
    expect(meterless.status).toBe(400)
    expect((await worker.get('/automations')).status).toBe(403)

    const a = (await admin.post('/automations', rule())).body.data as AutomationDto
    const off = (await admin.put(`/automations/${a.id}/active`, { active: false })).body.data
    expect(off.active).toBe(false)
    await admin.post('/work-orders', wo())
    expect(await prisma.automationLog.count()).toBe(0)
    expect((await admin.del(`/automations/${a.id}`)).status).toBe(204)
    expect((await admin.get('/automations')).body.data).toEqual([])
  })
})

describe('Phase 11 — root cause analysis', () => {
  it('records the root cause on the job and the asset', async () => {
    const w = (await admin.post('/work-orders', wo({ assetId }))).body.data as WorkOrderDetail
    expect(w.actions.rca).toBe(true)
    const body = {
      failure: 'Generator did not start',
      cause: 'Battery flat',
      rootCause: 'Charger relay failed',
      category: 'ELECTRICAL',
      correctiveAction: 'Replaced relay',
      preventiveAction: 'Monthly charger check',
    }
    expect((await worker.put(`/work-orders/${w.id}/root-cause`, body)).status).toBe(403)
    const d = (await admin.put(`/work-orders/${w.id}/root-cause`, body)).body
      .data as WorkOrderDetail
    expect(d.rootCause).toMatchObject({ rootCause: 'Charger relay failed', category: 'ELECTRICAL' })
    await admin.put(`/work-orders/${w.id}/root-cause`, { ...body, category: 'WEAR_AND_TEAR' })
    const list = (await admin.get(`/assets/${assetId}/root-causes`)).body.data as RootCauseDto[]
    expect(list).toMatchObject([{ category: 'WEAR_AND_TEAR', workOrder: { id: w.id } }])
    expect(
      await prisma.assetHistory.count({ where: { assetId, eventType: 'NOTE', workOrderId: w.id } }),
    ).toBe(1)
    expect(
      await prisma.auditLog.count({ where: { action: { startsWith: 'work_order.rca' } } }),
    ).toBe(2)
  })
})

describe('Phase 12 — communication', () => {
  it('keeps internal notes from technicians and notifies mentions', async () => {
    const w = (await admin.post('/work-orders', wo())).body.data as WorkOrderDetail
    let d = (
      await admin.post(`/work-orders/${w.id}/messages`, {
        body: 'Check the warranty before buying parts',
        internal: true,
      })
    ).body.data as WorkOrderDetail
    expect(d.messages).toMatchObject([{ internal: true }])
    expect(
      (await worker.post(`/work-orders/${w.id}/messages`, { body: 'hi', internal: true })).status,
    ).toBe(403)
    const seen = (await worker.get(`/work-orders/${w.id}`)).body.data as WorkOrderDetail
    expect(seen.messages).toEqual([])
    // Replying to a note you can't see is refused.
    const reply = await worker.post(`/work-orders/${w.id}/messages`, {
      body: 'ok',
      parentId: d.messages[0]!.id,
    })
    expect(reply.status).toBe(400)

    d = (
      await admin.post(`/work-orders/${w.id}/messages`, {
        body: '@Tech please help',
        mentionIds: [ids.tech2],
      })
    ).body.data
    const asked = d.messages.find((m) => !m.internal)!
    expect(asked.mentions).toMatchObject([{ id: ids.tech2 }])
    expect(
      await prisma.notification.count({ where: { recipientId: ids.tech2, type: 'MENTION' } }),
    ).toBe(1)
    d = (await worker.post(`/work-orders/${w.id}/messages`, { body: 'On it', parentId: asked.id }))
      .body.data
    expect(d.messages.find((m) => m.body === 'On it')).toMatchObject({ parentId: asked.id })
  })

  it('tells people taken off a job and reminds the assignee before the due time', async () => {
    const w = (
      await admin.post(
        '/work-orders',
        wo({ dueDate: new Date(Date.now() + 5 * 3_600_000).toISOString() }),
      )
    ).body.data as WorkOrderDetail
    expect(await dueSoonAlerts()).toBe(1)
    expect(await dueSoonAlerts()).toBe(0)
    await admin.post(`/work-orders/${w.id}/assign`, {
      assignedUserId: ids.tech2,
      assignedTeamId: '',
    })
    expect(
      await prisma.notification.count({
        where: { recipientId: ids.worker, type: 'WORK_REASSIGNED' },
      }),
    ).toBe(1)
  })

  it('stores email choices and push subscriptions', async () => {
    const p = (
      await admin.put('/notifications/preferences', {
        muted: ['NEW_MESSAGE'],
        email: ['TASK_OVERDUE'],
      })
    ).body.data as NotificationPreferences
    expect(p).toMatchObject({ muted: ['NEW_MESSAGE'], email: ['TASK_OVERDUE'] })
    expect(p.channels).toEqual({ email: false, push: false, pushKey: null })
    // Old clients that only send "muted" keep their email choices.
    const kept = (await admin.put('/notifications/preferences', { muted: [] })).body.data
    expect(kept.email).toEqual(['TASK_OVERDUE'])

    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'BPublicKeyValue123', auth: 'authsecret1' },
    }
    // The server POSTs to the endpoint: only real browser push services, never
    // internal hosts or a phone-app device row (native:<id>).
    for (const endpoint of [
      'http://10.0.0.5/internal',
      'https://169.254.169.254/latest/meta-data',
      'https://push.example.com/abc',
      'native:123e4567-e89b-12d3-a456-426614174000',
    ])
      expect((await worker.post('/notifications/push', { ...sub, endpoint })).status).toBe(400)
    expect(await prisma.pushSubscription.count()).toBe(0)
    expect((await worker.post('/notifications/push', sub)).status).toBe(204)
    expect(await prisma.pushSubscription.count({ where: { userId: ids.worker } })).toBe(1)
    expect((await worker.del('/notifications/push', { endpoint: sub.endpoint })).status).toBe(204)
    expect(await prisma.pushSubscription.count()).toBe(0)
  })
})

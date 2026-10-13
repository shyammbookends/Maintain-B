import { AUTH_CSRF_HEADER, AUTH_CSRF_VALUE, type WorkOrderDetail } from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'

/*
 * Phase 15: access rules on everything added in phases 11–14. Each new
 * endpoint keeps people inside their restaurants and their role.
 */

const app = createApp()
let fx: Fixture
let R: string[]
let ids: Record<'admin' | 'far' | 'worker' | 'requester', string>
let assetId: string
const tokens: Record<string, string> = {}

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
  }
}

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  const users = {
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    far: await fx.createUser({ role: 'ADMIN', username: 'far', restaurants: [R[1]!] }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
    requester: await fx.createUser({ role: 'WORKER', username: 'staff', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  for (const u of ['admin', 'far', 'worker', 'staff']) tokens[u] = await tokenFor(u)
  const cat = await prisma.assetCategory.create({ data: { organizationId: fx.orgId, name: 'Gen' } })
  assetId = (
    await prisma.asset.create({
      data: {
        organizationId: fx.orgId,
        restaurantId: R[0]!,
        categoryId: cat.id,
        publicId: 'SecQr000001',
        assetCode: 'AST-0001',
        name: 'Generator',
      },
    })
  ).id
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function job() {
  const res = await as('admin').post('/work-orders', {
    title: 'Check',
    description: '',
    category: 'OTHER',
    priority: 'MEDIUM',
    restaurantId: R[0],
    locationId: '',
    assetId,
    dueDate: '',
    assignedUserId: ids.worker,
    assignedTeamId: '',
    requestId: '',
  })
  return res.body.data as WorkOrderDetail
}

describe('Phase 15 — access rules on the new features', () => {
  it('keeps other restaurants out of meters, root causes, people and rules', async () => {
    const w = await job()
    const meter = (
      await as('admin').post(`/assets/${assetId}/meters`, {
        name: 'Hours',
        type: 'RUNTIME_HOURS',
        unit: 'h',
      })
    ).body.data[0]
    const rule = (
      await as('admin').post('/automations', {
        name: 'Rule',
        description: '',
        trigger: 'WORK_ORDER_CREATED',
        restaurantId: R[0],
        conditions: {},
        actions: [{ type: 'NOTIFY', recipients: 'MANAGERS', message: '' }],
        active: true,
      })
    ).body.data

    const far = as('far')
    expect((await far.get(`/assets/${assetId}/meters`)).status).toBe(404)
    expect(
      (await far.post(`/assets/${assetId}/meters/${meter.id}/readings`, { value: 1, note: '' }))
        .status,
    ).toBe(404)
    expect((await far.get(`/assets/${assetId}/root-causes`)).status).toBe(404)
    expect((await far.get(`/work-orders/${w.id}/people`)).status).toBe(404)
    expect((await far.get(`/automations/${rule.id}`)).status).toBe(404)
    expect((await far.get('/automations')).body.data).toEqual([])
    expect(
      (
        await far.put(`/work-orders/${w.id}/root-cause`, {
          failure: 'x x x',
          cause: '',
          rootCause: 'y y y',
          category: 'OTHER',
          correctiveAction: '',
          preventiveAction: '',
        })
      ).status,
    ).toBe(404)
    // A rule can't point at someone from another restaurant.
    const sneaky = await as('admin').post('/automations', {
      name: 'Sneaky',
      description: '',
      trigger: 'WORK_ORDER_CREATED',
      restaurantId: R[0],
      conditions: {},
      actions: [{ type: 'NOTIFY', recipients: 'USER', userId: ids.far, message: '' }],
      active: true,
    })
    expect(sneaky.body.error.fieldErrors).toEqual({
      'actions.0.userId': ['validation.invalidValue'],
    })
    // Report filters can't open another restaurant.
    const today = new Date().toISOString().slice(0, 10)
    const report = await as('admin').get(
      `/reports/reliability?from=${today}&to=${today}&restaurantId=${R[1]}`,
    )
    expect(report.status).toBe(400)
  })

  it('keeps roles to their job', async () => {
    const w = await job()
    const worker = as('worker')
    expect(
      (await worker.post(`/assets/${assetId}/meters`, { name: 'X', type: 'OTHER', unit: 'u' }))
        .status,
    ).toBe(403)
    expect((await worker.get('/automations')).status).toBe(403)
    expect(
      (await worker.get(`/reports/analytics/trends?from=2026-01-01&to=2026-01-31`)).status,
    ).toBe(403)
    expect((await worker.get(`/work-orders/${w.id}/people`)).status).toBe(200)
  })

  it('ignores fields a client must not set', async () => {
    const res = await as('admin').post('/automations', {
      name: 'Rule',
      description: '',
      trigger: 'WORK_ORDER_CREATED',
      restaurantId: R[0],
      conditions: {},
      actions: [{ type: 'NOTIFY', recipients: 'MANAGERS', message: '' }],
      active: true,
      organizationId: '00000000-0000-0000-0000-000000000000',
      runCount: 999,
      createdById: ids.far,
    })
    expect(res.status).toBe(201)
    const row = await prisma.automation.findUniqueOrThrow({ where: { id: res.body.data.id } })
    expect(row).toMatchObject({ organizationId: fx.orgId, runCount: 0, createdById: ids.admin })
  })

  it('does not leak internal details in errors', async () => {
    const res = await as('admin').get('/automations/not-a-uuid')
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|stack|at \w+ \(/i)
  })
})

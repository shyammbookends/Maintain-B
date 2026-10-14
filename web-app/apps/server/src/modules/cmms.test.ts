import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type AssetDetail,
  type AssigneeWorkload,
  type DashboardSummary,
  type LocationDto,
  type LocationLanding,
  type RequestDetail,
  type RestaurantStats,
  type WorkOrderDetail,
  type WorkOrderListItem,
} from '@maintainx/shared'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'
import { giveEvidence, report } from '../test/work-orders.js'
import { ensureDefaultCategories } from './assets/categories.service.js'

/*
 * CMMS phases 1–5 end to end: site hierarchy, roles, assets (hierarchy,
 * transfer, cost), QR landings, requests (approve), and the work order engine
 * (draft, schedule, helpers, sub work orders, verify / reject, cancel, costs).
 */

const app = createApp()
let fx: Fixture
let R: string[]
let boss: ReturnType<typeof api>
let admin: ReturnType<typeof api>
let supervisor: ReturnType<typeof api>
let worker: ReturnType<typeof api>
let helper: ReturnType<typeof api>
let staff: ReturnType<typeof api>
let ids: Record<'boss' | 'admin' | 'supervisor' | 'worker' | 'helper' | 'staff', string>
let categoryId: string

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
  }
}

const assetBody = (o: Record<string, unknown> = {}) => ({
  name: 'Walk-in cold room',
  categoryId,
  restaurantId: R[0],
  locationId: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  purchaseDate: '',
  purchaseCost: '',
  warrantyStart: '',
  warrantyEnd: '',
  notes: '',
  ...o,
})

const wo = (o: Record<string, unknown> = {}) => ({
  title: 'Fix cooling',
  description: '',
  category: 'REFRIGERATION',
  priority: 'HIGH',
  restaurantId: R[0],
  locationId: '',
  assetId: '',
  dueDate: '',
  assignedUserId: '',
  assignedTeamId: '',
  requestId: '',
  ...o,
})

const notes = (userId: string, type: string) =>
  prisma.notification.findMany({ where: { recipientId: userId, type: type as never } })

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  await ensureDefaultCategories(prisma, fx.orgId)
  const users = {
    boss: await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' }),
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    supervisor: await fx.createUser({
      role: 'ADMIN',
      username: 'supervisor',
      restaurants: [R[0]!],
    }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
    helper: await fx.createUser({ role: 'WORKER', username: 'helper', restaurants: [R[0]!] }),
    staff: await fx.createUser({ role: 'WORKER', username: 'staff', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  boss = api(await tokenFor('boss'))
  admin = api(await tokenFor('admin'))
  supervisor = api(await tokenFor('supervisor'))
  worker = api(await tokenFor('worker'))
  helper = api(await tokenFor('helper'))
  staff = api(await tokenFor('staff'))
  categoryId = (await prisma.assetCategory.findFirstOrThrow({ where: { name: 'Refrigerator' } })).id
})

// ---------------------------------------------------------------------------

describe('site hierarchy and location QR', () => {
  const loc = (o: Record<string, unknown>) => ({
    restaurantId: R[0],
    type: 'OTHER',
    description: '',
    ...o,
  })

  it('builds building → floor → room, refuses loops and foreign parents', async () => {
    const building = (await admin.post('/locations', loc({ name: 'Main block', type: 'BUILDING' })))
      .body.data as LocationDto
    const floor = (
      await admin.post(
        '/locations',
        loc({ name: 'Ground floor', type: 'FLOOR', parentId: building.id }),
      )
    ).body.data as LocationDto
    const room = (
      await admin.post('/locations', loc({ name: 'Cold store', type: 'ROOM', parentId: floor.id }))
    ).body.data as LocationDto
    expect(room).toMatchObject({ parentId: floor.id })
    expect(room.publicId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{12}$/)

    // A building can't move under its own room.
    const loop = await admin.put(
      `/locations/${building.id}`,
      loc({ name: 'Main block', type: 'BUILDING', parentId: room.id }),
    )
    expect(loop.body.error.fieldErrors).toEqual({ parentId: ['validation.locationCycle'] })

    const elsewhere = (
      await boss.post('/locations', loc({ restaurantId: R[1], name: 'Bar', type: 'BAR' }))
    ).body.data as LocationDto
    const foreign = await boss.post('/locations', loc({ name: 'Store', parentId: elsewhere.id }))
    expect(foreign.body.error.fieldErrors).toEqual({
      parentId: ['validation.locationNotInRestaurant'],
    })

    // Can't archive a location that still has sub-locations.
    expect((await admin.del(`/locations/${floor.id}`)).status).toBe(409)
  })

  it('location QR lands on the place with its path, assets and report access', async () => {
    const building = (await admin.post('/locations', loc({ name: 'Main block', type: 'BUILDING' })))
      .body.data as LocationDto
    const kitchen = (
      await admin.post(
        '/locations',
        loc({ name: 'Hot kitchen', type: 'HOT_KITCHEN', parentId: building.id }),
      )
    ).body.data as LocationDto
    await admin.post('/assets', assetBody({ name: 'Combi oven', locationId: kitchen.id }))

    const landing = (await worker.get(`/locations/by-public/${kitchen.publicId}`)).body
      .data as LocationLanding
    expect(landing.path.map((p) => p.name)).toEqual(['Main block'])
    expect(landing.assets.map((a) => a.name)).toEqual(['Combi oven'])
    expect(landing.can.report).toBe(true)
    // The building lists its sub-locations with the code to open each one.
    const block = (await worker.get(`/locations/by-public/${building.publicId}`)).body
      .data as LocationLanding
    expect(block.children).toEqual([
      { id: kitchen.id, publicId: kitchen.publicId, name: 'Hot kitchen', type: 'HOT_KITCHEN' },
    ])
    expect(
      (await worker.get(`/locations/by-public/${block.children[0]!.publicId}`)).body.data.id,
    ).toBe(kitchen.id)
    // Another restaurant's code is just "not found".
    const theirs = (
      await boss.post('/locations', loc({ restaurantId: R[1], name: 'Bar', type: 'BAR' }))
    ).body.data as LocationDto
    expect((await worker.get(`/locations/by-public/${theirs.publicId}`)).status).toBe(404)
  })
})

describe('roles', () => {
  it('users report problems and work their tasks, but never see the dashboard', async () => {
    const r = await staff.post('/requests', {
      restaurantId: R[0],
      locationId: '',
      assetId: '',
      category: 'PLUMBING',
      title: '',
      description: 'Sink in the bar is blocked',
      priority: 'MEDIUM',
    })
    expect(r.status).toBe(201)
    expect((await staff.get('/work-orders')).status).toBe(200)
    expect((await staff.get('/dashboard')).status).toBe(403)
    expect((await staff.get('/requests')).body.data).toHaveLength(1)
    expect((await staff.post('/parts', {})).status).toBe(403)
  })

  it('admins dispatch, verify and cancel work', async () => {
    const created = await supervisor.post('/work-orders', wo({ assignedUserId: ids.worker }))
    expect(created.status).toBe(201)
    const w = created.body.data as WorkOrderDetail
    expect(w.actions).toMatchObject({ assign: true, cancel: true })
    expect((await supervisor.post(`/work-orders/${w.id}/cancel`, { reason: 'Nope' })).status).toBe(
      200,
    )
  })
})

describe('assets', () => {
  it('keeps components under a parent, prevents loops, reports lifetime cost', async () => {
    const room = (await admin.post('/assets', assetBody({ criticality: 'CRITICAL' }))).body
      .data as AssetDetail
    expect(room.criticality).toBe('CRITICAL')
    const compressor = (
      await admin.post(
        '/assets',
        assetBody({ name: 'Compressor', parentId: room.id, installDate: '2025-04-01' }),
      )
    ).body.data as AssetDetail
    expect(compressor).toMatchObject({
      parent: { id: room.id },
      installDate: '2025-04-01',
      criticality: 'MEDIUM',
    })
    const loop = await admin.put(`/assets/${room.id}`, assetBody({ parentId: compressor.id }))
    expect(loop.body.error.fieldErrors).toEqual({ parentId: ['validation.assetCycle'] })

    const parent = (await admin.get(`/assets/${room.id}`)).body.data as AssetDetail
    expect(parent.children.map((c) => c.name)).toEqual(['Compressor'])
    expect(parent.cost).toEqual({ parts: 0, labour: 0, vendor: 0, other: 0, total: 0 })
    expect((await admin.get('/assets?topLevel=1')).body.data).toHaveLength(1)
  })

  it('transfers to another restaurant with its components, never with open work', async () => {
    const room = (await boss.post('/assets', assetBody())).body.data as AssetDetail
    const part = (await boss.post('/assets', assetBody({ name: 'Fan', parentId: room.id }))).body
      .data as AssetDetail
    const job = (await boss.post('/work-orders', wo({ assetId: room.id }))).body
      .data as WorkOrderDetail

    const blocked = await boss.post(`/assets/${room.id}/transfer`, {
      restaurantId: R[1],
      locationId: '',
      note: 'Moving to the new site',
    })
    expect(blocked.body.error.fieldErrors).toEqual({
      restaurantId: ['validation.assetHasOpenWork'],
    })

    await boss.post(`/work-orders/${job.id}/cancel`, { reason: 'Duplicate' })
    const moved = (
      await boss.post(`/assets/${room.id}/transfer`, {
        restaurantId: R[1],
        locationId: '',
        note: 'Moving to the new site',
      })
    ).body.data as AssetDetail
    expect(moved.restaurant.id).toBe(R[1])
    expect(moved.history[0]).toMatchObject({
      eventType: 'TRANSFERRED',
      note: 'Moving to the new site',
    })
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: part.id } })).restaurantId).toBe(
      R[1],
    )
    // Workers can't move assets.
    expect(
      (
        await worker.post(`/assets/${room.id}/transfer`, {
          restaurantId: R[0],
          locationId: '',
          note: 'test',
        })
      ).status,
    ).toBe(403)
  })
})

describe('requests', () => {
  it('approve → convert: the requester hears about both, conversion stays one-time', async () => {
    const r = (
      await worker.post('/requests', {
        restaurantId: R[0],
        locationId: '',
        assetId: '',
        category: 'REFRIGERATION',
        title: '',
        description: 'Fridge not cooling, ice on the back wall',
        priority: 'HIGH',
      })
    ).body.data as RequestDetail

    const approved = (await admin.post(`/requests/${r.id}/approve`, { note: 'Tech tomorrow' })).body
      .data as RequestDetail
    expect(approved).toMatchObject({ status: 'APPROVED', reviewNote: 'Tech tomorrow' })
    expect(approved.can).toEqual({ convert: true, reject: true, approve: false })
    expect((await notes(ids.worker, 'REQUEST_APPROVED')).length).toBe(1)
    expect((await admin.post(`/requests/${r.id}/approve`, { note: '' })).status).toBe(403)

    const w = (
      await admin.post('/work-orders', wo({ requestId: r.id, assignedUserId: ids.worker }))
    ).body.data as WorkOrderDetail
    expect(w.sourceRequest?.id).toBe(r.id)
    expect((await admin.get(`/requests/${r.id}`)).body.data.status).toBe('CONVERTED')
    expect((await notes(ids.worker, 'REQUEST_APPROVED')).length).toBe(2)
    expect((await admin.post('/work-orders', wo({ requestId: r.id }))).body.error.code).toBe(
      'ALREADY_CONVERTED',
    )
  })
})

describe('work order engine', () => {
  it('drafts stay hidden and silent until published', async () => {
    const d = (await admin.post('/work-orders', wo({ assignedUserId: ids.worker, asDraft: true })))
      .body.data as WorkOrderDetail
    expect(d.status).toBe('DRAFT')
    expect(d.actions.publish).toBe(true)
    expect((await worker.get('/work-orders')).body.meta.total).toBe(0)
    expect((await notes(ids.worker, 'TASK_ASSIGNED')).length).toBe(0)

    const p = (await admin.post(`/work-orders/${d.id}/publish`)).body.data as WorkOrderDetail
    expect(p.status).toBe('ASSIGNED')
    expect(p.history.map((h) => h.toStatus)).toEqual(['ASSIGNED', 'DRAFT'])
    expect((await worker.get('/work-orders')).body.meta.total).toBe(1)
    expect((await notes(ids.worker, 'TASK_ASSIGNED')).length).toBe(1)
  })

  it('a planned start makes it SCHEDULED; clearing it goes back to ASSIGNED', async () => {
    const start = new Date(Date.now() + 86_400_000).toISOString()
    const w = (
      await admin.post('/work-orders', wo({ assignedUserId: ids.worker, scheduledStart: start }))
    ).body.data as WorkOrderDetail
    expect(w).toMatchObject({ status: 'SCHEDULED', scheduledStart: start })
    const back = (await admin.put(`/work-orders/${w.id}`, wo({ scheduledStart: '' }))).body
      .data as WorkOrderDetail
    expect(back).toMatchObject({ status: 'ASSIGNED', scheduledStart: null })
    // Workers start straight from SCHEDULED too.
    await admin.post(`/work-orders/${w.id}/assign`, {
      assignedUserId: ids.worker,
      assignedTeamId: '',
      scheduledStart: start,
    })
    expect((await worker.post(`/work-orders/${w.id}/start`)).body.data.status).toBe('IN_PROGRESS')
  })

  it('helpers see and work the job; only newcomers are notified on reassignment', async () => {
    const w = (
      await admin.post('/work-orders', wo({ assignedUserId: ids.worker, helperIds: [ids.helper] }))
    ).body.data as WorkOrderDetail
    expect(w.helpers.map((h) => h.id)).toEqual([ids.helper])
    expect((await helper.get(`/work-orders/${w.id}`)).body.data.actions.start).toBe(true)
    expect((await notes(ids.helper, 'TASK_ASSIGNED')).length).toBe(1)

    await admin.post(`/work-orders/${w.id}/assign`, {
      assignedUserId: ids.worker,
      assignedTeamId: '',
      helperIds: [ids.helper],
    })
    expect((await notes(ids.helper, 'TASK_ASSIGNED')).length).toBe(1)
    expect((await notes(ids.worker, 'TASK_ASSIGNED')).length).toBe(1)

    const workload = (await admin.get(`/work-orders/workload?restaurantId=${R[0]}`)).body
      .data as AssigneeWorkload[]
    const byName = new Map(workload.map((r) => [r.user.id, r.openCount]))
    expect(byName.get(ids.worker)).toBe(1)
    expect(byName.get(ids.helper)).toBe(1)
  })

  it('supervisor rejects with a reason → REOPENED → reworked → verified and closed', async () => {
    const w = (
      await admin.post(
        '/work-orders',
        wo({ assignedUserId: ids.worker, supervisorId: ids.supervisor }),
      )
    ).body.data as WorkOrderDetail
    expect(w.supervisor?.id).toBe(ids.supervisor)
    await worker.post(`/work-orders/${w.id}/start`)
    await giveEvidence(w.id, ids.worker)
    await worker.post(
      `/work-orders/${w.id}/complete`,
      report({ notes: 'Recharged gas', assetStatus: '' }),
    )
    // Only the named supervisor is asked to verify.
    expect((await notes(ids.supervisor, 'TASK_COMPLETED')).length).toBe(1)
    expect((await notes(ids.admin, 'TASK_COMPLETED')).length).toBe(0)

    expect((await supervisor.post(`/work-orders/${w.id}/reject`, { reason: '' })).status).toBe(400)
    const back = (
      await supervisor.post(`/work-orders/${w.id}/reject`, { reason: 'Still 9°C inside' })
    ).body.data as WorkOrderDetail
    expect(back).toMatchObject({
      status: 'REOPENED',
      rejectionReason: 'Still 9°C inside',
      reopenCount: 1,
      completedAt: null,
    })
    expect((await notes(ids.worker, 'WORK_REJECTED')).length).toBe(1)

    await worker.post(`/work-orders/${w.id}/start`)

    await giveEvidence(w.id, ids.worker)
    await worker.post(
      `/work-orders/${w.id}/complete`,
      report({ notes: 'Fixed leak too', assetStatus: '' }),
    )
    const done = (await supervisor.post(`/work-orders/${w.id}/verify`, { note: 'OK now' })).body
      .data as WorkOrderDetail
    expect(done).toMatchObject({ status: 'CLOSED', verifiedBy: { id: ids.supervisor } })
    expect(done.history.map((h) => h.toStatus).slice(0, 4)).toEqual([
      'CLOSED',
      'VERIFIED',
      'REVIEW',
      'COMPLETED',
    ])
  })

  it('cancel needs a reason, stops the clock and tells the crew', async () => {
    const w = (await admin.post('/work-orders', wo({ assignedUserId: ids.worker }))).body
      .data as WorkOrderDetail
    await worker.post(`/work-orders/${w.id}/start`)
    await giveEvidence(w.id, ids.worker)
    expect((await worker.post(`/work-orders/${w.id}/cancel`, { reason: 'x' })).status).toBe(403)
    const c = (await admin.post(`/work-orders/${w.id}/cancel`, { reason: 'Machine replaced' })).body
      .data as WorkOrderDetail
    expect(c).toMatchObject({ status: 'CANCELLED', cancelReason: 'Machine replaced' })
    expect(c.timerRunning).toBe(false)
    expect(c.actions).toMatchObject({ start: false, edit: false, upload: false, cancel: false })
    expect((await notes(ids.worker, 'WORK_CANCELLED')).length).toBe(1)
  })

  it('sub work orders: progress on the parent, which cannot finish before them', async () => {
    const parent = (
      await admin.post('/work-orders', wo({ title: 'Kitchen refit', assignedUserId: ids.worker }))
    ).body.data as WorkOrderDetail
    const sub = (title: string) =>
      admin.post('/work-orders', wo({ title, parentId: parent.id, assignedUserId: ids.worker }))
    const a = (await sub('Electrical')).body.data as WorkOrderDetail
    await sub('Plumbing')
    const nested = await admin.post('/work-orders', wo({ title: 'Too deep', parentId: a.id }))
    expect(nested.body.error.fieldErrors).toEqual({
      parentId: ['validation.invalidParentWorkOrder'],
    })

    await worker.post(`/work-orders/${a.id}/start`)

    await giveEvidence(a.id, ids.worker)
    await worker.post(`/work-orders/${a.id}/complete`, report({ notes: 'Wired', assetStatus: '' }))
    const p = (await admin.get(`/work-orders/${parent.id}`)).body.data as WorkOrderDetail
    expect(p.subProgress).toEqual({ done: 1, total: 2 })
    expect(p.children.map((c) => c.title)).toEqual(['Electrical', 'Plumbing'])

    await worker.post(`/work-orders/${parent.id}/start`)

    await giveEvidence(parent.id, ids.worker)
    const early = await worker.post(
      `/work-orders/${parent.id}/complete`,
      report({
        notes: 'All done',
        assetStatus: '',
      }),
    )
    expect(early.body.error.code).toBe('SUB_WORK_ORDERS_OPEN')
    const list = (await admin.get(`/work-orders?parentId=${parent.id}`)).body
      .data as WorkOrderListItem[]
    expect(list).toHaveLength(2)
  })

  it('prices the job: parts + labour at the technician rate + cost lines, rolled up to the asset', async () => {
    await prisma.user.update({ where: { id: ids.worker }, data: { hourlyRate: 600 } })
    const asset = (await admin.post('/assets', assetBody())).body.data as AssetDetail
    const part = await prisma.part.create({
      data: { organizationId: fx.orgId, name: 'Relay', partNumber: 'RL-1', unitCost: 250 },
    })
    await prisma.inventory.create({
      data: { organizationId: fx.orgId, partId: part.id, restaurantId: R[0]!, quantity: 10 },
    })
    const w = (
      await admin.post('/work-orders', wo({ assetId: asset.id, assignedUserId: ids.worker }))
    ).body.data as WorkOrderDetail
    await worker.post(`/work-orders/${w.id}/start`)
    await giveEvidence(w.id, ids.worker)
    await worker.post(`/work-orders/${w.id}/parts`, { partId: part.id, quantity: 2 })
    // 30 minutes of logged work.
    await prisma.workOrderTimeEntry.updateMany({
      where: { workOrderId: w.id },
      data: { startedAt: new Date(Date.now() - 30 * 60_000) },
    })
    expect(
      (
        await worker.post(`/work-orders/${w.id}/costs`, {
          type: 'OTHER',
          description: 'Tip',
          amount: 1,
        })
      ).status,
    ).toBe(403)
    const priced = (
      await admin.post(`/work-orders/${w.id}/costs`, {
        type: 'VENDOR',
        description: 'Gas refill by CoolCare',
        amount: 1200,
      })
    ).body.data as WorkOrderDetail
    expect(priced.costLines).toHaveLength(1)
    expect(priced.cost.parts).toBe(500)
    expect(priced.cost.vendor).toBe(1200)
    expect(priced.cost.labour).toBeGreaterThanOrEqual(299)
    expect(priced.cost.labour).toBeLessThanOrEqual(302)

    expect(
      Number((await prisma.inventory.findFirstOrThrow({ where: { partId: part.id } })).quantity),
    ).toBe(8)
    const a = (await admin.get(`/assets/${asset.id}`)).body.data as AssetDetail
    // The job is still running, so labour grows by a paisa between the two reads.
    expect(a.cost.total).toBeCloseTo(priced.cost.total, 1)
    expect(a.history.map((h) => h.eventType)).toContain('PART_REPLACED')

    const removed = (await admin.del(`/work-orders/${w.id}/costs/${priced.costLines[0]!.id}`)).body
      .data as WorkOrderDetail
    expect(removed.cost.vendor).toBe(0)
  })
})

describe('restaurant control', () => {
  it('manager, statistics and archive (only without open work)', async () => {
    const r = (await boss.get(`/restaurants/${R[0]}`)).body.data
    const form = {
      code: r.code,
      name: r.name,
      status: r.status,
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      phone: '',
      email: '',
      opensAt: '',
      closesAt: '',
    }
    const updated = await boss.put(`/restaurants/${R[0]}`, {
      ...form,
      managerId: ids.admin,
      contactName: 'Front desk',
    })
    expect(updated.body.data).toMatchObject({
      manager: { id: ids.admin },
      contactName: 'Front desk',
    })
    // A worker can't be the manager.
    const bad = await boss.put(`/restaurants/${R[0]}`, { ...form, managerId: ids.worker })
    expect(bad.body.error.fieldErrors).toEqual({ managerId: ['validation.invalidValue'] })

    await admin.post('/work-orders', wo())
    const stats = (await admin.get(`/restaurants/${R[0]}/stats`)).body.data as RestaurantStats
    expect(stats).toMatchObject({ openWorkOrders: 1, workers: 3, assets: 0 })

    expect((await admin.del(`/restaurants/${R[0]}`)).status).toBe(403)
    expect((await boss.del(`/restaurants/${R[0]}`)).body.error.code).toBe(
      'RESTAURANT_HAS_OPEN_WORK',
    )
    expect((await boss.del(`/restaurants/${R[1]}`)).status).toBe(204)
    expect((await boss.get(`/restaurants/${R[1]}`)).status).toBe(404)
  })
})

describe('dashboard', () => {
  it('reports the CMMS numbers for the period and honours filters', async () => {
    await admin.post('/work-orders', wo({ priority: 'CRITICAL', assignedUserId: ids.worker }))
    await admin.post('/work-orders', wo({ priority: 'LOW', type: 'PREVENTIVE' }))
    const d = (await admin.get('/dashboard')).body.data as DashboardSummary
    expect(d.counts).toMatchObject({ open: 2, critical: 1, activeWorkers: 3 })
    expect(d.mix).toEqual({ REACTIVE: 1, PREVENTIVE: 1, INSPECTION_FOLLOWUP: 0 })
    expect(d.byPriority).toMatchObject({ CRITICAL: 1, LOW: 1 })
    expect(d.today.created).toBe(2)
    expect(d.trend.reduce((s, p) => s + p.created, 0)).toBe(2)
    expect(d.workload.map((r) => [r.user.id, r.open])).toEqual([[ids.worker, 1]])

    const filtered = (await admin.get('/dashboard?priority=LOW')).body.data as DashboardSummary
    expect(filtered.counts.open).toBe(1)
    expect(filtered.mix.REACTIVE).toBe(0)
    expect(
      (await admin.get('/dashboard?from=2025-01-01&to=2026-12-31')).body.error.fieldErrors,
    ).toEqual({ from: ['validation.periodTooLong'] })
  })
})

import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type RequestDetail,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'
import { giveEvidence, report as repairReport } from '../../test/work-orders.js'
import { ensureDefaultCategories } from '../assets/categories.service.js'
import { deriveTitle } from '../requests/requests.service.js'

const app = createApp()
let fx: Fixture
let R: string[]
let boss: ReturnType<typeof api>
let admin: ReturnType<typeof api>
let admin2: ReturnType<typeof api>
let worker: ReturnType<typeof api>
let other: ReturnType<typeof api>
let ids: Record<'boss' | 'admin' | 'admin2' | 'worker' | 'other', string>
let assetId: string

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

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
    upload: (u: string, files: Array<{ buf: Buffer; name: string }>) => {
      const r = request(app).post(`/api/v1${u}`).set(h)
      for (const f of files) r.attach('files', f.buf, f.name)
      return r
    },
  }
}

const report = (o: Record<string, unknown> = {}) => ({
  restaurantId: R[0],
  locationId: '',
  assetId: '',
  category: 'REFRIGERATION',
  title: '',
  description: 'Fridge not cooling, ice on the back wall',
  priority: 'HIGH',
  ...o,
})

const wo = (o: Record<string, unknown> = {}) => ({
  title: 'Replace door gasket',
  description: '',
  category: 'REFRIGERATION',
  priority: 'MEDIUM',
  restaurantId: R[0],
  locationId: '',
  assetId: '',
  dueDate: '',
  assignedUserId: '',
  assignedTeamId: '',
  requestId: '',
  ...o,
})

const notes = (userId: string, type?: string) =>
  prisma.notification.findMany({
    where: { recipientId: userId, ...(type ? { type: type as never } : {}) },
  })

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  await ensureDefaultCategories(prisma, fx.orgId)
  const users = {
    boss: await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' }),
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    admin2: await fx.createUser({ role: 'ADMIN', username: 'admin2', restaurants: [R[1]!] }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
    other: await fx.createUser({ role: 'WORKER', username: 'other', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  boss = api(await tokenFor('boss'))
  admin = api(await tokenFor('admin'))
  admin2 = api(await tokenFor('admin2'))
  worker = api(await tokenFor('worker'))
  other = api(await tokenFor('other'))
  const cat = await prisma.assetCategory.findFirstOrThrow({ where: { name: 'Refrigerator' } })
  const a = await admin.post('/assets', {
    name: 'Walk-in freezer',
    categoryId: cat.id,
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
  })
  assetId = a.body.data.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('requests', () => {
  it('derives a short title from the description', () => {
    expect(deriveTitle('Tap leaking\nunder the sink')).toBe('Tap leaking')
    expect(deriveTitle('x'.repeat(120))).toHaveLength(78)
  })

  it('a worker reports a problem; reviewers of that restaurant are notified', async () => {
    const res = await worker.post('/requests', report({ assetId, priority: 'CRITICAL' }))
    expect(res.status).toBe(201)
    const r = res.body.data as RequestDetail
    expect(r).toMatchObject({
      code: 'REQ-000001',
      title: 'Fridge not cooling, ice on the back wall',
      status: 'NEW',
      asset: { id: assetId },
      can: { convert: false, reject: false },
    })

    expect((await notes(ids.admin, 'NEW_REQUEST')).length).toBe(1)
    expect((await notes(ids.boss, 'CRITICAL_ISSUE')).length).toBe(1)
    expect(await notes(ids.admin2)).toHaveLength(0) // other restaurant
    expect(await notes(ids.worker)).toHaveLength(0) // never the reporter

    // Admin sees and may act; admin of another restaurant gets 404.
    const seen = (await admin.get(`/requests/${r.id}`)).body.data as RequestDetail
    expect(seen.can).toEqual({ convert: true, reject: true, approve: true })
    expect((await admin2.get(`/requests/${r.id}`)).status).toBe(404)
  })

  it('workers only see their own requests', async () => {
    await worker.post('/requests', report())
    await other.post('/requests', report({ description: 'Exhaust fan is noisy' }))
    expect((await worker.get('/requests')).body.meta.total).toBe(1)
    expect((await admin.get('/requests')).body.meta.total).toBe(2)
    expect((await admin.get('/requests?mine=1')).body.meta.total).toBe(0)
  })

  it('validates restaurant scope and asset ownership', async () => {
    expect(
      (await worker.post('/requests', report({ restaurantId: R[1] }))).body.error.fieldErrors,
    ).toEqual({ restaurantId: ['validation.restaurantOutOfScope'] })
    expect(
      (await boss.post('/requests', report({ restaurantId: R[1], assetId }))).body.error
        .fieldErrors,
    ).toEqual({ assetId: ['validation.assetNotInRestaurant'] })
  })

  it('the reporter attaches photos; files are checked by content', async () => {
    const r = (await worker.post('/requests', report())).body.data as RequestDetail
    const ok = await worker.upload(`/requests/${r.id}/attachments`, [
      { buf: PNG, name: 'leak.png' },
    ])
    expect(ok.status).toBe(200)
    expect(ok.body.data.attachments).toHaveLength(1)
    expect(ok.body.data.attachments[0]).toMatchObject({ kind: 'PHOTO', mimeType: 'image/webp' }) // re-encoded: no EXIF
    expect(ok.body.data.attachments[0].url).toMatch(/^\/api\/v1\/files\?key=attachments/)

    const fake = await worker.upload(`/requests/${r.id}/attachments`, [
      { buf: Buffer.from('<script>alert(1)</script>'), name: 'evil.png' },
    ])
    expect(fake.status).toBe(415)
    expect(
      (await other.upload(`/requests/${r.id}/attachments`, [{ buf: PNG, name: 'a.png' }])).status,
    ).toBe(404)
  })

  it('rejects with a reason, once; workers cannot reject', async () => {
    const r = (await worker.post('/requests', report())).body.data as RequestDetail
    expect((await worker.post(`/requests/${r.id}/reject`, { reason: 'Duplicate' })).status).toBe(
      403,
    )
    const res = await admin.post(`/requests/${r.id}/reject`, { reason: 'Duplicate of REQ-1' })
    expect(res.body.data).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Duplicate of REQ-1',
    })
    expect(res.body.data.can).toEqual({ convert: false, reject: false, approve: false })
    expect((await admin.post(`/requests/${r.id}/reject`, { reason: 'Again' })).status).toBe(403)
  })

  it('converts to a work order exactly once', async () => {
    const r = (await worker.post('/requests', report({ assetId }))).body.data as RequestDetail
    const res = await admin.post(
      '/work-orders',
      wo({ title: r.title, requestId: r.id, assetId, assignedUserId: ids.worker }),
    )
    expect(res.status).toBe(201)
    const w = res.body.data as WorkOrderDetail
    expect(w).toMatchObject({ code: 'WO-000001', status: 'ASSIGNED', sourceRequest: { id: r.id } })
    const after = (await admin.get(`/requests/${r.id}`)).body.data as RequestDetail
    expect(after).toMatchObject({ status: 'CONVERTED', workOrder: { id: w.id } })
    expect((await notes(ids.worker, 'TASK_ASSIGNED')).length).toBe(1)

    const again = await admin.post('/work-orders', wo({ requestId: r.id }))
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('ALREADY_CONVERTED')
  })
})

describe('work orders', () => {
  async function assigned(o: Record<string, unknown> = {}) {
    const res = await admin.post('/work-orders', wo({ assetId, assignedUserId: ids.worker, ...o }))
    expect(res.status).toBe(201)
    return res.body.data as WorkOrderDetail
  }

  it('creates OPEN without an assignee and validates references', async () => {
    const res = await admin.post('/work-orders', wo())
    expect(res.body.data).toMatchObject({ status: 'OPEN', assignedUser: null })
    expect(res.body.data.actions).toMatchObject({ assign: true, start: false, edit: true })

    const bad = await boss.post('/work-orders', wo({ restaurantId: R[1], assetId }))
    expect(bad.body.error.fieldErrors).toEqual({ assetId: ['validation.assetNotInRestaurant'] })
    const notThere = await boss.post(
      '/work-orders',
      wo({ restaurantId: R[1], assignedUserId: ids.worker }),
    )
    expect(notThere.body.error.fieldErrors).toEqual({
      assignedUserId: ['validation.assigneeNotInRestaurant'],
    })
    expect((await worker.post('/work-orders', wo())).status).toBe(403)
  })

  it('runs the full lifecycle: start → hold → resume → complete → verify (closed) → reopen', async () => {
    const w = await assigned()
    expect(w.actions).toMatchObject({ assign: true, verify: false }) // admin view

    const mine = (await worker.get(`/work-orders/${w.id}`)).body.data as WorkOrderDetail
    expect(mine.actions).toMatchObject({ start: true, assign: false, verify: false, edit: false })

    let s = (await worker.post(`/work-orders/${w.id}/start`)).body.data as WorkOrderDetail
    await giveEvidence(w.id, ids.worker)
    expect(s).toMatchObject({ status: 'IN_PROGRESS', timerRunning: true })
    expect((await worker.post(`/work-orders/${w.id}/hold`, { reason: '' })).status).toBe(400)
    s = (await worker.post(`/work-orders/${w.id}/hold`, { reason: 'Waiting for gas' })).body.data
    expect(s).toMatchObject({
      status: 'ON_HOLD',
      holdReason: 'Waiting for gas',
      timerRunning: false,
    })
    s = (await worker.post(`/work-orders/${w.id}/resume`)).body.data
    expect(s).toMatchObject({ status: 'IN_PROGRESS', timerRunning: true })

    // Verification is not possible before the work is submitted.
    expect((await admin.post(`/work-orders/${w.id}/verify`, { note: '' })).status).toBe(403)

    s = (
      await worker.post(
        `/work-orders/${w.id}/complete`,
        repairReport({
          notes: 'Replaced the gasket',
          assetStatus: 'OPERATIONAL',
        }),
      )
    ).body.data
    expect(s).toMatchObject({
      status: 'REVIEW',
      completionNotes: 'Replaced the gasket',
      timerRunning: false,
    })
    expect(s.history.map((h) => h.toStatus)).toEqual(
      expect.arrayContaining(['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'REVIEW']),
    )
    expect((await notes(ids.admin, 'TASK_COMPLETED')).length).toBe(1)
    const assetEvents = await prisma.assetHistory.findMany({
      where: { assetId, workOrderId: w.id },
    })
    expect(assetEvents.map((e) => e.eventType)).toContain('WORK_ORDER_COMPLETED')

    s = (await admin.post(`/work-orders/${w.id}/verify`, { note: 'Checked' })).body.data
    expect(s).toMatchObject({
      status: 'CLOSED',
      closedBy: { id: ids.admin },
      verifiedBy: { id: ids.admin },
    })
    expect(s.history.slice(0, 2).map((h) => h.toStatus)).toEqual(['CLOSED', 'VERIFIED'])
    expect(s.actions).toMatchObject({ reopen: true, message: false, upload: false })

    expect(
      (await worker.post(`/work-orders/${w.id}/reopen`, { reason: 'Still warm' })).status,
    ).toBe(403)
    s = (await admin.post(`/work-orders/${w.id}/reopen`, { reason: 'Still warm' })).body.data
    expect(s).toMatchObject({
      status: 'REOPENED',
      reopenCount: 1,
      closedAt: null,
      verifiedAt: null,
      rejectionReason: 'Still warm',
    })
    // The technician picks it up again from REOPENED.
    s = (await worker.post(`/work-orders/${w.id}/start`)).body.data
    expect(s.status).toBe('IN_PROGRESS')
  })

  it('rejects actions that are invalid for the current status', async () => {
    const w = await assigned()
    expect(
      (
        await worker.post(
          `/work-orders/${w.id}/complete`,
          repairReport({ notes: 'done', assetStatus: '' }),
        )
      ).status,
    ).toBe(403)
    expect((await worker.post(`/work-orders/${w.id}/resume`)).status).toBe(403)
    await worker.post(`/work-orders/${w.id}/start`)
    await giveEvidence(w.id, ids.worker)
    await giveEvidence(w.id, ids.worker)
    expect((await worker.post(`/work-orders/${w.id}/start`)).status).toBe(403)
  })

  it('workers only see their own work; others get 404', async () => {
    const w = await assigned()
    await admin.post('/work-orders', wo({ title: 'Unassigned job' }))
    expect((await worker.get('/work-orders')).body.meta.total).toBe(1)
    expect((await other.get('/work-orders')).body.meta.total).toBe(0)
    expect((await other.get(`/work-orders/${w.id}`)).status).toBe(404)
    expect((await other.post(`/work-orders/${w.id}/start`)).status).toBe(404)
    expect((await admin2.get(`/work-orders/${w.id}`)).status).toBe(404)
    expect((await admin.get('/work-orders?view=unassigned')).body.meta.total).toBe(1)
  })

  it('a team member claims an unassigned team task by starting it', async () => {
    const team = await prisma.team.create({
      data: {
        organizationId: fx.orgId,
        restaurantId: R[0],
        name: 'Kitchen crew',
        members: { create: [{ userId: ids.worker }, { userId: ids.other }] },
      },
    })
    const w = (await admin.post('/work-orders', wo({ assignedTeamId: team.id }))).body
      .data as WorkOrderDetail
    expect(w.status).toBe('ASSIGNED')
    expect((await notes(ids.worker, 'TASK_ASSIGNED')).length).toBe(1)
    expect((await notes(ids.other, 'TASK_ASSIGNED')).length).toBe(1)

    expect((await other.get('/work-orders')).body.meta.total).toBe(1)
    const started = (await worker.post(`/work-orders/${w.id}/start`)).body.data as WorkOrderDetail
    expect(started.assignedUser?.id).toBe(ids.worker)
    // Once claimed, the task leaves the other member's list.
    expect((await other.get(`/work-orders/${w.id}`)).status).toBe(404)
  })

  it('reassigns, unassigns and edits only while allowed', async () => {
    const w = await assigned()
    expect(
      (await admin.post(`/work-orders/${w.id}/assign`, {})).body.error.fieldErrors,
    ).toBeTruthy()
    const re = await admin.post(`/work-orders/${w.id}/assign`, {
      assignedUserId: ids.other,
      assignedTeamId: '',
    })
    expect(re.body.data.assignedUser.id).toBe(ids.other)
    expect((await notes(ids.other, 'TASK_ASSIGNED')).length).toBe(1)

    const un = (await admin.post(`/work-orders/${w.id}/unassign`)).body.data as WorkOrderDetail
    expect(un).toMatchObject({ status: 'OPEN', assignedUser: null })

    const edited = await admin.put(
      `/work-orders/${w.id}`,
      wo({ title: 'Replace door gasket and hinge', priority: 'HIGH', assetId }),
    )
    expect(edited.body.data).toMatchObject({
      title: 'Replace door gasket and hinge',
      priority: 'HIGH',
    })
    expect((await worker.put(`/work-orders/${w.id}`, wo())).status).toBe(404) // no longer theirs
  })

  it('messages and photos on a task', async () => {
    const w = await assigned()
    const m = await worker.post(`/work-orders/${w.id}/messages`, { body: 'On my way' })
    expect(m.body.data.messages).toEqual([
      expect.objectContaining({ body: 'On my way', mine: true }),
    ])
    const seen = (await admin.get(`/work-orders/${w.id}`)).body.data as WorkOrderDetail
    expect(seen.messages[0]!.mine).toBe(false)

    const up = await worker.upload(`/work-orders/${w.id}/attachments`, [
      { buf: PNG, name: 'before.png' },
      { buf: PNG, name: 'after.png' },
    ])
    expect(up.body.data.attachments).toHaveLength(2)
    const tooMany = await worker.upload(
      `/work-orders/${w.id}/attachments`,
      Array.from({ length: 7 }, (_, i) => ({ buf: PNG, name: `${i}.png` })),
    )
    expect(tooMany.body.error.fieldErrors).toEqual({ files: ['validation.tooManyFiles'] })
  })

  it('filters by view, priority and search', async () => {
    await assigned({ title: 'Fix tandoor burner', priority: 'CRITICAL', category: 'GAS' })
    await assigned({ title: 'Clean drain' })
    expect((await admin.get('/work-orders?priority=CRITICAL')).body.meta.total).toBe(1)
    expect((await admin.get('/work-orders?q=tandoor')).body.data[0].title).toBe(
      'Fix tandoor burner',
    )
    expect((await admin.get('/work-orders?view=active')).body.meta.total).toBe(2)
    expect((await admin.get('/work-orders?view=review')).body.meta.total).toBe(0)
    const sorted = (await admin.get('/work-orders?sort=priority:desc')).body.data
    expect(sorted[0].priority).toBe('CRITICAL')
  })
})

describe('work order list date filter', () => {
  it('uses the organization’s calendar days (IST), not UTC days', async () => {
    // 01:30 IST on 2 Oct is still 1 Oct in UTC.
    await prisma.workOrder.create({
      data: {
        organizationId: fx.orgId,
        code: 'WO-LATE',
        title: 'Night shift leak',
        restaurantId: R[0]!,
        createdById: ids.admin,
        createdAt: new Date('2026-10-01T20:00:00Z'),
      },
    })
    const on2nd = await admin.get('/work-orders?from=2026-10-02&to=2026-10-02')
    expect(on2nd.body.data.map((w: { code: string }) => w.code)).toEqual(['WO-LATE'])
    const on1st = await admin.get('/work-orders?from=2026-10-01&to=2026-10-01')
    expect(on1st.body.data).toEqual([])
  })
})

describe('abuse checks (security hardening)', () => {
  const assignedTo = async (userId: string) => {
    const res = await admin.post('/work-orders', wo({ assetId, assignedUserId: userId }))
    expect(res.status).toBe(201)
    return res.body.data as WorkOrderDetail
  }

  it('completing a job can report the asset broken, but not retire it, without assets:edit', async () => {
    const w = await assignedTo(ids.worker)
    await worker.post(`/work-orders/${w.id}/start`)
    await giveEvidence(w.id, ids.worker)
    const retire = await worker.post(
      `/work-orders/${w.id}/complete`,
      repairReport({ assetStatus: 'RETIRED' }),
    )
    expect(retire.status).toBe(400)
    // Refused before anything changed.
    expect((await worker.get(`/work-orders/${w.id}`)).body.data.status).toBe('IN_PROGRESS')
    const broken = await worker.post(
      `/work-orders/${w.id}/complete`,
      repairReport({ assetStatus: 'BROKEN' }),
    )
    expect(broken.status).toBe(200)
    const mine = (await worker.get(`/work-orders/${w.id}`)).body.data as WorkOrderDetail
    // Labour cost would reveal a colleague's hourly rate.
    expect(mine.cost).toEqual({ parts: 0, labour: 0, vendor: 0, other: 0, total: 0 })
    expect(mine.costLines).toEqual([])
  })

  it('whoever completed a job can’t verify it themselves (Super Admin may)', async () => {
    const w = await assignedTo(ids.admin)
    await admin.post(`/work-orders/${w.id}/start`)
    await giveEvidence(w.id, ids.admin)
    const done = await admin.post(`/work-orders/${w.id}/complete`, repairReport())
    expect(done.body.data.status).toBe('REVIEW')
    expect(done.body.data.actions.verify).toBe(false)
    expect((await admin.post(`/work-orders/${w.id}/verify`, { note: '' })).status).toBe(403)
    expect((await boss.post(`/work-orders/${w.id}/verify`, { note: '' })).status).toBe(200)
  })

  it('a converted request stays at the restaurant it was reported for', async () => {
    const r = await worker.post('/requests', report())
    expect(r.status).toBe(201)
    const moved = await boss.post('/work-orders', wo({ restaurantId: R[1], requestId: r.body.data.id }))
    expect(moved.status).toBe(400)
    const ok = await boss.post('/work-orders', wo({ restaurantId: R[0], requestId: r.body.data.id }))
    expect(ok.status).toBe(201)
  })

  it('counter meters only go up for people who can’t edit meters', async () => {
    const m = await admin.post(`/assets/${assetId}/meters`, {
      name: 'Runtime',
      type: 'RUNTIME_HOURS',
      unit: 'h',
    })
    const meterId = m.body.data[0].id as string
    const read = (who: typeof worker, value: number) =>
      who.post(`/assets/${assetId}/meters/${meterId}/readings`, { value, note: '' })
    expect((await read(worker, 1200)).status).toBe(201)
    const back = await read(worker, 1100)
    expect(back.body.error.fieldErrors).toEqual({ value: ['validation.meterGoesUp'] })
    const jump = await read(worker, 999_999_999)
    expect(jump.body.error.fieldErrors).toEqual({ value: ['validation.meterJumpTooBig'] })
    expect((await read(worker, 1250)).status).toBe(201)
    // A manager can still correct a wrong reading.
    expect((await read(admin, 1000)).status).toBe(201)
  })
})

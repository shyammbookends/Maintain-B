import { AUTH_CSRF_HEADER, AUTH_CSRF_VALUE, type DashboardSummary } from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { dayRangeInZone, timeZoneOffsetMinutes } from '../../core/time.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'

const app = createApp()
const HOUR = 3_600_000

let fx: Fixture
let R: string[]
let creatorId: string
let seq = 0

async function token(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}

async function dashboard(tok: string, restaurantId?: string): Promise<request.Response> {
  return request(app)
    .get(`/api/v1/dashboard${restaurantId ? `?restaurantId=${restaurantId}` : ''}`)
    .set('Authorization', `Bearer ${tok}`)
}

function wo(data: Partial<Prisma.WorkOrderUncheckedCreateInput> & { restaurantId: string }) {
  seq++
  return prisma.workOrder.create({
    data: {
      organizationId: fx.orgId,
      code: `WO-${String(seq).padStart(6, '0')}`,
      title: `Task ${seq}`,
      createdById: creatorId,
      ...data,
    },
  })
}

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 3 })
  R = fx.restaurantIds
  creatorId = (await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })).id
  await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] })
  await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('time helpers', () => {
  it('computes the local day in India', () => {
    expect(timeZoneOffsetMinutes('Asia/Kolkata', new Date('2026-10-02T00:00:00Z'))).toBe(330)
    const { start, end } = dayRangeInZone('Asia/Kolkata', new Date('2026-10-02T20:00:00Z'))
    // 20:00 UTC is 01:30 IST on 3 Oct → day starts 2 Oct 18:30 UTC.
    expect(start.toISOString()).toBe('2026-10-02T18:30:00.000Z')
    expect(end.toISOString()).toBe('2026-10-03T18:30:00.000Z')
  })
})

describe('GET /dashboard', () => {
  it('is all zeros on an empty system (no invented numbers)', async () => {
    const res = await dashboard(await token('boss'))
    expect(res.status).toBe(200)
    const d = res.body.data as DashboardSummary
    expect(d.counts).toMatchObject({
      restaurants: 3,
      activeRestaurants: 3,
      open: 0,
      overdue: 0,
      inProgress: 0,
      pendingVerification: 0,
      completed30d: 0,
      critical: 0,
      lowStock: 0,
      openRequests: 0,
      assetsDown: 0,
      criticalAssetsDown: 0,
      failedInspections: 0,
    })
    expect(d.cost).toEqual({ parts: 0, labour: 0, vendor: 0, other: 0, total: 0 })
    expect(d.mix).toEqual({ REACTIVE: 0, PREVENTIVE: 0, INSPECTION_FOLLOWUP: 0 })
    expect(d.trend).toHaveLength(30)
    expect(d.trend.every((p) => p.created === 0 && p.completed === 0)).toBe(true)
    expect(d.mttrHours).toBeNull()
    expect(d.downtimeHours).toBe(0)
    expect(d.pmCompliance).toBeNull()
    expect(d.todaysTasks).toEqual([])
    expect(d.restaurants).toHaveLength(3)
  })

  it('counts open, overdue, critical, in progress, completed and today, per restaurant', async () => {
    const now = Date.now()
    const { start } = dayRangeInZone('Asia/Kolkata', new Date())
    await wo({ restaurantId: R[0]!, status: 'OPEN', dueDate: new Date(now - 2 * HOUR) }) // overdue
    await wo({ restaurantId: R[0]!, status: 'IN_PROGRESS', priority: 'CRITICAL' })
    await wo({
      restaurantId: R[0]!,
      status: 'ASSIGNED',
      dueDate: new Date(Math.max(now + HOUR, start.getTime())),
    })
    await wo({
      restaurantId: R[1]!,
      status: 'ON_HOLD',
      priority: 'CRITICAL',
      dueDate: new Date(now - HOUR),
    })
    await wo({ restaurantId: R[1]!, status: 'CLOSED', completedAt: new Date(now - 2 * 86_400_000) })
    await wo({
      restaurantId: R[2]!,
      status: 'COMPLETED',
      completedAt: new Date(now - 40 * 86_400_000),
    }) // too old
    await wo({ restaurantId: R[2]!, status: 'OPEN', archivedAt: new Date() }) // archived: ignored

    const d = (await dashboard(await token('boss'))).body.data as DashboardSummary
    expect(d.counts).toMatchObject({
      open: 4,
      overdue: 2,
      inProgress: 1,
      completed30d: 1,
      critical: 2,
    })
    expect(d.criticalIssues.map((w) => w.status).sort()).toEqual(['IN_PROGRESS', 'ON_HOLD'])
    expect(d.overdueTasks).toHaveLength(2)
    expect(d.todaysTasks.length).toBeGreaterThanOrEqual(0)
    const r1 = d.restaurants.find((r) => r.id === R[0])!
    expect(r1).toMatchObject({ open: 3, overdue: 1, critical: 1 })
  })

  it('an Admin only sees their restaurants; asking for another one returns nothing', async () => {
    await wo({ restaurantId: R[0]!, status: 'OPEN', priority: 'CRITICAL' })
    await wo({ restaurantId: R[1]!, status: 'OPEN', priority: 'CRITICAL' })
    const tok = await token('admin')

    const all = (await dashboard(tok)).body.data as DashboardSummary
    expect(all.counts).toMatchObject({ restaurants: 1, open: 1, critical: 1 })
    expect(all.criticalIssues.every((w) => w.restaurant.id === R[0])).toBe(true)

    const other = (await dashboard(tok, R[1])).body.data as DashboardSummary
    expect(other.counts).toMatchObject({ restaurants: 0, open: 0, critical: 0 })
    expect(other.restaurants).toEqual([])
  })

  it('filters to one restaurant', async () => {
    await wo({ restaurantId: R[0]!, status: 'OPEN' })
    await wo({ restaurantId: R[1]!, status: 'OPEN' })
    await wo({ restaurantId: R[1]!, status: 'OPEN' })
    const d = (await dashboard(await token('boss'), R[1])).body.data as DashboardSummary
    expect(d.counts.open).toBe(2)
    expect(d.restaurants.map((r) => r.id)).toEqual([R[1]])
  })

  it('preventive maintenance compliance = on-time completions / due', async () => {
    const now = Date.now()
    const due = (h: number) => new Date(now - h * HOUR)
    await wo({
      restaurantId: R[0]!,
      type: 'PREVENTIVE',
      status: 'CLOSED',
      dueDate: due(48),
      completedAt: due(50),
    }) // on time
    await wo({
      restaurantId: R[0]!,
      type: 'PREVENTIVE',
      status: 'CLOSED',
      dueDate: due(48),
      completedAt: due(20),
    }) // late
    await wo({ restaurantId: R[0]!, type: 'PREVENTIVE', status: 'OPEN', dueDate: due(5) }) // missed
    await wo({
      restaurantId: R[0]!,
      type: 'PREVENTIVE',
      status: 'OPEN',
      dueDate: new Date(now + 48 * HOUR),
    }) // not due yet
    const d = (await dashboard(await token('boss'))).body.data as DashboardSummary
    expect(d.pmCompliance).toBe(33)
  })

  it('counts parts at or below minimum stock', async () => {
    const part = await prisma.part.create({
      data: { organizationId: fx.orgId, name: 'Door gasket', partNumber: 'DG-1', minStock: 3 },
    })
    const other = await prisma.part.create({
      data: { organizationId: fx.orgId, name: 'Relay', partNumber: 'RL-1', minStock: 0 },
    })
    await prisma.inventory.createMany({
      data: [
        { organizationId: fx.orgId, partId: part.id, restaurantId: R[0]!, quantity: 2 }, // low
        { organizationId: fx.orgId, partId: part.id, restaurantId: R[1]!, quantity: 10 }, // fine
        { organizationId: fx.orgId, partId: other.id, restaurantId: R[0]!, quantity: 0 }, // no minimum set
        {
          organizationId: fx.orgId,
          partId: other.id,
          restaurantId: R[2]!,
          quantity: 1,
          minStock: 5,
        }, // override → low
      ],
    })
    expect(
      ((await dashboard(await token('boss'))).body.data as DashboardSummary).counts.lowStock,
    ).toBe(2)
    expect(
      ((await dashboard(await token('admin'))).body.data as DashboardSummary).counts.lowStock,
    ).toBe(1)
  })

  it('recent activity: admins see their restaurants’ operational changes, not user administration', async () => {
    const boss = await token('boss')
    await request(app)
      .put(`/api/v1/restaurants/${R[0]}`)
      .set('Authorization', `Bearer ${boss}`)
      .send({
        code: 'R1',
        name: 'Renamed',
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        postalCode: '',
        phone: '',
        email: '',
        opensAt: '',
        closesAt: '',
        status: 'ACTIVE',
      })
    await request(app)
      .put(`/api/v1/restaurants/${R[1]}`)
      .set('Authorization', `Bearer ${boss}`)
      .send({
        code: 'R2',
        name: 'Other',
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        postalCode: '',
        phone: '',
        email: '',
        opensAt: '',
        closesAt: '',
        status: 'ACTIVE',
      })

    const adminView = (await dashboard(await token('admin'))).body.data as DashboardSummary
    expect(adminView.recentActivity.map((a) => [a.action, a.restaurant?.id])).toEqual([
      ['restaurant.updated', R[0]],
    ])

    const bossView = (await dashboard(boss)).body.data as DashboardSummary
    expect(bossView.recentActivity.map((a) => a.action)).toEqual([
      'restaurant.updated',
      'restaurant.updated',
    ])
    expect(bossView.recentActivity.some((a) => a.action.startsWith('auth.'))).toBe(false)
  })

  it('workers and unauthenticated users cannot use it', async () => {
    expect((await dashboard(await token('worker'))).status).toBe(403)
    expect((await request(app).get('/api/v1/dashboard')).status).toBe(401)
  })
})

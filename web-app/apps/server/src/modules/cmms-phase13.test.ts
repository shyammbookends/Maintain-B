import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type AnalyticsTrends,
  type ReportResult,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'

/* Phase 13: KPI reports (mix, labour, MTTR / MTBF, repeat failures, root causes, costs, vendors), filters and trends. */

const app = createApp()
let fx: Fixture
let R: string[]
let admin: ReturnType<typeof api>
let ids: Record<'admin' | 'ravi' | 'asha', string>
let fridge: string
let vendorId: string

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}

function api(token: string) {
  const h = { Authorization: `Bearer ${token}` }
  return { get: (u: string) => request(app).get(`/api/v1${u}`).set(h) }
}

const HOUR = 3_600_000
const today = new Date().toISOString().slice(0, 10)
const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
const range = `from=${monthAgo}&to=${today}`

let n = 0
async function job(o: Record<string, unknown>) {
  n++
  return prisma.workOrder.create({
    data: {
      organizationId: fx.orgId,
      restaurantId: R[0]!,
      code: `WO-9${String(n).padStart(5, '0')}`,
      title: `Job ${n}`,
      category: 'REFRIGERATION',
      priority: 'MEDIUM',
      type: 'REACTIVE',
      status: 'OPEN',
      createdById: ids.admin,
      ...o,
    },
  })
}

beforeEach(async () => {
  await resetDatabase()
  n = 0
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  const users = {
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    ravi: await fx.createUser({ role: 'WORKER', username: 'ravi', restaurants: [R[0]!] }),
    asha: await fx.createUser({ role: 'WORKER', username: 'asha', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  await prisma.user.update({ where: { id: ids.ravi }, data: { hourlyRate: 300 } })
  admin = api(await tokenFor('admin'))
  const cat = await prisma.assetCategory.create({
    data: { organizationId: fx.orgId, name: 'Fridge' },
  })
  fridge = (
    await prisma.asset.create({
      data: {
        organizationId: fx.orgId,
        restaurantId: R[0]!,
        categoryId: cat.id,
        publicId: 'FridgeQr9999',
        assetCode: 'AST-0009',
        name: 'Walk-in fridge',
      },
    })
  ).id
  vendorId = (await prisma.vendor.create({ data: { organizationId: fx.orgId, name: 'CoolTech' } }))
    .id

  // Three fridge failures in the last month (two fixed in 4 h and 8 h), one PM job.
  const t0 = Date.now() - 20 * 86_400_000
  const a = await job({
    assetId: fridge,
    createdAt: new Date(t0),
    completedAt: new Date(t0 + 4 * HOUR),
    status: 'CLOSED',
    assignedUserId: ids.ravi,
    priority: 'HIGH',
  })
  await job({
    assetId: fridge,
    createdAt: new Date(t0 + 5 * 86_400_000),
    startedAt: new Date(t0 + 5 * 86_400_000 + HOUR),
    completedAt: new Date(t0 + 5 * 86_400_000 + 8 * HOUR),
    dueDate: new Date(t0 + 6 * 86_400_000),
    status: 'CLOSED',
    assignedUserId: ids.asha,
    vendorId,
  })
  await job({ assetId: fridge, createdAt: new Date(t0 + 10 * 86_400_000) })
  await job({ type: 'PREVENTIVE', createdAt: new Date(t0 + 2 * 86_400_000) })
  await prisma.workOrderTimeEntry.create({
    data: {
      workOrderId: a.id,
      userId: ids.ravi,
      startedAt: new Date(t0 + HOUR),
      endedAt: new Date(t0 + 3 * HOUR),
      minutes: 120,
    },
  })
  await prisma.rootCauseAnalysis.create({
    data: {
      organizationId: fx.orgId,
      workOrderId: a.id,
      assetId: fridge,
      failure: 'Not cooling',
      rootCause: 'Gasket worn',
      category: 'WEAR_AND_TEAR',
      preventiveAction: 'Check gaskets monthly',
      createdById: ids.admin,
    },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

const report = async (key: string, extra = '') => {
  const res = await admin.get(`/reports/${key}?${range}${extra}`)
  expect(res.status).toBe(200)
  return res.body.data as ReportResult
}
const summary = (r: ReportResult, label: string) => r.summary.find((s) => s.label === label)?.value

describe('Phase 13 — KPI reports', () => {
  it('splits reactive and preventive work', async () => {
    const r = await report('maintenance-mix')
    expect(r.rows[0]).toMatchObject({ total: 4, reactive: 3, preventive: 1, preventivePct: 25 })
  })

  it('measures MTTR, MTBF and repeat failures per asset', async () => {
    const r = await report('reliability')
    expect(r.rows[0]).toMatchObject({ asset: 'Walk-in fridge', failures: 3, mttrHours: 6 })
    expect(summary(r, 'mttrHours')).toBe(6)
    expect(summary(r, 'mtbfHours')).toBeGreaterThan(0)
    const rep = await report('repeat-failures')
    expect(rep.rows[0]).toMatchObject({ failures: 3, topCategory: 'REFRIGERATION', rootCauses: 1 })
  })

  it('reports root causes, labour and vendor performance', async () => {
    const f = await report('failure-analysis')
    expect(f.rows[0]).toMatchObject({ category: 'WEAR_AND_TEAR', rootCause: 'Gasket worn' })
    expect(summary(f, 'preventionPct')).toBe(100)

    const l = await report('labour')
    expect(l.rows[0]).toMatchObject({ hours: 2, jobs: 1, labourCost: 600 })

    const v = await report('vendor-performance')
    expect(v.rows[0]).toMatchObject({
      vendor: 'CoolTech',
      jobs: 1,
      completed: 1,
      avgResponseHours: 1,
      avgCompletionHours: 8,
      onTimePct: 100,
    })
    const c = await report('cost-breakdown')
    expect(c.rows.find((r) => r.labour === 600)).toBeDefined()
  })

  it('filters work-order reports by technician, priority, asset and type', async () => {
    const byRavi = await report('work-orders-completed', `&userId=${ids.ravi}`)
    expect(byRavi.rows).toHaveLength(1)
    const high = await report('work-order-summary', '&priority=HIGH')
    expect(high.rows[0]).toMatchObject({ created: 1 })
    const pm = await report('maintenance-mix', '&type=PREVENTIVE')
    expect(pm.rows[0]).toMatchObject({ total: 1 })
    const asset = await report('reliability', `&assetId=${fridge}`)
    expect(asset.rows).toHaveLength(1)
    // CSV carries the new reports too.
    const csv = await admin.get(`/reports/reliability/csv?${range}`)
    expect(csv.status).toBe(200)
    expect(csv.text.split('\n')[0]).toContain('mttrHours')
  })

  it('returns trend series with headline KPIs', async () => {
    const res = await admin.get(`/reports/analytics/trends?${range}`)
    expect(res.status).toBe(200)
    const t = res.body.data as AnalyticsTrends
    expect(t.bucket).toBe('day')
    expect(t.points.length).toBeGreaterThanOrEqual(30)
    expect(t.totals).toMatchObject({
      created: 4,
      completed: 2,
      reactive: 3,
      preventive: 1,
      mttrHours: 6,
    })
    expect(t.totals.cost.labour).toBe(600)
    expect(t.points.reduce((s, p) => s + p.created, 0)).toBe(4)
  })
})

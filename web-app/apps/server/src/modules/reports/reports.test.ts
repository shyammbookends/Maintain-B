import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  REPORT_KEYS,
  type AnalyticsTrends,
  type ReportResult,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'
import { giveEvidence, report } from '../../test/work-orders.js'

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
  }
}

const today = new Date().toISOString().slice(0, 10)
const range = `from=${new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)}&to=${today}`

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

async function doneJob(title: string) {
  const w = (
    await admin.post('/work-orders', {
      title,
      description: '',
      category: 'PLUMBING',
      priority: 'HIGH',
      restaurantId: R[0],
      locationId: '',
      assetId: '',
      dueDate: new Date(Date.now() + 86_400_000).toISOString(),
      assignedUserId: ids.worker,
      assignedTeamId: '',
      requestId: '',
    })
  ).body.data as WorkOrderDetail
  await worker.post(`/work-orders/${w.id}/start`)
  await giveEvidence(w.id, ids.worker)
  await giveEvidence(w.id, ids.worker)
  await worker.post(`/work-orders/${w.id}/complete`, report({ notes: 'Fixed it', assetStatus: '' }))
  return w
}

describe('reports', () => {
  it('every report runs for every role that may see reports', async () => {
    await doneJob('Fix tap')
    for (const key of REPORT_KEYS) {
      const res = await admin.get(`/reports/${key}?${range}`)
      expect(res.status, key).toBe(200)
      expect(Array.isArray(res.body.data.rows), key).toBe(true)
    }
    expect((await worker.get(`/reports/work-order-summary?${range}`)).status).toBe(403)
  })

  it('counts completed work, scoped to the restaurant', async () => {
    await doneJob('Fix tap')
    await doneJob('Fix drain')
    await admin.post('/work-orders', {
      title: 'Overdue job',
      description: '',
      category: 'OTHER',
      priority: 'CRITICAL',
      restaurantId: R[0],
      locationId: '',
      assetId: '',
      dueDate: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      assignedUserId: '',
      assignedTeamId: '',
      requestId: '',
    })
    const summary = (await admin.get(`/reports/work-order-summary?${range}`)).body
      .data as ReportResult
    expect(summary.rows).toEqual([
      { restaurant: 'Restaurant R1', created: 3, completed: 2, open: 1, overdue: 1, critical: 1 },
    ])
    const done = (await admin.get(`/reports/work-orders-completed?${range}`)).body
      .data as ReportResult
    expect(done.rows.map((r) => r.title).sort()).toEqual(['Fix drain', 'Fix tap'])
    expect(done.rows[0]).toMatchObject({ assignee: 'Test WORKER', onTime: 'yes' })
    const tech = (await admin.get(`/reports/technician-performance?${range}`)).body
      .data as ReportResult
    expect(tech.rows[0]).toMatchObject({ technician: 'Test WORKER', completed: 2, onTimeRate: 100 })
    const overdue = (await admin.get(`/reports/overdue-work-orders?${range}`)).body
      .data as ReportResult
    expect(overdue.rows[0]).toMatchObject({ title: 'Overdue job', daysOverdue: 3 })

    // Another restaurant's admin sees none of it, and can't ask for R1.
    const other = (await admin2.get(`/reports/work-order-summary?${range}`)).body
      .data as ReportResult
    expect(other.rows).toEqual([
      expect.objectContaining({ restaurant: 'Restaurant R2', created: 0 }),
    ])
    expect(
      (await admin2.get(`/reports/work-order-summary?${range}&restaurantId=${R[0]}`)).status,
    ).toBe(400)
    expect((await boss.get(`/reports/work-order-summary?${range}`)).body.data.rows).toHaveLength(2)
  })

  it('validates the range and exports CSV safely (audited)', async () => {
    expect((await admin.get('/reports/low-stock?from=2026-05-01&to=2026-04-01')).status).toBe(400)
    await doneJob('=HYPERLINK("http://evil")')
    const csv = await admin.get(`/reports/work-orders-completed/csv?${range}`)
    expect(csv.status).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.text.startsWith('﻿code,title,')).toBe(true)
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(
      await prisma.auditLog.count({ where: { action: 'report.exported', actorId: ids.admin } }),
    ).toBe(1)
  })
})

/** Collects a binary response body (supertest only buffers text and JSON by default). */
const binary = (res: unknown, cb: (err: Error | null, body: Buffer) => void) => {
  const stream = res as NodeJS.ReadableStream
  const chunks: Buffer[] = []
  stream.on('data', (c: Buffer) => chunks.push(c))
  stream.on('end', () => cb(null, Buffer.concat(chunks)))
}

describe('PDF export', () => {
  it('returns a PDF of the same report, audited, for people who may export', async () => {
    await doneJob('Fix tap')
    const res = await admin
      .get(`/reports/work-orders-completed/pdf?${range}`)
      .buffer(true)
      .parse(binary)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="work-orders-completed_.*\.pdf"$/,
    )
    const body = res.body as Buffer
    expect(body.length).toBeGreaterThan(1000)
    expect(body.subarray(0, 5).toString()).toBe('%PDF-')
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'report.exported',
          actorId: ids.admin,
          metadata: { path: ['format'], equals: 'PDF' },
        },
      }),
    ).toBe(1)

    // Snapshot reports and empty ones render too.
    for (const key of ['low-stock', 'work-order-summary', 'unpaid-invoices'] as const) {
      const r = await boss.get(`/reports/${key}/pdf?${range}`).buffer(true).parse(binary)
      expect(r.status, key).toBe(200)
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
    }
  })

  it('respects reports:export and the restaurant scope', async () => {
    expect((await worker.get(`/reports/work-order-summary/pdf?${range}`)).status).toBe(403)
    // Another restaurant's admin can't export R1.
    expect(
      (await admin2.get(`/reports/work-order-summary/pdf?${range}&restaurantId=${R[0]}`)).status,
    ).toBe(400)
    // Admins whose role lost reports:export can still view, but not download.
    await prisma.rolePermission.deleteMany({
      where: { roleId: fx.roleIds.ADMIN, permission: { key: 'reports:export' } },
    })
    expect((await admin.get(`/reports/work-order-summary?${range}`)).status).toBe(200)
    expect((await admin.get(`/reports/work-order-summary/pdf?${range}`)).status).toBe(403)
    expect((await admin.get(`/reports/work-order-summary/csv?${range}`)).status).toBe(403)
  })
})

describe('audit log', () => {
  it('Super Admin can browse and export; admins and workers cannot', async () => {
    await doneJob('Fix tap')
    const list = (await boss.get('/audit-logs?q=work_order')).body
    expect(list.meta.total).toBeGreaterThanOrEqual(3)
    expect(list.data[0]).toMatchObject({ entityType: 'WORK_ORDER', actor: expect.any(Object) })
    expect((await admin.get('/audit-logs')).status).toBe(403)
    expect((await worker.get('/audit-logs')).status).toBe(403)

    const byActor = (await boss.get(`/audit-logs?actorId=${ids.worker}&entityType=WORK_ORDER`)).body
      .data
    expect(byActor.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['work_order.started', 'work_order.completed']),
    )
    const csv = await boss.get('/audit-logs/csv?entityType=WORK_ORDER')
    expect(csv.text.split('\r\n')[0]).toBe(
      '﻿time,action,entityType,entityId,actor,restaurant,oldValue,newValue,metadata,ip,requestId',
    )
    expect(await prisma.auditLog.count({ where: { action: 'audit.exported' } })).toBe(1)
  })
})

describe('security headers', () => {
  it('locks down API responses and keeps them out of caches', async () => {
    const res = await admin.get('/work-orders')
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'",
    )
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['strict-transport-security']).toBeDefined()
  })
})

describe('analytics trends in the organization time zone', () => {
  it('buckets work by the local (IST) day and keeps the last day of the range', async () => {
    const make = (code: string, createdAt: string) =>
      prisma.workOrder.create({
        data: {
          organizationId: fx.orgId,
          code,
          title: code,
          restaurantId: R[0]!,
          createdById: ids.admin,
          createdAt: new Date(createdAt),
        },
      })
    // 01:30 IST on 1 Oct (still 30 Sep in UTC) and 15:30 IST on 2 Oct.
    await make('WO-A', '2026-09-30T20:00:00Z')
    await make('WO-B', '2026-10-02T10:00:00Z')
    const res = await admin.get('/reports/analytics/trends?from=2026-10-01&to=2026-10-02')
    expect(res.status).toBe(200)
    const points = (res.body.data as AnalyticsTrends).points
    expect(points.map((p) => [p.start, p.created])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 1],
    ])
  })
})

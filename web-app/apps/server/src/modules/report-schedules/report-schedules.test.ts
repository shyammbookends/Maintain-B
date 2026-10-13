import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type ReportScheduleDto,
  type ReportScheduleRunDto,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../app.js'
import { env } from '../../config/env.js'
import { emailEnabled } from '../../core/delivery.js'
import { prisma } from '../../core/prisma.js'
import { runReportSchedules } from '../../jobs/report-schedules.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'
import { nextRunAfter, reportPeriod } from './report-schedules.service.js'

// The mail transport is mocked: nothing leaves the machine.
const sendMail = vi.hoisted(() => vi.fn(async () => ({ messageId: 'test' })))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))

const TZ = 'Asia/Kolkata'
const app = createApp()
let fx: Fixture
let R: string[]
let ids: Record<'boss' | 'admin' | 'admin2' | 'manager' | 'worker' | 'worker2', string>
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
  }
}

const schedule = (o: Record<string, unknown> = {}) => ({
  reportKey: 'work-order-summary',
  restaurantId: R[0],
  filters: { priority: 'HIGH' },
  frequency: 'DAILY',
  timeOfDay: '08:00',
  format: 'PDF',
  recipientUserIds: [ids.manager],
  recipientEmails: ['Owner@Example.com'],
  ...o,
})

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  const users = {
    boss: await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss', email: 'boss@test.in' }),
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    admin2: await fx.createUser({ role: 'ADMIN', username: 'admin2', restaurants: [R[1]!] }),
    manager: await fx.createUser({
      role: 'ADMIN',
      username: 'manager',
      email: 'manager@test.in',
      restaurants: [R[0]!],
    }),
    worker: await fx.createUser({
      role: 'WORKER',
      username: 'worker',
      email: 'worker@test.in',
      restaurants: [R[0]!],
    }),
    worker2: await fx.createUser({
      role: 'WORKER',
      username: 'worker2',
      email: 'worker2@test.in',
      restaurants: [R[1]!],
    }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  boss = api(await tokenFor('boss'))
  admin = api(await tokenFor('admin'))
  admin2 = api(await tokenFor('admin2'))
  worker = api(await tokenFor('worker'))
  sendMail.mockClear()
})

afterEach(() => {
  env.SMTP_URL = undefined
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Makes a schedule due now (as if its time had come). */
const makeDue = (id: string, at = new Date(Date.now() - 60_000)) =>
  prisma.reportSchedule.update({ where: { id }, data: { nextRunAt: at } })

describe('report schedule timing', () => {
  it('finds the next send time in the organization time zone', () => {
    // 2026-10-10 is a Saturday; 08:00 IST = 02:30 UTC.
    const at = new Date('2026-10-10T03:00:00Z')
    const t = { timeOfDay: '08:00', dayOfWeek: null, dayOfMonth: null }
    expect(nextRunAfter({ ...t, frequency: 'DAILY' }, TZ, at).toISOString()).toBe(
      '2026-10-11T02:30:00.000Z',
    )
    expect(
      nextRunAfter(
        { ...t, frequency: 'DAILY' },
        TZ,
        new Date('2026-10-10T02:00:00Z'),
      ).toISOString(),
    ).toBe('2026-10-10T02:30:00.000Z')
    expect(nextRunAfter({ ...t, frequency: 'WEEKLY', dayOfWeek: 1 }, TZ, at).toISOString()).toBe(
      '2026-10-12T02:30:00.000Z',
    )
    expect(nextRunAfter({ ...t, frequency: 'MONTHLY', dayOfMonth: 1 }, TZ, at).toISOString()).toBe(
      '2026-11-01T02:30:00.000Z',
    )
  })

  it('reports on the period before the send day', () => {
    const at = new Date('2026-10-10T02:30:00Z')
    expect(reportPeriod('DAILY', TZ, at)).toEqual({ from: '2026-10-09', to: '2026-10-09' })
    expect(reportPeriod('WEEKLY', TZ, at)).toEqual({ from: '2026-10-03', to: '2026-10-09' })
    expect(reportPeriod('MONTHLY', TZ, at)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(reportPeriod('MONTHLY', TZ, new Date('2026-01-01T03:00:00Z'))).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
  })
})

describe('report schedules API', () => {
  it('the recipient picker only offers people who can see reports', async () => {
    const res = await admin.get(`/users/options?restaurantId=${R[0]}&permission=reports:view`)
    expect(res.status).toBe(200)
    const offered = (res.body.data as Array<{ id: string }>).map((u) => u.id)
    expect(offered).toEqual(expect.arrayContaining([ids.admin, ids.manager]))
    expect(offered).not.toContain(ids.worker)
  })

  it('creates, lists in scope, updates and archives', async () => {
    const res = await admin.post('/report-schedules', schedule())
    expect(res.status).toBe(201)
    const s = res.body.data as ReportScheduleDto
    expect(s).toMatchObject({
      reportKey: 'work-order-summary',
      restaurant: { id: R[0] },
      filters: { priority: 'HIGH' },
      frequency: 'DAILY',
      format: 'PDF',
      recipientUsers: [{ id: ids.manager }],
      recipientEmails: ['owner@example.com'],
      active: true,
      lastRun: null,
      timeZone: TZ,
    })
    expect(new Date(s.nextRunAt).getTime()).toBeGreaterThan(Date.now())

    expect((await admin.get('/report-schedules')).body.data).toHaveLength(1)
    expect((await boss.get('/report-schedules')).body.data).toHaveLength(1)
    // Another restaurant's admin doesn't see it (or reach it).
    expect((await admin2.get('/report-schedules')).body.data).toHaveLength(0)
    expect((await admin2.get(`/report-schedules/${s.id}`)).status).toBe(404)
    // Workers can't schedule reports.
    expect((await worker.get('/report-schedules')).status).toBe(403)
    expect((await worker.post('/report-schedules', schedule())).status).toBe(403)

    const updated = await admin.put(
      `/report-schedules/${s.id}`,
      schedule({ frequency: 'WEEKLY', dayOfWeek: 1, format: 'CSV', recipientEmails: [] }),
    )
    expect(updated.status).toBe(200)
    expect(updated.body.data).toMatchObject({ frequency: 'WEEKLY', dayOfWeek: 1, format: 'CSV' })
    expect(new Date(updated.body.data.nextRunAt).getUTCDay()).toBe(1)

    expect((await admin.del(`/report-schedules/${s.id}`)).status).toBe(204)
    expect((await admin.get('/report-schedules')).body.data).toHaveLength(0)
    expect(
      await prisma.auditLog.count({ where: { action: { startsWith: 'report_schedule.' } } }),
    ).toBe(3)
  })

  it('validates recipients, restaurant scope and timing', async () => {
    // Users (workers) can't view reports in the app, so they can't be sent one either.
    const worker = await admin.post(
      '/report-schedules',
      schedule({ recipientUserIds: [ids.worker] }),
    )
    expect(worker.status).toBe(400)
    expect(worker.body.error.fieldErrors).toEqual({
      recipientUserIds: ['validation.recipientOutOfScope'],
    })
    const outOfScope = await admin.post(
      '/report-schedules',
      schedule({ recipientUserIds: [ids.worker2] }),
    )
    expect(outOfScope.status).toBe(400)
    expect(outOfScope.body.error.fieldErrors).toEqual({
      recipientUserIds: ['validation.recipientOutOfScope'],
    })
    // An admin's "all restaurants" means theirs; R2-only people can't get it.
    expect(
      (
        await admin.post(
          '/report-schedules',
          schedule({ restaurantId: '', recipientUserIds: [ids.worker2] }),
        )
      ).status,
    ).toBe(400)
    // A Super Admin's "all restaurants" can only go to Super Admins (or email addresses).
    expect(
      (await boss.post('/report-schedules', schedule({ restaurantId: '' }))).body.error.fieldErrors,
    ).toEqual({ recipientUserIds: ['validation.recipientOutOfScope'] })
    expect(
      (
        await boss.post(
          '/report-schedules',
          schedule({ restaurantId: '', recipientUserIds: [ids.boss] }),
        )
      ).status,
    ).toBe(201)

    expect(
      (await admin.post('/report-schedules', schedule({ restaurantId: R[1] }))).body.error
        .fieldErrors,
    ).toEqual({ restaurantId: ['validation.restaurantOutOfScope'] })
    const bad = await admin.post(
      '/report-schedules',
      schedule({
        frequency: 'WEEKLY',
        timeOfDay: '25:00',
        recipientUserIds: [],
        recipientEmails: ['nope'],
      }),
    )
    expect(bad.status).toBe(400)
    expect(Object.keys(bad.body.error.fieldErrors).sort()).toEqual(
      ['dayOfWeek', 'recipientEmails.0', 'timeOfDay'].sort(),
    )
    const none = await admin.post(
      '/report-schedules',
      schedule({ recipientUserIds: [], recipientEmails: [] }),
    )
    expect(none.body.error.fieldErrors).toEqual({
      recipientUserIds: ['validation.recipientRequired'],
    })
  })
})

describe('sending scheduled reports', () => {
  it('logs "skipped: email not configured" without SMTP, once per due time', async () => {
    expect(emailEnabled()).toBe(false)
    const s = (await admin.post('/report-schedules', schedule())).body.data as ReportScheduleDto
    await makeDue(s.id)
    expect(await runReportSchedules()).toEqual({ 'skipped: email not configured': 1 })
    // Already moved on: running again sends nothing and logs nothing.
    expect(await runReportSchedules()).toEqual({})
    const runs = (await admin.get(`/report-schedules/${s.id}/runs`)).body
      .data as ReportScheduleRunDto[]
    expect(runs).toEqual([
      expect.objectContaining({ status: 'skipped: email not configured', recipients: 2 }),
    ])
    const after = (await admin.get(`/report-schedules/${s.id}`)).body.data as ReportScheduleDto
    expect(new Date(after.nextRunAt).getTime()).toBeGreaterThan(Date.now())
    expect(after.lastRun?.status).toBe('skipped: email not configured')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('emails the report as a PDF or CSV attachment to each recipient', async () => {
    env.SMTP_URL = 'smtp://localhost:2525'
    const s = (await admin.post('/report-schedules', schedule())).body.data as ReportScheduleDto
    await makeDue(s.id)
    expect(await runReportSchedules()).toEqual({ sent: 1 })
    expect(sendMail).toHaveBeenCalledTimes(2)
    const calls = sendMail.mock.calls as unknown as Array<
      [{ to: string; subject: string; text: string; attachments: Array<Record<string, unknown>> }]
    >
    expect(calls.map(([m]) => m.to).sort()).toEqual(['manager@test.in', 'owner@example.com'])
    const [mail] = calls[0]!
    expect(mail.subject).toContain('Work order summary')
    expect(mail.subject).toContain('Restaurant R1')
    expect(mail.text).toContain('/reports/work-order-summary?')
    const [attachment] = mail.attachments
    expect(attachment).toMatchObject({ contentType: 'application/pdf' })
    expect(String(attachment!.filename)).toMatch(/^work-order-summary_.*\.pdf$/)
    expect((attachment!.content as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
    const run = await prisma.reportScheduleRun.findFirstOrThrow({ where: { scheduleId: s.id } })
    expect(run).toMatchObject({ status: 'sent', recipients: 2, rows: 1 })

    // CSV format.
    sendMail.mockClear()
    await admin.put(`/report-schedules/${s.id}`, schedule({ format: 'CSV', recipientUserIds: [] }))
    await makeDue(s.id)
    await runReportSchedules()
    const csvMail = (
      sendMail.mock.calls[0] as unknown as [
        { attachments: Array<{ content: Buffer; contentType: string }> },
      ]
    )[0]
    expect(csvMail.attachments[0]!.contentType).toContain('text/csv')
    expect(csvMail.attachments[0]!.content.toString('utf8')).toContain('restaurant,created')
  })

  it('never sends twice when runners overlap, and stops for people out of scope', async () => {
    env.SMTP_URL = 'smtp://localhost:2525'
    const s = (await admin.post('/report-schedules', schedule({ recipientEmails: [] }))).body
      .data as ReportScheduleDto
    await makeDue(s.id)
    await Promise.all([runReportSchedules(), runReportSchedules(), runReportSchedules()])
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(await prisma.reportScheduleRun.count({ where: { scheduleId: s.id } })).toBe(1)

    // The manager moves to the other restaurant: no recipients left.
    await prisma.userRestaurant.deleteMany({ where: { userId: ids.manager } })
    await makeDue(s.id, new Date(Date.now() - 30_000))
    sendMail.mockClear()
    expect(await runReportSchedules()).toEqual({ 'skipped: no recipients': 1 })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('skips paused or archived schedules and owners who lost access', async () => {
    const s = (await admin.post('/report-schedules', schedule())).body.data as ReportScheduleDto
    await admin.put(`/report-schedules/${s.id}`, schedule({ active: false }))
    await makeDue(s.id)
    expect(await runReportSchedules()).toEqual({})

    await admin.put(`/report-schedules/${s.id}`, schedule())
    await makeDue(s.id)
    await prisma.user.update({ where: { id: ids.admin }, data: { status: 'DISABLED' } })
    expect(await runReportSchedules()).toEqual({
      'skipped: owner can no longer export reports': 1,
    })
  })
})

describe('limits', () => {
  it('caps how many schedules one person can keep (the mailer is not a bulk sender)', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await admin.post('/report-schedules', schedule())).status).toBe(201)
    }
    const over = await admin.post('/report-schedules', schedule())
    expect(over.status).toBe(400)
    expect(over.body.error.fieldErrors).toEqual({ reportKey: ['validation.tooMany'] })
    // Someone else still can.
    expect((await boss.post('/report-schedules', schedule())).status).toBe(201)
  })
})

import {
  AUTH_CSRF_HEADER,
  STRICT_WORKFLOW,
  AUTH_CSRF_VALUE,
  addDays,
  type CalendarItem,
  type ProcedureDetail,
  type WorkOrderDetail,
  type WorkerHome,
  type WorkerTask,
} from '@maintainx/shared'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { COMPLETION_POLICY_KEY } from '../core/settings.js'
import { dateKeyInZone } from '../core/time.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'
import { giveEvidence, report } from '../test/work-orders.js'

/*
 * Phases 6–8: the technician's hand-in (evidence, repair report, parts,
 * time), richer checklist steps (checkbox, choice, photo, signature,
 * photo-required), and scheduling (reschedule, calendar, yearly / once PM).
 */

const app = createApp()
let fx: Fixture
let R: string[]
let admin: ReturnType<typeof api>
let worker: ReturnType<typeof api>
let helper: ReturnType<typeof api>
let ids: Record<'admin' | 'worker' | 'helper', string>
let workerToken: string

/** 1×1 PNG. */
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
    del: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
    upload: (u: string, fields: Record<string, string> = {}) => {
      const r = request(app).post(`/api/v1${u}`).set(h)
      for (const [k, v] of Object.entries(fields)) r.field(k, v)
      return r.attach('files', PNG, 'photo.png')
    },
  }
}

const wo = (o: Record<string, unknown> = {}) => ({
  title: 'Fridge not cooling',
  description: '',
  category: 'REFRIGERATION',
  priority: 'HIGH',
  restaurantId: R[0],
  locationId: '',
  assetId: '',
  dueDate: '',
  assignedUserId: ids.worker,
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
  const users = {
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
    helper: await fx.createUser({ role: 'WORKER', username: 'helper', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  admin = api(await tokenFor('admin'))
  workerToken = await tokenFor('worker')
  worker = api(workerToken)
  helper = api(await tokenFor('helper'))
})

async function started(o: Record<string, unknown> = {}) {
  const w = (await admin.post('/work-orders', wo(o))).body.data as WorkOrderDetail
  await worker.post(`/work-orders/${w.id}/start`)
  return w
}

// ---------------------------------------------------------------------------

describe('Phase 6 — technician hand-in', () => {
  it('start tells the person who raised the job', async () => {
    await started()
    expect((await notes(ids.admin, 'WORK_STARTED')).length).toBe(1)
  })

  it('needs before and after photos, then a full repair report', async () => {
    const w = await started()
    const noPhotos = await worker.post(`/work-orders/${w.id}/complete`, report())
    expect(noPhotos.body.error).toMatchObject({
      code: 'EVIDENCE_REQUIRED',
    })

    // Real uploads, tagged with their stage.
    const before = await worker.upload(`/work-orders/${w.id}/attachments`, { stage: 'BEFORE' })
    expect(before.status).toBe(200)
    let d = (
      await worker.upload(`/work-orders/${w.id}/attachments`, {
        stage: 'AFTER',
        caption: 'Cold again',
      })
    ).body.data as WorkOrderDetail
    expect(d.completionCheck.evidence).toEqual({ BEFORE: 1, DURING: 0, AFTER: 1 })
    expect(d.completionCheck).toMatchObject({ needsBeforePhoto: false, needsAfterPhoto: false })
    expect(d.attachments.find((a) => a.stage === 'AFTER')?.caption).toBe('Cold again')

    // Mandatory report fields.
    const missing = await worker.post(`/work-orders/${w.id}/complete`, {
      assetStatus: '',
      confirmed: true,
    })
    expect(Object.keys(missing.body.error.fieldErrors).sort()).toEqual([
      'finalCondition',
      'noPartsUsed',
      'problemFound',
      'workPerformed',
    ])
    const unconfirmed = await worker.post(
      `/work-orders/${w.id}/complete`,
      report({ confirmed: false }),
    )
    expect(unconfirmed.status).toBe(400)
    // Parts: say something about them.
    const noParts = await worker.post(
      `/work-orders/${w.id}/complete`,
      report({ noPartsUsed: false }),
    )
    expect(noParts.body.error.fieldErrors).toEqual({
      noPartsUsed: ['validation.partsInfoRequired'],
    })

    d = (
      await worker.post(
        `/work-orders/${w.id}/complete`,
        report({
          problemFound: 'Start relay burnt',
          rootCause: 'Voltage spikes',
          workPerformed: 'Replaced relay, tested 30 min',
          finalCondition: 'FULLY_WORKING',
          recommendation: 'Fit a voltage stabiliser',
        }),
      )
    ).body.data as WorkOrderDetail
    expect(d.status).toBe('REVIEW')
    expect(d.completionNotes).toBe('Replaced relay, tested 30 min')
    expect(d.completion).toMatchObject({
      problemFound: 'Start relay burnt',
      rootCause: 'Voltage spikes',
      finalCondition: 'FULLY_WORKING',
      recommendation: 'Fit a voltage stabiliser',
      noPartsUsed: true,
      confirmedBy: { id: ids.worker },
    })
  })

  it('the photo rules can be switched off for the organization', async () => {
    await prisma.setting.update({
      where: {
        organizationId_scopeKey_key: {
          organizationId: fx.orgId,
          scopeKey: 'org',
          key: COMPLETION_POLICY_KEY,
        },
      },
      data: { value: { ...STRICT_WORKFLOW, requireBeforePhoto: false, requireAfterPhoto: false } },
    })
    const w = await started()
    expect((await worker.post(`/work-orders/${w.id}/complete`, report())).body.data.status).toBe(
      'REVIEW',
    )
  })

  it('records the part condition and accepts parts instead of "no parts used"', async () => {
    const part = await prisma.part.create({
      data: { organizationId: fx.orgId, name: 'Relay', partNumber: 'RL-1', unitCost: 100 },
    })
    await prisma.inventory.create({
      data: { organizationId: fx.orgId, partId: part.id, restaurantId: R[0]!, quantity: 5 },
    })
    const w = await started()
    const d = (
      await worker.post(`/work-orders/${w.id}/parts`, {
        partId: part.id,
        quantity: 1,
        condition: 'REFURBISHED',
      })
    ).body.data as WorkOrderDetail
    expect(d.parts[0]).toMatchObject({ condition: 'REFURBISHED', qtyUsed: 1 })
    await giveEvidence(w.id, ids.worker)
    const done = await worker.post(
      `/work-orders/${w.id}/complete`,
      report({ noPartsUsed: false, newPartsInstalled: '1× relay (refurbished)' }),
    )
    expect(done.body.data.completion).toMatchObject({ noPartsUsed: false })
  })

  it('managers add time by hand; it is costed; timer records stay', async () => {
    await prisma.user.update({ where: { id: ids.worker }, data: { hourlyRate: 600 } })
    const w = await started()
    const at = new Date(Date.now() - 3_600_000).toISOString()
    const body = { userId: ids.worker, minutes: 30, startedAt: at, note: 'Forgot the timer' }
    expect((await worker.post(`/work-orders/${w.id}/time`, body)).status).toBe(403)
    const d = (await admin.post(`/work-orders/${w.id}/time`, body)).body.data as WorkOrderDetail
    const manual = d.timeEntries.find((e) => e.manual)!
    expect(manual).toMatchObject({ minutes: 30, note: 'Forgot the timer' })
    expect(d.cost.labour).toBeGreaterThanOrEqual(300)
    const timer = d.timeEntries.find((e) => !e.manual)!
    expect((await admin.del(`/work-orders/${w.id}/time/${timer.id}`)).status).toBe(403)
    const removed = (await admin.del(`/work-orders/${w.id}/time/${manual.id}`)).body
      .data as WorkOrderDetail
    expect(removed.timeEntries.some((e) => e.manual)).toBe(false)
  })

  it('worker home counts and task filters, including jobs they help on', async () => {
    await admin.post('/work-orders', wo({ title: 'Urgent', priority: 'CRITICAL' }))
    await admin.post('/work-orders', wo({ title: 'PM job', type: 'PREVENTIVE', priority: 'LOW' }))
    await admin.post(
      '/work-orders',
      wo({
        title: 'Late',
        priority: 'LOW',
        dueDate: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    )
    await admin.post(
      '/work-orders',
      wo({ title: 'Helping', priority: 'LOW', assignedUserId: ids.admin, helperIds: [ids.helper] }),
    )
    const home = (await worker.get('/me/home')).body.data as WorkerHome
    expect(home.counts).toMatchObject({ highPriority: 1, preventive: 1, overdue: 1 })
    const overdue = (await worker.get('/me/tasks?view=overdue')).body.data as WorkerTask[]
    expect(overdue.map((t) => t.title)).toEqual(['Late'])
    const critical = (await worker.get('/me/tasks?view=upcoming&priority=CRITICAL')).body
      .data as WorkerTask[]
    expect(critical.map((t) => t.title)).toEqual(['Urgent'])
    const pm = (await worker.get('/me/tasks?view=upcoming&pm=1')).body.data as WorkerTask[]
    expect(pm.map((t) => t.type)).toEqual(['PREVENTIVE'])
    const helping = (await helper.get('/me/tasks?view=upcoming')).body.data as WorkerTask[]
    expect(helping.map((t) => t.title)).toEqual(['Helping'])
  })
})

describe('Phase 7 — richer procedure steps', () => {
  const step = (o: Record<string, unknown>) => ({
    title: 'Step',
    instruction: '',
    inputType: 'CHECKBOX',
    unit: '',
    required: true,
    ...o,
  })

  async function procedureWith(steps: object[]) {
    const res = await admin.post('/procedures', {
      name: `Proc ${Math.random()}`,
      description: '',
      category: 'REFRIGERATION',
      restaurantId: R[0],
      steps,
    })
    return res
  }

  it('validates multiple-choice options', async () => {
    const res = await procedureWith([step({ inputType: 'MULTIPLE_CHOICE', options: ['Only one'] })])
    expect(res.body.error.fieldErrors).toEqual({
      'steps.0.options': ['validation.optionsRequired'],
    })
    const dup = await procedureWith([
      step({ inputType: 'MULTIPLE_CHOICE', options: ['Clean', 'clean'] }),
    ])
    expect(dup.body.error.fieldErrors).toEqual({
      'steps.0.options': ['validation.duplicateOptions'],
    })
  })

  it('checkbox, choice, photo, signature and photo-required steps', async () => {
    const proc = (
      await procedureWith([
        step({ title: 'Power off' }),
        step({ title: 'Filter state', inputType: 'MULTIPLE_CHOICE', options: ['Clean', 'Dirty'] }),
        step({ title: 'Coil photo', inputType: 'PHOTO' }),
        step({
          title: 'Temperature',
          inputType: 'NUMBER',
          unit: '°C',
          maxValue: 5,
          requirePhoto: true,
        }),
        step({ title: 'Manager signs', inputType: 'SIGNATURE' }),
      ])
    ).body.data as ProcedureDetail
    expect(proc.steps[1]).toMatchObject({ options: ['Clean', 'Dirty'] })
    expect(proc.steps[3]).toMatchObject({ requirePhoto: true })

    const w = await started({ procedureId: proc.id })
    let d = (await worker.get(`/work-orders/${w.id}`)).body.data as WorkOrderDetail
    const [power, filter, coil, temp, sign] = d.checklist
    const put = (itemId: string, o: Record<string, unknown>) =>
      worker.put(`/work-orders/${w.id}/checklist/${itemId}`, {
        result: '',
        textValue: '',
        note: '',
        ...o,
      })

    d = (await put(power!.id, { result: 'PASS' })).body.data
    expect(d.checklist[0]!.result).toBe('PASS')
    d = (await put(filter!.id, { textValue: 'Greasy' })).body.data
    expect(d.checklist[1]!.result).toBeNull() // not one of the options
    d = (await put(filter!.id, { textValue: 'dirty' })).body.data
    expect(d.checklist[1]).toMatchObject({ result: 'PASS', textValue: 'Dirty' })

    // A photo step is done by its photo.
    d = (await worker.upload(`/work-orders/${w.id}/checklist/${coil!.id}/attachments`)).body.data
    expect(d.checklist[2]).toMatchObject({ result: 'PASS' })
    expect(d.checklist[2]!.attachments).toHaveLength(1)

    // A reading that needs a photo isn't done without one.
    d = (await put(temp!.id, { numericValue: 3 })).body.data
    expect(d.checklist[3]!.result).toBe('PASS')
    // Signature: a new one replaces the old.
    await worker.upload(`/work-orders/${w.id}/checklist/${sign!.id}/attachments`)
    d = (await worker.upload(`/work-orders/${w.id}/checklist/${sign!.id}/attachments`)).body.data
    expect(d.checklist[4]!.attachments).toHaveLength(1)
    // A rejected upload (not an image) keeps the signature already there.
    const bad = await request(app)
      .post(`/api/v1/work-orders/${w.id}/checklist/${sign!.id}/attachments`)
      .set('Authorization', `Bearer ${workerToken}`)
      .attach('files', Buffer.from('not an image at all'), 'sig.png')
    expect(bad.status).toBe(415)
    expect(
      await prisma.attachment.count({ where: { ownerType: 'CHECKLIST_ITEM', ownerId: sign!.id } }),
    ).toBe(1)
    expect(d.completionCheck.stepsLeft).toBe(1)

    await giveEvidence(w.id, ids.worker)
    const blocked = await worker.post(`/work-orders/${w.id}/complete`, report())
    expect(blocked.body.error.code).toBe('CHECKLIST_INCOMPLETE')
    d = (await worker.upload(`/work-orders/${w.id}/checklist/${temp!.id}/attachments`)).body.data
    expect(d.completionCheck.stepsLeft).toBe(0)
    expect((await worker.post(`/work-orders/${w.id}/complete`, report())).body.data.status).toBe(
      'REVIEW',
    )
  })
})

describe('Phase 8 — scheduling', () => {
  it('reschedules: start moves, due date keeps its gap, the crew is told', async () => {
    const due = new Date(Date.now() + 2 * 86_400_000)
    const w = (await admin.post('/work-orders', wo({ dueDate: due.toISOString() }))).body
      .data as WorkOrderDetail
    const start = new Date(Date.now() + 86_400_000)
    expect(
      (await worker.post(`/work-orders/${w.id}/schedule`, { scheduledStart: start.toISOString() }))
        .status,
    ).toBe(403)
    let d = (
      await admin.post(`/work-orders/${w.id}/schedule`, { scheduledStart: start.toISOString() })
    ).body.data as WorkOrderDetail
    expect(d).toMatchObject({ status: 'SCHEDULED', scheduledStart: start.toISOString() })
    // Move it a further 3 days: the due date follows.
    const later = new Date(start.getTime() + 3 * 86_400_000)
    d = (await admin.post(`/work-orders/${w.id}/schedule`, { scheduledStart: later.toISOString() }))
      .body.data
    expect(new Date(d.dueDate!).getTime()).toBe(due.getTime() + 3 * 86_400_000)
    const told = await notes(ids.worker, 'WORK_RESCHEDULED')
    expect(told.length).toBe(2)
    // Readable local time ("14 Oct 2026, 3:30 pm"), never a raw ISO timestamp.
    for (const n of told) {
      expect(n.body).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
      expect(n.body).toMatch(/^\d{1,2} \w{3} \d{4}, \d{1,2}:\d{2} (am|pm)$/i)
    }
  })

  it('calendar shows planned work and upcoming preventive jobs', async () => {
    const tz = 'Asia/Kolkata'
    const today = dateKeyInZone(tz, new Date())
    const start = new Date(Date.now() + 2 * 86_400_000)
    await admin.post('/work-orders', wo({ title: 'Planned', scheduledStart: start.toISOString() }))
    await admin.post('/pm-schedules', {
      name: 'Weekly coil clean',
      description: '',
      restaurantId: R[0],
      assetId: '',
      frequency: 'WEEKLY',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      timeOfDay: '',
      procedureId: '',
      category: 'REFRIGERATION',
      priority: 'MEDIUM',
      assignedUserId: ids.worker,
      assignedTeamId: '',
      leadTimeDays: 0,
      startDate: addDays(today, 3),
      endDate: '',
    })
    const items = (await admin.get(`/calendar?from=${today}&to=${addDays(today, 6)}`)).body
      .data as CalendarItem[]
    const planned = items.find((i) => i.kind === 'work_order')
    expect(planned).toMatchObject({ title: 'Planned', canReschedule: true })
    const forecasts = items.filter((i) => i.kind === 'forecast')
    expect(forecasts.length).toBe(4)
    expect(forecasts[0]).toMatchObject({ name: 'Weekly coil clean', date: addDays(today, 3) })
    expect(
      (await admin.get(`/calendar?from=${today}&to=${addDays(today, 90)}`)).body.error.fieldErrors,
    ).toEqual({ to: ['validation.periodTooLong'] })
    // Workers only see their own work.
    const mine = (await worker.get(`/calendar?from=${today}&to=${addDays(today, 6)}`)).body
      .data as CalendarItem[]
    expect(mine.filter((i) => i.kind === 'work_order').every((i) => !i.canReschedule)).toBe(true)
  })
})

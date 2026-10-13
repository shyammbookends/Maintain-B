import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  addDays,
  type InspectionDetail,
  type PmScheduleDetail,
  type ProcedureDetail,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { dateKeyInZone, startOfDateInZone } from '../../core/time.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'
import { giveEvidence, report } from '../../test/work-orders.js'
import { runPmGenerator } from './pm-generator.js'

const TZ = 'Asia/Kolkata'
const app = createApp()
let fx: Fixture
let R: string[]
let ids: Record<'boss' | 'admin' | 'worker' | 'other', string>
let boss: ReturnType<typeof api>
let admin: ReturnType<typeof api>
let worker: ReturnType<typeof api>
let other: ReturnType<typeof api>

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

const procedure = (o: Record<string, unknown> = {}) => ({
  name: 'Freezer weekly check',
  description: '',
  category: 'REFRIGERATION',
  restaurantId: R[0],
  steps: [
    {
      title: 'Freezer temperature',
      instruction: 'Read the display',
      inputType: 'NUMBER',
      unit: '°C',
      minValue: -25,
      maxValue: -15,
      required: true,
    },
    {
      title: 'Door gasket intact',
      instruction: '',
      inputType: 'PASS_FAIL_NA',
      unit: '',
      required: true,
    },
    { title: 'Remarks', instruction: '', inputType: 'TEXT', unit: '', required: false },
  ],
  ...o,
})

const answer = (o: Record<string, unknown>) => ({ result: '', textValue: '', note: '', ...o })

const today = () => dateKeyInZone(TZ, new Date())

const schedule = (o: Record<string, unknown> = {}) => ({
  name: 'Clean condenser coils',
  description: '',
  restaurantId: R[0],
  assetId: '',
  frequency: 'DAILY',
  daysOfWeek: [],
  timeOfDay: '',
  procedureId: '',
  category: 'REFRIGERATION',
  priority: 'MEDIUM',
  assignedUserId: '',
  assignedTeamId: '',
  leadTimeDays: 0,
  startDate: today(),
  endDate: '',
  ...o,
})

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  const users = {
    boss: await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' }),
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
    other: await fx.createUser({ role: 'WORKER', username: 'other', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  boss = api(await tokenFor('boss'))
  admin = api(await tokenFor('admin'))
  worker = api(await tokenFor('worker'))
  other = api(await tokenFor('other'))
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('procedures', () => {
  it('creates with steps, bumps the version on edit, scopes global ones to Super Admin', async () => {
    const res = await admin.post('/procedures', procedure())
    expect(res.status).toBe(201)
    const p = res.body.data as ProcedureDetail
    expect(p).toMatchObject({ version: 1, stepCount: 3, can: { edit: true } })
    expect(p.steps[0]).toMatchObject({
      position: 1,
      inputType: 'NUMBER',
      minValue: -25,
      maxValue: -15,
    })
    // Range fields are dropped for non-number steps.
    expect(p.steps[1]).toMatchObject({ unit: null, minValue: null })

    const edited = await admin.put(
      `/procedures/${p.id}`,
      procedure({ steps: procedure().steps.slice(0, 2) }),
    )
    expect(edited.body.data).toMatchObject({ version: 2, stepCount: 2 })

    expect((await admin.post('/procedures', procedure())).body.error.fieldErrors).toEqual({
      name: ['validation.alreadyInUse'],
    })
    expect(
      (await admin.post('/procedures', procedure({ name: 'Global', restaurantId: '' }))).body.error
        .fieldErrors,
    ).toEqual({ restaurantId: ['validation.globalSuperAdminOnly'] })
    expect(
      (await boss.post('/procedures', procedure({ name: 'Global', restaurantId: '' }))).status,
    ).toBe(201)
    expect((await worker.get('/procedures')).body.data).toHaveLength(2)
    expect((await worker.post('/procedures', procedure({ name: 'X' }))).status).toBe(403)
  })

  it('rejects an inverted range and an empty step list', async () => {
    const bad = procedure({
      steps: [
        {
          title: 'Temp',
          instruction: '',
          inputType: 'NUMBER',
          unit: '',
          minValue: 5,
          maxValue: 1,
          required: true,
        },
      ],
    })
    expect((await admin.post('/procedures', bad)).body.error.fieldErrors).toEqual({
      'steps.0.maxValue': ['validation.maxBelowMin'],
    })
    expect(
      (await admin.post('/procedures', procedure({ steps: [] }))).body.error.fieldErrors,
    ).toEqual({
      steps: ['validation.stepsRequired'],
    })
  })

  it('cannot be archived while a schedule uses it; the name is then reusable', async () => {
    const p = (await admin.post('/procedures', procedure())).body.data as ProcedureDetail
    const s = (await admin.post('/pm-schedules', schedule({ procedureId: p.id }))).body.data
    const blocked = await admin.del(`/procedures/${p.id}`)
    expect(blocked.body.error.code).toBe('PROCEDURE_IN_USE')
    await admin.del(`/pm-schedules/${s.id}`)
    expect((await admin.del(`/procedures/${p.id}`)).status).toBe(204)
    expect((await admin.post('/procedures', procedure())).status).toBe(201)
  })
})

describe('work-order checklists', () => {
  async function startedTask() {
    const p = (await admin.post('/procedures', procedure())).body.data as ProcedureDetail
    const w = (
      await admin.post('/work-orders', {
        title: 'Weekly freezer check',
        description: '',
        category: 'REFRIGERATION',
        priority: 'MEDIUM',
        restaurantId: R[0],
        locationId: '',
        assetId: '',
        dueDate: '',
        assignedUserId: ids.worker,
        assignedTeamId: '',
        requestId: '',
        procedureId: p.id,
      })
    ).body.data as WorkOrderDetail
    return w
  }

  it('copies steps, judges readings, blocks completion until done, opens follow-ups for failures', async () => {
    const w = await startedTask()
    expect(w.checklist.map((c) => c.title)).toEqual([
      'Freezer temperature',
      'Door gasket intact',
      'Remarks',
    ])
    expect(w.procedure?.name).toBe('Freezer weekly check')
    const [temp, gasket] = w.checklist

    // Not before the task is started.
    expect(
      (
        await worker.put(
          `/work-orders/${w.id}/checklist/${temp!.id}`,
          answer({ numericValue: -18 }),
        )
      ).status,
    ).toBe(403)
    await worker.post(`/work-orders/${w.id}/start`)
    await giveEvidence(w.id, ids.worker)
    await giveEvidence(w.id, ids.worker)
    expect(
      (await other.put(`/work-orders/${w.id}/checklist/${temp!.id}`, answer({ numericValue: -18 })))
        .status,
    ).toBe(404)

    let d = (
      await worker.put(
        `/work-orders/${w.id}/checklist/${temp!.id}`,
        answer({ numericValue: -9, note: 'Warm' }),
      )
    ).body.data as WorkOrderDetail
    expect(d.checklist[0]).toMatchObject({
      result: 'FAIL',
      numericValue: -9,
      note: 'Warm',
      completedBy: { id: ids.worker },
    })

    const early = await worker.post(
      `/work-orders/${w.id}/complete`,
      report({
        notes: 'Done',
        assetStatus: '',
      }),
    )
    expect(early.status).toBe(409)
    expect(early.body.error.code).toBe('CHECKLIST_INCOMPLETE')

    d = (
      await worker.put(`/work-orders/${w.id}/checklist/${gasket!.id}`, answer({ result: 'PASS' }))
    ).body.data
    expect(d.checklist[1]!.result).toBe('PASS')

    const done = (
      await worker.post(
        `/work-orders/${w.id}/complete`,
        report({ notes: 'Checked all', assetStatus: '' }),
      )
    ).body.data as WorkOrderDetail
    expect(done.status).toBe('REVIEW')
    const fix = done.checklist[0]!.correctiveWorkOrder
    expect(fix).toBeTruthy()
    const followUp = await prisma.workOrder.findUniqueOrThrow({ where: { id: fix!.id } })
    expect(followUp).toMatchObject({
      type: 'INSPECTION_FOLLOWUP',
      status: 'OPEN',
      priority: 'HIGH',
      title: 'Fix: Freezer temperature',
    })
    expect(followUp.description).toContain('Reading: -9 °C (allowed -25 to -15)')
    expect(
      await prisma.notification.count({
        where: { recipientId: ids.admin, type: 'INSPECTION_FAILED' },
      }),
    ).toBe(1)
  })

  it('rejects a procedure from another restaurant', async () => {
    const p = (await boss.post('/procedures', procedure({ restaurantId: R[1] }))).body.data
    const res = await boss.post('/work-orders', {
      title: 'Check',
      description: '',
      category: 'OTHER',
      priority: 'LOW',
      restaurantId: R[0],
      locationId: '',
      assetId: '',
      dueDate: '',
      assignedUserId: '',
      assignedTeamId: '',
      requestId: '',
      procedureId: p.id,
    })
    expect(res.body.error.fieldErrors).toEqual({
      procedureId: ['validation.procedureNotAvailable'],
    })
  })
})

describe('preventive maintenance', () => {
  it('validates the recurrence', async () => {
    const weekly = await admin.post('/pm-schedules', schedule({ frequency: 'WEEKLY' }))
    expect(weekly.body.error.fieldErrors).toEqual({ daysOfWeek: ['validation.selectOption'] })
    const ended = await admin.post(
      '/pm-schedules',
      schedule({ startDate: '2020-01-01', endDate: '2020-02-01' }),
    )
    expect(ended.body.error.fieldErrors).toEqual({ endDate: ['validation.scheduleEnded'] })
    expect((await worker.post('/pm-schedules', schedule())).status).toBe(403)
  })

  it('keeps an occurrence for later (does not skip it) while nobody can own generated work', async () => {
    const s = (await admin.post('/pm-schedules', schedule())).body.data as PmScheduleDetail
    const before = await prisma.pmSchedule.findUniqueOrThrow({ where: { id: s.id } })
    await prisma.user.updateMany({
      where: { id: { in: [ids.boss, ids.admin] } },
      data: { status: 'DISABLED' },
    })
    const now = new Date()
    expect((await runPmGenerator(now)).created).toBe(0)
    const after = await prisma.pmSchedule.findUniqueOrThrow({ where: { id: s.id } })
    expect(after.nextDueAt.toISOString()).toBe(before.nextDueAt.toISOString())
    // With an active Admin of the organization, the occurrence is created after all.
    await prisma.user.update({ where: { id: ids.admin }, data: { status: 'ACTIVE' } })
    expect((await runPmGenerator(now)).created).toBe(1)
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { pmScheduleId: s.id } })
    expect(wo.createdById).toBe(ids.admin)
  })

  it('generates each occurrence once, with checklist and assignee, and advances', async () => {
    const p = (await admin.post('/procedures', procedure())).body.data as ProcedureDetail
    const res = await admin.post(
      '/pm-schedules',
      schedule({ procedureId: p.id, assignedUserId: ids.worker, timeOfDay: '10:00' }),
    )
    expect(res.status).toBe(201)
    const s = res.body.data as PmScheduleDetail
    expect(s.upcoming[0]).toBe(today())
    expect(s.upcoming).toHaveLength(5)

    const now = new Date()
    expect((await runPmGenerator(now)).created).toBe(1)
    expect((await runPmGenerator(now)).created).toBe(0)

    const wos = await prisma.workOrder.findMany({
      where: { pmScheduleId: s.id },
      include: { checklistItems: true },
    })
    expect(wos).toHaveLength(1)
    expect(wos[0]).toMatchObject({
      type: 'PREVENTIVE',
      status: 'ASSIGNED',
      assignedUserId: ids.worker,
      procedureId: p.id,
    })
    expect(wos[0]!.checklistItems).toHaveLength(3)
    expect(wos[0]!.dueDate!.getTime()).toBe(
      startOfDateInZone(TZ, today()).getTime() + 10 * 3_600_000,
    )
    expect(
      await prisma.notification.count({ where: { recipientId: ids.worker, type: 'PM_DUE' } }),
    ).toBe(1)

    const after = (await admin.get(`/pm-schedules/${s.id}`)).body.data as PmScheduleDetail
    expect(after.upcoming[0]).toBe(addDays(today(), 1))
    expect(after.recentWorkOrders).toHaveLength(1)
  })

  it('after downtime only creates what is still current', async () => {
    const s = (await admin.post('/pm-schedules', schedule())).body.data as PmScheduleDetail
    // Pretend the server was off for three days: it's now just after midnight, day +3.
    const later = new Date(startOfDateInZone(TZ, addDays(today(), 3)).getTime() + 60_000)
    expect((await runPmGenerator(later)).created).toBe(2)
    const dates = (
      await prisma.workOrder.findMany({
        where: { pmScheduleId: s.id },
        orderBy: { pmDueDate: 'asc' },
      })
    ).map((w) => w.pmDueDate!.toISOString().slice(0, 10))
    // Day +2 is due tonight-ish (still open) and day +3 starts now; days 0 and +1 were skipped.
    expect(dates).toEqual([addDays(today(), 2), addDays(today(), 3)])
  })

  it('respects lead time, pause and "create next now"', async () => {
    const s = (
      await admin.post(
        '/pm-schedules',
        schedule({ startDate: addDays(today(), 5), leadTimeDays: 2 }),
      )
    ).body.data as PmScheduleDetail
    expect((await runPmGenerator()).created).toBe(0)
    const inLead = new Date(startOfDateInZone(TZ, addDays(today(), 3)).getTime() + 60_000)
    expect((await runPmGenerator(inLead)).created).toBe(1)

    await admin.put(`/pm-schedules/${s.id}/active`, { active: false })
    const far = new Date(startOfDateInZone(TZ, addDays(today(), 20)).getTime())
    expect((await runPmGenerator(far)).created).toBe(0)
    expect((await admin.post(`/pm-schedules/${s.id}/generate`)).body.error.fieldErrors).toEqual({
      active: ['validation.schedulePaused'],
    })

    const resumed = (await admin.put(`/pm-schedules/${s.id}/active`, { active: true })).body
      .data as PmScheduleDetail
    expect(resumed.active).toBe(true)
    const before = await prisma.workOrder.count({ where: { pmScheduleId: s.id } })
    await admin.post(`/pm-schedules/${s.id}/generate`)
    expect(await prisma.workOrder.count({ where: { pmScheduleId: s.id } })).toBe(before + 1)
  })

  it('reports compliance and stays inside restaurant scope', async () => {
    const s = (await boss.post('/pm-schedules', schedule({ restaurantId: R[1] }))).body.data
    expect((await admin.get(`/pm-schedules/${s.id}`)).status).toBe(404)
    expect((await admin.get('/pm-schedules')).body.meta.total).toBe(0)
    const list = (await boss.get('/pm-schedules')).body.data
    expect(list[0]).toMatchObject({ name: 'Clean condenser coils', compliance: null, active: true })
  })
})

describe('inspections', () => {
  async function template() {
    const p = (await admin.post('/procedures', procedure())).body.data as ProcedureDetail
    const res = await admin.post('/inspection-templates', {
      name: 'Opening checklist',
      type: 'OPENING',
      procedureId: p.id,
      restaurantId: R[0],
      active: true,
    })
    expect(res.status).toBe(201)
    return res.body.data
  }

  it('a worker runs and submits an inspection; failures become work orders', async () => {
    const t = await template()
    const available = (await worker.get(`/inspection-templates?restaurantId=${R[0]}&active=true`))
      .body.data
    expect(available.map((x: { name: string }) => x.name)).toEqual(['Opening checklist'])

    const started = await worker.post('/inspections', {
      templateId: t.id,
      restaurantId: R[0],
      assetId: '',
    })
    expect(started.status).toBe(201)
    const ins = started.body.data as InspectionDetail
    expect(ins).toMatchObject({
      code: 'INS-000001',
      status: 'IN_PROGRESS',
      itemCount: 3,
      can: { answer: true },
    })

    const [temp, gasket] = ins.items
    expect((await other.get(`/inspections/${ins.id}`)).status).toBe(404)
    await worker.put(`/inspections/${ins.id}/items/${temp!.id}`, answer({ numericValue: -20 }))
    const incomplete = await worker.post(`/inspections/${ins.id}/submit`, { notes: '' })
    expect(incomplete.body.error.code).toBe('CHECKLIST_INCOMPLETE')

    await worker.put(
      `/inspections/${ins.id}/items/${gasket!.id}`,
      answer({ result: 'FAIL', note: 'Torn at the bottom' }),
    )
    const submitted = (
      await worker.post(`/inspections/${ins.id}/submit`, { notes: 'All else fine' })
    ).body.data as InspectionDetail
    expect(submitted).toMatchObject({
      status: 'SUBMITTED',
      passCount: 1,
      failCount: 1,
      naCount: 0,
      can: { answer: false },
    })
    expect(submitted.items[1]!.correctiveWorkOrder?.code).toMatch(/^WO-/)
    expect(
      await prisma.notification.count({
        where: { recipientId: ids.admin, type: 'INSPECTION_FAILED' },
      }),
    ).toBe(1)

    const again = await worker.post(`/inspections/${ins.id}/submit`, { notes: '' })
    expect(again.body.error.code).toBe('INSPECTION_SUBMITTED')
    expect(
      (await worker.put(`/inspections/${ins.id}/items/${temp!.id}`, answer({ numericValue: 1 })))
        .body.error.code,
    ).toBe('INSPECTION_SUBMITTED')

    expect((await admin.get('/inspections?result=failed')).body.meta.total).toBe(1)
    expect((await other.get('/inspections')).body.meta.total).toBe(0)
  })

  it('inactive templates cannot be started; unfinished runs can be discarded', async () => {
    const t = await template()
    const ins = (
      await worker.post('/inspections', { templateId: t.id, restaurantId: R[0], assetId: '' })
    ).body.data
    expect((await other.del(`/inspections/${ins.id}`)).status).toBe(404)
    expect((await worker.del(`/inspections/${ins.id}`)).status).toBe(204)

    await admin.put(`/inspection-templates/${t.id}`, {
      name: t.name,
      type: 'OPENING',
      procedureId: t.procedure.id,
      restaurantId: R[0],
      active: false,
    })
    const res = await worker.post('/inspections', {
      templateId: t.id,
      restaurantId: R[0],
      assetId: '',
    })
    expect(res.body.error.fieldErrors).toEqual({ templateId: ['validation.invalidValue'] })
  })
})

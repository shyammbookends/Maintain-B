import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  initialMeterDue,
  nextMeterDue,
  type AssetMeterDto,
  type PmScheduleDetail,
  type PmScheduleListItem,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'
import { runMeterSchedules, runPmGenerator } from './pm-generator.js'

/*
 * Meter-based PM schedules: "every 500 h" / "at 10,000 km" create a work
 * order as soon as a reading reaches the due value, exactly once.
 */

const app = createApp()
let fx: Fixture
let R: string[]
let admin: ReturnType<typeof api>
let worker: ReturnType<typeof api>
let assetId: string
let otherAssetId: string

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
  }
}

const schedule = (o: Record<string, unknown> = {}) => ({
  name: 'Generator service',
  description: '',
  restaurantId: R[0],
  assetId,
  frequency: 'MONTHLY',
  daysOfWeek: [],
  timeOfDay: '',
  procedureId: '',
  category: 'ELECTRICAL',
  priority: 'HIGH',
  assignedUserId: '',
  assignedTeamId: '',
  leadTimeDays: 0,
  startDate: '2026-01-01',
  endDate: '',
  triggerType: 'METER',
  ...o,
})

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  // Generated work orders are owned by a Super Admin.
  await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
  await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] })
  await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] })
  admin = api(await tokenFor('admin'))
  worker = api(await tokenFor('worker'))
  const cat = await prisma.assetCategory.create({
    data: { organizationId: fx.orgId, name: 'Generator' },
  })
  const asset = (code: string, name: string) =>
    prisma.asset.create({
      data: {
        organizationId: fx.orgId,
        restaurantId: R[0]!,
        categoryId: cat.id,
        publicId: `Qr${code}`,
        assetCode: code,
        name,
      },
    })
  assetId = (await asset('AST-0001', 'Generator')).id
  otherAssetId = (await asset('AST-0002', 'Chiller')).id
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function newMeter(onAsset = assetId) {
  const res = await admin.post(`/assets/${onAsset}/meters`, {
    name: 'Runtime',
    type: 'RUNTIME_HOURS',
    unit: 'h',
  })
  expect(res.status).toBe(201)
  return (res.body.data as AssetMeterDto[]).at(-1)!
}

const read = (meterId: string, value: number) =>
  worker.post(`/assets/${assetId}/meters/${meterId}/readings`, { value, note: '' })

const pmWorkOrders = (scheduleId: string) =>
  prisma.workOrder.findMany({ where: { pmScheduleId: scheduleId }, orderBy: { createdAt: 'asc' } })

describe('meter due values', () => {
  it('starts at the threshold, then steps by the interval past the reading', () => {
    expect(initialMeterDue(500, null, 120)).toBe(620)
    expect(initialMeterDue(500, null, null)).toBe(500)
    expect(initialMeterDue(null, 10_000, 9_000)).toBe(10_000)
    expect(initialMeterDue(500, 1_000, 200)).toBe(1_000)
    // Threshold already passed: the next interval step above the reading.
    expect(initialMeterDue(500, 1_000, 1_700)).toBe(2_000)
    expect(nextMeterDue(500, 500, 520)).toBe(1_000)
    // Missed steps are skipped (one work order, not three).
    expect(nextMeterDue(500, 500, 1_730)).toBe(2_000)
    expect(nextMeterDue(1.5, 0.25, 1.5)).toBe(1.75)
  })
})

describe('meter-based PM schedules', () => {
  it('creates a work order when a reading crosses the due value, once per step', async () => {
    const meter = await newMeter()
    await read(meter.id, 100)
    const created = await admin.post(
      '/pm-schedules',
      schedule({ meterId: meter.id, meterInterval: 500 }),
    )
    expect(created.status).toBe(201)
    const s = created.body.data as PmScheduleDetail
    expect(s).toMatchObject({
      triggerType: 'METER',
      meter: { id: meter.id, unit: 'h', currentValue: 100 },
      meterInterval: 500,
      nextDueReading: 600,
      nextDueAt: null,
      upcoming: [],
    })

    // Below the due value: nothing.
    expect((await read(meter.id, 599)).status).toBe(201)
    expect(await pmWorkOrders(s.id)).toHaveLength(0)

    // Crossing it creates the work order immediately, with the schedule's details.
    expect((await read(meter.id, 605)).status).toBe(201)
    const [wo] = await pmWorkOrders(s.id)
    expect(wo).toMatchObject({
      type: 'PREVENTIVE',
      title: 'Generator service',
      priority: 'HIGH',
      assetId,
      restaurantId: R[0],
      pmDueDate: null,
    })
    const after = (await admin.get(`/pm-schedules/${s.id}`)).body.data as PmScheduleDetail
    expect(after).toMatchObject({ nextDueReading: 1_100, lastTriggeredReading: 605, active: true })
    expect(after.recentWorkOrders).toHaveLength(1)

    // The same reading again, more readings below the next step, and the job: no duplicates.
    await read(meter.id, 605)
    await read(meter.id, 900)
    await runPmGenerator()
    await runMeterSchedules(meter.id, 605)
    expect(await pmWorkOrders(s.id)).toHaveLength(1)

    // A big jump past several steps makes one work order and skips ahead.
    await read(meter.id, 2_250)
    expect(await pmWorkOrders(s.id)).toHaveLength(2)
    const later = (await admin.get(`/pm-schedules/${s.id}`)).body.data as PmScheduleDetail
    expect(later.nextDueReading).toBe(2_600)

    // The list shows the reading instead of a date.
    const list = (await admin.get('/pm-schedules')).body.data as PmScheduleListItem[]
    expect(list[0]).toMatchObject({ triggerType: 'METER', nextDueReading: 2_600, nextDueAt: null })
  })

  it('never double-creates when the same reading is processed concurrently', async () => {
    const meter = await newMeter()
    const s = (
      await admin.post('/pm-schedules', schedule({ meterId: meter.id, meterInterval: 500 }))
    ).body.data as PmScheduleDetail
    expect(s.nextDueReading).toBe(500)
    await prisma.assetMeter.update({ where: { id: meter.id }, data: { currentValue: 510 } })
    await Promise.all([
      runMeterSchedules(meter.id, 510),
      runMeterSchedules(meter.id, 510),
      runPmGenerator(),
      runPmGenerator(),
    ])
    expect(await pmWorkOrders(s.id)).toHaveLength(1)
  })

  it('a threshold without an interval fires once and ends the schedule', async () => {
    const meter = await newMeter()
    await read(meter.id, 9_500)
    const s = (
      await admin.post('/pm-schedules', schedule({ meterId: meter.id, meterThreshold: 10_000 }))
    ).body.data as PmScheduleDetail
    expect(s.nextDueReading).toBe(10_000)
    await read(meter.id, 10_020)
    await read(meter.id, 12_000)
    expect(await pmWorkOrders(s.id)).toHaveLength(1)
    const after = (await admin.get(`/pm-schedules/${s.id}`)).body.data as PmScheduleDetail
    expect(after).toMatchObject({
      active: false,
      nextDueReading: null,
      lastTriggeredReading: 10_020,
    })
    // Nothing left to resume.
    expect((await admin.put(`/pm-schedules/${s.id}/active`, { active: true })).status).toBe(400)
  })

  it('the PM job catches readings the request did not handle', async () => {
    const meter = await newMeter()
    const s = (
      await admin.post(
        '/pm-schedules',
        schedule({ meterId: meter.id, meterInterval: 250, meterThreshold: 1_000 }),
      )
    ).body.data as PmScheduleDetail
    expect(s.nextDueReading).toBe(1_000)
    // e.g. the reading was stored but generation failed: the meter already shows 1,010.
    await prisma.assetMeter.update({ where: { id: meter.id }, data: { currentValue: 1_010 } })
    expect((await runPmGenerator()).created).toBe(1)
    expect((await runPmGenerator()).created).toBe(0)
    const after = (await admin.get(`/pm-schedules/${s.id}`)).body.data as PmScheduleDetail
    expect(after.nextDueReading).toBe(1_250)
  })

  it('keeps the due reading on a plain edit, recalculates when the meter rule changes', async () => {
    const meter = await newMeter()
    const s = (
      await admin.post('/pm-schedules', schedule({ meterId: meter.id, meterInterval: 500 }))
    ).body.data as PmScheduleDetail
    await read(meter.id, 300)
    const renamed = await admin.put(
      `/pm-schedules/${s.id}`,
      schedule({ name: 'Generator oil change', meterId: meter.id, meterInterval: 500 }),
    )
    expect(renamed.body.data).toMatchObject({ name: 'Generator oil change', nextDueReading: 500 })
    const changed = await admin.put(
      `/pm-schedules/${s.id}`,
      schedule({ meterId: meter.id, meterInterval: 1_000 }),
    )
    expect(changed.body.data.nextDueReading).toBe(1_300)
    // Back to the calendar: no meter fields left behind.
    const timed = await admin.put(
      `/pm-schedules/${s.id}`,
      schedule({ triggerType: 'TIME', dayOfMonth: 1, meterId: meter.id, meterInterval: 1_000 }),
    )
    expect(timed.body.data).toMatchObject({
      triggerType: 'TIME',
      meter: null,
      meterInterval: null,
      nextDueReading: null,
    })
    expect(timed.body.data.nextDueAt).not.toBeNull()
  })

  it('rejects a meter from another asset and incomplete meter rules', async () => {
    const foreign = await newMeter(otherAssetId)
    const wrong = await admin.post(
      '/pm-schedules',
      schedule({ meterId: foreign.id, meterInterval: 500 }),
    )
    expect(wrong.status).toBe(400)
    expect(wrong.body.error.fieldErrors).toEqual({ meterId: ['validation.meterNotOnAsset'] })

    const meter = await newMeter()
    const noRule = await admin.post('/pm-schedules', schedule({ meterId: meter.id }))
    expect(noRule.body.error.fieldErrors).toEqual({
      meterInterval: ['validation.meterIntervalOrThreshold'],
    })
    const noAsset = await admin.post(
      '/pm-schedules',
      schedule({ assetId: '', meterId: meter.id, meterInterval: 500 }),
    )
    expect(noAsset.body.error.fieldErrors).toMatchObject({ assetId: ['validation.required'] })
    const noMeter = await admin.post('/pm-schedules', schedule({ meterInterval: 500 }))
    expect(noMeter.body.error.fieldErrors).toEqual({ meterId: ['validation.required'] })
  })

  it('"create now" makes a work order and restarts the interval from the current reading', async () => {
    const meter = await newMeter()
    const s = (
      await admin.post('/pm-schedules', schedule({ meterId: meter.id, meterInterval: 500 }))
    ).body.data as PmScheduleDetail
    await read(meter.id, 320)
    const res = await admin.post(`/pm-schedules/${s.id}/generate`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ nextDueReading: 820, lastTriggeredReading: 320 })
    expect(await pmWorkOrders(s.id)).toHaveLength(1)
  })
})

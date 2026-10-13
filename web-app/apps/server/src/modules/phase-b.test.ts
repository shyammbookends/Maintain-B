import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  PROCEDURE_LIBRARY,
  SUPPORTED_LOCALES,
  libraryProcedureInput,
  procedureSchema,
  type CustomFieldDto,
  type LabelWithUsage,
  type PartDetail,
  type ProcedureDetail,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'

/* Phase B: sections & conditional steps, procedure library, custom fields, labels, stock transfer. */

const app = createApp()
let fx: Fixture
let tokens: Record<string, string>
let workerId: string

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
    delete: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
  }
}

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2, workflow: 'simple' })
  await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
  await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: fx.restaurantIds })
  workerId = (
    await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: fx.restaurantIds })
  ).id
  tokens = {
    boss: await tokenFor('boss'),
    admin: await tokenFor('admin'),
    worker: await tokenFor('worker'),
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

const wo = (extra: object = {}) => ({
  title: 'Check the cooler',
  description: '',
  category: 'REFRIGERATION',
  priority: 'MEDIUM',
  restaurantId: fx.restaurantIds[0],
  locationId: '',
  assetId: '',
  dueDate: '',
  assignedUserId: workerId,
  assignedTeamId: '',
  requestId: '',
  ...extra,
})

const step = (title: string, inputType: string, extra: object = {}) => ({
  title,
  instruction: '',
  inputType,
  unit: '',
  required: true,
  options: [],
  ...extra,
})

describe('procedure sections and conditional steps', () => {
  it('hides a follow-up until its condition matches, and never asks for section answers', async () => {
    const proc = await as('boss').post('/procedures', {
      name: 'Cooler check',
      description: '',
      category: 'REFRIGERATION',
      restaurantId: '',
      steps: [
        step('Condition', 'SECTION', { required: true }),
        step('Door seals OK', 'PASS_FAIL_NA'),
        step('Photo of the damaged seal', 'PHOTO', { showIf: { step: 2, answer: 'FAIL' } }),
      ],
    })
    expect(proc.status).toBe(201)
    const p = proc.body.data as ProcedureDetail
    expect(p.steps[0]).toMatchObject({ inputType: 'SECTION', required: false })
    expect(p.steps[2]!.showIf).toEqual({ step: 2, answer: 'FAIL' })

    const w = (await as('admin').post('/work-orders', wo({ procedureId: p.id }))).body
      .data as WorkOrderDetail
    // Only "Door seals OK" is waiting: the section is a heading, the photo is hidden.
    expect(w.completionCheck.stepsLeft).toBe(1)
    await as('worker').post(`/work-orders/${w.id}/start`)
    const [section, seals] = w.checklist
    expect(
      (await as('worker').put(`/work-orders/${w.id}/checklist/${section!.id}`, {
        result: 'PASS',
        textValue: '',
        note: '',
      })).status,
    ).toBe(400)

    const failed = await as('worker').put(`/work-orders/${w.id}/checklist/${seals!.id}`, {
      result: 'FAIL',
      textValue: '',
      note: '',
    })
    // FAIL shows the photo step, which now has to be done.
    expect((failed.body.data as WorkOrderDetail).completionCheck.stepsLeft).toBe(1)
    const passed = await as('worker').put(`/work-orders/${w.id}/checklist/${seals!.id}`, {
      result: 'PASS',
      textValue: '',
      note: '',
    })
    expect((passed.body.data as WorkOrderDetail).completionCheck.stepsLeft).toBe(0)
  })

  it('rejects conditions that point forward or at a section', async () => {
    const bad = await as('boss').post('/procedures', {
      name: 'Bad',
      description: '',
      category: '',
      restaurantId: '',
      steps: [
        step('A', 'PASS_FAIL_NA', { showIf: { step: 2, answer: 'PASS' } }),
        step('B', 'PASS_FAIL_NA'),
      ],
    })
    expect(bad.status).toBe(400)
  })
})

describe('procedure library', () => {
  it('every library procedure is valid in every language', () => {
    for (const entry of PROCEDURE_LIBRARY)
      for (const locale of SUPPORTED_LOCALES) {
        const parsed = procedureSchema.safeParse({
          ...libraryProcedureInput(entry, locale),
          restaurantId: '',
        })
        expect(parsed.success, `${entry.key}/${locale}`).toBe(true)
      }
  })

  it('copies a library procedure in the chosen language; a second copy gets a new name', async () => {
    const first = await as('boss').post('/procedures/library/gas-safety', {
      locale: 'hi',
      restaurantId: '',
    })
    expect(first.status).toBe(201)
    const p = first.body.data as ProcedureDetail
    expect(p.name).toBe('गैस लाइन सुरक्षा जांच')
    expect(p.steps.some((s) => s.inputType === 'SECTION')).toBe(true)
    const again = await as('boss').post('/procedures/library/gas-safety', {
      locale: 'hi',
      restaurantId: '',
    })
    expect((again.body.data as ProcedureDetail).name).toBe('गैस लाइन सुरक्षा जांच (2)')
    expect((await as('boss').post('/procedures/library/nope', { locale: 'en', restaurantId: '' })).status).toBe(404)
  })
})

describe('custom fields', () => {
  it('admins define fields; work orders and assets store checked values', async () => {
    expect(
      (await as('worker').post('/custom-fields', {
        entity: 'WORK_ORDER',
        label: 'Bill number',
        type: 'TEXT',
      })).status,
    ).toBe(403)
    await as('boss').post('/custom-fields', {
      entity: 'WORK_ORDER',
      label: 'Bill number',
      type: 'TEXT',
      required: true,
    })
    const fields = (
      await as('boss').post('/custom-fields', {
        entity: 'WORK_ORDER',
        label: 'Shift',
        type: 'SELECT',
        options: ['Morning', 'Night'],
      })
    ).body.data as CustomFieldDto[]
    const [bill, shift] = fields
    // Everyone can read the definitions (forms need them).
    expect((await as('worker').get('/custom-fields?entity=WORK_ORDER')).body.data).toHaveLength(2)

    const missing = await as('admin').post('/work-orders', wo())
    expect(missing.status).toBe(400)
    expect(Object.keys(missing.body.error.fieldErrors)).toEqual([`customFields.${bill!.id}`])
    const badChoice = await as('admin').post(
      '/work-orders',
      wo({ customFields: { [bill!.id]: 'B-17', [shift!.id]: 'Lunch' } }),
    )
    expect(badChoice.status).toBe(400)
    const ok = await as('admin').post(
      '/work-orders',
      wo({ customFields: { [bill!.id]: 'B-17', [shift!.id]: 'night' } }),
    )
    expect(ok.status).toBe(201)
    expect((ok.body.data as WorkOrderDetail).customFields).toEqual({
      [bill!.id]: 'B-17',
      [shift!.id]: 'Night',
    })

    // Assets have their own fields.
    const [warranty] = (
      await as('boss').post('/custom-fields', { entity: 'ASSET', label: 'Warranty card', type: 'CHECKBOX' })
    ).body.data as CustomFieldDto[]
    const cat = await prisma.assetCategory.create({
      data: { organizationId: fx.orgId, name: 'Fridges' },
    })
    const asset = await as('admin').post('/assets', {
      name: 'Walk-in cooler',
      categoryId: cat.id,
      restaurantId: fx.restaurantIds[0],
      locationId: '',
      manufacturer: '',
      model: '',
      serialNumber: '',
      purchaseDate: '',
      purchaseCost: '',
      warrantyStart: '',
      warrantyEnd: '',
      notes: '',
      customFields: { [warranty!.id]: true },
    })
    expect(asset.status).toBe(201)
    expect(asset.body.data.customFields).toEqual({ [warranty!.id]: true })
  })
})

describe('labels', () => {
  it('tags work orders, filters by label, and removing a label untags them', async () => {
    const labels = (
      await as('boss').post('/labels', { name: 'Guest complaint', color: 'red' })
    ).body.data as LabelWithUsage[]
    const label = labels[0]!
    const tagged = (await as('admin').post('/work-orders', wo({ labelIds: [label.id] }))).body
      .data as WorkOrderDetail
    await as('admin').post('/work-orders', wo({ title: 'Not tagged' }))
    expect(tagged.labels).toEqual([{ id: label.id, name: 'Guest complaint', color: 'red' }])

    const filtered = await as('admin').get(`/work-orders?labelId=${label.id}`)
    expect(filtered.body.data.map((w: { id: string }) => w.id)).toEqual([tagged.id])
    expect(((await as('admin').get('/labels')).body.data as LabelWithUsage[])[0]!.workOrders).toBe(1)
    expect((await as('boss').post('/labels', { name: 'guest COMPLAINT', color: 'blue' })).status).toBe(400)

    await as('boss').delete(`/labels/${label.id}`)
    const after = (await as('admin').get(`/work-orders/${tagged.id}`)).body.data as WorkOrderDetail
    expect(after.labels).toEqual([])
    // Unknown labels are refused.
    expect((await as('admin').post('/work-orders', wo({ labelIds: [label.id] }))).status).toBe(400)
  })
})

describe('stock transfer between restaurants', () => {
  it('moves stock with two ledger lines and refuses more than is there', async () => {
    const part = await prisma.part.create({
      data: { organizationId: fx.orgId, name: 'Door gasket', partNumber: 'GSK-1', unit: 'pcs' },
    })
    await as('admin').post(`/parts/${part.id}/adjust`, {
      restaurantId: fx.restaurantIds[0],
      mode: 'RECEIVE',
      quantity: 10,
      reason: 'Opening stock',
    })
    const moved = await as('admin').post(`/parts/${part.id}/transfer`, {
      fromRestaurantId: fx.restaurantIds[0],
      toRestaurantId: fx.restaurantIds[1],
      quantity: 4,
      reason: 'R2 ran out',
    })
    expect(moved.status).toBe(200)
    const levels = (moved.body.data as PartDetail).stockLevels
    expect(levels.find((l) => l.restaurant.id === fx.restaurantIds[0])!.quantity).toBe(6)
    expect(levels.find((l) => l.restaurant.id === fx.restaurantIds[1])!.quantity).toBe(4)
    expect(await prisma.inventoryTransaction.count({ where: { type: 'TRANSFER' } })).toBe(2)

    const tooMuch = await as('admin').post(`/parts/${part.id}/transfer`, {
      fromRestaurantId: fx.restaurantIds[0],
      toRestaurantId: fx.restaurantIds[1],
      quantity: 50,
      reason: '',
    })
    expect(tooMuch.status).toBe(409)
    const same = await as('admin').post(`/parts/${part.id}/transfer`, {
      fromRestaurantId: fx.restaurantIds[0],
      toRestaurantId: fx.restaurantIds[0],
      quantity: 1,
      reason: '',
    })
    expect(same.status).toBe(400)
  })
})

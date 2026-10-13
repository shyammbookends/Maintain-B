import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  warrantyState,
  type AssetDetail,
  type AssetListItem,
  type LocationDto,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'
import { ensureDefaultCategories } from './categories.service.js'

const app = createApp()
let fx: Fixture
let R: string[]
let boss: ReturnType<typeof api>
let admin: ReturnType<typeof api>
let worker: ReturnType<typeof api>
let fridgeCat: string

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

const asset = (o: Record<string, unknown> = {}) => ({
  name: 'Walk-in freezer',
  categoryId: fridgeCat,
  restaurantId: R[0],
  locationId: '',
  manufacturer: 'Blue Star',
  model: 'WF-200',
  serialNumber: 'BS-22-00418',
  purchaseDate: '2024-03-01',
  purchaseCost: '185000',
  warrantyStart: '2024-03-01',
  warrantyEnd: '2027-02-28',
  notes: '',
  ...o,
})

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 3 })
  R = fx.restaurantIds
  await ensureDefaultCategories(prisma, fx.orgId)
  fridgeCat = (await prisma.assetCategory.findFirstOrThrow({ where: { name: 'Refrigerator' } })).id
  await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
  await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] })
  await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] })
  boss = api(await tokenFor('boss'))
  admin = api(await tokenFor('admin'))
  worker = api(await tokenFor('worker'))
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('locations', () => {
  const loc = (o: Record<string, unknown> = {}) => ({
    restaurantId: R[0],
    name: 'Hot kitchen',
    type: 'HOT_KITCHEN',
    description: '',
    ...o,
  })

  it('creates, lists, renames; names unique per restaurant; scoped', async () => {
    const created = await admin.post('/locations', loc())
    expect(created.status).toBe(201)
    expect(
      (await admin.post('/locations', loc({ name: 'HOT KITCHEN' }))).body.error.fieldErrors,
    ).toEqual({ name: ['validation.alreadyInUse'] })
    expect((await boss.post('/locations', loc({ restaurantId: R[1] }))).status).toBe(201) // same name, other restaurant

    const list = (await admin.get('/locations')).body.data as LocationDto[]
    expect(list.map((l) => l.restaurantId)).toEqual([R[0]])
    expect(
      (await admin.post('/locations', loc({ restaurantId: R[1] }))).body.error.fieldErrors,
    ).toEqual({
      restaurantId: ['validation.restaurantOutOfScope'],
    })

    const renamed = await admin.put(
      `/locations/${created.body.data.id}`,
      loc({ name: 'Tandoor area', type: 'KITCHEN' }),
    )
    expect(renamed.body.data).toMatchObject({ name: 'Tandoor area', type: 'KITCHEN' })
  })

  it('cannot archive a location with assets; archived names can be re-added', async () => {
    const l = (await admin.post('/locations', loc({ name: 'Storage', type: 'STORAGE' }))).body
      .data as LocationDto
    const a = await admin.post('/assets', asset({ locationId: l.id }))
    const blocked = await admin.del(`/locations/${l.id}`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('LOCATION_IN_USE')

    await admin.put(`/assets/${a.body.data.id}`, asset({ locationId: '' }))
    expect((await admin.del(`/locations/${l.id}`)).status).toBe(204)
    const again = await admin.post('/locations', loc({ name: 'Storage', type: 'STORAGE' }))
    expect(again.status).toBe(201)
    expect(again.body.data.id).toBe(l.id)
  })

  it('workers can view but not change locations', async () => {
    expect((await worker.get('/locations')).status).toBe(200)
    expect((await worker.post('/locations', loc())).status).toBe(403)
  })
})

describe('asset categories', () => {
  it('ships the 17 defaults and manages custom ones', async () => {
    const list = (await boss.get('/asset-categories')).body.data
    expect(list).toHaveLength(17)
    const created = await admin.post('/asset-categories', { name: 'Tandoor' })
    expect(created.status).toBe(201)
    expect(
      (await admin.post('/asset-categories', { name: 'tandoor' })).body.error.fieldErrors,
    ).toEqual({ name: ['validation.alreadyInUse'] })
    await admin.post('/assets', asset({ categoryId: created.body.data.id }))
    expect((await boss.del(`/asset-categories/${created.body.data.id}`)).body.error.code).toBe(
      'CATEGORY_IN_USE',
    )
  })
})

describe('assets', () => {
  it('creates with sequential codes, unique public ids and a CREATED history entry', async () => {
    const a = (await admin.post('/assets', asset())).body.data as AssetDetail
    const b = (await admin.post('/assets', asset({ name: 'Ice machine' }))).body.data as AssetDetail
    expect([a.assetCode, b.assetCode]).toEqual(['AST-0001', 'AST-0002'])
    expect(a.publicId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{12}$/)
    expect(a.publicId).not.toBe(b.publicId)
    expect(a).toMatchObject({
      status: 'OPERATIONAL',
      purchaseCost: '185000',
      warrantyEnd: '2027-02-28',
      purchaseDate: '2024-03-01',
    })
    expect(a.history.map((h) => h.eventType)).toEqual(['CREATED'])
  })

  it('validates references: location must belong to the restaurant; warranty end after start', async () => {
    const other = (
      await boss.post('/locations', {
        restaurantId: R[1],
        name: 'Bar',
        type: 'BAR',
        description: '',
      })
    ).body.data
    const bad = await boss.post('/assets', asset({ locationId: other.id }))
    expect(bad.body.error.fieldErrors).toEqual({
      locationId: ['validation.locationNotInRestaurant'],
    })
    const dates = await boss.post(
      '/assets',
      asset({ warrantyStart: '2026-01-01', warrantyEnd: '2025-01-01' }),
    )
    expect(dates.body.error.fieldErrors).toEqual({
      warrantyEnd: ['validation.warrantyEndBeforeStart'],
    })
    expect(
      (await admin.post('/assets', asset({ restaurantId: R[1] }))).body.error.fieldErrors,
    ).toEqual({
      restaurantId: ['validation.restaurantOutOfScope'],
    })
  })

  it('restaurant scope: other restaurants’ assets are invisible, also by QR id', async () => {
    const mine = (await admin.post('/assets', asset())).body.data as AssetDetail
    const theirs = (await boss.post('/assets', asset({ restaurantId: R[2] }))).body
      .data as AssetDetail
    const list = (await admin.get('/assets')).body.data as AssetListItem[]
    expect(list.map((a) => a.id)).toEqual([mine.id])
    expect((await admin.get(`/assets/${theirs.id}`)).status).toBe(404)
    expect((await admin.get(`/assets/by-public/${theirs.publicId}`)).status).toBe(404)
    expect((await worker.get(`/assets/by-public/${mine.publicId}`)).body.data.id).toBe(mine.id)
    expect((await worker.get('/assets/by-public/not-a-real-code')).status).toBe(400)
  })

  it('records edits and moves in the maintenance history', async () => {
    const kitchen = (
      await admin.post('/locations', {
        restaurantId: R[0],
        name: 'Kitchen',
        type: 'KITCHEN',
        description: '',
      })
    ).body.data
    const a = (await admin.post('/assets', asset())).body.data as AssetDetail
    const updated = (
      await admin.put(`/assets/${a.id}`, asset({ locationId: kitchen.id, model: 'WF-300' }))
    ).body.data as AssetDetail
    expect(updated.location?.name).toBe('Kitchen')
    expect(updated.history.map((h) => h.eventType).sort()).toEqual(['CREATED', 'MOVED', 'UPDATED'])
    const upd = updated.history.find((h) => h.eventType === 'UPDATED')!
    expect(upd.newValue).toEqual({ fields: ['model'] })
    // No-op save adds nothing.
    const same = (
      await admin.put(`/assets/${a.id}`, asset({ locationId: kitchen.id, model: 'WF-300' }))
    ).body.data as AssetDetail
    expect(same.history).toHaveLength(3)
  })

  it('moving a component to another restaurant (edit form) detaches it from its old parent', async () => {
    const parent = (await boss.post('/assets', asset({ name: 'Cold room' }))).body.data as AssetDetail
    const child = (
      await boss.post('/assets', asset({ name: 'Compressor', parentId: parent.id }))
    ).body.data as AssetDetail
    // An older client omits parentId and just changes the restaurant.
    const moved = await boss.put(`/assets/${child.id}`, asset({ name: 'Compressor', restaurantId: R[1] }))
    expect(moved.status).toBe(200)
    const stored = await prisma.asset.findUniqueOrThrow({ where: { id: child.id } })
    expect(stored.restaurantId).toBe(R[1])
    expect(stored.parentId).toBeNull()
  })

  it('status changes open and close downtime', async () => {
    const a = (await admin.post('/assets', asset())).body.data as AssetDetail
    const broken = (
      await admin.put(`/assets/${a.id}/status`, {
        status: 'BROKEN',
        note: 'Compressor not starting',
      })
    ).body.data as AssetDetail
    expect(broken.status).toBe('BROKEN')
    expect(broken.downSince).not.toBeNull()
    expect(broken.history[0]).toMatchObject({
      eventType: 'STATUS_CHANGED',
      note: 'Compressor not starting',
    })

    await prisma.assetDowntime.updateMany({
      data: { startedAt: new Date(Date.now() - 5 * 3_600_000) },
    })
    const fixed = (await admin.put(`/assets/${a.id}/status`, { status: 'OPERATIONAL', note: '' }))
      .body.data as AssetDetail
    expect(fixed.downSince).toBeNull()
    expect(fixed.downtimeHours90d).toBeCloseTo(5, 0)
    expect(
      (await worker.put(`/assets/${a.id}/status`, { status: 'BROKEN', note: '' })).status,
    ).toBe(403)
  })

  it('search, filters and sort', async () => {
    await admin.post('/assets', asset({ name: 'Ice machine', serialNumber: 'ICE-9' }))
    await admin.post(
      '/assets',
      asset({
        name: 'Combi oven',
        categoryId: (await prisma.assetCategory.findFirstOrThrow({ where: { name: 'Oven' } })).id,
      }),
    )
    const names = async (q: string) =>
      ((await admin.get(`/assets${q}`)).body.data as AssetListItem[]).map((a) => a.name)
    expect(await names('?q=ice-9')).toEqual(['Ice machine'])
    expect(await names(`?categoryId=${fridgeCat}&sort=name:desc`)).toEqual(['Ice machine'])
    expect(await names('?sort=name:asc')).toEqual(['Combi oven', 'Ice machine'])
  })

  it('archive hides the asset; workers cannot create', async () => {
    const a = (await admin.post('/assets', asset())).body.data as AssetDetail
    expect((await worker.post('/assets', asset())).status).toBe(403)
    expect((await worker.del(`/assets/${a.id}`)).status).toBe(403)
    expect((await admin.del(`/assets/${a.id}`)).status).toBe(204)
    expect((await admin.get(`/assets/${a.id}`)).status).toBe(404)
    expect(await prisma.auditLog.count({ where: { action: 'asset.archived' } })).toBe(1)
  })
})

describe('warrantyState', () => {
  it('classifies warranty end dates', () => {
    const today = new Date('2026-10-02T10:00:00')
    expect(warrantyState(null, today)).toBe('none')
    expect(warrantyState('2026-09-30', today)).toBe('expired')
    expect(warrantyState('2026-10-20', today)).toBe('expiring')
    expect(warrantyState('2027-10-20', today)).toBe('active')
  })
})

import { AUTH_CSRF_HEADER, AUTH_CSRF_VALUE, type WorkOrderDetail } from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { cleanup } from '../jobs/index.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'

/* Phase 14: writes replayed by the offline queue are applied once. */

const app = createApp()
let fx: Fixture
let token: string
let adminToken: string
let workerId: string

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}

const post = (t: string, u: string, body: object, key?: string) => {
  const r = request(app).post(`/api/v1${u}`).set('Authorization', `Bearer ${t}`)
  if (key) r.set('Idempotency-Key', key)
  return r.send(body)
}

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 1 })
  await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: fx.restaurantIds })
  workerId = (
    await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: fx.restaurantIds })
  ).id
  adminToken = await tokenFor('admin')
  token = await tokenFor('worker')
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function assignedJob() {
  const res = await post(adminToken, '/work-orders', {
    title: 'Sink leak',
    description: '',
    category: 'PLUMBING',
    priority: 'MEDIUM',
    restaurantId: fx.restaurantIds[0],
    locationId: '',
    assetId: '',
    dueDate: '',
    assignedUserId: workerId,
    assignedTeamId: '',
    requestId: '',
  })
  return res.body.data as WorkOrderDetail
}

describe('Phase 14 — idempotent sync', () => {
  it('applies a queued write once and replays the stored response', async () => {
    const w = await assignedJob()
    const first = await post(
      token,
      `/work-orders/${w.id}/messages`,
      { body: 'Water off' },
      'msg-key-0001',
    )
    expect(first.status).toBe(200)
    const again = await post(
      token,
      `/work-orders/${w.id}/messages`,
      { body: 'Water off' },
      'msg-key-0001',
    )
    expect(again.status).toBe(200)
    expect(again.headers['idempotent-replay']).toBe('true')
    expect(again.body).toEqual(first.body)
    expect(await prisma.message.count({ where: { workOrderId: w.id } })).toBe(1)

    // Start twice from a flaky connection: one start, one history line.
    await post(token, `/work-orders/${w.id}/start`, {}, 'start-key-001')
    const replay = await post(token, `/work-orders/${w.id}/start`, {}, 'start-key-001')
    expect(replay.status).toBe(200)
    expect(
      await prisma.workOrderStatusHistory.count({
        where: { workOrderId: w.id, toStatus: 'IN_PROGRESS' },
      }),
    ).toBe(1)
  })

  it('refuses a key reused for a different request; keys are per user', async () => {
    const w = await assignedJob()
    await post(token, `/work-orders/${w.id}/messages`, { body: 'a' }, 'shared-key-01')
    const other = await post(token, `/work-orders/${w.id}/start`, {}, 'shared-key-01')
    expect(other.status).toBe(422)
    // Another user may use the same key string.
    const admin = await post(
      adminToken,
      `/work-orders/${w.id}/messages`,
      { body: 'b' },
      'shared-key-01',
    )
    expect(admin.status).toBe(200)
    expect(admin.headers['idempotent-replay']).toBeUndefined()
    expect(
      (await post(token, `/work-orders/${w.id}/messages`, { body: 'c' }, 'bad key!')).status,
    ).toBe(400)
  })

  it('stores failures too (a rejected change is not retried into a different result)', async () => {
    const w = await assignedJob()
    const denied = await post(token, `/work-orders/${w.id}/verify`, {}, 'verify-key-01')
    const again = await post(token, `/work-orders/${w.id}/verify`, {}, 'verify-key-01')
    expect(again.status).toBe(denied.status)
    expect(again.headers['idempotent-replay']).toBe('true')
  })

  it('forgets keys after a day', async () => {
    const w = await assignedJob()
    await post(token, `/work-orders/${w.id}/messages`, { body: 'x' }, 'old-key-0001')
    await prisma.idempotencyKey.updateMany({
      data: { createdAt: new Date(Date.now() - 2 * 86_400_000) },
    })
    expect((await cleanup()).idempotencyKeys).toBe(1)
  })
})

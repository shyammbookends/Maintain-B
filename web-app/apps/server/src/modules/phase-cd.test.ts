import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  WEBHOOK_SIGNATURE_HEADER,
  type ChatMessagesPage,
  type ConversationListItem,
  type CreatedApiKey,
  type CreatedWebhook,
} from '@maintainx/shared'
import { createHmac } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { webhookTransport } from './integrations/webhooks.service.js'
import { prisma } from '../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'

/* Phases C & D: team chat, dashboard layout, test notification, API keys, webhooks, SSO. */

const app = createApp()
let fx: Fixture
let tokens: Record<string, string>
let ids: Record<string, string>

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}
const as = (who: string) => {
  const h = { Authorization: `Bearer ${tokens[who] ?? who}` }
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
  const [r1, r2] = fx.restaurantIds as [string, string]
  ids = {
    boss: (await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss', email: 'boss@bookends.in' })).id,
    admin: (await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [r1] })).id,
    worker: (await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [r1] })).id,
    far: (await fx.createUser({ role: 'WORKER', username: 'far', restaurants: [r2] })).id,
  }
  tokens = {
    boss: await tokenFor('boss'),
    admin: await tokenFor('admin'),
    worker: await tokenFor('worker'),
    far: await tokenFor('far'),
  }
})
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await prisma.$disconnect()
})

describe('team chat', () => {
  it('direct chats are reused, unread counts and one notification per chat', async () => {
    const people = (await as('worker').get('/chats/people')).body.data as Array<{ id: string }>
    // Same restaurant + the Super Admin; not the worker at the other restaurant.
    expect(people.map((p) => p.id).sort()).toEqual([ids.admin, ids.boss].sort())
    expect((await as('worker').post('/chats', { userIds: [ids.far] })).status).toBe(400)

    const chat = (await as('worker').post('/chats', { userIds: [ids.admin] })).body.data.id
    expect((await as('admin').post('/chats', { userIds: [ids.worker] })).body.data.id).toBe(chat)

    await as('worker').post(`/chats/${chat}/messages`, { body: 'Fridge 2 is noisy' })
    await as('worker').post(`/chats/${chat}/messages`, { body: 'Can you check?' })
    expect((await as('admin').get('/chats/unread')).body.data.count).toBe(2)
    expect(
      await prisma.notification.count({ where: { recipientId: ids.admin, type: 'CHAT_MESSAGE' } }),
    ).toBe(1)
    const list = (await as('admin').get('/chats')).body.data as ConversationListItem[]
    expect(list[0]).toMatchObject({ id: chat, type: 'DIRECT', unread: 2 })
    expect(list[0]!.lastMessage?.body).toBe('Can you check?')

    const page = (await as('admin').get(`/chats/${chat}/messages`)).body.data as ChatMessagesPage
    expect(page.messages.map((m) => m.body)).toEqual(['Fridge 2 is noisy', 'Can you check?'])
    await as('admin').post(`/chats/${chat}/read`)
    expect((await as('admin').get('/chats/unread')).body.data.count).toBe(0)
    // Polling for newer messages.
    await as('worker').post(`/chats/${chat}/messages`, { body: 'Thanks!' })
    const newer = (await as('admin').get(`/chats/${chat}/messages?after=${page.messages[1]!.id}`))
      .body.data as ChatMessagesPage
    expect(newer.messages.map((m) => m.body)).toEqual(['Thanks!'])

    // Outsiders can't read it.
    expect((await as('far').get(`/chats/${chat}/messages`)).status).toBe(404)
  })

  it('work-order cards only for work the sender, and each reader, can see', async () => {
    const wo = async (restaurantId: string, assignedUserId: string) =>
      (
        await as('boss').post('/work-orders', {
          title: 'Hidden job',
          description: '',
          category: 'PLUMBING',
          priority: 'MEDIUM',
          restaurantId,
          locationId: '',
          assetId: '',
          dueDate: '',
          assignedUserId,
          assignedTeamId: '',
          requestId: '',
        })
      ).body.data.id as string
    const [r1, r2] = fx.restaurantIds as [string, string]
    const otherRestaurant = await wo(r2, ids.far!)
    const notTheWorkers = await wo(r1, '')
    const chat = (await as('admin').post('/chats', { userIds: [ids.worker] })).body.data.id
    // The admin can't attach another restaurant's job.
    expect(
      (await as('admin').post(`/chats/${chat}/messages`, { body: 'see', workOrderId: otherRestaurant }))
        .status,
    ).toBe(400)
    // The admin shares a job in their restaurant that isn't the worker's: the worker sees no card.
    expect(
      (await as('admin').post(`/chats/${chat}/messages`, { body: 'fyi', workOrderId: notTheWorkers }))
        .status,
    ).toBe(201)
    const page = (await as('worker').get(`/chats/${chat}/messages`)).body.data as ChatMessagesPage
    expect(page.messages[0]!.workOrder).toBeNull()
    const adminPage = (await as('admin').get(`/chats/${chat}/messages`)).body.data as ChatMessagesPage
    expect(adminPage.messages[0]!.workOrder?.id).toBe(notTheWorkers)
  })

  it('groups need a name; members can leave', async () => {
    expect((await as('admin').post('/chats', { userIds: [ids.worker, ids.boss] })).status).toBe(400)
    const g = (
      await as('admin').post('/chats', { userIds: [ids.worker, ids.boss], name: 'R1 kitchen' })
    ).body.data.id
    await as('worker').post(`/chats/${g}/messages`, { body: 'Hello team' })
    expect(((await as('boss').get('/chats')).body.data as ConversationListItem[])[0]!.title).toBe(
      'R1 kitchen',
    )
    await as('worker').post(`/chats/${g}/leave`)
    expect((await as('worker').get('/chats')).body.data).toEqual([])
    expect((await as('worker').post(`/chats/${g}/messages`, { body: 'x' })).status).toBe(404)
  })
})

describe('dashboard layout and test notification', () => {
  it('stores the personal layout', async () => {
    const def = (await as('admin').get('/me/dashboard-layout')).body.data
    expect(def.widgets).toContain('kpis')
    const saved = await as('admin').put('/me/dashboard-layout', { widgets: ['kpis', 'today'] })
    expect(saved.body.data).toEqual({ widgets: ['kpis', 'today'] })
    expect((await as('admin').get('/me/dashboard-layout')).body.data.widgets).toEqual(['kpis', 'today'])
    expect((await as('admin').put('/me/dashboard-layout', { widgets: ['nope'] })).status).toBe(400)
  })

  it('reports delivery status and sends a test notification to me', async () => {
    expect((await as('admin').get('/notifications/delivery')).body.data).toMatchObject({
      email: false,
      push: false,
    })
    expect((await as('admin').post('/notifications/test')).status).toBe(204)
    expect(await prisma.notification.count({ where: { recipientId: ids.admin } })).toBe(1)
  })
})

describe('API keys', () => {
  it('a key acts as its creator, only within its scopes, until revoked', async () => {
    expect(
      (await as('worker').post('/api-keys', { name: 'Mine', scopes: ['work_orders:view'] })).status,
    ).toBe(403)
    const created = await as('boss').post('/api-keys', {
      name: 'Reporting',
      scopes: ['work_orders:view'],
      expiresInDays: 30,
    })
    expect(created.status).toBe(201)
    const key = created.body.data as CreatedApiKey
    expect(key.key.startsWith('mx_live_')).toBe(true)
    expect(await prisma.apiKey.count({ where: { hash: key.key } })).toBe(0) // only the hash is kept

    expect((await as(key.key).get('/work-orders')).status).toBe(200)
    // Outside its scopes (even though the creator is a Super Admin).
    expect((await as(key.key).get('/assets')).status).toBe(403)
    // A key can't make more keys.
    expect((await as(key.key).get('/api-keys')).status).toBe(403)
    expect((await as('boss').get('/api-keys')).body.data[0].lastUsedAt).not.toBeNull()

    await as('boss').delete(`/api-keys/${key.id}`)
    expect((await as(key.key).get('/work-orders')).status).toBe(401)
  })

  it("a key never reaches its creator's personal account (chats, inbox, devices, password)", async () => {
    const key = (
      await as('boss').post('/api-keys', { name: 'Ops', scopes: ['work_orders:view'] })
    ).body.data as CreatedApiKey
    for (const res of [
      await as(key.key).get('/chats'),
      await as(key.key).get('/notifications'),
      await as(key.key).post('/push-devices', {}),
      await as(key.key).get('/saved-views?resource=work_orders'),
      await as(key.key).get('/me/dashboard-layout'),
      await as(key.key).post('/auth/logout-all', {}),
      await as(key.key).post('/auth/change-password', {
        currentPassword: TEST_PASSWORD,
        newPassword: 'Another-Horse-77',
      }),
    ])
      expect(res.status).toBe(403)
    expect(await prisma.pushSubscription.count()).toBe(0)
    // Still fine with the creator's own session.
    expect((await as('boss').get('/chats')).status).toBe(200)
  })
})

describe('webhooks', () => {
  it('only HTTPS; signed deliveries on events; test ping', async () => {
    expect(
      (await as('boss').post('/webhooks', { url: 'http://hooks.example.com/x', events: ['request.created'] }))
        .status,
    ).toBe(400)
    const hook = (
      await as('boss').post('/webhooks', {
        url: 'https://hooks.example.com/bookends',
        events: ['work_order.created'],
      })
    ).body.data as CreatedWebhook
    expect(hook.secret.startsWith('whsec_')).toBe(true)

    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> =
      []
    vi.spyOn(webhookTransport, 'post').mockImplementation(async (url, headers, body) => {
      calls.push({ url, init: { headers, body } })
      return { status: 200 }
    })
    await as('admin').post('/work-orders', {
      title: 'Hood fan noisy',
      description: '',
      category: 'KITCHEN_EQUIPMENT',
      priority: 'MEDIUM',
      restaurantId: fx.restaurantIds[0],
      locationId: '',
      assetId: '',
      dueDate: '',
      assignedUserId: '',
      assignedTeamId: '',
      requestId: '',
    })
    expect(calls).toHaveLength(1)
    const body = String(calls[0]!.init.body)
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers[WEBHOOK_SIGNATURE_HEADER]).toBe(
      `sha256=${createHmac('sha256', hook.secret).update(body).digest('hex')}`,
    )
    expect(JSON.parse(body)).toMatchObject({
      event: 'work_order.created',
      data: { label: expect.stringContaining('Hood fan noisy') },
    })

    const ping = await as('boss').post(`/webhooks/${hook.id}/test`)
    expect(ping.body.data).toMatchObject({ ok: true, status: 200 })
    const list = (await as('boss').get('/webhooks')).body.data
    expect(list[0].recent).toHaveLength(2)
  })
})

describe('single sign-on', () => {
  it('lists no providers until configured and refuses a bad callback', async () => {
    expect((await request(app).get('/api/v1/auth/sso/providers')).body.data).toEqual([])
    const start = await request(app).get('/api/v1/auth/sso/google/start')
    expect(start.status).toBe(302)
    expect(start.headers.location).toMatch(/\/sso\?error=not_configured$/)
    const cb = await request(app).get('/api/v1/auth/sso/google/callback?code=x&state=y')
    expect(cb.headers.location).toMatch(/\/sso\?error=expired$/)
  })

  it('signs in an existing user by verified email', async () => {
    const { ssoLogin } = await import('./auth/auth.service.js')
    const fakeReq = { get: () => 'test', ip: '127.0.0.1' } as never
    const { session } = await ssoLogin('BOSS@bookends.in', 'google', fakeReq)
    expect(session.user.id).toBe(ids.boss)
    await expect(ssoLogin('nobody@bookends.in', 'google', fakeReq)).rejects.toThrow()
  })
})

import { AUTH_CSRF_HEADER, AUTH_CSRF_VALUE } from '@maintainx/shared'
import { SignJWT, decodeJwt } from 'jose'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { prisma } from './core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from './test/db.js'

/* OWASP Top 10 (2025) checks that complement security-hardening.test.ts and the
 * auth / permission-matrix suites: access control between restaurants and
 * roles, mass assignment, injection payloads, forged tokens, traversal and
 * oversized or malformed input. Every case must fail safely (4xx, no leak). */

const app = createApp()
let fx: Fixture
let R: string[]
let ids: Record<'boss' | 'admin' | 'admin2' | 'worker' | 'worker2', string>
let tokens: Record<keyof typeof ids, string>

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}

const as = (who: keyof typeof ids) => {
  const h = { Authorization: `Bearer ${tokens[who]}` }
  return {
    get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
    post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b),
    put: (u: string, b?: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
    patch: (u: string, b?: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
    del: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
  }
}

const wo = (o: Record<string, unknown> = {}) => ({
  title: 'Replace door gasket',
  description: '',
  category: 'REFRIGERATION',
  priority: 'MEDIUM',
  restaurantId: R[0],
  locationId: '',
  assetId: '',
  dueDate: '',
  assignedUserId: '',
  assignedTeamId: '',
  requestId: '',
  ...o,
})

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  const users = {
    boss: await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' }),
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    admin2: await fx.createUser({ role: 'ADMIN', username: 'admin2', restaurants: [R[1]!] }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
    worker2: await fx.createUser({ role: 'WORKER', username: 'worker2', restaurants: [R[1]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  tokens = Object.fromEntries(
    await Promise.all(Object.keys(users).map(async (k) => [k, await tokenFor(k)])),
  ) as typeof tokens
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('A01 broken access control', () => {
  it('another restaurant’s work order is invisible (404), not just forbidden', async () => {
    const created = await as('admin2').post('/work-orders', wo({ restaurantId: R[1] }))
    expect(created.status).toBe(201)
    const id = created.body.data.id as string
    for (const who of ['admin', 'worker'] as const) {
      expect((await as(who).get(`/work-orders/${id}`)).status).toBe(404)
      expect((await as(who).put(`/work-orders/${id}`, wo({ restaurantId: R[1] }))).status).toBe(404)
    }
    const list = await as('admin').get('/work-orders')
    expect(list.body.data.map((w: { id: string }) => w.id)).not.toContain(id)
  })

  it('a work order can’t be moved into a restaurant outside the caller’s scope', async () => {
    const res = await as('admin').post('/work-orders', wo({ restaurantId: R[1] }))
    expect([400, 403, 404, 422]).toContain(res.status)
    expect(await prisma.workOrder.count({ where: { restaurantId: R[1] } })).toBe(0)
  })

  it('a worker can’t use admin endpoints', async () => {
    const w = as('worker')
    expect((await w.get('/users')).status).toBe(403)
    expect((await w.get('/roles')).status).toBe(403)
    expect((await w.get('/audit-logs')).status).toBe(403)
    expect((await w.get('/settings')).status).toBeGreaterThanOrEqual(403)
  })

  it('an admin can’t grant the Super Admin role or edit someone outside their restaurants', async () => {
    const promote = await as('admin').put(`/users/${ids.worker}/access`, {
      roleId: fx.roleIds.SUPER_ADMIN,
      restaurantIds: [R[0]],
    })
    expect([400, 403, 422]).toContain(promote.status)
    const me = await prisma.userRole.findMany({ where: { userId: ids.worker } })
    expect(me.map((r) => r.roleId)).not.toContain(fx.roleIds.SUPER_ADMIN)

    const outside = await as('admin').put(`/users/${ids.worker2}/access`, {
      roleId: fx.roleIds.WORKER,
      restaurantIds: [R[0]],
    })
    expect([400, 403, 404]).toContain(outside.status)
    const still = await prisma.userRestaurant.findMany({ where: { userId: ids.worker2 } })
    expect(still.map((r) => r.restaurantId)).toEqual([R[1]])
  })

  it('mass assignment: unknown fields (role, super admin, org) are ignored', async () => {
    const res = await as('worker').patch('/auth/me/preferences', {
      preferredLocale: 'hi',
      isSuperAdmin: true,
      roleKind: 'ADMIN',
      organizationId: '00000000-0000-0000-0000-000000000000',
      status: 'ACTIVE',
    })
    expect(res.status).toBeLessThan(500)
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ids.worker } })
    expect(u.organizationId).toBe(fx.orgId)
    const roles = await prisma.userRole.findMany({ where: { userId: ids.worker } })
    expect(roles.map((r) => r.roleId)).toEqual([fx.roleIds.WORKER])
  })
})

describe('A05 injection', () => {
  const payloads = [
    "' OR 1=1 --",
    "'; DROP TABLE users; --",
    '" onmouseover="alert(1)',
    '<script>alert(1)</script>',
    '${7*7}{{7*7}}',
    '../../../../etc/passwd',
    '\u0000‮',
  ]

  it('search and filters treat payloads as plain text (no 500, no extra rows)', async () => {
    await as('admin').post('/work-orders', wo({ title: 'Tandoor flame weak' }))
    for (const p of payloads) {
      const q = encodeURIComponent(p)
      for (const path of [`/work-orders?q=${q}`, `/users?q=${q}`, `/assets?q=${q}`]) {
        const res = await as('boss').get(path)
        expect(res.status, `${path}`).toBeLessThan(500)
        if (res.status === 200 && path.startsWith('/work-orders')) expect(res.body.data).toEqual([])
      }
    }
    expect(await prisma.user.count()).toBe(5)
  })

  it('stored text comes back exactly as typed (JSON, never interpreted)', async () => {
    const title = '<img src=x onerror=alert(1)> "quoted" \'single\''
    const res = await as('admin').post('/work-orders', wo({ title }))
    expect(res.status).toBe(201)
    const back = await as('admin').get(`/work-orders/${res.body.data.id}`)
    expect(back.headers['content-type']).toMatch(/application\/json/)
    expect(back.body.data.title).toBe(title)
  })
})

describe('A07 identification and authentication', () => {
  async function forged(token: string) {
    return request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)
  }

  it('refuses unsigned (alg: none) and wrong-key tokens built from a real one', async () => {
    const claims = decodeJwt(tokens.worker)
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, sub: ids.boss })}.`
    expect((await forged(none)).status).toBe(401)

    const wrongKey = await new SignJWT({ ...claims, sub: ids.boss })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(new TextEncoder().encode('not-the-server-secret-not-the-server-secret'))
    expect((await forged(wrongKey)).status).toBe(401)

    const expired = await new SignJWT({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 })
      .setProtectedHeader({ alg: 'HS512', typ: 'JWT' })
      .sign(new TextEncoder().encode('x'.repeat(64)))
    expect((await forged(expired)).status).toBe(401)
  })

  it('a token’s subject can’t be swapped while keeping its signature', async () => {
    const [h, , s] = tokens.worker.split('.')
    const claims = decodeJwt(tokens.worker)
    const p = Buffer.from(JSON.stringify({ ...claims, sub: ids.boss })).toString('base64url')
    expect((await forged(`${h}.${p}.${s}`)).status).toBe(401)
  })

  it('the refresh cookie is never readable by page scripts', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
      .send({ identifier: 'worker', password: TEST_PASSWORD })
    const cookie = String(res.headers['set-cookie'] ?? '')
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/i)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(JSON.stringify(res.body)).not.toMatch(/refresh/i)
  })
})

describe('A02 misconfiguration / A10 exceptional conditions', () => {
  it('only the configured origin may call the API from a browser', async () => {
    const evil = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')
    expect(evil.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('API pages can never be framed', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'")
  })

  it('oversized, malformed and absurd input fails with 4xx and no internals', async () => {
    const big = await as('admin').post('/work-orders', wo({ description: 'x'.repeat(1_100_000) }))
    expect(big.status).toBe(413)

    for (const path of ['/work-orders/not-a-uuid', '/work-orders/..%2F..%2Fetc', '/users/%00']) {
      const res = await as('boss').get(path)
      expect(res.status, path).toBeGreaterThanOrEqual(400)
      expect(res.status, path).toBeLessThan(500)
    }
    const huge = await as('boss').get('/work-orders?page=99999999999999999999&pageSize=-5')
    expect(huge.status).toBeLessThan(500)

    const broken = await request(app)
      .post('/api/v1/auth/login')
      .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
      .set('Content-Type', 'application/json')
      .send('{"identifier": ')
    expect(broken.status).toBe(400)
    expect(JSON.stringify(broken.body)).not.toMatch(/at \w+ \(|node_modules|SyntaxError/)
  })

  it('file links refuse path traversal', async () => {
    for (const key of ['../.env', '..%2F..%2F.env', '/etc/passwd', 'a/../../b']) {
      const res = await request(app).get(
        `/api/v1/files?key=${encodeURIComponent(key)}&exp=9999999999&sig=x`,
      )
      expect(res.status, key).toBeGreaterThanOrEqual(400)
      expect(res.status, key).toBeLessThan(500)
    }
  })
})

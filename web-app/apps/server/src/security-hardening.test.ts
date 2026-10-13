import { randomUUID } from 'node:crypto'
import { AUTH_CSRF_HEADER, AUTH_CSRF_VALUE } from '@maintainx/shared'
import type { Router } from 'express'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { env, productionIssues } from './config/env.js'
import { demoSeedAllowed, hostedAdminPasswordProblem, isHostedDatabase } from './config/seed-guard.js'
import { canAccessRestaurant } from './core/authz.js'
import { prisma } from './core/prisma.js'
import { PostgresRateLimitStore, pruneRateLimits } from './middleware/rate-limit-store.js'
import { buildAuthContext } from './modules/auth/auth.context.js'
import { loadUser } from './modules/auth/auth.repository.js'
import { apiRouter } from './modules/index.js'
import { microsoftEmail } from './modules/integrations/sso.js'
import { storage } from './storage/index.js'
import { buildSignedFilePath } from './storage/signing.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from './test/db.js'

/* Security hardening before go-live: every route needs a session unless it is
 * deliberately public, Super Admin can't reach another organization, files can
 * never run as pages, production config fails closed, and seeds can't create
 * known-password logins on a hosted database. */

const app = createApp()
let fx: Fixture

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------------------------------------------------------------- route inventory

interface Layer {
  route?: { path: string | string[]; methods: Record<string, boolean> }
  handle?: { stack?: Layer[] }
}

/** Every [method, path] mounted under /api/v1 (module routers are mounted without a prefix). */
function mountedRoutes(router: Router): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
        for (const p of paths)
          for (const [m, on] of Object.entries(layer.route.methods))
            if (on && m !== '_all') out.push([m.toUpperCase(), p])
      } else if (layer.handle?.stack) walk(layer.handle.stack)
    }
  }
  walk((router as unknown as { stack: Layer[] }).stack)
  return out
}

/** Reachable without a session, on purpose (each has its own protection). */
const PUBLIC_ROUTES = new Set([
  'GET /health', // liveness
  'GET /ready', // readiness
  'POST /auth/login', // credentials + CSRF header + lockout
  'POST /auth/refresh', // refresh cookie + CSRF header
  'POST /auth/logout', // refresh cookie + CSRF header
  'GET /auth/sso/providers',
  'GET /auth/sso/:provider/start',
  'GET /auth/sso/:provider/callback', // state + PKCE
  'GET /files', // HMAC-signed, expiring link
  'GET /jobs/run', // CRON_SECRET bearer
  'GET /push-feed', // device key
  'GET /public/portal/:token', // public QR portal: unguessable token + shared rate limits
  'POST /public/portal/:token/requests',
  'POST /public/portal/:token/status',
])

describe('route inventory', () => {
  const routes = mountedRoutes(apiRouter)

  it('finds the API routes', () => {
    expect(routes.length).toBeGreaterThan(150)
  })

  it('every route requires a session unless it is on the public allowlist', async () => {
    const id = randomUUID()
    const open: string[] = []
    for (const [method, path] of routes) {
      const name = `${method} ${path}`
      if (PUBLIC_ROUTES.has(name)) continue
      const url = `/api/v1${path.replace(/:[A-Za-z]+/g, id)}`
      const res = await request(app)[method.toLowerCase() as 'get'](url).send({})
      if (res.status !== 401) open.push(`${name} → ${res.status}`)
    }
    expect(open).toEqual([])
  })

  it('the public allowlist only names routes that exist', () => {
    const names = new Set(routes.map(([m, p]) => `${m} ${p}`))
    expect([...PUBLIC_ROUTES].filter((r) => !names.has(r))).toEqual([])
  })

  it('test-only routes are never mounted outside NODE_ENV=test', async () => {
    const prod = createApp({ testRoutes: (r) => r.get('/ping', (_q, s) => s.send('pong')) })
    // In the test environment the hook works…
    expect((await request(prod).get('/api/v1/__test/ping')).status).toBe(200)
    // …and the guard also refuses it on Vercel whatever NODE_ENV says.
    process.env.VERCEL = '1'
    try {
      const onVercel = createApp({ testRoutes: (r) => r.get('/ping', (_q, s) => s.send('pong')) })
      expect((await request(onVercel).get('/api/v1/__test/ping')).status).toBe(404)
    } finally {
      delete process.env.VERCEL
    }
  })
})

// ---------------------------------------------------------------- organizations

describe('Super Admin stays inside their own organization', () => {
  async function foreignRestaurant() {
    const other = await prisma.organization.create({ data: { name: 'Other', slug: 'other-org' } })
    return prisma.restaurant.create({
      data: { organizationId: other.id, code: 'X1', name: 'Foreign kitchen' },
    })
  }

  it('canAccessRestaurant: own (even archived) yes, another organization no', async () => {
    const boss = await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
    const foreign = await foreignRestaurant()
    await prisma.restaurant.update({
      where: { id: fx.restaurantIds[1]! },
      data: { archivedAt: new Date() },
    })
    const loaded = (await loadUser(boss.id))!
    const auth = buildAuthContext(loaded.authUser, loaded.orgRestaurantIds)
    expect(canAccessRestaurant(auth, fx.restaurantIds[0]!)).toBe(true)
    expect(canAccessRestaurant(auth, fx.restaurantIds[1]!)).toBe(true)
    expect(canAccessRestaurant(auth, foreign.id)).toBe(false)
  })

  it('records can’t be created against another organization’s restaurant', async () => {
    await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
    const foreign = await foreignRestaurant()
    const token = await tokenFor('boss')
    const res = await request(app)
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        restaurantId: foreign.id,
        locationId: '',
        assetId: '',
        category: 'PLUMBING',
        title: '',
        description: 'Sink blocked',
        priority: 'MEDIUM',
      })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(await prisma.request.count({ where: { restaurantId: foreign.id } })).toBe(0)

    const part = await request(app)
      .post('/api/v1/parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Gasket', unit: 'pcs' })
    if (part.status === 201) {
      const adjust = await request(app)
        .post(`/api/v1/parts/${part.body.data.id}/adjust`)
        .set('Authorization', `Bearer ${token}`)
        .send({ restaurantId: foreign.id, mode: 'ADD', quantity: 5, note: '' })
      expect(adjust.status).toBeGreaterThanOrEqual(400)
      expect(adjust.status).toBeLessThan(500)
    }
    expect(await prisma.inventory.count({ where: { restaurantId: foreign.id } })).toBe(0)
  })
})

// ---------------------------------------------------------------- sessions

describe('sessions', () => {
  it('sign out everywhere also removes phone device keys', async () => {
    await fx.createUser({ role: 'WORKER', username: 'ravi', restaurants: [fx.restaurantIds[0]!] })
    const token = await tokenFor('ravi')
    const auth = { Authorization: `Bearer ${token}` }
    const device = await request(app).post('/api/v1/push-devices').set(auth)
    expect(device.status).toBe(201)
    const key = device.body.data.key as string
    expect((await request(app).get('/api/v1/push-feed?wait=0').set('x-device-key', key)).status).toBe(
      200,
    )
    expect((await request(app).post('/api/v1/auth/logout-all').set(auth)).status).toBe(204)
    expect((await request(app).get('/api/v1/push-feed?wait=0').set('x-device-key', key)).status).toBe(
      401,
    )
  })
})

// ---------------------------------------------------------------- files

describe('signed file responses', () => {
  async function fetchFile(type: string, name: string, dl: '0' | '1' = '0') {
    const key = `attachments/test/${randomUUID()}.bin`
    await storage.put(key, Buffer.from('<html><script>alert(1)</script></html>'), { mimeType: type })
    const path = buildSignedFilePath(
      { key, exp: Math.floor(Date.now() / 1000) + 60, type, name, dl },
      env.FILE_SIGNING_SECRET,
    )
    return request(app).get(path)
  }

  it('markup is downloaded, never rendered, and sandboxed', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/xml']) {
      const res = await fetchFile(type, 'evil.html')
      expect(res.status).toBe(200)
      expect(res.headers['content-disposition']).toMatch(/^attachment;/)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['content-security-policy']).toContain('sandbox')
      expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    }
  })

  it('photos and voice notes still open inline', async () => {
    for (const type of ['image/webp', 'audio/webm', 'video/mp4']) {
      const res = await fetchFile(type, 'photo.webp')
      expect(res.headers['content-disposition']).toMatch(/^inline;/)
      expect(res.headers['content-security-policy']).toContain('sandbox')
    }
    const pdf = await fetchFile('application/pdf', 'report.pdf')
    expect(pdf.headers['content-disposition']).toMatch(/^inline;/)
  })

  it('a tampered link is refused', async () => {
    const path = buildSignedFilePath(
      { key: 'attachments/x.webp', exp: Math.floor(Date.now() / 1000) + 60, type: 'image/webp', name: 'a', dl: '0' },
      env.FILE_SIGNING_SECRET,
    )
    const res = await request(app).get(path.replace('image%2Fwebp', 'text%2Fhtml'))
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------- config

describe('production configuration fails closed', () => {
  const good = {
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'a'.repeat(20) + 'Q9x7v2k1m8n3b5c4z6l0',
    JWT_REFRESH_SECRET: 'b'.repeat(20) + 'Q9x7v2k1m8n3b5c4z6l0',
    FILE_SIGNING_SECRET: 'c'.repeat(20) + 'Q9x7v2k1m8n3b5c4z6l0',
    CORS_ORIGIN: 'https://maint.example.com',
    APP_URL: 'https://maint.example.com',
  }

  it('accepts a proper production setup', () => {
    expect(productionIssues(good)).toEqual([])
  })

  it('rejects placeholders, reused secrets, wildcard CORS, http and test mode on Vercel', () => {
    const paths = (e: Record<string, unknown>) => productionIssues(e).map((i) => i.path)
    expect(
      paths({
        ...good,
        JWT_ACCESS_SECRET: 'replace-with-64-plus-random-characters-replace-with-64-plus',
      }),
    ).toContain('JWT_ACCESS_SECRET')
    expect(paths({ ...good, FILE_SIGNING_SECRET: good.JWT_ACCESS_SECRET })).toContain(
      'FILE_SIGNING_SECRET',
    )
    expect(paths({ ...good, CORS_ORIGIN: '*' })).toContain('CORS_ORIGIN')
    expect(paths({ ...good, APP_URL: 'http://maint.example.com' })).toContain('APP_URL')
    expect(paths({ ...good, NODE_ENV: 'test', VERCEL: '1' })).toContain('NODE_ENV')
  })
})

describe('seed guards', () => {
  it('treats production, Vercel and remote databases as hosted', () => {
    expect(isHostedDatabase({ NODE_ENV: 'production' })).toBe(true)
    expect(isHostedDatabase({ VERCEL: '1' })).toBe(true)
    expect(
      isHostedDatabase({ DATABASE_URL: 'postgresql://u:p@db.abc.supabase.co:5432/postgres' }),
    ).toBe(true)
    expect(isHostedDatabase({ DATABASE_URL: 'postgresql://u:p@localhost:5432/maintainx' })).toBe(
      false,
    )
    expect(isHostedDatabase({ DATABASE_URL: 'postgresql://u:p@192.168.1.5:5432/m' })).toBe(false)
  })

  it('never seeds the published passwords on a hosted database', () => {
    expect(hostedAdminPasswordProblem(undefined)).not.toBeNull()
    expect(hostedAdminPasswordProblem('ChangeMe123')).not.toBeNull()
    expect(hostedAdminPasswordProblem('short1')).not.toBeNull()
    expect(hostedAdminPasswordProblem('a-long-unique-passphrase-9')).toBeNull()
    expect(demoSeedAllowed({ DATABASE_URL: 'postgresql://u:p@localhost/m' })).toBe(true)
    expect(demoSeedAllowed({ DATABASE_URL: 'postgresql://u:p@db.x.supabase.co/m' })).toBe(false)
    expect(demoSeedAllowed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'yes-i-understand' })).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------- SSO

describe('Microsoft sign-in', () => {
  const TENANT = '11111111-2222-3333-4444-555555555555'
  const token = (claims: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
  const base = {
    tid: TENANT,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    aud: 'client-id-123',
    preferred_username: 'Priya@Bookends.in',
    email: 'someone-else@victim.com',
  }

  it('uses the tenant sign-in name, not the unverified email claim', () => {
    env.MICROSOFT_TENANT_ID = TENANT
    env.MICROSOFT_CLIENT_ID = 'client-id-123'
    try {
      expect(microsoftEmail(token(base))).toBe('priya@bookends.in')
      expect(microsoftEmail(token({ ...base, xms_edov: true }))).toBe('someone-else@victim.com')
      // Another tenant, a guest from elsewhere, or a token for another app: refused.
      const other = '99999999-2222-3333-4444-555555555555'
      expect(
        microsoftEmail(token({ ...base, tid: other, iss: `https://login.microsoftonline.com/${other}/v2.0` })),
      ).toBeNull()
      expect(microsoftEmail(token({ ...base, idp: 'live.com' }))).toBeNull()
      expect(microsoftEmail(token({ ...base, aud: 'someone-elses-app' }))).toBeNull()
      expect(microsoftEmail(undefined)).toBeNull()
    } finally {
      env.MICROSOFT_TENANT_ID = undefined
      env.MICROSOFT_CLIENT_ID = undefined
    }
  })
})

// ---------------------------------------------------------------- shared rate limits

describe('shared rate-limit store', () => {
  it('counts across instances and resets after the window', async () => {
    const a = new PostgresRateLimitStore('rl:test')
    const b = new PostgresRateLimitStore('rl:test')
    a.windowMs = b.windowMs = 60_000
    expect((await a.increment('1.2.3.4')).totalHits).toBe(1)
    expect((await b.increment('1.2.3.4')).totalHits).toBe(2) // another "instance" sees it
    await b.decrement('1.2.3.4')
    expect((await a.get('1.2.3.4'))?.totalHits).toBe(1)
    await prisma.rateLimitHit.updateMany({ data: { resetAt: new Date(Date.now() - 1000) } })
    expect((await a.increment('1.2.3.4')).totalHits).toBe(1) // new window
    await prisma.rateLimitHit.updateMany({ data: { resetAt: new Date(Date.now() - 1000) } })
    expect(await pruneRateLimits()).toBe(1)
  })
})

describe('logs', () => {
  it('never keep signed file links or OAuth codes', async () => {
    const { loggableUrl } = await import('./middleware/http-logger.js')
    expect(loggableUrl('/api/v1/files?key=a&sig=secret')).toBe('/api/v1/files?[redacted]')
    expect(loggableUrl('/api/v1/auth/sso/google/callback?code=c&state=s')).toBe(
      '/api/v1/auth/sso/google/callback?[redacted]',
    )
    expect(loggableUrl('/api/v1/work-orders?page=2')).toBe('/api/v1/work-orders?page=2')
  })
})

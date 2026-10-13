import { AUTH_CSRF_HEADER, AUTH_CSRF_VALUE, AUTH_MAX_FAILED_ATTEMPTS } from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { hashRefreshToken } from '../../core/tokens.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'
import { parseIdentifier } from './identifier.js'
import { REFRESH_REUSE_GRACE_MS } from './auth.service.js'

const app = createApp({
  testRoutes: (r) => {
    r.get('/protected', ...requireAuth(), (req, res) => {
      res.json({ data: { userId: getAuth(req).userId } })
    })
  },
})

const CSRF = { [AUTH_CSRF_HEADER]: AUTH_CSRF_VALUE }

function login(identifier: string, password = TEST_PASSWORD, agent = request(app)) {
  return agent.post('/api/v1/auth/login').set(CSRF).send({ identifier, password })
}

function refreshCookieFrom(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  const line = raw?.find((c) => c.startsWith('mx_rt='))
  return line?.split(';')[0]
}

let fx: Fixture

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('parseIdentifier', () => {
  it('routes email, phone and username to the right column', () => {
    expect(parseIdentifier(' Admin@Bookends.Local ')).toEqual({
      field: 'email',
      value: 'admin@bookends.local',
    })
    expect(parseIdentifier('98765 43210')).toEqual({ field: 'phone', value: '+919876543210' })
    expect(parseIdentifier('+91 (98765) 43210')).toEqual({ field: 'phone', value: '+919876543210' })
    expect(parseIdentifier('Ramesh.K')).toEqual({ field: 'username', value: 'ramesh.k' })
  })
})

describe('POST /auth/login', () => {
  it('signs in with email, username or phone and sets a hardened refresh cookie', async () => {
    await fx.createUser({
      role: 'ADMIN',
      email: 'admin@test.local',
      username: 'admin1',
      phone: '+919876543210',
    })

    for (const id of ['ADMIN@test.local', 'Admin1', '98765 43210']) {
      const res = await login(id)
      expect(res.status, id).toBe(200)
      expect(res.body.data.accessToken).toMatch(/^ey/)
      expect(res.body.data.expiresIn).toBe(900)
      expect(res.body.data.user).toMatchObject({
        email: 'admin@test.local',
        roleKind: 'ADMIN',
        isSuperAdmin: false,
      })
      expect(res.headers['cache-control']).toBe('no-store')

      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('mx_rt='),
      )!
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/SameSite=Strict/i)
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/)
    }
  })

  it('returns the same error for unknown users and wrong passwords', async () => {
    await fx.createUser({ role: 'WORKER', username: 'ravi' })
    const wrong = await login('ravi', 'nope-nope-1')
    const unknown = await login('nobody', 'nope-nope-1')
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    }
  })

  it('requires the CSRF header', async () => {
    await fx.createUser({ role: 'WORKER', username: 'ravi' })
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'ravi', password: TEST_PASSWORD })
    expect(res.status).toBe(403)
  })

  it(`locks the account after ${AUTH_MAX_FAILED_ATTEMPTS} failures, even for the right password`, async () => {
    const user = await fx.createUser({ role: 'WORKER', username: 'ravi' })
    for (let i = 1; i < AUTH_MAX_FAILED_ATTEMPTS; i++) {
      expect((await login('ravi', 'wrong-pass-1')).body.error.code).toBe('INVALID_CREDENTIALS')
    }
    const locking = await login('ravi', 'wrong-pass-1')
    // Same answer as a wrong password / unknown user: no account enumeration.
    expect(locking.status).toBe(401)
    expect(locking.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil,
    ).not.toBeNull()

    const correctButLocked = await login('ravi')
    expect(correctButLocked.status).toBe(401)
    expect(correctButLocked.body.error.code).toBe('INVALID_CREDENTIALS')
    const unknown = await login('nobody-here', 'wrong-pass-1')
    expect(unknown.body.error).toMatchObject({
      code: correctButLocked.body.error.code,
      message: correctButLocked.body.error.message,
    })

    // Lock expires → correct password works and counters reset.
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    })
    expect((await login('ravi')).status).toBe(200)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after).toMatchObject({ failedLoginCount: 0, lockedUntil: null })
    expect(after.lastLoginAt).not.toBeNull()
  })

  it('refuses disabled accounts only after a correct password', async () => {
    await fx.createUser({ role: 'WORKER', username: 'gone', status: 'DISABLED' })
    expect((await login('gone', 'wrong-pass-1')).body.error.code).toBe('INVALID_CREDENTIALS')
    const res = await login('gone')
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED')
  })

  it('writes audit records for success and failure', async () => {
    const user = await fx.createUser({ role: 'WORKER', username: 'ravi' })
    await login('ravi', 'wrong-pass-1')
    await login('ravi')
    const actions = (
      await prisma.auditLog.findMany({ where: { actorId: user.id }, orderBy: { createdAt: 'asc' } })
    ).map((a) => a.action)
    expect(actions).toEqual(['auth.login_failed', 'auth.login'])
    const raw = JSON.stringify(await prisma.auditLog.findMany())
    expect(raw).not.toContain(TEST_PASSWORD)
  })

  it('validates input', async () => {
    const res = await request(app).post('/api/v1/auth/login').set(CSRF).send({ identifier: '' })
    expect(res.status).toBe(400)
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['identifier', 'password'])
  })
})

describe('access tokens', () => {
  it('GET /auth/me returns the user with permissions and restaurant scope', async () => {
    await fx.createUser({ role: 'ADMIN', username: 'a', restaurants: [fx.restaurantIds[0]!] })
    const token = (await login('a')).body.data.accessToken
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.permissions).toContain('work_orders:assign')
    expect(res.body.data.permissions).not.toContain('roles:edit')
    expect(res.body.data.restaurants.map((r: { code: string }) => r.code)).toEqual(['R1'])
  })

  it('Super Admin sees every active restaurant', async () => {
    await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
    const res = await login('boss')
    expect(res.body.data.user.isSuperAdmin).toBe(true)
    expect(res.body.data.user.restaurants).toHaveLength(2)
  })

  it('rejects missing, malformed and tampered tokens with distinct codes', async () => {
    await fx.createUser({ role: 'WORKER', username: 'w' })
    const token: string = (await login('w')).body.data.accessToken

    expect((await request(app).get('/api/v1/auth/me')).body.error.code).toBe('UNAUTHENTICATED')
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer abc')).body.error
        .code,
    ).toBe('TOKEN_INVALID')
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa')
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tampered}`)).body
        .error.code,
    ).toBe('TOKEN_INVALID')
  })

  it('a disabled user is cut off on the next request', async () => {
    const user = await fx.createUser({ role: 'WORKER', username: 'w' })
    const token = (await login('w')).body.data.accessToken
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } })
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED')
  })

  it('users who must change their password can only reach the auth endpoints', async () => {
    await fx.createUser({ role: 'ADMIN', username: 'new', mustChangePassword: true })
    const token = (await login('new')).body.data.accessToken
    const auth = { Authorization: `Bearer ${token}` }

    expect((await request(app).get('/api/v1/auth/me').set(auth)).status).toBe(200)
    const blocked = await request(app).get('/api/v1/__test/protected').set(auth)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })
})

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    await fx.createUser({ role: 'WORKER', username: 'w' })
    const first = refreshCookieFrom(await login('w'))!

    const res = await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', first)
    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toMatch(/^ey/)
    const second = refreshCookieFrom(res)!
    expect(second).not.toBe(first)

    // The new token works; the old one is now spent.
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', second)).status,
    ).toBe(200)
  })

  it('a token replayed within the grace window fails without killing the login (two-tab race)', async () => {
    await fx.createUser({ role: 'WORKER', username: 'w' })
    const first = refreshCookieFrom(await login('w'))!
    const second = refreshCookieFrom(
      await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', first),
    )!

    const replay = await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', first)
    expect(replay.status).toBe(401)
    expect(refreshCookieFrom(replay)).toBeUndefined() // must not clear the winner's cookie
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', second)).status,
    ).toBe(200)
  })

  it('a token replayed after the grace window revokes the whole login (theft)', async () => {
    const user = await fx.createUser({ role: 'WORKER', username: 'w' })
    const first = refreshCookieFrom(await login('w'))!
    const second = refreshCookieFrom(
      await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', first),
    )!

    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(first.split('=')[1]!) },
      data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000) },
    })
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', first)).status,
    ).toBe(401)
    // Legitimate holder is also signed out.
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', second)).status,
    ).toBe(401)
    expect(
      await prisma.auditLog.count({
        where: { actorId: user.id, action: 'auth.refresh_token_reuse' },
      }),
    ).toBe(1)
  })

  it('rejects expired tokens, missing cookies and missing CSRF header', async () => {
    await fx.createUser({ role: 'WORKER', username: 'w' })
    const cookie = refreshCookieFrom(await login('w'))!
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(403)
    expect((await request(app).post('/api/v1/auth/refresh').set(CSRF)).body.error.code).toBe(
      'UNAUTHENTICATED',
    )

    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    const expired = await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', cookie)
    expect(expired.body.error.code).toBe('TOKEN_EXPIRED')
  })
})

describe('logout', () => {
  it('POST /auth/logout revokes the refresh token and clears the cookie', async () => {
    await fx.createUser({ role: 'WORKER', username: 'w' })
    const cookie = refreshCookieFrom(await login('w'))!
    const res = await request(app).post('/api/v1/auth/logout').set(CSRF).set('Cookie', cookie)
    expect(res.status).toBe(204)
    expect(refreshCookieFrom(res)).toBe('mx_rt=')
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', cookie)).status,
    ).toBe(401)
  })

  it('POST /auth/logout-all invalidates every session, including access tokens', async () => {
    await fx.createUser({ role: 'WORKER', username: 'w' })
    const phone = await login('w')
    const laptop = await login('w')
    const res = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${laptop.body.data.accessToken}`)
    expect(res.status).toBe(204)

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${phone.body.data.accessToken}`)
    expect(me.body.error.code).toBe('TOKEN_INVALID')
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', refreshCookieFrom(phone)!)
    expect(refresh.status).toBe(401)
  })
})

describe('POST /auth/change-password', () => {
  it('rejects a wrong current password on the right field', async () => {
    await fx.createUser({ role: 'ADMIN', username: 'a' })
    const token = (await login('a')).body.data.accessToken
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'not-it-123', newPassword: 'Brand-New-77' })
    expect(res.status).toBe(400)
    expect(res.body.error.fieldErrors).toEqual({
      currentPassword: ['validation.currentPasswordWrong'],
    })
  })

  it('enforces the password policy', async () => {
    await fx.createUser({ role: 'ADMIN', username: 'a' })
    const token = (await login('a')).body.data.accessToken
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.error.fieldErrors.newPassword).toContain('validation.passwordMinLength')
  })

  it('changes the password, clears the flag and signs out other sessions', async () => {
    const user = await fx.createUser({ role: 'ADMIN', username: 'a', mustChangePassword: true })
    const other = await login('a')
    const current = await login('a')

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${current.body.data.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Brand-New-77' })
    expect(res.status).toBe(200)
    expect(res.body.data.user.mustChangePassword).toBe(false)
    expect(refreshCookieFrom(res)).toMatch(/^mx_rt=.+/)

    // New session can reach protected routes; old access and refresh tokens are dead.
    const fresh = await request(app)
      .get('/api/v1/__test/protected')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`)
    expect(fresh.body.data.userId).toBe(user.id)
    expect(
      (
        await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${other.body.data.accessToken}`)
      ).status,
    ).toBe(401)
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set(CSRF)
          .set('Cookie', refreshCookieFrom(other)!)
      ).status,
    ).toBe(401)

    expect((await login('a')).status).toBe(401)
    expect((await login('a', 'Brand-New-77')).status).toBe(200)
  })
})

describe('PATCH /auth/me/preferences', () => {
  it('saves the preferred language', async () => {
    await fx.createUser({ role: 'WORKER', username: 'w' })
    const token = (await login('w')).body.data.accessToken
    const res = await request(app)
      .patch('/api/v1/auth/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferredLocale: 'gu' })
    expect(res.body.data.preferredLocale).toBe('gu')
    expect((await login('w')).body.data.user.preferredLocale).toBe('gu')

    const bad = await request(app)
      .patch('/api/v1/auth/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferredLocale: 'fr' })
    expect(bad.status).toBe(400)
  })
})

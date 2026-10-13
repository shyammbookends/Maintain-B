import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type RoleDto,
} from '@maintainx/shared'
import type { Request } from 'express'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'
import { buildAuthContext } from './auth/auth.context.js'
import { loadUser } from './auth/auth.repository.js'
import { archiveUser, setUserStatus, updateUserAccess } from './users/users.service.js'

const app = createApp()
const CSRF = { [AUTH_CSRF_HEADER]: AUTH_CSRF_VALUE }

let fx: Fixture
/** R1…R7 ids */
let R: string[]

async function tokenFor(username: string, password = TEST_PASSWORD): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(CSRF)
    .send({ identifier: username, password })
  expect(res.status, `login ${username}`).toBe(200)
  return res.body.data.accessToken as string
}

function api(token: string) {
  const auth = { Authorization: `Bearer ${token}` }
  return {
    get: (url: string) => request(app).get(`/api/v1${url}`).set(auth),
    post: (url: string, body?: object) => request(app).post(`/api/v1${url}`).set(auth).send(body),
    put: (url: string, body?: object) => request(app).put(`/api/v1${url}`).set(auth).send(body),
    del: (url: string) => request(app).delete(`/api/v1${url}`).set(auth),
  }
}

const newUser = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Ravi',
  lastName: 'Kumar',
  email: '',
  username: 'ravi',
  phone: '',
  password: '',
  restaurantIds: [] as string[],
  ...overrides,
})

let superToken: string
let adminToken: string
let adminId: string

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 7 })
  R = fx.restaurantIds
  await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
  const admin = await fx.createUser({
    role: 'ADMIN',
    username: 'admin-a',
    restaurants: R.slice(0, 3),
  })
  adminId = admin.id
  superToken = await tokenFor('boss')
  adminToken = await tokenFor('admin-a')
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('restaurant scope (Phase 4 acceptance)', () => {
  it('Admin assigned to restaurants 1–3 cannot reach 4–7', async () => {
    const a = api(adminToken)
    const list = await a.get('/restaurants')
    expect(list.body.data.map((r: { code: string }) => r.code)).toEqual(['R1', 'R2', 'R3'])

    for (const id of R.slice(0, 3)) expect((await a.get(`/restaurants/${id}`)).status).toBe(200)
    for (const id of R.slice(3)) {
      const res = await a.get(`/restaurants/${id}`)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    }
  })

  it('Super Admin reaches all 7', async () => {
    const res = await api(superToken).get('/restaurants')
    expect(res.body.data).toHaveLength(7)
  })

  it('Admin cannot edit a restaurant outside scope, can edit one inside', async () => {
    const a = api(adminToken)
    const body = {
      code: 'R5',
      name: 'Hacked',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      phone: '',
      email: '',
      opensAt: '',
      closesAt: '',
      status: 'ACTIVE',
    }
    expect((await a.put(`/restaurants/${R[4]}`, body)).status).toBe(404)
    const ok = await a.put(`/restaurants/${R[0]}`, { ...body, code: 'R1', name: 'Restaurant One' })
    expect(ok.status).toBe(200)
    expect(ok.body.data.name).toBe('Restaurant One')

    // Deactivating a restaurant drops it from everyone's scope (like archiving):
    // Super Admin only.
    const off = await a.put(`/restaurants/${R[0]}`, {
      ...body,
      code: 'R1',
      name: 'Restaurant One',
      status: 'INACTIVE',
    })
    expect(off.status).toBe(403)
    expect((await prisma.restaurant.findUniqueOrThrow({ where: { id: R[0]! } })).status).toBe(
      'ACTIVE',
    )
    // The manager must work at the restaurant (not an Admin from elsewhere).
    const elsewhere = await fx.createUser({ role: 'ADMIN', username: 'far-admin', restaurants: [R[6]!] })
    const badManager = await a.put(`/restaurants/${R[0]}`, {
      ...body,
      code: 'R1',
      name: 'Restaurant One',
      managerId: elsewhere.id,
    })
    expect(badManager.status).toBe(400)
    expect(badManager.body.error.fieldErrors).toEqual({ managerId: ['validation.invalidValue'] })
    expect(
      (await a.put(`/restaurants/${R[0]}`, { ...body, code: 'R1', name: 'R One', managerId: adminId }))
        .status,
    ).toBe(200)
  })

  it('only Super Admin creates restaurants; codes are unique and upper-cased', async () => {
    const body = {
      code: 'sg-1',
      name: 'SG Highway',
      addressLine1: '',
      addressLine2: '',
      city: 'Ahmedabad',
      state: '',
      postalCode: '',
      phone: '',
      email: '',
      opensAt: '09:00',
      closesAt: '23:30',
      status: 'ACTIVE',
    }
    expect((await api(adminToken).post('/restaurants', body)).status).toBe(403)
    const created = await api(superToken).post('/restaurants', body)
    expect(created.status).toBe(201)
    expect(created.body.data.code).toBe('SG-1')
    const dup = await api(superToken).post('/restaurants', body)
    expect(dup.body.error.fieldErrors).toEqual({ code: ['validation.alreadyInUse'] })
  })
})

describe('users', () => {
  async function workerRoleId() {
    return (await prisma.role.findFirstOrThrow({ where: { systemKey: 'WORKER' } })).id
  }

  it('creates a user with a one-time temporary password that must be changed', async () => {
    const res = await api(superToken).post(
      '/users',
      newUser({ roleId: await workerRoleId(), restaurantIds: [R[0]], phone: '98765 43210' }),
    )
    expect(res.status).toBe(201)
    expect(res.headers['cache-control']).toBe('no-store')
    const { user, temporaryPassword } = res.body.data
    expect(temporaryPassword).toMatch(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{10}$/)
    expect(user).toMatchObject({
      username: 'ravi',
      phone: '+919876543210',
      mustChangePassword: true,
      role: { systemKey: 'WORKER' },
    })

    const login = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ identifier: 'ravi', password: temporaryPassword })
    expect(login.body.data.user.mustChangePassword).toBe(true)

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.created' } })
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword)
  })

  it('requires at least one sign-in identifier and reports duplicates per field', async () => {
    const roleId = await workerRoleId()
    const none = await api(superToken).post('/users', newUser({ roleId, username: '' }))
    expect(none.body.error.fieldErrors.email).toEqual(['validation.identifierRequired'])

    await api(superToken).post(
      '/users',
      newUser({ roleId, email: 'ravi@x.in', restaurantIds: [R[0]] }),
    )
    const dup = await api(superToken).post(
      '/users',
      newUser({ roleId, email: 'RAVI@x.in', username: 'RAVI', restaurantIds: [R[0]] }),
    )
    expect(dup.body.error.fieldErrors).toEqual({
      email: ['validation.alreadyInUse'],
      username: ['validation.alreadyInUse'],
    })
  })

  it('Admin sees only users sharing a restaurant, and never Super Admins', async () => {
    const roleId = await workerRoleId()
    await api(superToken).post(
      '/users',
      newUser({ roleId, username: 'in-r2', restaurantIds: [R[1]] }),
    )
    const outside = await api(superToken).post(
      '/users',
      newUser({ roleId, username: 'in-r6', restaurantIds: [R[5]] }),
    )

    const list = await api(adminToken).get('/users?pageSize=100')
    const names = list.body.data.map((u: { username: string }) => u.username).sort()
    expect(names).toEqual(['admin-a', 'in-r2'])
    expect(list.body.meta.total).toBe(2)

    expect((await api(adminToken).get(`/users/${outside.body.data.user.id}`)).status).toBe(404)
    const boss = await prisma.user.findFirstOrThrow({ where: { username: 'boss' } })
    expect((await api(adminToken).get(`/users/${boss.id}`)).status).toBe(404)
  })

  it('Admin can only assign restaurants in scope and roles within their own permissions', async () => {
    const a = api(adminToken)
    const workerId = await workerRoleId()
    const superRole = await prisma.role.findFirstOrThrow({ where: { systemKey: 'SUPER_ADMIN' } })

    const outOfScope = await a.post(
      '/users',
      newUser({ roleId: workerId, restaurantIds: [R[0], R[4]] }),
    )
    expect(outOfScope.body.error.fieldErrors).toEqual({
      restaurantIds: ['validation.restaurantOutOfScope'],
    })

    const escalate = await a.post(
      '/users',
      newUser({ roleId: superRole.id, restaurantIds: [R[0]] }),
    )
    expect(escalate.body.error.fieldErrors).toEqual({ roleId: ['validation.roleNotAllowed'] })

    const assignable = await a.get('/roles/assignable')
    expect(assignable.body.data.map((r: RoleDto) => r.systemKey).sort()).toEqual([
      'ADMIN',
      'WORKER',
    ])

    const noRestaurant = await a.post('/users', newUser({ roleId: workerId, restaurantIds: [] }))
    expect(noRestaurant.body.error.fieldErrors).toEqual({
      restaurantIds: ['validation.restaurantRequired'],
    })

    const ok = await a.post('/users', newUser({ roleId: workerId, restaurantIds: [R[2]] }))
    expect(ok.status).toBe(201)
  })

  it('changing access keeps restaurants the Admin cannot see', async () => {
    const workerId = await workerRoleId()
    const created = await api(superToken).post(
      '/users',
      newUser({ roleId: workerId, restaurantIds: [R[0], R[5]] }),
    )
    const id = created.body.data.user.id

    const res = await api(adminToken).put(`/users/${id}/access`, {
      roleId: workerId,
      restaurantIds: [R[1]],
    })
    expect(res.status).toBe(200)
    expect(res.body.data.restaurants.map((r: { code: string }) => r.code)).toEqual(['R2'])
    const stored = await prisma.userRestaurant.findMany({ where: { userId: id } })
    expect(stored.map((s) => s.restaurantId).sort()).toEqual([R[1], R[5]].sort())
  })

  it('nobody can change their own access or status', async () => {
    const workerId = await workerRoleId()
    const self = await api(adminToken).put(`/users/${adminId}/access`, {
      roleId: workerId,
      restaurantIds: [R[0]],
    })
    expect(self.status).toBe(403)
    expect(self.body.error.code).toBe('CANNOT_MODIFY_SELF')
    expect(
      (await api(adminToken).put(`/users/${adminId}/status`, { status: 'DISABLED' })).body.error
        .code,
    ).toBe('CANNOT_MODIFY_SELF')
  })

  it('a Super Admin can disable another Super Admin while one stays active', async () => {
    const deputy = await fx.createUser({ role: 'SUPER_ADMIN', username: 'deputy' })
    const res = await api(superToken).put(`/users/${deputy.id}/status`, { status: 'DISABLED' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('DISABLED')
  })

  it('never removes the last active Super Admin (safety net below the API checks)', async () => {
    // Through the API the actor is always another active Super Admin, so one always remains.
    // The guard protects against stale sessions and races; exercise the service directly.
    const boss = await prisma.user.findFirstOrThrow({ where: { username: 'boss' } })
    const actor = (await loadUser(adminId))!.authUser
    const ctx = buildAuthContext({ ...actor, isSuperAdmin: true })
    const req = { get: () => undefined, ip: '127.0.0.1', requestId: 'test' } as unknown as Request
    const adminRole = await prisma.role.findFirstOrThrow({ where: { systemKey: 'ADMIN' } })

    await expect(setUserStatus(ctx, boss.id, { status: 'DISABLED' }, req)).rejects.toMatchObject({
      code: 'LAST_SUPER_ADMIN',
    })
    await expect(archiveUser(ctx, boss.id, req)).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' })
    await expect(
      updateUserAccess(ctx, boss.id, { roleId: adminRole.id, restaurantIds: [R[0]!] }, req),
    ).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: boss.id } })).status).toBe('ACTIVE')
  })

  it('disabling a user signs them out immediately; enabling unlocks', async () => {
    const workerId = await workerRoleId()
    const created = await api(superToken).post(
      '/users',
      newUser({ roleId: workerId, restaurantIds: [R[0]], password: 'Worker-Pass-1' }),
    )
    const id = created.body.data.user.id
    const workerToken = await tokenFor('ravi', 'Worker-Pass-1')

    expect((await api(superToken).put(`/users/${id}/status`, { status: 'DISABLED' })).status).toBe(
      200,
    )
    expect((await api(workerToken).get('/auth/me')).status).toBe(401)

    await prisma.user.update({
      where: { id },
      data: { lockedUntil: new Date(Date.now() + 60_000) },
    })
    const enabled = await api(superToken).put(`/users/${id}/status`, { status: 'ACTIVE' })
    expect(enabled.body.data).toMatchObject({ status: 'ACTIVE', locked: false })
  })

  it('reset password issues a new temporary password and ends existing sessions', async () => {
    const workerId = await workerRoleId()
    const created = await api(superToken).post(
      '/users',
      newUser({ roleId: workerId, restaurantIds: [R[0]], password: 'Worker-Pass-1' }),
    )
    const id = created.body.data.user.id
    const workerToken = await tokenFor('ravi', 'Worker-Pass-1')

    const reset = await api(adminToken).post(`/users/${id}/reset-password`)
    expect(reset.status).toBe(200)
    const temp = reset.body.data.temporaryPassword as string
    expect((await api(workerToken).get('/auth/me')).status).toBe(401)
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .set(CSRF)
          .send({ identifier: 'ravi', password: 'Worker-Pass-1' })
      ).status,
    ).toBe(401)
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ identifier: 'ravi', password: temp })
    expect(login.body.data.user.mustChangePassword).toBe(true)
  })

  it('archive hides the user and writes an audit record', async () => {
    const workerId = await workerRoleId()
    const created = await api(superToken).post(
      '/users',
      newUser({ roleId: workerId, restaurantIds: [R[0]] }),
    )
    const id = created.body.data.user.id
    // The default Admin role has no users:delete permission.
    expect((await api(adminToken).del(`/users/${id}`)).status).toBe(403)
    expect((await api(superToken).del(`/users/${id}`)).status).toBe(204)
    expect((await api(superToken).get(`/users/${id}`)).status).toBe(404)
    expect(await prisma.auditLog.count({ where: { action: 'user.archived', entityId: id } })).toBe(
      1,
    )
  })

  it('workers cannot reach user administration', async () => {
    await fx.createUser({ role: 'WORKER', username: 'w', restaurants: [R[0]!] })
    const w = api(await tokenFor('w'))
    expect((await w.get('/users')).status).toBe(403)
    expect((await w.get('/roles')).status).toBe(403)
    expect((await w.get('/roles/assignable')).status).toBe(403)
  })

  it('filters and searches', async () => {
    const workerId = await workerRoleId()
    await api(superToken).post(
      '/users',
      newUser({ roleId: workerId, firstName: 'Imran', username: 'imran', restaurantIds: [R[0]] }),
    )
    await api(superToken).post(
      '/users',
      newUser({ roleId: workerId, firstName: 'Suresh', username: 'suresh', restaurantIds: [R[3]] }),
    )
    const s = api(superToken)
    expect(
      (await s.get('/users?q=imr')).body.data.map((u: { username: string }) => u.username),
    ).toEqual(['imran'])
    expect(
      (await s.get(`/users?restaurantId=${R[3]}`)).body.data.map(
        (u: { username: string }) => u.username,
      ),
    ).toEqual(['suresh'])
    expect(
      (await s.get(`/users?roleId=${workerId}&sort=name:desc`)).body.data.map(
        (u: { username: string }) => u.username,
      ),
    ).toEqual(['suresh', 'imran'])
  })
})

describe('roles', () => {
  it('only Super Admin sees roles; there are exactly three, all locked', async () => {
    expect((await api(adminToken).get('/roles')).status).toBe(403)
    const list = await api(superToken).get('/roles')
    expect(list.body.data.map((r: RoleDto) => [r.systemKey, r.locked])).toEqual([
      ['ADMIN', true],
      ['SUPER_ADMIN', true],
      ['WORKER', true],
    ])
  })

  it('roles cannot be created, edited or deleted', async () => {
    const s = api(superToken)
    const role = await prisma.role.findFirstOrThrow({ where: { systemKey: 'ADMIN' } })
    const body = { name: 'X', description: '', kind: 'ADMIN', permissions: [] }
    expect((await s.post('/roles', body)).status).toBe(404)
    expect((await s.put(`/roles/${role.id}`, body)).status).toBe(404)
    expect((await s.del(`/roles/${role.id}`)).status).toBe(404)
  })

  it('a leftover custom role is hidden and cannot be given to anyone', async () => {
    const custom = await prisma.role.create({
      data: { organizationId: fx.orgId, name: 'Old custom', kind: 'ADMIN' },
    })
    const list = await api(superToken).get('/roles')
    expect(list.body.data.map((r: RoleDto) => r.id)).not.toContain(custom.id)
    const res = await api(superToken).post(
      '/users',
      newUser({ roleId: custom.id, restaurantIds: [R[0]] }),
    )
    expect(res.body.error.fieldErrors).toEqual({ roleId: ['validation.selectOption'] })
  })
})

describe('teams', () => {
  it('Admin manages teams in their restaurants; members must belong to that restaurant', async () => {
    const tech = await fx.createUser({ role: 'WORKER', username: 'tech', restaurants: [R[0]!] })
    const elsewhere = await fx.createUser({
      role: 'WORKER',
      username: 'elsewhere',
      restaurants: [R[1]!],
    })
    const a = api(adminToken)

    const bad = await a.post('/teams', {
      name: 'Kitchen crew',
      description: '',
      restaurantId: R[0]!,
      leadUserId: null,
      memberIds: [elsewhere.id],
    })
    expect(bad.body.error.fieldErrors).toEqual({ memberIds: ['validation.memberNotInRestaurant'] })

    const created = await a.post('/teams', {
      name: 'Kitchen crew',
      description: '',
      restaurantId: R[0]!,
      leadUserId: tech.id,
      memberIds: [],
    })
    expect(created.status).toBe(201)
    expect(created.body.data.lead.id).toBe(tech.id)
    expect(created.body.data.members.map((m: { id: string }) => m.id)).toEqual([tech.id]) // lead is a member

    const outside = await a.post('/teams', {
      name: 'R5 crew',
      description: '',
      restaurantId: R[4]!,
      leadUserId: null,
      memberIds: [],
    })
    expect(outside.body.error.fieldErrors).toEqual({
      restaurantId: ['validation.restaurantOutOfScope'],
    })

    const orgWide = await a.post('/teams', {
      name: 'Electricians',
      description: '',
      restaurantId: null,
      leadUserId: null,
      memberIds: [],
    })
    expect(orgWide.status).toBe(400)
    expect(
      (
        await api(superToken).post('/teams', {
          name: 'Electricians',
          description: '',
          restaurantId: null,
          leadUserId: null,
          memberIds: [],
        })
      ).status,
    ).toBe(201)
  })

  it('teams in other restaurants are invisible to an Admin', async () => {
    const s = api(superToken)
    const t = await s.post('/teams', {
      name: 'R6 crew',
      description: '',
      restaurantId: R[5]!,
      leadUserId: null,
      memberIds: [],
    })
    expect((await api(adminToken).get(`/teams/${t.body.data.id}`)).status).toBe(404)
    expect((await api(adminToken).get('/teams')).body.data).toEqual([])
    expect((await api(adminToken).del(`/teams/${t.body.data.id}`)).status).toBe(404)
  })
})

describe('users who also work in restaurants outside the Admin’s scope', () => {
  it('an Admin cannot take over their account (password, identity, status), nor change their role', async () => {
    const roles = fx.roleIds
    // Another Admin running R1 (shared with admin-a) and R6 (not admin-a's).
    const other = await fx.createUser({
      role: 'ADMIN',
      username: 'admin-b',
      email: 'b@example.com',
      restaurants: [R[0]!, R[5]!],
    })
    const a = api(adminToken)
    expect((await a.get(`/users/${other.id}`)).status).toBe(200)
    expect((await a.post(`/users/${other.id}/reset-password`)).status).toBe(403)
    expect(
      (
        await a.put(`/users/${other.id}`, {
          firstName: 'Test',
          lastName: 'B',
          email: 'attacker@example.com',
          username: 'admin-b',
          phone: '',
        })
      ).status,
    ).toBe(403)
    expect((await a.put(`/users/${other.id}/status`, { status: 'DISABLED' })).status).toBe(403)
    expect((await a.del(`/users/${other.id}`)).status).toBe(403)
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: other.id } })
    expect(stored.email).toBe('b@example.com')
    expect(stored.status).toBe('ACTIVE')

    // A worker in R1 + R6 can't be promoted to Admin (that would make them Admin of R6 too).
    const worker = await fx.createUser({
      role: 'WORKER',
      username: 'w16',
      restaurants: [R[0]!, R[5]!],
    })
    const promote = await a.put(`/users/${worker.id}/access`, {
      roleId: roles.ADMIN,
      restaurantIds: [R[0]],
    })
    expect(promote.status).toBe(403)
    // Keeping the role and adjusting their in-scope restaurants is still fine.
    const move = await a.put(`/users/${worker.id}/access`, {
      roleId: roles.WORKER,
      restaurantIds: [R[1]],
    })
    expect(move.status).toBe(200)
    const detail = await a.get(`/users/${worker.id}`)
    expect(detail.body.data.can).toMatchObject({
      changeAccess: true,
      resetPassword: false,
      changeStatus: false,
      archive: false,
    })
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../core/prisma.js'
import { createFixture, resetDatabase, type Fixture } from '../test/db.js'

/* The data migration that folds the old roles into Super Admin, Admin and User. */

const SQL = readFileSync(
  fileURLToPath(
    new URL('../../prisma/migrations/20261012000000_three_roles/migration.sql', import.meta.url),
  ),
  'utf8',
)

async function runMigration() {
  const statements = SQL.split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
  for (const s of statements) await prisma.$executeRawUnsafe(s)
}

let fx: Fixture

async function legacyRole(name: string, kind: 'ADMIN' | 'WORKER', systemKey: string | null) {
  return prisma.role.create({
    data: { organizationId: fx.orgId, name, kind, systemKey, isSystem: systemKey !== null },
  })
}

async function moveTo(userId: string, roleId: string) {
  await prisma.userRole.deleteMany({ where: { userId } })
  await prisma.userRole.create({ data: { userId, roleId } })
}

const roleKeysOf = async (userId: string) =>
  (
    await prisma.userRole.findMany({ where: { userId }, include: { role: true } })
  ).map((ur) => ur.role.systemKey)

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 1 })
})

describe('three roles migration', () => {
  it('moves admin-app roles to Admin and worker-app roles to User, then removes them', async () => {
    const manager = await legacyRole('Maintenance Manager', 'ADMIN', 'MAINTENANCE_MANAGER')
    const supervisor = await legacyRole('Supervisor', 'ADMIN', 'SUPERVISOR')
    const requester = await legacyRole('Requester', 'WORKER', 'REQUESTER')
    const customAdmin = await legacyRole('Auditor', 'ADMIN', null)
    const customWorker = await legacyRole('Store keeper', 'WORKER', null)

    const people = {
      manager: await fx.createUser({ role: 'ADMIN', username: 'm' }),
      supervisor: await fx.createUser({ role: 'ADMIN', username: 's' }),
      requester: await fx.createUser({ role: 'WORKER', username: 'r' }),
      customAdmin: await fx.createUser({ role: 'ADMIN', username: 'ca' }),
      customWorker: await fx.createUser({ role: 'WORKER', username: 'cw' }),
      untouched: await fx.createUser({ role: 'WORKER', username: 'u' }),
    }
    await moveTo(people.manager.id, manager.id)
    await moveTo(people.supervisor.id, supervisor.id)
    await moveTo(people.requester.id, requester.id)
    await moveTo(people.customAdmin.id, customAdmin.id)
    await moveTo(people.customWorker.id, customWorker.id)
    // Someone holding both an old role and Admin keeps a single Admin link.
    await prisma.userRole.create({ data: { userId: people.manager.id, roleId: fx.roleIds.ADMIN } })

    await runMigration()

    expect(await roleKeysOf(people.manager.id)).toEqual(['ADMIN'])
    expect(await roleKeysOf(people.supervisor.id)).toEqual(['ADMIN'])
    expect(await roleKeysOf(people.customAdmin.id)).toEqual(['ADMIN'])
    expect(await roleKeysOf(people.requester.id)).toEqual(['WORKER'])
    expect(await roleKeysOf(people.customWorker.id)).toEqual(['WORKER'])
    expect(await roleKeysOf(people.untouched.id)).toEqual(['WORKER'])

    const roles = await prisma.role.findMany({ orderBy: { systemKey: 'asc' } })
    expect(roles.map((r) => [r.systemKey, r.name])).toEqual([
      ['ADMIN', 'ADMIN'],
      ['SUPER_ADMIN', 'SUPER_ADMIN'],
      ['WORKER', 'User'],
    ])

    // Moved people are signed out; others keep their sessions.
    const after = await prisma.user.findMany({ select: { username: true, tokenVersion: true } })
    const version = Object.fromEntries(after.map((u) => [u.username, u.tokenVersion]))
    expect(version).toMatchObject({ m: 2, s: 2, r: 2, ca: 2, cw: 2, u: 1 })
  })

  it('is safe to run twice', async () => {
    await runMigration()
    await runMigration()
    expect(await prisma.role.count()).toBe(3)
  })
})

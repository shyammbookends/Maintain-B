import {
  STRICT_WORKFLOW,
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  parsePermission,
  type SystemRole,
} from '@maintainx/shared'
import type { PermissionAction, User } from '@prisma/client'
import { hashPassword } from '../core/password.js'
import { prisma } from '../core/prisma.js'

/**
 * Integration-test helpers. Refuses to touch any database whose name doesn't
 * end in "_test", so a misconfigured DATABASE_URL can never wipe real data.
 */
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  const name = new URL(url).pathname.replace(/^\//, '')
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run database tests against "${name}". Set TEST_DATABASE_URL to a *_test database.`,
    )
  }
}

export async function resetDatabase(): Promise<void> {
  assertTestDatabase()
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  if (tables.length === 0) return
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

export const TEST_PASSWORD = 'Correct-Horse-9'

export interface Fixture {
  orgId: string
  roleIds: Record<SystemRole, string>
  restaurantIds: string[]
  createUser(opts: {
    role: SystemRole
    email?: string
    username?: string
    phone?: string
    password?: string
    mustChangePassword?: boolean
    status?: 'ACTIVE' | 'INVITED' | 'DISABLED'
    restaurants?: string[]
  }): Promise<User>
}

/** Organization, permission catalogue, the system roles and N restaurants (R1…Rn, default 2). */
export async function createFixture(
  options: { restaurants?: number; workflow?: 'strict' | 'simple' } = {},
): Promise<Fixture> {
  const org = await prisma.organization.create({ data: { name: 'Test Org', slug: 'test-org' } })
  // Most tests exercise the full flow (photos, report, verification); 'simple'
  // keeps the MaintainX-style defaults.
  if ((options.workflow ?? 'strict') === 'strict')
    await prisma.setting.create({
      data: {
        organizationId: org.id,
        scope: 'ORGANIZATION',
        scopeKey: 'org',
        key: 'workOrders.completion',
        value: { ...STRICT_WORKFLOW },
      },
    })

  await prisma.permission.createMany({
    data: ALL_PERMISSIONS.map((key) => {
      const p = parsePermission(key)!
      return { key, resource: p.resource, action: p.action.toUpperCase() as PermissionAction }
    }),
  })
  const permissions = await prisma.permission.findMany()
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]))

  const roleIds = {} as Record<SystemRole, string>
  for (const key of Object.values(SYSTEM_ROLES)) {
    const role = await prisma.role.create({
      data: {
        organizationId: org.id,
        name: key,
        systemKey: key,
        isSystem: true,
        kind: key === SYSTEM_ROLES.WORKER ? 'WORKER' : 'ADMIN',
      },
    })
    await prisma.rolePermission.createMany({
      data: DEFAULT_ROLE_PERMISSIONS[key].map((k) => ({
        roleId: role.id,
        permissionId: idByKey.get(k)!,
      })),
    })
    roleIds[key] = role.id
  }

  const restaurants = await Promise.all(
    Array.from({ length: options.restaurants ?? 2 }, (_, i) => `R${i + 1}`).map((code) =>
      prisma.restaurant.create({
        data: { organizationId: org.id, code, name: `Restaurant ${code}` },
      }),
    ),
  )

  const passwordHashCache = new Map<string, string>()

  return {
    orgId: org.id,
    roleIds,
    restaurantIds: restaurants.map((r) => r.id),
    async createUser(opts) {
      const password = opts.password ?? TEST_PASSWORD
      let passwordHash = passwordHashCache.get(password)
      if (!passwordHash) {
        passwordHash = await hashPassword(password)
        passwordHashCache.set(password, passwordHash)
      }
      return prisma.user.create({
        data: {
          organizationId: org.id,
          email: opts.email ?? null,
          username: opts.username ?? null,
          phone: opts.phone ?? null,
          firstName: 'Test',
          lastName: opts.role,
          passwordHash,
          mustChangePassword: opts.mustChangePassword ?? false,
          status: opts.status ?? 'ACTIVE',
          userRoles: { create: { roleId: roleIds[opts.role] } },
          userRestaurants: opts.restaurants
            ? { create: opts.restaurants.map((restaurantId) => ({ restaurantId })) }
            : undefined,
        },
      })
    },
  }
}

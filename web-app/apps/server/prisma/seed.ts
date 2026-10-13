/**
 * Idempotent seed: organization, permission catalogue, the three roles
 * (Super Admin, Admin, User) and the first Super Admin. Safe to re-run: every
 * role's permissions are reset to their fixed set.
 *
 *   npm run db:seed            (reads SEED_* from apps/server/.env)
 */
import { PrismaClient, type PermissionAction, type RoleKind } from '@prisma/client'
import { config as loadDotenv } from 'dotenv'
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  LOCKED_SYSTEM_ROLES,
  SYSTEM_ROLES,
  parsePermission,
  type SystemRole,
} from '@maintainx/shared'
import { demoSeedAllowed, hostedAdminPasswordProblem, isHostedDatabase } from '../src/config/seed-guard.js'
import { hashPassword } from '../src/core/password.js'
import { ensureDefaultCategories } from '../src/modules/assets/categories.service.js'

loadDotenv({ quiet: true })

const prisma = new PrismaClient()

const ORG_SLUG = 'bookends'
const CODE_COUNTERS = ['WO', 'REQ', 'AST', 'PO', 'INS']

interface RoleSeed {
  systemKey: SystemRole
  name: string
  kind: RoleKind
  description: string
}

const ROLE_SEEDS: RoleSeed[] = [
  {
    systemKey: SYSTEM_ROLES.SUPER_ADMIN,
    name: 'Super Admin',
    kind: 'ADMIN',
    description: 'Full control over the organization, all restaurants and system configuration.',
  },
  {
    systemKey: SYSTEM_ROLES.ADMIN,
    name: 'Admin',
    kind: 'ADMIN',
    description: 'Runs maintenance for assigned restaurants: work, people, assets, stock, vendors.',
  },
  {
    systemKey: SYSTEM_ROLES.WORKER,
    name: 'User',
    kind: 'WORKER',
    description: 'Does assigned work, runs checklists and reports problems.',
  },
]

async function main(): Promise<void> {
  const orgName = process.env.SEED_ORG_NAME ?? 'Bookends Hospitality'
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@bookends.local').trim().toLowerCase()
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123'
  // The default password is public (it's in this file): never use it on a hosted
  // database — production, Vercel, or any non-local DATABASE_URL.
  const hosted = isHostedDatabase()
  const adminProblem = hosted ? hostedAdminPasswordProblem(process.env.SEED_ADMIN_PASSWORD) : null
  const skipAdmin = adminProblem !== null

  // 1. Organization
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: { slug: ORG_SLUG, name: orgName },
  })

  // 2. Permission catalogue
  const permissionIdByKey = new Map<string, string>()
  const existingKeys = new Set(
    (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key),
  )
  for (const key of ALL_PERMISSIONS) {
    const parsed = parsePermission(key)
    if (!parsed) throw new Error(`Invalid permission key in shared package: ${key}`)
    const action = parsed.action.toUpperCase() as PermissionAction
    const permission = await prisma.permission.upsert({
      where: { key },
      update: { resource: parsed.resource, action },
      create: { key, resource: parsed.resource, action },
    })
    permissionIdByKey.set(key, permission.id)
  }

  // 3. System roles (+ default permissions)
  const roleIdByKey = new Map<SystemRole, string>()
  for (const seed of ROLE_SEEDS) {
    const role = await prisma.role.upsert({
      where: { organizationId_systemKey: { organizationId: org.id, systemKey: seed.systemKey } },
      update: { name: seed.name, kind: seed.kind, isSystem: true, description: seed.description },
      create: {
        organizationId: org.id,
        systemKey: seed.systemKey,
        name: seed.name,
        kind: seed.kind,
        isSystem: true,
        description: seed.description,
      },
    })
    roleIdByKey.set(seed.systemKey, role.id)

    const existing = await prisma.rolePermission.count({ where: { roleId: role.id } })
    // Locked roles are always reset to their fixed sets. Editable roles are
    // initialised once, then only gain permissions that are new to the catalogue.
    const locked = LOCKED_SYSTEM_ROLES.includes(seed.systemKey)
    if (!locked && existing > 0) {
      const added = DEFAULT_ROLE_PERMISSIONS[seed.systemKey].filter((k) => !existingKeys.has(k))
      if (added.length > 0) {
        await prisma.rolePermission.createMany({
          data: added.map((k) => ({ roleId: role.id, permissionId: permissionIdByKey.get(k)! })),
          skipDuplicates: true,
        })
      }
      continue
    }

    const wanted = DEFAULT_ROLE_PERMISSIONS[seed.systemKey].map((k) => {
      const id = permissionIdByKey.get(k)
      if (!id) throw new Error(`Permission ${k} missing after seeding`)
      return id
    })
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ])
  }

  // 4. First Super Admin
  const superAdminRoleId = roleIdByKey.get(SYSTEM_ROLES.SUPER_ADMIN)
  if (!superAdminRoleId) throw new Error('Super Admin role missing')

  let admin = await prisma.user.findFirst({ where: { organizationId: org.id, email: adminEmail } })
  let createdAdmin = false
  if (!admin && skipAdmin) {
    console.warn(`  ${adminProblem}: first Super Admin NOT created on this hosted database.`)
  } else if (!admin) {
    admin = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: adminEmail,
        username: 'superadmin',
        firstName: 'Super',
        lastName: 'Admin',
        passwordHash: await hashPassword(adminPassword),
        mustChangePassword: true,
        status: 'ACTIVE',
      },
    })
    createdAdmin = true
  }
  if (admin) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: superAdminRoleId } },
      update: {},
      create: { userId: admin.id, roleId: superAdminRoleId },
    })
  }

  // 5. Default asset categories
  await ensureDefaultCategories(prisma, org.id)

  // 6. Code counters
  for (const key of CODE_COUNTERS) {
    await prisma.counter.upsert({
      where: { organizationId_key: { organizationId: org.id, key } },
      update: {},
      create: { organizationId: org.id, key, value: 0 },
    })
  }

  // 7. Optional demo data for trying every role locally (never on a hosted site).
  if (process.env.SEED_DEMO_USERS === 'true') {
    if (demoSeedAllowed()) await seedDemo(org.id, roleIdByKey)
    else console.warn('  SEED_DEMO_USERS ignored: demo logins are never created on a hosted database.')
  }

  console.log(`Seeded organization "${org.name}" (${org.slug})`)
  console.log(`  permissions: ${permissionIdByKey.size}`)
  console.log(`  roles: ${ROLE_SEEDS.map((r) => r.name).join(', ')}`)
  if (createdAdmin) {
    // Build logs are shared (Vercel): never print a real password there.
    console.log(
      `  super admin created: ${adminEmail}${hosted ? '' : ` / ${adminPassword}`}  (must change password on first login)`,
    )
  } else {
    console.log(`  super admin exists: ${adminEmail}`)
  }
}

/** One restaurant, a manager (Admin) and a technician (Worker). Idempotent. */
async function seedDemo(organizationId: string, roles: Map<SystemRole, string>) {
  const password = process.env.SEED_DEMO_PASSWORD ?? 'Demo@1234'
  const restaurant =
    (await prisma.restaurant.findFirst({ where: { organizationId, code: 'DEMO' } })) ??
    (await prisma.restaurant.create({
      data: { organizationId, code: 'DEMO', name: 'Bookends Café (demo)', city: 'Ahmedabad' },
    }))
  const people = [
    { username: 'manager', firstName: 'Priya', lastName: 'Shah', role: SYSTEM_ROLES.ADMIN },
    { username: 'technician', firstName: 'Ravi', lastName: 'Kumar', role: SYSTEM_ROLES.WORKER },
    { username: 'supervisor', firstName: 'Meera', lastName: 'Patel', role: SYSTEM_ROLES.ADMIN },
    { username: 'staff', firstName: 'Arjun', lastName: 'Mehta', role: SYSTEM_ROLES.WORKER },
  ] as const
  const hash = await hashPassword(password)
  for (const p of people) {
    const existing = await prisma.user.findFirst({
      where: { organizationId, username: p.username },
    })
    const user =
      existing ??
      (await prisma.user.create({
        data: {
          organizationId,
          username: p.username,
          email: `${p.username}@bookends.local`,
          firstName: p.firstName,
          lastName: p.lastName,
          passwordHash: hash,
          mustChangePassword: false,
          status: 'ACTIVE',
        },
      }))
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: roles.get(p.role)! } },
      update: {},
      create: { userId: user.id, roleId: roles.get(p.role)! },
    })
    await prisma.userRestaurant.upsert({
      where: { userId_restaurantId: { userId: user.id, restaurantId: restaurant.id } },
      update: {},
      create: { userId: user.id, restaurantId: restaurant.id },
    })
    console.log(
      `  demo ${p.role.toLowerCase()}: ${p.username} / ${existing ? '(unchanged)' : password}`,
    )
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

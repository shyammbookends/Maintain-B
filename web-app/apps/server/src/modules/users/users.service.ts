import {
  ERROR_CODES,
  SYSTEM_ROLES,
  normalizePhone,
  type CreateUserInput,
  type CreatedUser,
  type ListUsersQuery,
  type PagedResponse,
  type Permission,
  type SetUserStatusInput,
  type UpdateUserAccessInput,
  type UpdateUserInput,
  type UserDetail,
  type UserListItem,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import {
  canAccessRestaurant,
  cannotModifySelf,
  hasPermission,
  withinActorPermissions,
} from '../../core/authz.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { generateTemporaryPassword, hashPassword } from '../../core/password.js'
import { prisma } from '../../core/prisma.js'
import { revokeNativeDevices } from '../notifications/devices.service.js'
import type { AuthContext } from '../auth/auth.context.js'
import { canGrantRole, rolePermissions } from '../roles/roles.service.js'

const userInclude = {
  userRoles: {
    include: {
      role: {
        include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
      },
    },
  },
  userRestaurants: {
    where: { restaurant: { archivedAt: null } },
    include: { restaurant: { select: { id: true, code: true, name: true } } },
  },
  teamMemberships: {
    where: { team: { archivedAt: null } },
    include: { team: { select: { id: true, name: true, restaurantId: true } } },
  },
} satisfies Prisma.UserInclude

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>

const blank = (v: string) => (v === '' ? null : v)
const isSuperAdminUser = (u: UserRow) =>
  u.userRoles.some((ur) => ur.role.systemKey === SYSTEM_ROLES.SUPER_ADMIN)

function permissionsOf(u: UserRow): Permission[] {
  return [...new Set(u.userRoles.flatMap((ur) => rolePermissions(ur.role)))]
}

/** Users an actor may see: Super Admin sees everyone; others see non-Super-Admin users sharing a restaurant. */
export function visibilityWhere(auth: AuthContext): Prisma.UserWhereInput {
  if (auth.isSuperAdmin) return {}
  return {
    AND: [
      { userRestaurants: { some: { restaurantId: { in: [...auth.restaurantIds] } } } },
      { userRoles: { none: { role: { systemKey: SYSTEM_ROLES.SUPER_ADMIN } } } },
    ],
  }
}

/** May the actor change this user at all? Never someone with more power than themselves. */
function canManage(auth: AuthContext, target: UserRow): boolean {
  if (auth.isSuperAdmin) return true
  if (isSuperAdminUser(target)) return false
  return withinActorPermissions(auth, permissionsOf(target))
}

/**
 * Full control (password, sign-in identity, status, role, archive) also needs
 * every restaurant the user works at to be in the actor's scope: otherwise an
 * Admin sharing one restaurant could take over an account that reaches
 * restaurants they don't run. Restaurant assignments inside the actor's scope
 * stay editable (see updateUserAccess).
 */
function canControl(auth: AuthContext, target: UserRow): boolean {
  if (!canManage(auth, target)) return false
  return target.userRestaurants.every((ur) => canAccessRestaurant(auth, ur.restaurant.id))
}

function toListItem(auth: AuthContext, u: UserRow): UserListItem {
  const role = u.userRoles[0]?.role ?? null
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    username: u.username,
    phone: u.phone,
    status: u.status,
    locked: !!u.lockedUntil && u.lockedUntil > new Date(),
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    jobTitle: u.jobTitle,
    hourlyRate: u.hourlyRate?.toString() ?? null,
    role: role
      ? { id: role.id, name: role.name, systemKey: role.systemKey, kind: role.kind }
      : null,
    restaurants: u.userRestaurants
      .map((ur) => ur.restaurant)
      .filter((r) => canAccessRestaurant(auth, r.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

function toDetail(auth: AuthContext, u: UserRow): UserDetail {
  const self = u.id === auth.userId
  const manageable = canManage(auth, u)
  const controllable = canControl(auth, u)
  return {
    ...toListItem(auth, u),
    teams: u.teamMemberships
      .map((m) => m.team)
      .filter((t) => t.restaurantId === null || canAccessRestaurant(auth, t.restaurantId))
      .map(({ id, name }) => ({ id, name })),
    can: {
      edit: hasPermission(auth, 'users:edit') && (self || controllable),
      changeAccess: hasPermission(auth, 'users:assign') && !self && manageable,
      changeStatus: hasPermission(auth, 'users:edit') && !self && controllable,
      resetPassword: hasPermission(auth, 'users:edit') && !self && controllable,
      archive: hasPermission(auth, 'users:delete') && !self && controllable,
    },
  }
}

async function loadVisible(auth: AuthContext, id: string): Promise<UserRow> {
  const u = await prisma.user.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null, ...visibilityWhere(auth) },
    include: userInclude,
  })
  if (!u) throw new NotFoundError('User')
  return u
}

async function loadManageable(
  auth: AuthContext,
  id: string,
  level: 'manage' | 'control' = 'control',
): Promise<UserRow> {
  const u = await loadVisible(auth, id)
  if (!(level === 'manage' ? canManage(auth, u) : canControl(auth, u)))
    throw new ForbiddenError('You can’t change a user with more access than you.')
  return u
}

function normaliseIdentifiers(input: { email: string; username: string; phone: string }) {
  return {
    email: blank(input.email),
    username: blank(input.username),
    phone: input.phone ? normalizePhone(input.phone) : null,
  }
}

/** Clear per-field errors instead of a generic unique-constraint failure. */
async function assertIdentifiersFree(
  organizationId: string,
  ids: { email: string | null; username: string | null; phone: string | null },
  exceptId?: string,
) {
  const or: Prisma.UserWhereInput[] = []
  if (ids.email) or.push({ email: { equals: ids.email, mode: 'insensitive' } })
  if (ids.username) or.push({ username: { equals: ids.username, mode: 'insensitive' } })
  if (ids.phone) or.push({ phone: ids.phone })
  if (or.length === 0) return
  const clashes = await prisma.user.findMany({
    where: { organizationId, OR: or, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { email: true, username: true, phone: true },
  })
  const errors: Record<string, string[]> = {}
  for (const c of clashes) {
    if (ids.email && c.email?.toLowerCase() === ids.email)
      errors.email = ['validation.alreadyInUse']
    if (ids.username && c.username?.toLowerCase() === ids.username)
      errors.username = ['validation.alreadyInUse']
    if (ids.phone && c.phone === ids.phone) errors.phone = ['validation.alreadyInUse']
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors)
}

/** Role must be one of the three roles and grantable by the actor. */
async function resolveGrantableRole(auth: AuthContext, roleId: string) {
  const role = await prisma.role.findFirst({
    where: {
      id: roleId,
      organizationId: auth.organizationId,
      systemKey: { in: Object.values(SYSTEM_ROLES) },
    },
    include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
  })
  if (!role) throw new ValidationError({ roleId: ['validation.selectOption'] })
  if (!canGrantRole(auth, { systemKey: role.systemKey, permissions: rolePermissions(role) })) {
    throw new ValidationError({ roleId: ['validation.roleNotAllowed'] })
  }
  return role
}

/** Restaurants must exist in the organization and be within the actor's own scope. */
async function resolveRestaurants(auth: AuthContext, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  if (unique.some((id) => !canAccessRestaurant(auth, id))) {
    throw new ValidationError({ restaurantIds: ['validation.restaurantOutOfScope'] })
  }
  const found = await prisma.restaurant.count({
    where: { id: { in: unique }, organizationId: auth.organizationId, archivedAt: null },
  })
  if (found !== unique.length)
    throw new ValidationError({ restaurantIds: ['validation.invalidValue'] })
  return unique
}

async function assertNotLastSuperAdmin(organizationId: string, userId: string) {
  const others = await prisma.user.count({
    where: {
      organizationId,
      id: { not: userId },
      archivedAt: null,
      status: { not: 'DISABLED' },
      userRoles: { some: { role: { systemKey: SYSTEM_ROLES.SUPER_ADMIN } } },
    },
  })
  if (others === 0) {
    throw new ConflictError(
      'There must always be at least one active Super Admin.',
      ERROR_CODES.LAST_SUPER_ADMIN,
    )
  }
}

/** Sign the user out everywhere (used on disable, archive and password reset). */
async function revokeSessions(tx: Prisma.TransactionClient, userId: string) {
  await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } })
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  await revokeNativeDevices(tx, userId)
}

function auditSnapshot(u: UserRow) {
  return {
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    username: u.username,
    phone: u.phone,
    status: u.status,
    role: u.userRoles[0]?.role.name ?? null,
    restaurantIds: u.userRestaurants.map((r) => r.restaurant.id).sort(),
  }
}

// ---------------------------------------------------------------------------

const SORT: Record<string, (dir: Prisma.SortOrder) => Prisma.UserOrderByWithRelationInput[]> = {
  name: (dir) => [{ firstName: dir }, { lastName: dir }],
  createdAt: (dir) => [{ createdAt: dir }],
  lastLoginAt: (dir) => [{ lastLoginAt: { sort: dir, nulls: 'last' } }],
}

export async function listUsers(
  auth: AuthContext,
  query: ListUsersQuery,
): Promise<PagedResponse<UserListItem>> {
  if (query.restaurantId && !canAccessRestaurant(auth, query.restaurantId)) {
    return toPagedResponse([], query, 0)
  }
  const and: Prisma.UserWhereInput[] = [visibilityWhere(auth)]
  if (query.q) {
    const q = query.q
    and.push({
      OR: [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q.replace(/[\s()-]/g, '') } },
      ],
    })
  }
  if (query.roleId) and.push({ userRoles: { some: { roleId: query.roleId } } })
  if (query.restaurantId)
    and.push({ userRestaurants: { some: { restaurantId: query.restaurantId } } })

  const where: Prisma.UserWhereInput = {
    organizationId: auth.organizationId,
    archivedAt: null,
    status: query.status,
    AND: and,
  }
  const sort = query.sort ?? { field: 'name', direction: 'asc' as const }
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: userInclude,
      orderBy: [...SORT[sort.field]!(sort.direction), { id: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.user.count({ where }),
  ])
  return toPagedResponse(
    rows.map((u) => toListItem(auth, u)),
    query,
    total,
  )
}

export async function getUser(auth: AuthContext, id: string): Promise<UserDetail> {
  return toDetail(auth, await loadVisible(auth, id))
}

export async function createUser(
  auth: AuthContext,
  input: CreateUserInput,
  req: Request,
): Promise<CreatedUser> {
  const role = await resolveGrantableRole(auth, input.roleId)
  const isSuper = role.systemKey === SYSTEM_ROLES.SUPER_ADMIN
  // Super Admins see every restaurant; restaurant rows would be meaningless for them.
  const restaurantIds = isSuper ? [] : await resolveRestaurants(auth, input.restaurantIds)
  if (!isSuper && !auth.isSuperAdmin && restaurantIds.length === 0) {
    // Without a shared restaurant the creating admin couldn't see the user afterwards.
    throw new ValidationError({ restaurantIds: ['validation.restaurantRequired'] })
  }
  const ids = normaliseIdentifiers(input)
  await assertIdentifiersFree(auth.organizationId, ids)

  const temporaryPassword = input.password || generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  const id = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        organizationId: auth.organizationId,
        firstName: input.firstName,
        lastName: input.lastName,
        ...ids,
        ...workDetails(input),
        passwordHash,
        mustChangePassword: true,
        status: 'ACTIVE',
        userRoles: { create: { roleId: role.id } },
        userRestaurants: { create: restaurantIds.map((restaurantId) => ({ restaurantId })) },
      },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'user.created',
        entityType: 'USER',
        entityId: user.id,
        newValue: {
          firstName: input.firstName,
          lastName: input.lastName,
          ...ids,
          role: role.name,
          restaurantIds,
        },
      },
      req,
      tx,
    )
    return user.id
  })
  return { user: await getUser(auth, id), temporaryPassword }
}

export async function updateUser(
  auth: AuthContext,
  id: string,
  input: UpdateUserInput,
  req: Request,
): Promise<UserDetail> {
  const self = id === auth.userId
  const before = self ? await loadVisible(auth, id) : await loadManageable(auth, id)
  const ids = normaliseIdentifiers(input)
  await assertIdentifiersFree(auth.organizationId, ids, id)
  // People don't set their own pay rate or title (Super Admins excepted).
  const extra = self && !auth.isSuperAdmin ? {} : workDetails(input)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { firstName: input.firstName, lastName: input.lastName, ...ids, ...extra },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'user.updated',
        entityType: 'USER',
        entityId: id,
        oldValue: {
          firstName: before.firstName,
          lastName: before.lastName,
          email: before.email,
          username: before.username,
          phone: before.phone,
          jobTitle: before.jobTitle,
          hourlyRate: before.hourlyRate,
        },
        newValue: {
          firstName: input.firstName,
          lastName: input.lastName,
          ...ids,
          ...('jobTitle' in extra ? { jobTitle: extra.jobTitle } : {}),
          ...('hourlyRate' in extra ? { hourlyRate: extra.hourlyRate } : {}),
        },
      },
      req,
      tx,
    )
  })
  return getUser(auth, id)
}

/** Optional work details from a profile form; omitted fields stay unchanged. */
function workDetails(input: { jobTitle?: string; hourlyRate?: string }) {
  return {
    ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle || null } : {}),
    ...(input.hourlyRate !== undefined ? { hourlyRate: input.hourlyRate || null } : {}),
  }
}

export async function updateUserAccess(
  auth: AuthContext,
  id: string,
  input: UpdateUserAccessInput,
  req: Request,
): Promise<UserDetail> {
  if (id === auth.userId) throw cannotModifySelf()
  const before = await loadManageable(auth, id, 'manage')
  const role = await resolveGrantableRole(auth, input.roleId)
  const willBeSuper = role.systemKey === SYSTEM_ROLES.SUPER_ADMIN
  if (isSuperAdminUser(before) && !willBeSuper)
    await assertNotLastSuperAdmin(auth.organizationId, id)

  const requested = willBeSuper ? [] : await resolveRestaurants(auth, input.restaurantIds)
  // An Admin only controls restaurants they can see; assignments elsewhere are kept as-is.
  const keptOutOfScope = willBeSuper
    ? []
    : before.userRestaurants
        .map((ur) => ur.restaurant.id)
        .filter((rid) => !canAccessRestaurant(auth, rid))
  // A new role would apply in those other restaurants too: only with full control.
  if (!canControl(auth, before) && before.userRoles[0]?.role.id !== role.id)
    throw new ForbiddenError('This user also works at restaurants you don’t manage.')
  const restaurantIds = [...new Set([...requested, ...keptOutOfScope])]
  if (!willBeSuper && !auth.isSuperAdmin && requested.length === 0) {
    throw new ValidationError({ restaurantIds: ['validation.restaurantRequired'] })
  }

  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: id } })
    await tx.userRole.create({ data: { userId: id, roleId: role.id } })
    await tx.userRestaurant.deleteMany({ where: { userId: id } })
    await tx.userRestaurant.createMany({
      data: restaurantIds.map((restaurantId) => ({ userId: id, restaurantId })),
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'user.access_changed',
        entityType: 'USER',
        entityId: id,
        oldValue: {
          role: before.userRoles[0]?.role.name ?? null,
          restaurantIds: before.userRestaurants.map((r) => r.restaurant.id).sort(),
        },
        newValue: { role: role.name, restaurantIds: [...restaurantIds].sort() },
      },
      req,
      tx,
    )
  })
  return getUser(auth, id)
}

export async function setUserStatus(
  auth: AuthContext,
  id: string,
  input: SetUserStatusInput,
  req: Request,
): Promise<UserDetail> {
  if (id === auth.userId) throw cannotModifySelf()
  const before = await loadManageable(auth, id)
  if (input.status === 'DISABLED' && isSuperAdminUser(before)) {
    await assertNotLastSuperAdmin(auth.organizationId, id)
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      // Re-enabling also clears a sign-in lock, which doubles as "unlock".
      data:
        input.status === 'ACTIVE'
          ? { status: 'ACTIVE', lockedUntil: null, failedLoginCount: 0 }
          : { status: 'DISABLED' },
    })
    if (input.status === 'DISABLED') await revokeSessions(tx, id)
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: input.status === 'DISABLED' ? 'user.disabled' : 'user.enabled',
        entityType: 'USER',
        entityId: id,
        oldValue: {
          status: before.status,
          locked: !!before.lockedUntil && before.lockedUntil > new Date(),
        },
        newValue: { status: input.status },
      },
      req,
      tx,
    )
  })
  return getUser(auth, id)
}

export async function resetUserPassword(
  auth: AuthContext,
  id: string,
  req: Request,
): Promise<{ temporaryPassword: string }> {
  if (id === auth.userId) throw cannotModifySelf()
  await loadManageable(auth, id)
  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true, lockedUntil: null, failedLoginCount: 0 },
    })
    await revokeSessions(tx, id)
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'user.password_reset',
        entityType: 'USER',
        entityId: id,
      },
      req,
      tx,
    )
  })
  return { temporaryPassword }
}

export async function archiveUser(auth: AuthContext, id: string, req: Request): Promise<void> {
  if (id === auth.userId) throw cannotModifySelf()
  const before = await loadManageable(auth, id)
  if (isSuperAdminUser(before)) await assertNotLastSuperAdmin(auth.organizationId, id)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { archivedAt: new Date(), status: 'DISABLED' } })
    await tx.teamMember.deleteMany({ where: { userId: id } })
    await revokeSessions(tx, id)
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'user.archived',
        entityType: 'USER',
        entityId: id,
        oldValue: auditSnapshot(before),
      },
      req,
      tx,
    )
  })
}

/**
 * Lightweight list for pickers (team members, assignees, supervisors).
 * `permission` keeps only people who hold it (Super Admins always do).
 */
export async function listUserOptions(
  auth: AuthContext,
  restaurantId?: string,
  permission?: 'work_orders:approve' | 'work_orders:complete' | 'reports:view',
) {
  if (restaurantId && !canAccessRestaurant(auth, restaurantId)) return []
  const rows = await prisma.user.findMany({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      status: 'ACTIVE',
      AND: [
        visibilityWhere(auth),
        restaurantId ? { userRestaurants: { some: { restaurantId } } } : {},
        permission
          ? {
              userRoles: {
                some: {
                  role: {
                    OR: [
                      { systemKey: SYSTEM_ROLES.SUPER_ADMIN },
                      { rolePermissions: { some: { permission: { key: permission } } } },
                    ],
                  },
                },
              },
            }
          : {},
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 500,
  })
  return rows.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.userRoles[0]?.role.name ?? null,
  }))
}

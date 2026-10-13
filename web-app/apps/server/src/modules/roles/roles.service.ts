import {
  LOCKED_SYSTEM_ROLES,
  SYSTEM_ROLES,
  isPermission,
  type Permission,
  type RoleDto,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { withinActorPermissions } from '../../core/authz.js'
import { NotFoundError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Exactly three roles: Super Admin, Admin and User (system key WORKER).
 * They are created by the seed with fixed permissions; there are no custom roles.
 */
const LOCKED_ROLES: ReadonlySet<string> = new Set(LOCKED_SYSTEM_ROLES)
const ROLE_KEYS = Object.values(SYSTEM_ROLES)

const roleWithCounts = {
  rolePermissions: { include: { permission: { select: { key: true } } } },
  _count: { select: { userRoles: { where: { user: { archivedAt: null } } } } },
} satisfies Prisma.RoleInclude

type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleWithCounts }>

export function rolePermissions(role: {
  rolePermissions: Array<{ permission: { key: string } }>
}): Permission[] {
  return role.rolePermissions
    .map((rp) => rp.permission.key)
    .filter(isPermission)
    .sort()
}

function toRoleDto(role: RoleRow): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    kind: role.kind,
    isSystem: role.isSystem,
    systemKey: role.systemKey,
    locked: role.systemKey !== null && LOCKED_ROLES.has(role.systemKey),
    permissions: rolePermissions(role),
    userCount: role._count.userRoles,
  }
}

export async function listRoles(auth: AuthContext): Promise<RoleDto[]> {
  const roles = await prisma.role.findMany({
    where: { organizationId: auth.organizationId, systemKey: { in: ROLE_KEYS } },
    include: roleWithCounts,
    orderBy: { name: 'asc' },
  })
  return roles.map(toRoleDto)
}

/**
 * Roles the actor may give to other users: never Super Admin unless they are one,
 * and never a role carrying permissions the actor doesn't have themselves.
 */
export async function listAssignableRoles(auth: AuthContext): Promise<RoleDto[]> {
  return (await listRoles(auth)).filter((r) => canGrantRole(auth, r))
}

export function canGrantRole(
  auth: AuthContext,
  role: { systemKey: string | null; permissions: Permission[] },
): boolean {
  if (auth.isSuperAdmin) return true
  if (role.systemKey === SYSTEM_ROLES.SUPER_ADMIN) return false
  return withinActorPermissions(auth, role.permissions)
}

export async function getRole(auth: AuthContext, id: string): Promise<RoleDto> {
  const role = await prisma.role.findFirst({
    where: { id, organizationId: auth.organizationId, systemKey: { in: ROLE_KEYS } },
    include: roleWithCounts,
  })
  if (!role) throw new NotFoundError('Role')
  return toRoleDto(role)
}

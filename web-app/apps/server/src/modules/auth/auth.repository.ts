import {
  SYSTEM_ROLES,
  isLocale,
  isPermission,
  type AuthRestaurant,
  type AuthUser,
  type Permission,
} from '@maintainx/shared'
import type { User } from '@prisma/client'
import { prisma } from '../../core/prisma.js'

export interface LoadedUser {
  record: User
  authUser: AuthUser
  /**
   * Every restaurant of the user's organization, archived and inactive ones
   * included. A Super Admin may open any of these — and only these: an id from
   * another organization is out of scope even for a Super Admin.
   */
  orgRestaurantIds: string[]
}

/*
 * Runs on every authenticated request, so it is four flat queries sent at the
 * same time (one database round trip) instead of one nested include, which
 * Prisma runs as seven queries one after another (user → user_roles → roles →
 * role_permissions → permissions, user_restaurants → restaurants).
 */

/** User + roles + permissions + restaurant scope, or null if the user doesn't exist. */
export async function loadUser(userId: string): Promise<LoadedUser | null> {
  const [record, roles, permissionRows, restaurantRows, orgRestaurantRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.role.findMany({
      where: { userRoles: { some: { userId } } },
      select: { id: true, name: true, systemKey: true, kind: true },
    }),
    prisma.permission.findMany({
      where: { rolePermissions: { some: { role: { userRoles: { some: { userId } } } } } },
      select: { key: true },
    }),
    // A Super Admin sees every active restaurant of the organization; everyone
    // else only the ones they are assigned to.
    prisma.restaurant.findMany({
      where: {
        archivedAt: null,
        status: 'ACTIVE',
        OR: [
          { userRestaurants: { some: { userId } } },
          {
            organization: {
              users: {
                some: {
                  id: userId,
                  userRoles: { some: { role: { systemKey: SYSTEM_ROLES.SUPER_ADMIN } } },
                },
              },
            },
          },
        ],
      },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.restaurant.findMany({
      where: { organization: { users: { some: { id: userId } } } },
      select: { id: true },
    }),
  ])
  if (!record) return null

  const isSuperAdmin = roles.some((r) => r.systemKey === SYSTEM_ROLES.SUPER_ADMIN)
  const permissions = new Set<Permission>()
  for (const { key } of permissionRows) {
    if (isPermission(key)) permissions.add(key)
  }
  const restaurants: AuthRestaurant[] = isSuperAdmin
    ? restaurantRows
    : [...restaurantRows].sort((a, b) => a.name.localeCompare(b.name))

  const authUser: AuthUser = {
    id: record.id,
    organizationId: record.organizationId,
    email: record.email,
    username: record.username,
    phone: record.phone,
    firstName: record.firstName,
    lastName: record.lastName,
    preferredLocale: isLocale(record.preferredLocale) ? record.preferredLocale : 'en',
    mustChangePassword: record.mustChangePassword,
    roleKind: roles.some((r) => r.kind === 'ADMIN') ? 'ADMIN' : 'WORKER',
    isSuperAdmin,
    roles: roles.map((r) => ({ id: r.id, name: r.name, systemKey: r.systemKey })),
    permissions: [...permissions].sort(),
    restaurants,
  }
  return { record, authUser, orgRestaurantIds: orgRestaurantRows.map((r) => r.id) }
}

/** Login lookup. Returns up to 2 matches so ambiguous identifiers can be rejected. */
export function findUsersByIdentifier(field: 'email' | 'username' | 'phone', value: string) {
  return prisma.user.findMany({
    where: { [field]: { equals: value, mode: 'insensitive' }, archivedAt: null },
    take: 2,
  })
}

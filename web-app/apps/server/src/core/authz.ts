import { ERROR_CODES, type Permission } from '@maintainx/shared'
import type { RequestHandler } from 'express'
import { getAuth } from '../middleware/authenticate.js'
import type { AuthContext } from '../modules/auth/auth.context.js'
import { ForbiddenError, NotFoundError } from './errors.js'

/*
 * Authorization primitives. Three questions, asked on every request:
 *   1. Permission — does one of the user's roles grant `resource:action`?
 *   2. Scope      — is the record's restaurant one the user is assigned to?
 *   3. Ceiling    — when granting access to others, is it within the actor's own?
 * Super Admin passes 1 and 2 for everything.
 */

export function hasPermission(auth: AuthContext, permission: Permission): boolean {
  return auth.isSuperAdmin || auth.permissions.has(permission)
}

/** Route guard: all listed permissions are required. Use after requireAuth(). */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const auth = getAuth(req)
    if (!permissions.every((p) => hasPermission(auth, p))) throw new ForbiddenError()
    next()
  }
}

export function requireSuperAdmin(): RequestHandler {
  return (req, _res, next) => {
    if (!getAuth(req).isSuperAdmin) throw new ForbiddenError()
    next()
  }
}

/**
 * Super Admin reaches every restaurant of their own organization (archived
 * ones too) but never another organization's, even with a guessed id.
 */
export function canAccessRestaurant(auth: AuthContext, restaurantId: string): boolean {
  return auth.isSuperAdmin
    ? auth.orgRestaurantIds.has(restaurantId)
    : auth.restaurantIds.has(restaurantId)
}

/**
 * Out-of-scope records are reported as "not found" (404), not "forbidden", so
 * users can't discover what exists in restaurants they don't belong to.
 */
export function assertRestaurantAccess(
  auth: AuthContext,
  restaurantId: string,
  what = 'Record',
): void {
  if (!canAccessRestaurant(auth, restaurantId)) throw new NotFoundError(what)
}

/** Prisma filter value for `restaurantId`; undefined means "no restriction" (Super Admin). */
export function restaurantScope(auth: AuthContext): { in: string[] } | undefined {
  return auth.isSuperAdmin ? undefined : { in: [...auth.restaurantIds] }
}

/** True when every permission in `granted` is one the actor holds (no privilege escalation). */
export function withinActorPermissions(auth: AuthContext, granted: Iterable<string>): boolean {
  if (auth.isSuperAdmin) return true
  for (const p of granted) if (!auth.permissions.has(p as Permission)) return false
  return true
}

export function cannotModifySelf(): ForbiddenError {
  return new ForbiddenError(
    'You can’t change this on your own account.',
    ERROR_CODES.CANNOT_MODIFY_SELF,
  )
}

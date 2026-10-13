import type { RoleKind } from './enums.js'
import type { Locale } from './locales.js'
import type { Permission } from './permissions.js'

/**
 * Auth contract shared by API and web.
 *
 * Session model
 *  - Access token: short-lived JWT, returned in the response body, kept in memory
 *    by the web app and sent as `Authorization: Bearer …`.
 *  - Refresh token: opaque random string in an httpOnly, SameSite=Strict cookie
 *    scoped to /api/v1/auth. Rotated on every use; reuse of a rotated token
 *    revokes the whole login (token family).
 *  - Cookie-authenticated endpoints (refresh, logout) also require the CSRF
 *    header below, which a cross-site form or image cannot send.
 */
export const AUTH_CSRF_HEADER = 'x-requested-with'
export const AUTH_CSRF_VALUE = 'maintainx'

/** Failed sign-ins before the account is locked, and for how long. */
export const AUTH_MAX_FAILED_ATTEMPTS = 5
export const AUTH_LOCKOUT_MINUTES = 15

export interface AuthRole {
  id: string
  name: string
  systemKey: string | null
}

export interface AuthRestaurant {
  id: string
  code: string
  name: string
}

export interface AuthUser {
  id: string
  organizationId: string
  email: string | null
  username: string | null
  phone: string | null
  firstName: string
  lastName: string
  preferredLocale: Locale
  mustChangePassword: boolean
  /** Which shell the user lands in. ADMIN if any role is an admin-kind role. */
  roleKind: RoleKind
  isSuperAdmin: boolean
  roles: AuthRole[]
  permissions: Permission[]
  /** Restaurants in scope. Super Admin: every active restaurant. */
  restaurants: AuthRestaurant[]
}

export interface AuthSession {
  accessToken: string
  /** Seconds until the access token expires. */
  expiresIn: number
  user: AuthUser
}

export function fullName(user: Pick<AuthUser, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim()
}

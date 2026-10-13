import type { AuthUser, Permission } from '@maintainx/shared'

/** Who is making the request, resolved once per request by the authenticate middleware. */
export interface AuthContext {
  userId: string
  organizationId: string
  user: AuthUser
  isSuperAdmin: boolean
  permissions: ReadonlySet<Permission>
  /** Restaurants in scope. Ignored for Super Admin (all restaurants). */
  restaurantIds: ReadonlySet<string>
  /**
   * Every restaurant id of the organization (archived included): what a Super
   * Admin may reach. Ids of other organizations are never in it.
   */
  orgRestaurantIds: ReadonlySet<string>
  /** Set when the request came in with an API key instead of a signed-in session. */
  apiKeyId?: string
}

export function buildAuthContext(user: AuthUser, orgRestaurantIds?: Iterable<string>): AuthContext {
  return {
    userId: user.id,
    organizationId: user.organizationId,
    user,
    isSuperAdmin: user.isSuperAdmin,
    permissions: new Set(user.permissions),
    restaurantIds: new Set(user.restaurants.map((r) => r.id)),
    // Fails closed: without the organization list only the visible restaurants count.
    orgRestaurantIds: new Set(orgRestaurantIds ?? user.restaurants.map((r) => r.id)),
  }
}

import type { RestaurantStatus, RoleKind, UserStatus } from './enums.js'
import type { Permission } from './permissions.js'

/** API response shapes for the administration modules. */

export interface RestaurantRef {
  id: string
  code: string
  name: string
}

export interface RoleRef {
  id: string
  name: string
  systemKey: string | null
  kind: RoleKind
}

export interface UserRef {
  id: string
  firstName: string
  lastName: string
}

export interface UserListItem {
  id: string
  firstName: string
  lastName: string
  email: string | null
  username: string | null
  phone: string | null
  status: UserStatus
  /** Account is temporarily locked after failed sign-ins. */
  locked: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
  jobTitle: string | null
  /** Labour cost per hour (rupees) as a decimal string, or null. */
  hourlyRate: string | null
  role: RoleRef | null
  /** Only restaurants the viewer can see. */
  restaurants: RestaurantRef[]
}

export interface UserDetail extends UserListItem {
  teams: Array<{ id: string; name: string }>
  /** What the viewer may do with this user (computed by the server). */
  can: {
    edit: boolean
    changeAccess: boolean
    changeStatus: boolean
    resetPassword: boolean
    archive: boolean
  }
}

export interface CreatedUser {
  user: UserDetail
  /** Shown once to the admin; the user must change it at first sign-in. */
  temporaryPassword: string
}

export interface RoleDto {
  id: string
  name: string
  description: string | null
  kind: RoleKind
  isSystem: boolean
  systemKey: string | null
  /** Super Admin and Worker are fixed. */
  locked: boolean
  permissions: Permission[]
  userCount: number
}

export interface TeamDto {
  id: string
  name: string
  description: string | null
  restaurant: RestaurantRef | null
  lead: UserRef | null
  members: Array<UserRef & { role: string | null }>
}

export interface RestaurantDto extends RestaurantRef {
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  phone: string | null
  email: string | null
  opensAt: string | null
  closesAt: string | null
  status: RestaurantStatus
  manager: UserRef | null
  contactName: string | null
  /** Public request portal link token (/r/<portalId>). */
  portalId: string
  createdAt: string
}

/** Everything that hangs off one restaurant, for its overview page. */
export interface RestaurantStats {
  locations: number
  assets: number
  /** Assets not operational right now (broken or under maintenance). */
  assetsDown: number
  users: number
  workers: number
  teams: number
  vendors: number
  parts: number
  lowStock: number
  procedures: number
  openRequests: number
  openWorkOrders: number
  overdueWorkOrders: number
  completed30d: number
  inspections30d: number
  failedInspections30d: number
  /** Maintenance spend in the last 30 days. */
  cost30d: number
}

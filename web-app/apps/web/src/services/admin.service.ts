import type {
  ApiResponse,
  CreateUserInput,
  CreatedUser,
  PagedResponse,
  RestaurantDto,
  RestaurantInput,
  RestaurantStats,
  RoleDto,
  SetUserStatusInput,
  TeamDto,
  TeamInput,
  UpdateUserAccessInput,
  UpdateUserInput,
  UserDetail,
  UserListItem,
} from '@maintainx/shared'
import { http, type QueryValue } from './http'

/** Typed client for the administration endpoints (users, roles, teams, restaurants). */

const unwrap = <T>(p: Promise<ApiResponse<T>>) => p.then((r) => r.data)

export interface UserOption {
  id: string
  firstName: string
  lastName: string
  role: string | null
}

/** Narrow a people picker to those who may verify or carry out work. */
export type UserOptionPermission = 'work_orders:approve' | 'work_orders:complete' | 'reports:view'

export const usersApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<UserListItem>>('/users', { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<UserDetail>>(`/users/${id}`, { signal })),
  options: (restaurantId?: string, signal?: AbortSignal, permission?: UserOptionPermission) =>
    unwrap(
      http.get<ApiResponse<UserOption[]>>('/users/options', {
        query: { restaurantId, permission },
        signal,
      }),
    ),
  create: (input: CreateUserInput) => unwrap(http.post<ApiResponse<CreatedUser>>('/users', input)),
  update: (id: string, input: UpdateUserInput) =>
    unwrap(http.put<ApiResponse<UserDetail>>(`/users/${id}`, input)),
  updateAccess: (id: string, input: UpdateUserAccessInput) =>
    unwrap(http.put<ApiResponse<UserDetail>>(`/users/${id}/access`, input)),
  setStatus: (id: string, input: SetUserStatusInput) =>
    unwrap(http.put<ApiResponse<UserDetail>>(`/users/${id}/status`, input)),
  resetPassword: (id: string) =>
    unwrap(http.post<ApiResponse<{ temporaryPassword: string }>>(`/users/${id}/reset-password`)),
  archive: (id: string) => http.delete<void>(`/users/${id}`),
}

/** The three fixed roles (Super Admin, Admin, User); only the ones the caller may give. */
export const rolesApi = {
  assignable: (signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<RoleDto[]>>('/roles/assignable', { signal })),
}

export const teamsApi = {
  list: (signal?: AbortSignal) => unwrap(http.get<ApiResponse<TeamDto[]>>('/teams', { signal })),
  create: (input: TeamInput) => unwrap(http.post<ApiResponse<TeamDto>>('/teams', input)),
  update: (id: string, input: TeamInput) =>
    unwrap(http.put<ApiResponse<TeamDto>>(`/teams/${id}`, input)),
  archive: (id: string) => http.delete<void>(`/teams/${id}`),
}

export const restaurantsApi = {
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<RestaurantDto>>(`/restaurants/${id}`, { signal })),
  list: (query: Record<string, QueryValue> = {}, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<RestaurantDto[]>>('/restaurants', { query, signal })),
  create: (input: RestaurantInput) =>
    unwrap(http.post<ApiResponse<RestaurantDto>>('/restaurants', input)),
  update: (id: string, input: RestaurantInput) =>
    unwrap(http.put<ApiResponse<RestaurantDto>>(`/restaurants/${id}`, input)),
  stats: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<RestaurantStats>>(`/restaurants/${id}/stats`, { signal })),
  archive: (id: string) => http.delete<void>(`/restaurants/${id}`),
}

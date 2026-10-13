import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryValue } from '@/services/http'
import {
  restaurantsApi,
  rolesApi,
  teamsApi,
  usersApi,
  type UserOptionPermission,
} from '@/services/admin.service'

/*
 * Query keys and hooks for the administration modules. Mutations invalidate
 * the affected lists so screens never show stale data after a change.
 */

export const adminKeys = {
  users: ['users'] as const,
  userList: (q: Record<string, QueryValue>) => ['users', 'list', q] as const,
  user: (id: string) => ['users', 'detail', id] as const,
  userOptions: (restaurantId?: string) => ['users', 'options', restaurantId ?? 'all'] as const,
  roles: ['roles'] as const,
  assignableRoles: ['roles', 'assignable'] as const,
  role: (id: string) => ['roles', 'detail', id] as const,
  teams: ['teams'] as const,
  restaurants: ['restaurants'] as const,
}

export function useUsers(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: adminKeys.userList(query),
    queryFn: ({ signal }) => usersApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useUser(id: string) {
  return useQuery({
    queryKey: adminKeys.user(id),
    queryFn: ({ signal }) => usersApi.get(id, signal),
  })
}

export function useUserOptions(
  restaurantId: string | undefined,
  enabled = true,
  permission?: UserOptionPermission,
) {
  return useQuery({
    queryKey: [...adminKeys.userOptions(restaurantId), permission ?? 'any'],
    queryFn: ({ signal }) => usersApi.options(restaurantId, signal, permission),
    enabled,
  })
}

export function useAssignableRoles(enabled = true) {
  return useQuery({
    queryKey: adminKeys.assignableRoles,
    queryFn: ({ signal }) => rolesApi.assignable(signal),
    enabled,
    staleTime: 60_000,
  })
}

export function useTeams() {
  return useQuery({ queryKey: adminKeys.teams, queryFn: ({ signal }) => teamsApi.list(signal) })
}

export function useRestaurants(enabled = true) {
  return useQuery({
    queryKey: adminKeys.restaurants,
    queryFn: ({ signal }) => restaurantsApi.list({}, signal),
    enabled,
    staleTime: 60_000,
  })
}

/** Wraps useMutation and invalidates the given key prefixes on success. */
export function useInvalidatingMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  invalidate: ReadonlyArray<readonly unknown[]>,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })))
    },
  })
}

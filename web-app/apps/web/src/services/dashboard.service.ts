import type { ApiResponse, DashboardSummary } from '@maintainx/shared'
import { queryOptions } from '@tanstack/react-query'
import { http } from './http'

const REFRESH_MS = 60_000

/** The admin dashboard for one restaurant (or all of the user's: `null`). */
export function dashboardQuery(restaurantId: string | null) {
  const query = { restaurantId }
  return queryOptions({
    queryKey: ['dashboard', query],
    queryFn: ({ signal }) =>
      http.get<ApiResponse<DashboardSummary>>('/dashboard', { query, signal }).then((r) => r.data),
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  })
}

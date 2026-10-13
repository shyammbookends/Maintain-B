import type {
  ApiResponse,
  AutomationDto,
  AutomationInput,
  AutomationLogDto,
  AnalyticsTrends,
} from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import { http, type QueryValue } from './http'

const unwrap = <T>(p: Promise<ApiResponse<T>>) => p.then((r) => r.data)

export interface MeterOption {
  id: string
  name: string
  unit: string
  asset: { id: string; name: string }
}

export const automationsApi = {
  list: (signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<AutomationDto[]>>('/automations', { signal })),
  create: (input: AutomationInput) =>
    unwrap(http.post<ApiResponse<AutomationDto>>('/automations', input)),
  update: (id: string, input: AutomationInput) =>
    unwrap(http.put<ApiResponse<AutomationDto>>(`/automations/${id}`, input)),
  setActive: (id: string, active: boolean) =>
    unwrap(http.put<ApiResponse<AutomationDto>>(`/automations/${id}/active`, { active })),
  archive: (id: string) => http.delete<void>(`/automations/${id}`),
  logs: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<AutomationLogDto[]>>(`/automations/${id}/logs`, { signal })),
  meterOptions: (restaurantId?: string, signal?: AbortSignal) =>
    unwrap(
      http.get<ApiResponse<MeterOption[]>>('/automations/meter-options', {
        query: { restaurantId },
        signal,
      }),
    ),
}

export const analyticsApi = {
  trends: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<AnalyticsTrends>>('/reports/analytics/trends', { query, signal })),
}

export const autoKeys = {
  all: ['automations'] as const,
  logs: (id: string) => ['automations', 'logs', id] as const,
  meters: (restaurantId?: string) => ['automations', 'meters', restaurantId ?? 'all'] as const,
  trends: (q: Record<string, QueryValue>) => ['analytics', 'trends', q] as const,
}

export function useAutomations() {
  return useQuery({ queryKey: autoKeys.all, queryFn: ({ signal }) => automationsApi.list(signal) })
}

export function useAutomationLogs(id: string | null) {
  return useQuery({
    queryKey: autoKeys.logs(id ?? ''),
    queryFn: ({ signal }) => automationsApi.logs(id!, signal),
    enabled: !!id,
  })
}

export function useMeterOptions(restaurantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: autoKeys.meters(restaurantId),
    queryFn: ({ signal }) => automationsApi.meterOptions(restaurantId, signal),
    enabled,
  })
}

export function useTrends(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: autoKeys.trends(query),
    queryFn: ({ signal }) => analyticsApi.trends(query, signal),
  })
}

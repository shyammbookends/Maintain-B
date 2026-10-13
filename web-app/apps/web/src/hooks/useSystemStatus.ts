import { useQuery } from '@tanstack/react-query'
import { systemService } from '@/services/system.service'

export const systemKeys = {
  health: ['system', 'health'] as const,
  readiness: ['system', 'readiness'] as const,
}

const POLL_MS = 15_000

// Retry policy comes from the shared query client (no retry on 4xx, 2 on network/5xx).
export function useHealth() {
  return useQuery({
    queryKey: systemKeys.health,
    queryFn: ({ signal }) => systemService.health(signal),
    refetchInterval: POLL_MS,
  })
}

export function useReadiness() {
  return useQuery({
    queryKey: systemKeys.readiness,
    queryFn: ({ signal }) => systemService.readiness(signal),
    refetchInterval: POLL_MS,
  })
}

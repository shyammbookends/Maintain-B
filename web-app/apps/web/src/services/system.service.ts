import type { ApiResponse } from '@maintainx/shared'
import { http } from './http'

export interface HealthData {
  status: 'ok'
  service: string
  version: string
  environment: string
  uptimeSeconds: number
  timestamp: string
}

export interface ReadinessData {
  status: 'ready' | 'degraded'
  checks: {
    database: { status: 'up' | 'down'; latencyMs: number }
  }
  timestamp: string
}

export const systemService = {
  health: (signal?: AbortSignal) =>
    http.get<ApiResponse<HealthData>>('/health', { signal }).then((r) => r.data),

  // /ready answers 503 when degraded; we still want the body.
  readiness: (signal?: AbortSignal) =>
    http
      .get<ApiResponse<ReadinessData>>('/ready', { signal, acceptStatuses: [503] })
      .then((r) => r.data),
}

import type {
  NotificationPreferences,
  PushSubscriptionInput,
  ApiResponse,
  AuditLogDto,
  DocumentDto,
  DocumentMetaInput,
  NotificationDto,
  NotificationType,
  PagedResponse,
  ReportKey,
  ReportResult,
  ReportScheduleDto,
  ReportScheduleInput,
  ReportScheduleRunDto,
} from '@maintainx/shared'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { downloadBinary, downloadFile, http, request, type QueryValue } from './http'

const unwrap = <T>(p: Promise<ApiResponse<T>>) => p.then((r) => r.data)

export const notificationsApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<NotificationDto> & { unread: number }>('/notifications', {
      query,
      signal,
    }),
  unreadCount: (signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<{ count: number }>>('/notifications/unread-count', { signal })),
  read: (id: string) =>
    unwrap(http.post<ApiResponse<NotificationDto>>(`/notifications/${id}/read`)),
  readAll: () => unwrap(http.post<ApiResponse<{ updated: number }>>('/notifications/read-all')),
  preferences: (signal?: AbortSignal) =>
    unwrap(
      http.get<ApiResponse<NotificationPreferences>>('/notifications/preferences', { signal }),
    ),
  setPreferences: (muted: NotificationType[], email?: NotificationType[]) =>
    unwrap(
      http.put<ApiResponse<NotificationPreferences>>('/notifications/preferences', {
        muted,
        ...(email ? { email } : {}),
      }),
    ),
  subscribePush: (input: PushSubscriptionInput) => http.post<void>('/notifications/push', input),
  unsubscribePush: (endpoint: string) =>
    request<void>('/notifications/push', { method: 'DELETE', body: { endpoint } }),
}

export const documentsApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<DocumentDto>>('/documents', { query, signal }),
  upload: (fields: Record<string, string>, file: File) => {
    const body = new FormData()
    for (const [k, v] of Object.entries(fields)) body.append(k, v)
    body.append('file', file, file.name)
    return unwrap(http.post<ApiResponse<DocumentDto>>('/documents', body))
  },
  update: (id: string, input: DocumentMetaInput) =>
    unwrap(http.put<ApiResponse<DocumentDto>>(`/documents/${id}`, input)),
  archive: (id: string) => http.delete<void>(`/documents/${id}`),
}

export const reportsApi = {
  run: (key: ReportKey, query: Record<string, QueryValue>, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<ReportResult>>(`/reports/${key}`, { query, signal })),
  csv: (key: ReportKey, query: Record<string, QueryValue>) =>
    downloadFile(
      `/reports/${key}/csv`,
      query,
      `${key}_${String(query.from)}_${String(query.to)}.csv`,
    ),
  pdf: (key: ReportKey, query: Record<string, QueryValue>) =>
    downloadBinary(
      `/reports/${key}/pdf`,
      query,
      `${key}_${String(query.from)}_${String(query.to)}.pdf`,
    ),
}

/** Reports emailed on a schedule. */
export const reportSchedulesApi = {
  list: (reportKey?: ReportKey, signal?: AbortSignal) =>
    unwrap(
      http.get<ApiResponse<ReportScheduleDto[]>>('/report-schedules', {
        query: { reportKey },
        signal,
      }),
    ),
  runs: (id: string, signal?: AbortSignal) =>
    unwrap(
      http.get<ApiResponse<ReportScheduleRunDto[]>>(`/report-schedules/${id}/runs`, { signal }),
    ),
  create: (input: ReportScheduleInput) =>
    unwrap(http.post<ApiResponse<ReportScheduleDto>>('/report-schedules', input)),
  update: (id: string, input: ReportScheduleInput) =>
    unwrap(http.put<ApiResponse<ReportScheduleDto>>(`/report-schedules/${id}`, input)),
  archive: (id: string) => http.delete<void>(`/report-schedules/${id}`),
}

export const auditApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<AuditLogDto>>('/audit-logs', { query, signal }),
  csv: (query: Record<string, QueryValue>) =>
    downloadFile('/audit-logs/csv', query, 'audit-log.csv'),
}

export const platformKeys = {
  notifications: ['notifications'] as const,
  notificationList: (q: Record<string, QueryValue>) => ['notifications', 'list', q] as const,
  unread: ['notifications', 'unread'] as const,
  preferences: ['notifications', 'preferences'] as const,
  documents: ['documents'] as const,
  documentList: (q: Record<string, QueryValue>) => ['documents', 'list', q] as const,
  report: (key: ReportKey, q: Record<string, QueryValue>) => ['reports', key, q] as const,
  reportSchedules: ['report-schedules'] as const,
  reportScheduleList: (key?: ReportKey) => ['report-schedules', 'list', key ?? 'all'] as const,
  audit: (q: Record<string, QueryValue>) => ['audit', q] as const,
}

/** Polled badge count: every minute and when the window regains focus. */
export function useUnreadCount() {
  return useQuery({
    queryKey: platformKeys.unread,
    queryFn: ({ signal }) => notificationsApi.unreadCount(signal),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })
}

export function useNotifications(query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: platformKeys.notificationList(query),
    queryFn: ({ signal }) => notificationsApi.list(query, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    enabled,
  })
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: platformKeys.preferences,
    queryFn: ({ signal }) => notificationsApi.preferences(signal),
  })
}

export function useDocuments(query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: platformKeys.documentList(query),
    queryFn: ({ signal }) => documentsApi.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
    // Signed links last an hour; refresh well before.
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
  })
}

export function useReportSchedules(reportKey?: ReportKey, enabled = true) {
  return useQuery({
    queryKey: platformKeys.reportScheduleList(reportKey),
    queryFn: ({ signal }) => reportSchedulesApi.list(reportKey, signal),
    enabled,
  })
}

export function useReport(key: ReportKey, query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: platformKeys.report(key, query),
    queryFn: ({ signal }) => reportsApi.run(key, query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useAuditLog(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: platformKeys.audit(query),
    queryFn: ({ signal }) => auditApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

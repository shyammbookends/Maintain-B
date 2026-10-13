import type {
  ApiResponse,
  ApproveRequestInput,
  AssigneeWorkload,
  CalendarItem,
  CalendarQuery,
  EvidenceStage,
  ManualTimeInput,
  RescheduleWorkOrderInput,
  AssignWorkOrderInput,
  CancelWorkOrderInput,
  CompleteWorkOrderInput,
  CreateRequestInput,
  CreateWorkOrderInput,
  HoldWorkOrderInput,
  MessageInput,
  PersonRef,
  RootCauseInput,
  PagedResponse,
  RejectRequestInput,
  RejectWorkOrderInput,
  ReopenWorkOrderInput,
  RequestDetail,
  RequestListItem,
  UpdateWorkOrderInput,
  VerifyWorkOrderInput,
  WorkOrderCostInput,
  WorkOrderDetail,
  WorkOrderListItem,
} from '@maintainx/shared'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { http, type QueryValue } from './http'

const unwrap = <T>(p: Promise<ApiResponse<T>>) => p.then((r) => r.data)

function filesBody(files: File[], fields: Record<string, string> = {}): FormData {
  const body = new FormData()
  // Fields first: the server reads them alongside the files.
  for (const [k, v] of Object.entries(fields)) body.append(k, v)
  for (const f of files) body.append('files', f, f.name)
  return body
}

export const requestsApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<RequestListItem>>('/requests', { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<RequestDetail>>(`/requests/${id}`, { signal })),
  create: (input: CreateRequestInput) =>
    unwrap(http.post<ApiResponse<RequestDetail>>('/requests', input)),
  addPhotos: (id: string, files: File[]) =>
    unwrap(http.post<ApiResponse<RequestDetail>>(`/requests/${id}/attachments`, filesBody(files))),
  reject: (id: string, input: RejectRequestInput) =>
    unwrap(http.post<ApiResponse<RequestDetail>>(`/requests/${id}/reject`, input)),
  approve: (id: string, input: ApproveRequestInput) =>
    unwrap(http.post<ApiResponse<RequestDetail>>(`/requests/${id}/approve`, input)),
}

const action =
  <I = void>(path: string) =>
  (id: string, input?: I) =>
    unwrap(http.post<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}/${path}`, input))

export const workOrdersApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<WorkOrderListItem>>('/work-orders', { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}`, { signal })),
  create: (input: CreateWorkOrderInput) =>
    unwrap(http.post<ApiResponse<WorkOrderDetail>>('/work-orders', input)),
  update: (id: string, input: UpdateWorkOrderInput) =>
    unwrap(http.put<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}`, input)),
  assign: action<AssignWorkOrderInput>('assign'),
  unassign: action('unassign'),
  start: action('start'),
  hold: action<HoldWorkOrderInput>('hold'),
  resume: action('resume'),
  complete: action<CompleteWorkOrderInput>('complete'),
  publish: action('publish'),
  verify: action<VerifyWorkOrderInput>('verify'),
  reject: action<RejectWorkOrderInput>('reject'),
  cancel: action<CancelWorkOrderInput>('cancel'),
  reopen: action<ReopenWorkOrderInput>('reopen'),
  addCost: action<WorkOrderCostInput>('costs'),
  removeCost: (id: string, costId: string) =>
    unwrap(http.delete<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}/costs/${costId}`)),
  workload: (restaurantId: string, signal?: AbortSignal) =>
    unwrap(
      http.get<ApiResponse<AssigneeWorkload[]>>('/work-orders/workload', {
        query: { restaurantId },
        signal,
      }),
    ),
  message: action<MessageInput>('messages'),
  messageFiles: (id: string, messageId: string, files: File[]) =>
    unwrap(
      http.post<ApiResponse<WorkOrderDetail>>(
        `/work-orders/${id}/messages/${messageId}/attachments`,
        filesBody(files),
      ),
    ),
  people: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<PersonRef[]>>(`/work-orders/${id}/people`, { signal })),
  rootCause: (id: string, input: RootCauseInput) =>
    unwrap(http.put<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}/root-cause`, input)),
  upload: (id: string, files: File[], meta: { stage?: EvidenceStage; caption?: string } = {}) =>
    unwrap(
      http.post<ApiResponse<WorkOrderDetail>>(
        `/work-orders/${id}/attachments`,
        filesBody(files, {
          ...(meta.stage ? { stage: meta.stage } : {}),
          ...(meta.caption ? { caption: meta.caption } : {}),
        }),
      ),
    ),
  uploadStep: (id: string, itemId: string, files: File[]) =>
    unwrap(
      http.post<ApiResponse<WorkOrderDetail>>(
        `/work-orders/${id}/checklist/${itemId}/attachments`,
        filesBody(files),
      ),
    ),
  addTime: action<ManualTimeInput>('time'),
  removeTime: (id: string, entryId: string) =>
    unwrap(http.delete<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}/time/${entryId}`)),
  reschedule: action<RescheduleWorkOrderInput>('schedule'),
  calendar: (query: CalendarQuery, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<CalendarItem[]>>('/calendar', { query, signal })),
}

export const workKeys = {
  requests: ['requests'] as const,
  requestList: (q: Record<string, QueryValue>) => ['requests', 'list', q] as const,
  request: (id: string) => ['requests', 'detail', id] as const,
  workOrders: ['work-orders'] as const,
  workOrderList: (q: Record<string, QueryValue>) => ['work-orders', 'list', q] as const,
  workOrder: (id: string) => ['work-orders', 'detail', id] as const,
}

/**
 * Everything a work-order change can affect: lists, the record, the worker's
 * home/tasks, the dashboard, and the asset (status, history).
 */
export const WORK_ORDER_EFFECTS = [
  workKeys.workOrders,
  workKeys.requests,
  ['me'],
  ['dashboard'],
  ['assets'],
  ['parts'],
] as const

export function useRequests(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: workKeys.requestList(query),
    queryFn: ({ signal }) => requestsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useRequest(id: string | null) {
  return useQuery({
    queryKey: workKeys.request(id ?? ''),
    queryFn: ({ signal }) => requestsApi.get(id!, signal),
    enabled: !!id,
  })
}

export function useWorkOrders(query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: workKeys.workOrderList(query),
    queryFn: ({ signal }) => workOrdersApi.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useCalendar(query: CalendarQuery, enabled = true) {
  return useQuery({
    queryKey: [...workKeys.workOrders, 'calendar', query],
    queryFn: ({ signal }) => workOrdersApi.calendar(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** Who can take a job in this restaurant, least busy first. */
export function useAssigneeWorkload(restaurantId: string, enabled = true) {
  return useQuery({
    queryKey: [...workKeys.workOrders, 'workload', restaurantId],
    queryFn: ({ signal }) => workOrdersApi.workload(restaurantId, signal),
    enabled: enabled && !!restaurantId,
    staleTime: 15_000,
  })
}

export function useWorkOrder(id: string) {
  return useQuery({
    queryKey: workKeys.workOrder(id),
    queryFn: ({ signal }) => workOrdersApi.get(id, signal),
    // Keeps the worked time and status fresh while the page is open.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

/** Writes a fresh detail into the cache and refreshes everything that depends on it. */
export function useApplyWorkOrder() {
  const qc = useQueryClient()
  return async (w: WorkOrderDetail) => {
    qc.setQueryData(workKeys.workOrder(w.id), w)
    await Promise.all(
      WORK_ORDER_EFFECTS.filter((k) => k !== workKeys.workOrders).map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    )
    // Lists, the calendar, workload and people pickers: everything under
    // 'work-orders' except the record just written (no need to refetch it).
    await qc.invalidateQueries({
      queryKey: workKeys.workOrders,
      predicate: (q) => !(q.queryKey[1] === 'detail' && q.queryKey[2] === w.id),
    })
  }
}

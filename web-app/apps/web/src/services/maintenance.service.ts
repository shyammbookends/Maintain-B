import type {
  ApiResponse,
  InspectionDetail,
  InspectionListItem,
  InspectionTemplateDto,
  InspectionTemplateInput,
  PagedResponse,
  PmScheduleDetail,
  PmScheduleInput,
  PmScheduleListItem,
  ProcedureDetail,
  ProcedureInput,
  ProcedureListItem,
  StartInspectionInput,
  StepAnswerInput,
  WorkOrderDetail,
} from '@maintainx/shared'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { http, type QueryValue } from './http'

const unwrap = <T>(p: Promise<ApiResponse<T>>) => p.then((r) => r.data)

export const pmApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<PmScheduleListItem>>('/pm-schedules', { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<PmScheduleDetail>>(`/pm-schedules/${id}`, { signal })),
  create: (input: PmScheduleInput) =>
    unwrap(http.post<ApiResponse<PmScheduleDetail>>('/pm-schedules', input)),
  update: (id: string, input: PmScheduleInput) =>
    unwrap(http.put<ApiResponse<PmScheduleDetail>>(`/pm-schedules/${id}`, input)),
  setActive: (id: string, active: boolean) =>
    unwrap(http.put<ApiResponse<PmScheduleDetail>>(`/pm-schedules/${id}/active`, { active })),
  generate: (id: string) =>
    unwrap(http.post<ApiResponse<PmScheduleDetail>>(`/pm-schedules/${id}/generate`)),
  archive: (id: string) => http.delete<void>(`/pm-schedules/${id}`),
}

export const proceduresApi = {
  list: (query: Record<string, QueryValue> = {}, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<ProcedureListItem[]>>('/procedures', { query, signal })),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<ProcedureDetail>>(`/procedures/${id}`, { signal })),
  create: (input: ProcedureInput) =>
    unwrap(http.post<ApiResponse<ProcedureDetail>>('/procedures', input)),
  update: (id: string, input: ProcedureInput) =>
    unwrap(http.put<ApiResponse<ProcedureDetail>>(`/procedures/${id}`, input)),
  archive: (id: string) => http.delete<void>(`/procedures/${id}`),
}

export const templatesApi = {
  list: (query: Record<string, QueryValue> = {}, signal?: AbortSignal) =>
    unwrap(
      http.get<ApiResponse<InspectionTemplateDto[]>>('/inspection-templates', { query, signal }),
    ),
  create: (input: InspectionTemplateInput) =>
    unwrap(http.post<ApiResponse<InspectionTemplateDto>>('/inspection-templates', input)),
  update: (id: string, input: InspectionTemplateInput) =>
    unwrap(http.put<ApiResponse<InspectionTemplateDto>>(`/inspection-templates/${id}`, input)),
  archive: (id: string) => http.delete<void>(`/inspection-templates/${id}`),
}

export const inspectionsApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<InspectionListItem>>('/inspections', { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<InspectionDetail>>(`/inspections/${id}`, { signal })),
  start: (input: StartInspectionInput) =>
    unwrap(http.post<ApiResponse<InspectionDetail>>('/inspections', input)),
  answer: (id: string, itemId: string, input: StepAnswerInput) =>
    unwrap(http.put<ApiResponse<InspectionDetail>>(`/inspections/${id}/items/${itemId}`, input)),
  submit: (id: string, notes: string) =>
    unwrap(http.post<ApiResponse<InspectionDetail>>(`/inspections/${id}/submit`, { notes })),
  discard: (id: string) => http.delete<void>(`/inspections/${id}`),
  /** A photo or signature for one step. */
  uploadStep: (id: string, itemId: string, files: File[]) => {
    const body = new FormData()
    for (const f of files) body.append('files', f, f.name)
    return unwrap(
      http.post<ApiResponse<InspectionDetail>>(
        `/inspections/${id}/items/${itemId}/attachments`,
        body,
      ),
    )
  },
}

export const checklistApi = {
  answer: (workOrderId: string, itemId: string, input: StepAnswerInput) =>
    unwrap(
      http.put<ApiResponse<WorkOrderDetail>>(
        `/work-orders/${workOrderId}/checklist/${itemId}`,
        input,
      ),
    ),
}

export const mxKeys = {
  pm: ['pm-schedules'] as const,
  pmList: (q: Record<string, QueryValue>) => ['pm-schedules', 'list', q] as const,
  pmDetail: (id: string) => ['pm-schedules', 'detail', id] as const,
  procedures: ['procedures'] as const,
  procedureList: (q: Record<string, QueryValue>) => ['procedures', 'list', q] as const,
  procedure: (id: string) => ['procedures', 'detail', id] as const,
  templates: ['inspection-templates'] as const,
  templateList: (q: Record<string, QueryValue>) => ['inspection-templates', q] as const,
  inspections: ['inspections'] as const,
  inspectionList: (q: Record<string, QueryValue>) => ['inspections', 'list', q] as const,
  inspection: (id: string) => ['inspections', 'detail', id] as const,
}

export function usePmSchedules(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: mxKeys.pmList(query),
    queryFn: ({ signal }) => pmApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function usePmSchedule(id: string) {
  return useQuery({
    queryKey: mxKeys.pmDetail(id),
    queryFn: ({ signal }) => pmApi.get(id, signal),
  })
}

export function useProcedures(query: Record<string, QueryValue> = {}, enabled = true) {
  return useQuery({
    queryKey: mxKeys.procedureList(query),
    queryFn: ({ signal }) => proceduresApi.list(query, signal),
    enabled,
    staleTime: 30_000,
  })
}

export function useProcedure(id: string | undefined) {
  return useQuery({
    queryKey: mxKeys.procedure(id ?? ''),
    queryFn: ({ signal }) => proceduresApi.get(id!, signal),
    enabled: !!id,
  })
}

export function useInspectionTemplates(query: Record<string, QueryValue> = {}, enabled = true) {
  return useQuery({
    queryKey: mxKeys.templateList(query),
    queryFn: ({ signal }) => templatesApi.list(query, signal),
    enabled,
  })
}

export function useInspections(query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: mxKeys.inspectionList(query),
    queryFn: ({ signal }) => inspectionsApi.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useInspection(id: string) {
  return useQuery({
    queryKey: mxKeys.inspection(id),
    queryFn: ({ signal }) => inspectionsApi.get(id, signal),
  })
}

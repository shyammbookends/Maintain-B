import type {
  ApiResponse,
  CustomFieldDto,
  CustomFieldEntity,
  CustomFieldInput,
  LabelInput,
  LabelWithUsage,
} from '@maintainx/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from './http'

/** Custom fields per entity and the label list, cached for forms and lists. */
export const customKeys = {
  fields: (entity: CustomFieldEntity) => ['custom-fields', entity] as const,
  labels: ['labels'] as const,
}

export function useCustomFields(entity: CustomFieldEntity, enabled = true) {
  return useQuery({
    queryKey: customKeys.fields(entity),
    queryFn: ({ signal }) =>
      http
        .get<ApiResponse<CustomFieldDto[]>>('/custom-fields', { query: { entity }, signal })
        .then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled,
  })
}

export function useLabels(enabled = true) {
  return useQuery({
    queryKey: customKeys.labels,
    queryFn: ({ signal }) =>
      http.get<ApiResponse<LabelWithUsage[]>>('/labels', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled,
  })
}

/** Every call returns the fresh list; it replaces the cache. */
export function useCustomizationApi() {
  const qc = useQueryClient()
  const fields = (entity: CustomFieldEntity) => (r: ApiResponse<CustomFieldDto[]>) => {
    qc.setQueryData(customKeys.fields(entity), r.data)
    return r.data
  }
  const labels = (r: ApiResponse<LabelWithUsage[]>) => {
    qc.setQueryData(customKeys.labels, r.data)
    // Lists show label chips: refresh them.
    void qc.invalidateQueries({ queryKey: ['work-orders'] })
    return r.data
  }
  return {
    createField: (input: CustomFieldInput) =>
      http.post<ApiResponse<CustomFieldDto[]>>('/custom-fields', input).then(fields(input.entity)),
    updateField: (id: string, input: CustomFieldInput) =>
      http
        .put<ApiResponse<CustomFieldDto[]>>(`/custom-fields/${id}`, input)
        .then(fields(input.entity)),
    removeField: (id: string, entity: CustomFieldEntity) =>
      http.delete<ApiResponse<CustomFieldDto[]>>(`/custom-fields/${id}`).then(fields(entity)),
    reorderFields: (entity: CustomFieldEntity, ids: string[]) =>
      http
        .put<ApiResponse<CustomFieldDto[]>>('/custom-fields/order', { ids }, { query: { entity } })
        .then(fields(entity)),
    createLabel: (input: LabelInput) =>
      http.post<ApiResponse<LabelWithUsage[]>>('/labels', input).then(labels),
    updateLabel: (id: string, input: LabelInput) =>
      http.put<ApiResponse<LabelWithUsage[]>>(`/labels/${id}`, input).then(labels),
    removeLabel: (id: string) => http.delete<ApiResponse<LabelWithUsage[]>>(`/labels/${id}`).then(labels),
  }
}

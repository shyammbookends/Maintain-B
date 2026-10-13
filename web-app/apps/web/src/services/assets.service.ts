import type {
  AssetMeterDto,
  MeterInput,
  MeterReadingInput,
  RootCauseDto,
  ApiResponse,
  AssetCategoryDto,
  AssetCategoryInput,
  AssetDetail,
  AssetInput,
  AssetListItem,
  AssetStatusChangeInput,
  AssetTransferInput,
  LocationDto,
  LocationInput,
  LocationLanding,
  PagedResponse,
} from '@maintainx/shared'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { http, type QueryValue } from './http'

const unwrap = <T>(p: Promise<ApiResponse<T>>) => p.then((r) => r.data)

export const locationsApi = {
  list: (restaurantId?: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<LocationDto[]>>('/locations', { query: { restaurantId }, signal })),
  create: (input: LocationInput) =>
    unwrap(http.post<ApiResponse<LocationDto>>('/locations', input)),
  update: (id: string, input: LocationInput) =>
    unwrap(http.put<ApiResponse<LocationDto>>(`/locations/${id}`, input)),
  archive: (id: string) => http.delete<void>(`/locations/${id}`),
  byPublicId: (publicId: string, signal?: AbortSignal) =>
    unwrap(
      http.get<ApiResponse<LocationLanding>>(
        `/locations/by-public/${encodeURIComponent(publicId)}`,
        { signal },
      ),
    ),
}

export const categoriesApi = {
  list: (signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<AssetCategoryDto[]>>('/asset-categories', { signal })),
  create: (input: AssetCategoryInput) =>
    unwrap(http.post<ApiResponse<AssetCategoryDto>>('/asset-categories', input)),
  rename: (id: string, input: AssetCategoryInput) =>
    unwrap(http.put<ApiResponse<AssetCategoryDto>>(`/asset-categories/${id}`, input)),
  archive: (id: string) => http.delete<void>(`/asset-categories/${id}`),
}

export const assetsApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<AssetListItem>>('/assets', { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<AssetDetail>>(`/assets/${id}`, { signal })),
  byPublicId: (publicId: string, signal?: AbortSignal) =>
    unwrap(
      http.get<ApiResponse<AssetDetail>>(`/assets/by-public/${encodeURIComponent(publicId)}`, {
        signal,
      }),
    ),
  create: (input: AssetInput) => unwrap(http.post<ApiResponse<AssetDetail>>('/assets', input)),
  update: (id: string, input: AssetInput) =>
    unwrap(http.put<ApiResponse<AssetDetail>>(`/assets/${id}`, input)),
  changeStatus: (id: string, input: AssetStatusChangeInput) =>
    unwrap(http.put<ApiResponse<AssetDetail>>(`/assets/${id}/status`, input)),
  transfer: (id: string, input: AssetTransferInput) =>
    unwrap(http.post<ApiResponse<AssetDetail>>(`/assets/${id}/transfer`, input)),
  archive: (id: string) => http.delete<void>(`/assets/${id}`),
}

/** Meters, readings and root causes on an asset. */
export const metersApi = {
  list: (assetId: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<AssetMeterDto[]>>(`/assets/${assetId}/meters`, { signal })),
  create: (assetId: string, input: MeterInput) =>
    unwrap(http.post<ApiResponse<AssetMeterDto[]>>(`/assets/${assetId}/meters`, input)),
  update: (assetId: string, meterId: string, input: MeterInput) =>
    unwrap(http.put<ApiResponse<AssetMeterDto[]>>(`/assets/${assetId}/meters/${meterId}`, input)),
  archive: (assetId: string, meterId: string) =>
    unwrap(http.delete<ApiResponse<AssetMeterDto[]>>(`/assets/${assetId}/meters/${meterId}`)),
  read: (assetId: string, meterId: string, input: MeterReadingInput) =>
    unwrap(
      http.post<ApiResponse<AssetMeterDto[]>>(
        `/assets/${assetId}/meters/${meterId}/readings`,
        input,
      ),
    ),
  rootCauses: (assetId: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<RootCauseDto[]>>(`/assets/${assetId}/root-causes`, { signal })),
}

export const assetKeys = {
  all: ['assets'] as const,
  list: (q: Record<string, QueryValue>) => ['assets', 'list', q] as const,
  detail: (id: string) => ['assets', 'detail', id] as const,
  categories: ['asset-categories'] as const,
  locations: (restaurantId?: string) => ['locations', restaurantId ?? 'all'] as const,
  locationsAll: ['locations'] as const,
}

export function useAssets(query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: assetKeys.list(query),
    queryFn: ({ signal }) => assetsApi.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * True only when `id` is surely not one of the listed assets: the page holds the
 * whole list. Pickers load the first 100 assets, so a chosen asset beyond that
 * must be kept, not silently cleared (that dropped the asset from edited jobs).
 */
export function assetMissingFrom(page: PagedResponse<AssetListItem>, id: string): boolean {
  return page.meta.total <= page.data.length && !page.data.some((a) => a.id === id)
}

export function useAsset(id: string) {
  return useQuery({
    queryKey: assetKeys.detail(id),
    queryFn: ({ signal }) => assetsApi.get(id, signal),
    enabled: !!id,
  })
}

export function useAssetCategories() {
  return useQuery({
    queryKey: assetKeys.categories,
    queryFn: ({ signal }) => categoriesApi.list(signal),
    staleTime: 60_000,
  })
}

export function useLocations(restaurantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: assetKeys.locations(restaurantId),
    queryFn: ({ signal }) => locationsApi.list(restaurantId, signal),
    enabled,
    staleTime: 30_000,
  })
}

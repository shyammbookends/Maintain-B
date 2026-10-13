import type {
  ApiResponse,
  PagedResponse,
  WorkerHome,
  WorkerRestaurant,
  WorkerSchedule,
  WorkerTask,
  WorkerTaskView,
} from '@maintainx/shared'
import { keepPreviousData, queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { http } from './http'

/** Worker app data. Tasks are always the signed-in worker's own (the API enforces it). */

const PAGE_SIZE = 20

export const workerKeys = {
  all: ['me'] as const,
  home: ['me', 'home'] as const,
  tasks: (view: WorkerTaskView) => ['me', 'tasks', view] as const,
  schedule: ['me', 'schedule'] as const,
  restaurants: ['me', 'restaurants'] as const,
}

// Workers glance at these on the floor: refresh on focus and every couple of minutes.
const live = { refetchOnWindowFocus: true, refetchInterval: 120_000, staleTime: 20_000 }

export const workerHomeQuery = queryOptions({
  queryKey: workerKeys.home,
  queryFn: ({ signal }) =>
    http.get<ApiResponse<WorkerHome>>('/me/home', { signal }).then((r) => r.data),
  ...live,
})

export function useWorkerHome() {
  return useQuery(workerHomeQuery)
}

/** Optional narrowing for My Work. */
export interface WorkerTaskFilters {
  priority?: string
  restaurantId?: string
  pm?: '1'
}

export function useWorkerTasks(view: WorkerTaskView, filters: WorkerTaskFilters = {}) {
  return useInfiniteQuery({
    queryKey: [...workerKeys.tasks(view), filters],
    queryFn: ({ pageParam, signal }) =>
      http.get<PagedResponse<WorkerTask>>('/me/tasks', {
        query: { view, ...filters, page: pageParam, pageSize: PAGE_SIZE },
        signal,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    placeholderData: keepPreviousData,
    ...live,
  })
}

export function useWorkerSchedule() {
  return useQuery({
    queryKey: workerKeys.schedule,
    queryFn: ({ signal }) =>
      http
        .get<ApiResponse<WorkerSchedule>>('/me/schedule', { query: { days: 14 }, signal })
        .then((r) => r.data),
    ...live,
  })
}

export function useWorkerRestaurants() {
  return useQuery({
    queryKey: workerKeys.restaurants,
    queryFn: ({ signal }) =>
      http.get<ApiResponse<WorkerRestaurant[]>>('/me/restaurants', { signal }).then((r) => r.data),
    staleTime: 60_000,
  })
}

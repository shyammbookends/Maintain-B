import type { RouteObject } from 'react-router'
import type { LayoutRouteHandle } from '@/layouts/navigation'
import { RouteErrorPage } from '@/pages/RouteErrorPage'

/** Dev-only component gallery at /design (see routes/index.tsx). */
export const designRoutes: RouteObject[] = [
  {
    path: '/design',
    errorElement: <RouteErrorPage />,
    lazy: async () => ({ Component: (await import('@/pages/dev/design/DesignShell')).DesignShell }),
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('@/pages/dev/design/FoundationsPage')).FoundationsPage,
        }),
      },
      {
        path: 'components',
        lazy: async () => ({
          Component: (await import('@/pages/dev/design/ComponentsPage')).ComponentsPage,
        }),
      },
      {
        path: 'forms',
        lazy: async () => ({ Component: (await import('@/pages/dev/design/FormsPage')).FormsPage }),
      },
      {
        path: 'data-table',
        lazy: async () => ({
          Component: (await import('@/pages/dev/design/DataTablePage')).DataTablePage,
        }),
      },
      {
        path: 'overlays',
        lazy: async () => ({
          Component: (await import('@/pages/dev/design/OverlaysPage')).OverlaysPage,
        }),
      },
      {
        path: 'feedback',
        lazy: async () => ({
          Component: (await import('@/pages/dev/design/FeedbackPage')).FeedbackPage,
        }),
      },
    ],
  },
  {
    path: '/design/worker',
    errorElement: <RouteErrorPage />,
    lazy: async () => ({
      Component: (await import('@/pages/dev/design/worker/WorkerPreviewShell')).WorkerPreviewShell,
    }),
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('@/pages/dev/design/worker/WorkerHomePreview'))
            .WorkerHomePreview,
        }),
      },
      {
        path: 'tasks',
        lazy: async () => ({
          Component: (await import('@/pages/dev/design/worker/WorkerTasksPreview'))
            .WorkerTasksPreview,
        }),
      },
      {
        path: 'tasks/:taskId',
        handle: { hideWorkerNav: true } satisfies LayoutRouteHandle,
        lazy: async () => ({
          Component: (await import('@/pages/dev/design/worker/WorkerTaskPreview'))
            .WorkerTaskPreview,
        }),
      },
      {
        path: ':section',
        lazy: async () => ({
          Component: (await import('@/pages/dev/design/worker/WorkerEmptyPreview'))
            .WorkerEmptyPreview,
        }),
      },
    ],
  },
]

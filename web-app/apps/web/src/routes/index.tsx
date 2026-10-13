import { RouterProvider, createBrowserRouter } from 'react-router'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { appRoutes } from './app.routes'
import { designRoutes } from './design.routes'

const router = createBrowserRouter([
  ...appRoutes,
  // Component gallery: development builds only. The branch is removed from
  // production bundles because import.meta.env.DEV is statically `false` there.
  ...(import.meta.env.DEV ? designRoutes : []),
  { path: '*', element: <NotFoundPage /> },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}

import type { AuthUser } from '@maintainx/shared'
import { rememberedRestaurantId } from '@/contexts/RestaurantScopeContext'
import { startSessionRestore } from '@/services/auth.service'
import { dashboardQuery } from '@/services/dashboard.service'
import { workerHomeQuery } from '@/services/worker.service'
import { queryClient } from './query-client'

/**
 * Runs once, before React's first render: asks for the session right away and,
 * as soon as it is back, the home screen's data. Both then load in parallel with
 * the page's code instead of after it (the screens use the same queries, so
 * nothing is fetched twice).
 */
export function startUp(): void {
  startSessionRestore()
    .then((session) => {
      if (session) prefetchHome(session.user)
    })
    // A failed restore is shown by the auth provider.
    .catch(() => undefined)
}

function prefetchHome(user: AuthUser): void {
  if (user.mustChangePassword) return
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/' && user.roleKind === 'ADMIN') {
    // Same rule as the admin home (AdminIndex).
    if (user.isSuperAdmin || user.permissions.includes('dashboard:view'))
      void queryClient.prefetchQuery(dashboardQuery(rememberedRestaurantId(user)))
  } else if (path === '/w' && user.roleKind === 'WORKER') {
    void queryClient.prefetchQuery(workerHomeQuery)
  }
}

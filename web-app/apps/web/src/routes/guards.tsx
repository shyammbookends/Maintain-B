import type { Permission, RoleKind } from '@maintainx/shared'
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { FullPageLoader, OfflineScreen } from '@/components/common/FullPageStatus'
import { useAuth } from '@/contexts/AuthContext'
import { ForbiddenPage } from '@/pages/ForbiddenPage'
import { homePath, safeRedirect } from '@/utils/redirect'

/**
 * Route guards. They control what the UI shows; the API independently
 * enforces authentication and permissions on every request.
 */

/** Signed-in users only. Sends others to /login and remembers where they were going. */
export function RequireAuth() {
  const { status, user, retry, signedOutReason } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageLoader />
  if (status === 'offline') return <OfflineScreen onRetry={retry} />
  if (status === 'anonymous' || !user) {
    const target = `${location.pathname}${location.search}`
    const params = new URLSearchParams()
    if (target !== '/') params.set('redirect', target)
    if (signedOutReason === 'expired') params.set('expired', '1')
    const qs = params.toString()
    return <Navigate to={`/login${qs ? `?${qs}` : ''}`} replace />
  }
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <Outlet />
}

/** Keeps admins in the admin app and workers in the worker app. */
export function RequireRoleKind({ kind }: { kind: RoleKind }) {
  const { user } = useAuth()
  if (!user) return null
  if (user.roleKind !== kind) return <Navigate to={homePath(user)} replace />
  return <Outlet />
}

/** Sign-in page: already signed-in users go straight to where they were heading. */
export function GuestOnly() {
  const { status, user, retry } = useAuth()
  const [params] = useSearchParams()

  if (status === 'loading') return <FullPageLoader />
  if (status === 'offline') return <OfflineScreen onRetry={retry} />
  if (status === 'authenticated' && user) {
    if (user.mustChangePassword) return <Navigate to="/change-password" replace />
    return <Navigate to={safeRedirect(params.get('redirect')) ?? homePath(user)} replace />
  }
  return <Outlet />
}

/** Permission-gated route: shows a friendly "no access" page instead of an empty screen. */
export function RequirePermission({ permission }: { permission: Permission }) {
  const { can } = useAuth()
  if (!can(permission)) return <ForbiddenPage />
  return <Outlet />
}

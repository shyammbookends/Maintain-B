import type { Permission } from '@maintainx/shared'
import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Renders children only when the user holds the permission. Cosmetic: the API
 * enforces the same rule, this just hides controls that would be refused.
 */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission
  children: ReactNode
  fallback?: ReactNode
}) {
  const { can } = useAuth()
  return <>{can(permission) ? children : fallback}</>
}

import type { Permission } from '@maintainx/shared'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  key: string
  label: string
  to: string
  icon: LucideIcon
  /** Exact-match active state (for index routes like "/"). */
  end?: boolean
  /** Small count shown next to the label (e.g. unread notifications). */
  badge?: number
  /** Item is shown only when the user holds this permission. */
  permission?: Permission
}

export interface NavGroup {
  key: string
  label?: string
  items: NavItem[]
  /** Folded away by default (opens itself when one of its pages is active). */
  collapsible?: boolean
}

/** Remove items the user can't access, then drop groups that became empty. */
export function filterNavigation(
  groups: readonly NavGroup[],
  can: (permission: Permission) => boolean,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(item.permission)),
    }))
    .filter((group) => group.items.length > 0)
}

/** Route `handle` fields understood by the layouts. */
export interface LayoutRouteHandle {
  /** Worker shell: hide the bottom tab bar (focused flows like executing a task). */
  hideWorkerNav?: boolean
}

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'

/**
 * The top-bar restaurant switcher pre-filters a list page (still changeable
 * there). On arrival the scope fills an empty restaurant filter; switching the
 * scope while on the page moves the filter with it (to the new restaurant, or
 * cleared for "All restaurants").
 */
export function useScopeRestaurantFilter(
  current: string | undefined,
  setFilter: (restaurantId: string | undefined) => void,
): void {
  const { restaurantId } = useRestaurantScope()
  const previous = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const before = previous.current
    previous.current = restaurantId
    if (before === undefined) {
      if (restaurantId && !current) setFilter(restaurantId)
      return
    }
    if (before !== restaurantId && current !== (restaurantId ?? undefined))
      setFilter(restaurantId ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the scope changes
  }, [restaurantId])
}

/**
 * `?restaurantId=` for pages without a table (reports, analytics, calendar):
 * defaults to the top-bar scope. An empty value means "All restaurants" was
 * picked on the page, so the scope doesn't silently put its restaurant back.
 */
export function useScopedRestaurantParam(): [
  string | undefined,
  (restaurantId: string | undefined) => void,
] {
  const scope = useRestaurantScope()
  const [params, setParams] = useSearchParams()
  const raw = params.get('restaurantId')
  const restaurantId = raw !== null ? raw || undefined : (scope.restaurantId ?? undefined)
  const set = (id: string | undefined) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('restaurantId', id)
        else if (scope.restaurantId) next.set('restaurantId', '')
        else next.delete('restaurantId')
        return next
      },
      { replace: true },
    )
  return [restaurantId, set]
}

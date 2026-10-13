import type { AuthUser } from '@maintainx/shared'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

/**
 * Which restaurant the admin is looking at: one restaurant or all of theirs
 * (`null`). Remembered per user on this device; ignored if the user no longer
 * has access to it. The API re-checks scope on every request.
 */
interface RestaurantScopeValue {
  restaurantId: string | null
  setRestaurantId(id: string | null): void
}

const Ctx = createContext<RestaurantScopeValue | null>(null)

const storageKey = (userId: string) => `mx.scope.${userId}`

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Storage unavailable: selection just isn't remembered.
  }
}

/** The restaurant this user last picked on this device, if they can still see it. */
export function rememberedRestaurantId(user: AuthUser): string | null {
  const stored = read(storageKey(user.id))
  return stored && user.restaurants.some((r) => r.id === stored) ? stored : null
}

export function RestaurantScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const key = user ? storageKey(user.id) : null
  const [stored, setStored] = useState<string | null>(() => (key ? read(key) : null))

  const allowed = useMemo(() => new Set(user?.restaurants.map((r) => r.id) ?? []), [user])
  const restaurantId = stored && allowed.has(stored) ? stored : null

  const setRestaurantId = useCallback(
    (id: string | null) => {
      setStored(id)
      if (key) write(key, id)
    },
    [key],
  )

  const value = useMemo(() => ({ restaurantId, setRestaurantId }), [restaurantId, setRestaurantId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRestaurantScope(): RestaurantScopeValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRestaurantScope must be used inside <RestaurantScopeProvider>')
  return ctx
}

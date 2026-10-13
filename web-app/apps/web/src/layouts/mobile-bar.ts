import { matchPath } from 'react-router'
import {
  createContext,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

/**
 * Lets the page's <PageHeader> put its title (and back link) into the phone
 * app bar, like a Flutter AppBar. Only the phone app bar reads it; on desktop
 * nothing subscribes, so nothing changes.
 */
export interface MobileBarState {
  title: ReactNode
  back?: string
}

export class MobileBarStore {
  private value: MobileBarState | null = null
  private listeners = new Set<() => void>()
  get = () => this.value
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  set(v: MobileBarState | null) {
    this.value = v
    for (const l of this.listeners) l()
  }
}

export const MobileBarContext = createContext<MobileBarStore | null>(null)

/** Called by PageHeader: publishes the title while the page is shown. */
export function usePublishMobileBar(title: ReactNode, back?: string) {
  const store = useContext(MobileBarContext)
  useLayoutEffect(() => {
    if (!store) return
    const v = { title, back }
    store.set(v)
    return () => {
      if (store.get() === v) store.set(null)
    }
  }, [store, title, back])
}

export function useMobileBar(store: MobileBarStore) {
  return useSyncExternalStore(store.subscribe, store.get, () => null)
}

/** Whether a path is a tab's root screen (Flutter shows the chat button only there). */
export function isTabRoot(pathname: string, roots: string[]) {
  return roots.some((r) => matchPath({ path: r, end: true }, pathname))
}

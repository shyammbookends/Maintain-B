import { useSyncExternalStore } from 'react'
import { offlineStatus } from '@/services/offline'

/** Connection state, queued changes and failed syncs. */
export function useOfflineStatus() {
  return useSyncExternalStore(offlineStatus.subscribe, offlineStatus.get, offlineStatus.get)
}

import type { TFunction } from 'i18next'
import { toast } from '@/components/ui/toaster'
import { ApiError } from '@/services/http'

/** Human-readable, translated message for any thrown value. Never exposes internals. */
export function describeError(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    return t(`errors.${error.code}`, { defaultValue: error.message })
  }
  return t('errors.INTERNAL_ERROR')
}

/** The change was kept on the device and will be sent when the connection returns. */
export const isQueuedOffline = (error: unknown) =>
  error instanceof ApiError && error.code === 'QUEUED_OFFLINE'

/**
 * Tells the user an action failed — or, when it was only queued offline, that
 * it is safely stored and will sync (an information toast, not an error).
 */
export function reportError(error: unknown, t: TFunction): void {
  if (isQueuedOffline(error)) toast.info(t('offline.queued'))
  else toast.error(describeError(error, t))
}

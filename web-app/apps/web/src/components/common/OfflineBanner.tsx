import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { dismissFailed, flushQueue, setOnSynced, startOfflineSync } from '@/services/offline'
import { useOfflineStatus } from '@/hooks/useOfflineStatus'
import { formatDateTime } from '@/utils/format'

/** Starts background sync once; refreshes every screen after queued changes are sent. */
export function OfflineSync() {
  const qc = useQueryClient()
  useEffect(() => {
    setOnSynced(() => void qc.invalidateQueries())
    const stop = startOfflineSync()
    return () => {
      setOnSynced(null)
      stop()
    }
  }, [qc])
  return null
}

/**
 * A strip above the page when the device is offline, changes are waiting to
 * be sent, or some could not be saved.
 */
export function OfflineBanner() {
  const { t } = useTranslation()
  const s = useOfflineStatus()
  const [details, setDetails] = useState(false)
  if (s.online && s.pending === 0 && s.failed.length === 0) return null
  return (
    <>
      <div
        role="status"
        className={
          s.failed.length
            ? 'flex flex-wrap items-center gap-2 bg-danger-soft px-4 py-2 text-13 text-danger-fg'
            : 'flex flex-wrap items-center gap-2 bg-warning-soft px-4 py-2 text-13 text-warning-fg'
        }
      >
        {s.failed.length ? (
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
        ) : s.syncing ? (
          <RefreshCw className="size-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <CloudOff className="size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          {!s.online
            ? t('offline.offline', { count: s.pending })
            : s.syncing
              ? t('offline.syncing', { count: s.pending })
              : s.pending > 0
                ? t('offline.waiting', { count: s.pending })
                : null}
          {s.failed.length > 0 && ` ${t('offline.failed', { count: s.failed.length })}`}
        </span>
        {s.online && s.pending > 0 && !s.syncing && (
          <Button size="sm" variant="secondary" onClick={() => void flushQueue()}>
            {t('offline.syncNow')}
          </Button>
        )}
        {s.failed.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setDetails(true)}>
            {t('offline.details')}
          </Button>
        )}
      </div>
      <Dialog open={details} onOpenChange={setDetails}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('offline.failedTitle')}</DialogTitle>
            <DialogDescription>{t('offline.failedBody')}</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2">
            {s.failed.map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <span className="min-w-0 flex-1 text-13">
                  <span className="block font-medium">
                    {t(`offline.action_${actionOf(f.path)}`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(new Date(f.createdAt).toISOString())} ·{' '}
                    {t(`errors.${f.error}`, { defaultValue: f.error })}
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void dismissFailed(f.id)}>
                  {t('offline.dismiss')}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                void dismissFailed()
                setDetails(false)
              }}
            >
              {t('offline.dismissAll')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A short name for a queued request, for the "could not be saved" list. */
function actionOf(path: string) {
  if (/\/checklist\//.test(path)) return 'checklist'
  if (/\/attachments$/.test(path)) return 'photo'
  if (/\/messages$/.test(path)) return 'message'
  if (/\/parts$/.test(path)) return 'part'
  if (/\/readings$/.test(path)) return 'reading'
  if (/\/inspections\//.test(path)) return 'inspection'
  if (/^\/requests$/.test(path)) return 'request'
  return 'status'
}

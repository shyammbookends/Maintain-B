import { WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/** Shown while the session is being restored on start-up. */
export function FullPageLoader() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <Spinner className="size-6 text-muted-foreground" label={t('common.loading')} />
    </div>
  )
}

/** Start-up couldn't reach the API. We don't know if the user is signed in, so don't bounce them to login. */
export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-background text-muted-foreground">
        <WifiOff className="size-5" aria-hidden />
      </div>
      <h1 className="text-base font-semibold">{t('auth.offlineTitle')}</h1>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('auth.offlineBody')}</p>
      <Button className="mt-5" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </main>
  )
}

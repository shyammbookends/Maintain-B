import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useRouteError } from 'react-router'
import { reloadForStaleBuild } from '@/utils/chunk-reload'

/** Shown when a lazy route fails to load (e.g. a stale deploy) or a render error escapes. */
export function RouteErrorPage() {
  const { t } = useTranslation()
  const error = useRouteError()
  if (import.meta.env.DEV) console.error(error)
  // A lazy page from an older deploy: load the new build instead of showing an error.
  useEffect(() => {
    reloadForStaleBuild(error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">{t('routeError.title')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('routeError.body')}</p>
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('common.retry')}
        </button>
        <Link
          to="/"
          className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
        >
          {t('common.backHome')}
        </Link>
      </div>
    </main>
  )
}

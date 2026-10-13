import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">404</p>
      <h1 className="mt-2 text-xl font-semibold">{t('notFound.title')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('notFound.body')}</p>
      <Link
        to="/"
        className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('common.backHome')}
      </Link>
    </main>
  )
}

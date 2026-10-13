import { ShieldOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export function ForbiddenPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-background text-muted-foreground">
        <ShieldOff className="size-5" aria-hidden />
      </div>
      <h1 className="text-base font-semibold">{t('forbidden.title')}</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('forbidden.body')}</p>
      <Button asChild variant="secondary" size="sm" className="mt-4">
        <Link to="/">{t('common.backHome')}</Link>
      </Button>
    </div>
  )
}

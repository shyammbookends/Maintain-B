import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/services/http'
import { cn } from '@/utils/cn'
import { describeError } from '@/utils/errors'

interface ErrorStateProps {
  error: unknown
  onRetry?: () => void
  title?: ReactNode
  retrying?: boolean
  compact?: boolean
  className?: string
}

/**
 * Failed-to-load state. Human message (translated from the error code), a
 * retry, and the request reference for support — never a stack trace.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  retrying,
  compact,
  className,
}: ErrorStateProps) {
  const { t } = useTranslation()
  const requestId = error instanceof ApiError ? error.requestId : undefined

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-danger/25 bg-danger-soft text-danger-fg">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-foreground">{title ?? t('feedback.loadFailed')}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{describeError(error, t)}</p>
      {requestId && (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {t('common.reference', { id: requestId })}
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry} loading={retrying}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}

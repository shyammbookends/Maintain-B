import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { cn } from '@/utils/cn'

interface WorkerPageHeaderProps {
  title: ReactNode
  /** Back target; renders a 44px back button. */
  backTo?: string
  actions?: ReactNode
  className?: string
}

/** Sticky app bar for worker screens. Title is the page's <h1>. */
export function WorkerPageHeader({ title, backTo, actions, className }: WorkerPageHeaderProps) {
  const { t } = useTranslation()
  return (
    <header
      data-m="w-header"
      className={cn(
        'glass sticky top-0 z-20 flex h-14 items-center gap-1 border-b px-2 lg:h-16 lg:px-6',
        !backTo && 'px-4',
        className,
      )}
    >
      {backTo && (
        <Link
          to={backTo}
          aria-label={t('actions.back')}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
      )}
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold lg:text-xl lg:tracking-tight">
        {title}
      </h1>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  )
}

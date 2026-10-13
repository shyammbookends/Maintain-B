import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/cn'

/** Product mark + name. Swap the icon for a real logo when available. */
export function BrandMark({ className, subtitle }: { className?: string; subtitle?: string }) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="bg-brand flex size-8 items-center justify-center rounded-lg shadow-[0_4px_12px_-4px_oklch(0.45_0.18_270/0.6)]">
        <Wrench className="size-4" aria-hidden />
      </span>
      <span className="grid leading-tight">
        <span className="text-sm font-semibold text-foreground">{t('app.name')}</span>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </div>
  )
}

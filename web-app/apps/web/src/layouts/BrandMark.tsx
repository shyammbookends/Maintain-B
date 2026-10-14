import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/cn'

/** The Bookends "B with a wrench" logo (rounded square). */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src="/icons/logo.png"
      alt=""
      aria-hidden
      draggable={false}
      className={cn('size-8 shrink-0 select-none', className)}
    />
  )
}

/** Product mark + name. */
export function BrandMark({ className, subtitle }: { className?: string; subtitle?: string }) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <BrandLogo className="drop-shadow-[0_4px_12px_oklch(0.45_0.18_270/0.35)]" />
      <span className="grid leading-tight">
        <span className="text-sm font-semibold text-foreground">{t('app.name')}</span>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </div>
  )
}

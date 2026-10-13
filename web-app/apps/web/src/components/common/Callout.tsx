import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/utils/cn'

type CalloutTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const TONE: Record<CalloutTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: 'border-info/25 bg-info-soft', icon: 'text-info-fg', Icon: Info },
  success: {
    box: 'border-success/25 bg-success-soft',
    icon: 'text-success-fg',
    Icon: CheckCircle2,
  },
  warning: {
    box: 'border-warning/40 bg-warning-soft',
    icon: 'text-warning-fg',
    Icon: AlertTriangle,
  },
  danger: { box: 'border-danger/25 bg-danger-soft', icon: 'text-danger-fg', Icon: XCircle },
  neutral: { box: 'border-border bg-muted', icon: 'text-muted-foreground', Icon: Info },
}

interface CalloutProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: CalloutTone
  title?: ReactNode
  action?: ReactNode
  icon?: LucideIcon
}

/** Inline notice inside a page or form. For transient confirmations use a toast instead. */
export function Callout({
  tone = 'info',
  title,
  action,
  icon,
  children,
  className,
  ...props
}: CalloutProps) {
  const style = TONE[tone]
  const Icon = icon ?? style.Icon
  return (
    <div
      className={cn('flex gap-3 rounded-md border px-3 py-2.5 text-sm', style.box, className)}
      {...props}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', style.icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children && <div className={cn('text-foreground/80', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

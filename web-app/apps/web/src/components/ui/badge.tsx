import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/utils/cn'

export const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'bg-neutral-soft text-neutral-fg',
        info: 'bg-info-soft text-info-fg',
        warning: 'bg-warning-soft text-warning-fg',
        success: 'bg-success-soft text-success-fg',
        danger: 'bg-danger-soft text-danger-fg',
        review: 'bg-review-soft text-review-fg',
        outline: 'border border-border bg-background text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>

export const TONE_DOT_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-neutral',
  info: 'bg-info',
  warning: 'bg-warning',
  success: 'bg-success',
  danger: 'bg-danger',
  review: 'bg-review',
  outline: 'bg-border-strong',
}

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  /** Small leading dot in the tone's solid colour. */
  dot?: boolean
}

export function Badge({ className, tone, dot = false, children, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      data-tone={tone ?? 'neutral'}
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    >
      {dot && (
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full', TONE_DOT_CLASS[tone ?? 'neutral'])}
        />
      )}
      {children}
    </span>
  )
}

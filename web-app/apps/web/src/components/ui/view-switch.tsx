import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface ViewSwitchProps<V extends string> {
  value: V
  onValueChange: (value: V) => void
  options: ReadonlyArray<{ value: V; label: ReactNode }>
  /** Names the group for screen readers. */
  label: string
  className?: string
}

/**
 * Looks like tabs, behaves like a filter: switches which records a list shows
 * without separate tab panels (so no dangling aria-controls). Toggle buttons
 * with aria-pressed inside a labelled group.
 */
export function ViewSwitch<V extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: ViewSwitchProps<V>) {
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="view-switch"
      className={cn('flex items-center gap-4 overflow-x-auto border-b', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(o.value)}
            className={cn(
              '-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-0.5 text-sm font-medium whitespace-nowrap',
              'transition-colors duration-(--duration-fast) hover:text-foreground',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

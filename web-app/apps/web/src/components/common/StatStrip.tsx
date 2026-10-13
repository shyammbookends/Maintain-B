import type { LucideIcon } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface Stat {
  label: string
  value: string
  icon?: LucideIcon
  /** Small line under the value. */
  hint?: string
}

/** A row of labelled numbers (no chart needed for single values). */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3 shadow-card sm:grid-cols-4',
        className,
      )}
    >
      {stats.map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {s.icon && <s.icon className="size-3.5 shrink-0" aria-hidden />} {s.label}
          </dt>
          <dd className="truncate text-sm font-semibold tabular">{s.value}</dd>
          {s.hint && <dd className="truncate text-xs text-muted-foreground">{s.hint}</dd>}
        </div>
      ))}
    </dl>
  )
}

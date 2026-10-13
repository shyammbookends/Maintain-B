import type { LabelDto } from '@maintainx/shared'
import { cn } from '@/utils/cn'
import { LABEL_COLOR_CLASS, LABEL_SWATCH_CLASS } from './label-colors'

/** A work order label (custom category) as a small coloured chip. */
export function LabelChip({ label, className }: { label: LabelDto; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-40 items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        LABEL_COLOR_CLASS[label.color],
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', LABEL_SWATCH_CLASS[label.color])} aria-hidden />
      <span className="truncate">{label.name}</span>
    </span>
  )
}

export function LabelList({ labels, className }: { labels: LabelDto[]; className?: string }) {
  if (labels.length === 0) return null
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {labels.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
    </span>
  )
}

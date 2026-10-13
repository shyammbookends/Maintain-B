import type { Priority, WorkOrderStatus } from '@maintainx/shared'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { StatusBadge } from '@/components/common/StatusBadge'
import { MTaskCard } from '@/components/mobile/MTaskCard'
import { usePhone } from '@/hooks/usePhone'
import { cn } from '@/utils/cn'
import { DUE_TONE_CLASS, describeDue, type DateInput } from '@/utils/format'

export interface TaskCardProps {
  /** Task page. Without it the card is informational (not tappable). */
  to?: string
  code: string
  title: string
  restaurant: string
  location?: string | null
  asset?: string | null
  priority: Priority
  status: WorkOrderStatus
  dueDate?: DateInput | null
  /** Extra line under the details, e.g. which team the task came through. */
  note?: ReactNode
  now?: Date
  className?: string
}

/**
 * One task in the worker's list. When linked, the whole row is the tap target.
 * Priority is only shown when it matters (High / Critical) to keep the list calm.
 */
export function TaskCard({
  to,
  code,
  title,
  restaurant,
  location,
  asset,
  priority,
  status,
  dueDate,
  note,
  now,
  className,
}: TaskCardProps) {
  const { t } = useTranslation()
  const phone = usePhone()
  if (phone)
    return (
      <MTaskCard
        to={to}
        code={code}
        title={title}
        where={[asset, location, restaurant]}
        priority={priority}
        status={status}
        dueDate={dueDate}
        team={typeof note === 'string' ? note : null}
      />
    )
  const due = dueDate ? describeDue(dueDate, t, now) : null
  const where = [restaurant, location].filter(Boolean).join(' · ')
  const showPriority = priority === 'HIGH' || priority === 'CRITICAL'
  const done = status === 'COMPLETED' || status === 'REVIEW' || status === 'CLOSED'

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular">{code}</span>
          <StatusBadge kind="workOrderStatus" value={status} />
        </div>
        <p className="mt-1 line-clamp-2 text-base leading-snug font-medium text-foreground">
          {title}
        </p>
        <p className="mt-0.5 truncate text-13 text-muted-foreground">
          {asset ? `${asset} · ${where}` : where}
        </p>
        {(showPriority || (due && !done)) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            {showPriority && <StatusBadge kind="priority" value={priority} />}
            {due && !done && (
              <span className={cn('text-13 font-medium', DUE_TONE_CLASS[due.tone])}>
                {due.label}
              </span>
            )}
          </div>
        )}
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
      {to && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  )

  const classes = cn(
    'flex h-full items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-card',
    priority === 'CRITICAL' && !done && 'border-l-[3px] border-l-danger',
    className,
  )

  // Hooks for mobile.css (status stripe, entrance and press effects).
  const hooks = { 'data-m': 'task-card', 'data-priority': priority, 'data-done': done || undefined }
  if (!to)
    return (
      <div {...hooks} className={classes}>
        {body}
      </div>
    )
  return (
    <Link
      {...hooks}
      to={to}
      className={cn(
        classes,
        'card-lift active:bg-muted/60',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      {body}
    </Link>
  )
}

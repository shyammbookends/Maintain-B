import type { Priority, WorkOrderStatus, WorkOrderType } from '@maintainx/shared'
import { AlarmClock, CalendarDays, CircleDot, MapPin, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/common/StatusBadge'
import { describeDue, type DateInput } from '@/utils/format'
import { cn } from '@/utils/cn'
import { AppCard, MAvatar, MPill } from './kit'
import { TONE_ACCENT, TONE_SOFT, alpha, type MTone } from './tones'

const PRIORITY_TONE: Record<Priority, MTone> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'neutral',
}

const DONE: WorkOrderStatus[] = ['COMPLETED', 'REVIEW', 'VERIFIED', 'CLOSED', 'CANCELLED']

export interface MTaskCardProps {
  to?: string
  onClick?: () => void
  code: string
  title: string
  /** asset · location · restaurant */
  where: Array<string | null | undefined>
  priority: Priority
  status: WorkOrderStatus
  type?: WorkOrderType
  dueDate?: DateInput | null
  overdue?: boolean
  /** Shown on the right of the last row (admin lists). */
  assignee?: { initials: string; name: string } | null
  /** Team text when nobody is assigned, or "via team" for workers. */
  team?: string | null
  extra?: ReactNode
}

/** Task card used by every work order list on a phone — Flutter `TaskCard`. */
export function MTaskCard({
  to,
  onClick,
  code,
  title,
  where,
  priority,
  status,
  type,
  dueDate,
  overdue,
  assignee,
  team,
  extra,
}: MTaskCardProps) {
  const { t } = useTranslation()
  const active = !DONE.includes(status)
  const due = active && dueDate ? describeDue(dueDate, t) : null
  const isOverdue = overdue ?? due?.overdue ?? false
  const place = where.filter(Boolean).join(' · ')
  const dueColor = isOverdue
    ? TONE_SOFT.danger.fg
    : due?.tone === 'warning'
      ? TONE_SOFT.warning.fg
      : '#64748b'
  return (
    <AppCard
      to={to}
      onClick={onClick}
      padding="p-0"
      borderColor={isOverdue && active ? alpha('#e11d48', 0.35) : undefined}
      className="h-full"
      label={`${code} ${title}`}
    >
      <span className="flex h-full" data-m="task-card-body">
        <span
          aria-hidden
          className="w-1.25 shrink-0"
          style={{ background: TONE_ACCENT[PRIORITY_TONE[priority]] }}
        />
        <span className="block min-w-0 flex-1 px-3.5 py-3.25">
          <span className="flex items-center gap-1.5">
            <span className="rounded-md bg-[#f1f5f9] px-1.75 py-0.5 text-[11.5px] font-semibold tracking-[0.2px] text-[#64748b] tabular-nums">
              {code}
            </span>
            {type === 'PREVENTIVE' && (
              <MPill tone="info" icon={CircleDot}>
                PM
              </MPill>
            )}
            <span className="flex-1" />
            <StatusBadge kind="workOrderStatus" value={status} />
          </span>
          <span className="mt-2 block text-[15.5px] leading-tight font-bold tracking-[-0.2px] wrap-break-word">
            {title}
          </span>
          {place && (
            <span className="mt-1.5 flex items-center gap-1 text-[12.5px] font-medium text-[#64748b]">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{place}</span>
            </span>
          )}
          <span className="mt-2.5 flex min-w-0 items-center gap-2.5">
            <StatusBadge kind="priority" value={priority} />
            <span className="min-w-0 flex-1">
              {due && (
                <span
                  className="flex items-center gap-1 text-[12.5px] font-semibold"
                  style={{ color: dueColor }}
                >
                  {isOverdue ? (
                    <AlarmClock className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{due.label}</span>
                </span>
              )}
            </span>
            {assignee ? (
              <span className="flex max-w-[45%] min-w-0 items-center gap-1.5">
                <MAvatar initials={assignee.initials} size={22} />
                <span className="truncate text-[12.5px] font-medium">{assignee.name}</span>
              </span>
            ) : team ? (
              <span
                className={cn(
                  'flex max-w-[45%] min-w-0 items-center gap-1 text-[12.5px] font-medium text-[#64748b]',
                )}
              >
                <Users className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{team}</span>
              </span>
            ) : null}
          </span>
          {extra}
        </span>
      </span>
    </AppCard>
  )
}

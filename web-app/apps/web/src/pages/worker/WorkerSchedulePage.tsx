import { CalendarDays } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { useWorkerSchedule } from '@/services/worker.service'
import { intlLocale } from '@/utils/format'
import { TaskListSkeleton, WorkerTaskList } from './WorkerTaskList'

/** "Fri, 3 Oct" for a YYYY-MM-DD key (calendar date, no time-zone shifting). */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(intlLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function WorkerSchedulePage() {
  const { t } = useTranslation()
  const query = useWorkerSchedule()

  return (
    <>
      <WorkerPageHeader title={t('worker.scheduleTitle')} />
      <div className="px-4 py-4">
        {query.isPending ? (
          <TaskListSkeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : query.data.days.every((d) => d.tasks.length === 0) ? (
          <EmptyState icon={CalendarDays} title={t('worker.scheduleEmpty')} />
        ) : (
          <ol className="grid gap-5">
            {query.data.days.map((day, i) => {
              const heading =
                i === 0 ? t('worker.scheduleToday') : i === 1 ? t('worker.scheduleTomorrow') : null
              // Quiet days are kept short so the busy ones stand out.
              if (day.tasks.length === 0 && i > 1) return null
              return (
                <li key={day.date} className="grid gap-2">
                  <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                    {heading ?? dayLabel(day.date)}
                    {heading && (
                      <span className="font-normal text-muted-foreground">
                        {dayLabel(day.date)}
                      </span>
                    )}
                  </h2>
                  {day.tasks.length === 0 ? (
                    <p className="text-13 text-muted-foreground">{t('worker.scheduleFree')}</p>
                  ) : (
                    <WorkerTaskList tasks={day.tasks} />
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </>
  )
}

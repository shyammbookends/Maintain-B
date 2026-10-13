import type { ReportScheduleDto } from '@maintainx/shared'
import type { TFunction } from 'i18next'
import { weekdayNames } from '@/components/maintenance/schedule-text'
import { looseT } from '@/utils/i18n'

/** "Daily at 08:00", "Weekly on Mon at 08:00", "Monthly on day 1 at 08:00". */
export function describeReportSchedule(
  t: TFunction,
  s: Pick<ReportScheduleDto, 'frequency' | 'timeOfDay' | 'dayOfWeek' | 'dayOfMonth'>,
): string {
  if (s.frequency === 'WEEKLY')
    return t('reportSchedules.summaryWeekly', {
      day: weekdayNames('long')[s.dayOfWeek ?? 1],
      time: s.timeOfDay,
    })
  if (s.frequency === 'MONTHLY')
    return t('reportSchedules.summaryMonthly', { day: s.dayOfMonth ?? 1, time: s.timeOfDay })
  return t('reportSchedules.summaryDaily', { time: s.timeOfDay })
}

/** Run log statuses ("skipped: email not configured" …) in the current language. */
export function runStatusLabel(t: TFunction, status: string): string {
  const key = (
    {
      sent: 'runSent',
      'skipped: email not configured': 'runNoEmail',
      'skipped: no recipients': 'runNoRecipients',
      'skipped: owner can no longer export reports': 'runOwner',
      'skipped: restaurant not available': 'runRestaurant',
      failed: 'runFailed',
    } as Record<string, string>
  )[status]
  return key ? looseT(t)(`reportSchedules.${key}`) : status
}

import type { PmScheduleListItem } from '@maintainx/shared'
import type { TFunction } from 'i18next'
import { formatNumber, intlLocale } from '@/utils/format'

/** Short weekday names in the current language, Sunday first. */
export function weekdayNames(style: 'short' | 'long' = 'short'): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale(), { weekday: style, timeZone: 'UTC' })
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2023, 0, 1 + i))))
}

/** A meter value in the current language, e.g. "1,500.5". */
export const meterValue = (n: number) => formatNumber(n, { maximumFractionDigits: 3 })

/** "Every 500 h", "At 10,000 km", "Every 250 h from 1,000 h". */
export function describeMeterRule(
  t: TFunction,
  s: Pick<PmScheduleListItem, 'meter' | 'meterInterval' | 'meterThreshold'>,
): string {
  const unit = s.meter?.unit ?? ''
  if (s.meterInterval !== null && s.meterThreshold !== null)
    return t('pm.meterEveryFrom', {
      value: meterValue(s.meterInterval),
      start: meterValue(s.meterThreshold),
      unit,
    })
  if (s.meterInterval !== null)
    return t('pm.meterEvery', { value: meterValue(s.meterInterval), unit })
  return t('pm.meterAt', { value: meterValue(s.meterThreshold ?? 0), unit })
}

/** "Next due at 1,500 h", or null when a one-time threshold was already reached. */
export function meterNextDue(
  t: TFunction,
  s: Pick<PmScheduleListItem, 'meter' | 'nextDueReading'>,
): string | null {
  if (s.nextDueReading === null) return null
  return t('pm.nextDueReading', { value: meterValue(s.nextDueReading), unit: s.meter?.unit ?? '' })
}

/** "Every day at 10:00", "Weekly on Mon, Fri", "Every 10 days", "Every 500 h" … */
export function describeSchedule(
  t: TFunction,
  s: Pick<
    PmScheduleListItem,
    'frequency' | 'intervalDays' | 'daysOfWeek' | 'dayOfMonth' | 'timeOfDay'
  > &
    Partial<Pick<PmScheduleListItem, 'triggerType' | 'meter' | 'meterInterval' | 'meterThreshold'>>,
): string {
  if (s.triggerType === 'METER')
    return describeMeterRule(t, {
      meter: s.meter ?? null,
      meterInterval: s.meterInterval ?? null,
      meterThreshold: s.meterThreshold ?? null,
    })
  let base: string
  switch (s.frequency) {
    case 'DAILY':
      base = t('pm.everyDay')
      break
    case 'WEEKLY': {
      const names = weekdayNames()
      base = t('pm.weeklyOn', { days: s.daysOfWeek.map((d) => names[d]).join(', ') })
      break
    }
    case 'MONTHLY':
      base = t('pm.monthlyOn', { day: s.dayOfMonth ?? 1 })
      break
    case 'QUARTERLY':
      base = t('pm.quarterlyOn', { day: s.dayOfMonth ?? 1 })
      break
    case 'YEARLY':
      base = t('pm.yearly')
      break
    case 'ONCE':
      base = t('pm.once')
      break
    default:
      base = t('pm.everyNDays', { count: s.intervalDays ?? 1 })
  }
  return s.timeOfDay ? t('pm.atTime', { base, time: s.timeOfDay }) : base
}

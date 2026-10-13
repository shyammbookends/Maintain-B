import { type Locale } from '@maintainx/shared'
import type { TFunction } from 'i18next'
import { currentLocale } from '@/i18n'

/** UI locale → Intl locale. Indian regional variants give ₹ and lakh/crore grouping. */
const INTL_LOCALE: Record<Locale, string> = { en: 'en-IN', hi: 'hi-IN', gu: 'gu-IN' }

export function intlLocale(locale: Locale = currentLocale()): string {
  return INTL_LOCALE[locale]
}

export type DateInput = Date | string | number

export function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

// Intl formatter construction is relatively expensive; cache by locale + options.
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let f = dateFormatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options)
    dateFormatters.set(key, f)
  }
  return f
}

interface FormatOptions {
  locale?: Locale
}

/** 2 Oct 2026 */
export function formatDate(value: DateInput, { locale }: FormatOptions = {}): string {
  return dtf(intlLocale(locale), { day: 'numeric', month: 'short', year: 'numeric' }).format(
    toDate(value),
  )
}

/** 2 Oct */
export function formatDayMonth(value: DateInput, { locale }: FormatOptions = {}): string {
  return dtf(intlLocale(locale), { day: 'numeric', month: 'short' }).format(toDate(value))
}

/** 4:30 pm */
export function formatTime(value: DateInput, { locale }: FormatOptions = {}): string {
  return dtf(intlLocale(locale), { hour: 'numeric', minute: '2-digit' }).format(toDate(value))
}

/** 2 Oct 2026, 4:30 pm */
export function formatDateTime(value: DateInput, { locale }: FormatOptions = {}): string {
  return dtf(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(toDate(value))
}

/** Fri, 4:30 pm */
export function formatWeekdayTime(value: DateInput, { locale }: FormatOptions = {}): string {
  return dtf(intlLocale(locale), { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(
    toDate(value),
  )
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

const RELATIVE_STEPS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number; limit: number }> =
  [
    { unit: 'second', seconds: 1, limit: 45 },
    { unit: 'minute', seconds: 60, limit: 45 * 60 },
    { unit: 'hour', seconds: 3600, limit: 22 * 3600 },
    { unit: 'day', seconds: 86_400, limit: 26 * 86_400 },
    { unit: 'month', seconds: 30 * 86_400, limit: 320 * 86_400 },
    { unit: 'year', seconds: 365 * 86_400, limit: Number.POSITIVE_INFINITY },
  ]

/** "3 hours ago", "in 2 days", "now" — localised. */
export function formatRelative(
  value: DateInput,
  now: Date = new Date(),
  { locale }: FormatOptions = {},
): string {
  const diffSeconds = (toDate(value).getTime() - now.getTime()) / 1000
  const abs = Math.abs(diffSeconds)
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' })
  if (abs < 45) return rtf.format(0, 'second')
  const step =
    RELATIVE_STEPS.find((s) => abs < s.limit) ?? RELATIVE_STEPS[RELATIVE_STEPS.length - 1]!
  return rtf.format(Math.round(diffSeconds / step.seconds), step.unit)
}

export type DueTone = 'danger' | 'warning' | 'neutral'

export interface DueDescription {
  label: string
  tone: DueTone
  overdue: boolean
}

/**
 * Human due-date label used across task lists:
 *   past        → "Overdue · 2 hours ago"   (danger)
 *   today       → "Due today, 4:30 pm"      (warning)
 *   tomorrow    → "Due tomorrow, 9:00 am"
 *   ≤ 6 days    → "Due Fri, 4:30 pm"
 *   later       → "Due 12 Oct"
 */
export function describeDue(due: DateInput, t: TFunction, now: Date = new Date()): DueDescription {
  const d = toDate(due)
  if (d.getTime() < now.getTime()) {
    return {
      label: t('time.overdue', { relative: formatRelative(d, now) }),
      tone: 'danger',
      overdue: true,
    }
  }
  if (isSameLocalDay(d, now)) {
    return { label: t('time.dueToday', { time: formatTime(d) }), tone: 'warning', overdue: false }
  }
  if (isSameLocalDay(d, addDays(now, 1))) {
    return {
      label: t('time.dueTomorrow', { time: formatTime(d) }),
      tone: 'neutral',
      overdue: false,
    }
  }
  const days = (d.getTime() - now.getTime()) / 86_400_000
  const date = days <= 6 ? formatWeekdayTime(d) : formatDayMonth(d)
  return { label: t('time.dueOn', { date }), tone: 'neutral', overdue: false }
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  danger: 'text-danger-fg',
  warning: 'text-warning-fg',
  neutral: 'text-muted-foreground',
}

const numberFormatters = new Map<string, Intl.NumberFormat>()
function nf(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let f = numberFormatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, options)
    numberFormatters.set(key, f)
  }
  return f
}

export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
  { locale }: FormatOptions = {},
): string {
  return nf(intlLocale(locale), options).format(value)
}

/** ₹1,23,456 or ₹1,23,456.50 — decimals only when present. Accepts Prisma Decimal strings. */
export function formatCurrency(
  value: number | string,
  currency = 'INR',
  { locale }: FormatOptions = {},
): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  const hasFraction = Math.round(n * 100) % 100 !== 0
  return nf(intlLocale(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n)
}

/** 90 → "1 hr 30 min" (localised unit names). */
export function formatDuration(totalMinutes: number, { locale }: FormatOptions = {}): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const loc = intlLocale(locale)
  const unit = (u: 'hour' | 'minute', v: number) =>
    nf(loc, { style: 'unit', unit: u, unitDisplay: 'short' }).format(v)
  if (h === 0) return unit('minute', m)
  if (m === 0) return unit('hour', h)
  return `${unit('hour', h)} ${unit('minute', m)}`
}

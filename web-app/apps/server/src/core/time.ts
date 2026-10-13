/** Minutes to add to UTC to get wall-clock time in `timeZone` at `at`. */
export function timeZoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
}

/** [start, end) of the calendar day containing `at`, in `timeZone`, as UTC instants. */
export function dayRangeInZone(
  timeZone: string,
  at: Date = new Date(),
): { start: Date; end: Date } {
  const offset = timeZoneOffsetMinutes(timeZone, at)
  const local = new Date(at.getTime() + offset * 60_000)
  const startLocalMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  const start = new Date(startLocalMs - offset * 60_000)
  return { start, end: new Date(start.getTime() + 86_400_000) }
}

/** YYYY-MM-DD of `at` in `timeZone`. */
export function dateKeyInZone(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Start of the calendar day `date` (YYYY-MM-DD) in `timeZone`, as a UTC instant. */
export function startOfDateInZone(timeZone: string, date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  // Noon UTC falls on the same local date for offsets between −12h and +12h (incl. India).
  return dayRangeInZone(timeZone, new Date(Date.UTC(y, m - 1, d, 12))).start
}

/**
 * Human-readable date and time in `timeZone` for notification text, e.g.
 * "11 Oct 2026, 5:39 pm" (never a raw ISO timestamp).
 */
export function formatDateTimeInZone(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(at)
}

/** A calendar date (stored as UTC midnight) for notification text, e.g. "11 Oct 2026". */
export function formatCalendarDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

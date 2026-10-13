import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import {
  describeDue,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatRelative,
  isSameLocalDay,
} from './format'

const t = i18n.t.bind(i18n)

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('describeDue', () => {
  const now = new Date(2026, 9, 2, 10, 0) // Fri 2 Oct 2026, 10:00 local

  it('past → overdue, danger', () => {
    const d = describeDue(new Date(2026, 9, 2, 8, 0), t, now)
    expect(d).toMatchObject({ tone: 'danger', overdue: true })
    expect(d.label).toMatch(/^Overdue · 2 hours ago$/)
  })

  it('later today → warning with time', () => {
    const d = describeDue(new Date(2026, 9, 2, 16, 30), t, now)
    expect(d.tone).toBe('warning')
    expect(d.label).toMatch(/^Due today, 4:30\s?pm$/i)
  })

  it('tomorrow → neutral', () => {
    const d = describeDue(new Date(2026, 9, 3, 9, 0), t, now)
    expect(d.tone).toBe('neutral')
    expect(d.label.startsWith('Due tomorrow')).toBe(true)
  })

  it('within a week → weekday; later → date', () => {
    expect(describeDue(new Date(2026, 9, 6, 9, 0), t, now).label).toMatch(/^Due Tue/)
    expect(describeDue(new Date(2026, 9, 20, 9, 0), t, now).label).toMatch(/^Due 20 Oct$/)
  })

  it('follows the UI language', async () => {
    await i18n.changeLanguage('hi')
    expect(describeDue(new Date(2026, 9, 2, 8, 0), t, now).label.startsWith('समय निकल गया')).toBe(
      true,
    )
    await i18n.changeLanguage('gu')
    expect(describeDue(new Date(2026, 9, 2, 16, 30), t, now).label.startsWith('આજે')).toBe(true)
  })
})

describe('formatRelative', () => {
  const now = new Date(2026, 9, 2, 10, 0)
  it('picks a sensible unit', () => {
    expect(formatRelative(new Date(now.getTime() - 10_000), now)).toBe('now')
    expect(formatRelative(new Date(now.getTime() - 5 * 60_000), now)).toBe('5 minutes ago')
    expect(formatRelative(new Date(now.getTime() + 3 * 3_600_000), now)).toBe('in 3 hours')
    expect(formatRelative(new Date(now.getTime() - 86_400_000), now)).toBe('yesterday')
  })
})

describe('numbers and money', () => {
  it('uses Indian digit grouping', () => {
    expect(formatNumber(1234567)).toBe('12,34,567')
  })

  it('formats INR, decimals only when present, accepts Decimal strings', () => {
    expect(formatCurrency(123456)).toBe('₹1,23,456')
    expect(formatCurrency('2499.5')).toBe('₹2,499.50')
    expect(formatCurrency('not a number')).toBe('—')
  })

  it('formats durations (unit words come from ICU, e.g. "45 mins")', () => {
    expect(formatDuration(45)).toMatch(/^45 mins?$/)
    expect(formatDuration(120)).toMatch(/^2 hrs?$/)
    expect(formatDuration(90)).toMatch(/^1 hr 30 mins?$/)
    expect(formatDuration(-5)).toMatch(/^0 mins?$/)
  })
})

describe('isSameLocalDay', () => {
  it('compares calendar days in local time', () => {
    expect(isSameLocalDay(new Date(2026, 0, 1, 0, 1), new Date(2026, 0, 1, 23, 59))).toBe(true)
    expect(isSameLocalDay(new Date(2026, 0, 1, 23, 59), new Date(2026, 0, 2, 0, 0))).toBe(false)
  })
})

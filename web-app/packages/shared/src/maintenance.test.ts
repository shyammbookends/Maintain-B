import { describe, expect, it } from 'vitest'
import type { StepInputType } from './enums.js'
import {
  evaluateAnswer,
  nextOccurrence,
  stepIsDone,
  upcomingOccurrences,
  type RecurrenceRule,
  type StepAnswerInput,
} from './maintenance.js'

const rule = (o: Partial<RecurrenceRule>): RecurrenceRule => ({
  frequency: 'DAILY',
  startDate: '2026-10-01',
  ...o,
})

describe('recurrence', () => {
  it('daily starts at the start date and respects the end date', () => {
    expect(nextOccurrence(rule({}), '2026-09-01')).toBe('2026-10-01')
    expect(nextOccurrence(rule({}), '2026-10-05')).toBe('2026-10-05')
    expect(nextOccurrence(rule({ endDate: '2026-10-03' }), '2026-10-04')).toBeNull()
  })

  it('weekly on chosen weekdays', () => {
    // 2026-10-01 is a Thursday. Mondays and Fridays.
    const r = rule({ frequency: 'WEEKLY', daysOfWeek: [1, 5] })
    expect(upcomingOccurrences(r, '2026-10-01', 4)).toEqual([
      '2026-10-02',
      '2026-10-05',
      '2026-10-09',
      '2026-10-12',
    ])
  })

  it('monthly and quarterly on a day of the month', () => {
    const m = rule({ frequency: 'MONTHLY', dayOfMonth: 15 })
    expect(upcomingOccurrences(m, '2026-10-01', 3)).toEqual([
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
    ])
    expect(nextOccurrence(m, '2026-10-16')).toBe('2026-11-15')

    const q = rule({ frequency: 'QUARTERLY', dayOfMonth: 1 })
    expect(upcomingOccurrences(q, '2026-10-01', 3)).toEqual([
      '2026-10-01',
      '2027-01-01',
      '2027-04-01',
    ])
    expect(nextOccurrence(q, '2026-11-20')).toBe('2027-01-01')
  })

  it('custom every N days from the start', () => {
    const r = rule({ frequency: 'CUSTOM', intervalDays: 10 })
    expect(upcomingOccurrences(r, '2026-10-02', 3)).toEqual([
      '2026-10-11',
      '2026-10-21',
      '2026-10-31',
    ])
  })
})

describe('evaluateAnswer', () => {
  const blank = { result: '' as const, textValue: '', note: '' }
  it('fails readings outside the range', () => {
    const step = { inputType: 'NUMBER' as const, minValue: -25, maxValue: -15 }
    expect(evaluateAnswer(step, { ...blank, numericValue: -18 }).result).toBe('PASS')
    expect(evaluateAnswer(step, { ...blank, numericValue: -9 }).result).toBe('FAIL')
    expect(evaluateAnswer(step, blank).result).toBeNull()
  })
  it('text passes when filled; pass/fail uses the chosen result', () => {
    const text = { inputType: 'TEXT' as const, minValue: null, maxValue: null }
    expect(evaluateAnswer(text, { ...blank, textValue: ' ok ' })).toMatchObject({
      result: 'PASS',
      textValue: 'ok',
    })
    const pf = { inputType: 'PASS_FAIL_NA' as const, minValue: null, maxValue: null }
    expect(evaluateAnswer(pf, { ...blank, result: 'FAIL' }).result).toBe('FAIL')
  })
})

describe('yearly and one-off schedules', () => {
  it('YEARLY repeats on the start date every year', () => {
    const rule = { frequency: 'YEARLY' as const, startDate: '2026-03-15', dayOfMonth: 15 }
    expect(upcomingOccurrences(rule, '2026-01-01', 3)).toEqual([
      '2026-03-15',
      '2027-03-15',
      '2028-03-15',
    ])
    expect(nextOccurrence(rule, '2026-03-16')).toBe('2027-03-15')
  })

  it('ONCE happens on its date and then never again', () => {
    const rule = { frequency: 'ONCE' as const, startDate: '2026-11-20' }
    expect(nextOccurrence(rule, '2026-10-01')).toBe('2026-11-20')
    expect(nextOccurrence(rule, '2026-11-21')).toBeNull()
    expect(upcomingOccurrences(rule, '2026-10-01', 5)).toEqual(['2026-11-20'])
  })
})

describe('new step types', () => {
  const step = (inputType: StepInputType, options: string[] = []) => ({
    inputType,
    minValue: null,
    maxValue: null,
    options,
  })
  const answer = (o: Partial<StepAnswerInput>): StepAnswerInput => ({
    result: '',
    textValue: '',
    note: '',
    ...o,
  })

  it('checkbox: ticked passes, unticked clears', () => {
    expect(evaluateAnswer(step('CHECKBOX'), answer({ result: 'PASS' })).result).toBe('PASS')
    expect(evaluateAnswer(step('CHECKBOX'), answer({})).result).toBeNull()
  })

  it('multiple choice accepts only listed options (any case) and stores the canonical one', () => {
    const s = step('MULTIPLE_CHOICE', ['Clean', 'Dirty'])
    expect(evaluateAnswer(s, answer({ textValue: 'dirty' }))).toMatchObject({
      result: 'PASS',
      textValue: 'Dirty',
    })
    expect(evaluateAnswer(s, answer({ textValue: 'Greasy' })).result).toBeNull()
  })

  it('photo and signature steps pass only with the picture attached', () => {
    expect(evaluateAnswer(step('PHOTO'), answer({ result: 'PASS' })).result).toBeNull()
    expect(evaluateAnswer(step('SIGNATURE'), answer({}), true).result).toBe('PASS')
  })

  it('a step that needs a photo is not done without one', () => {
    const base = { required: true, requirePhoto: true, result: 'PASS' as const }
    expect(stepIsDone({ ...base, photoCount: 0 })).toBe(false)
    expect(stepIsDone({ ...base, photoCount: 1 })).toBe(true)
    expect(stepIsDone({ ...base, result: 'NA', photoCount: 0 })).toBe(true)
    expect(stepIsDone({ required: false, requirePhoto: false, result: null, photoCount: 0 })).toBe(
      true,
    )
  })
})

describe('guessCategory', () => {
  it('picks the category from the words people type', async () => {
    const { guessCategory } = await import('./work-orders.js')
    expect(guessCategory('Fridge not cooling')).toBe('REFRIGERATION')
    expect(guessCategory('AC dripping water')).toBe('AC')
    expect(guessCategory('Kitchen temperature too high, light flickering')).toBe('ELECTRICAL')
    expect(guessCategory('Sink tap leaking')).toBe('PLUMBING')
    expect(guessCategory('Rats near the store room')).toBe('PEST_CONTROL')
    expect(guessCategory('POS printer not printing')).toBe('IT_POS')
    expect(guessCategory('फ्रिज ठंडा नहीं कर रहा')).toBe('REFRIGERATION')
    expect(guessCategory('પાણી લીક થાય છે')).toBe('PLUMBING')
    expect(guessCategory('Something strange')).toBe('OTHER')
  })
})

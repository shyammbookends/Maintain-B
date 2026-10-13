import { z } from 'zod'
import i18n from '@/i18n'

/**
 * Global Zod error messages in the active UI language.
 *
 * Precedence (Zod v4): a message set on the schema wins over this map. Shared
 * schemas use `validation.*` keys for their custom messages, which FormMessage
 * translates at render time.
 */

export interface ValidationKey {
  key: string
  params?: Record<string, number | string>
}

type RawIssue = z.core.$ZodRawIssue

function isEmpty(input: unknown): boolean {
  return input === undefined || input === null || input === ''
}

export function validationKeyFor(issue: RawIssue): ValidationKey {
  switch (issue.code) {
    case 'invalid_type': {
      if (isEmpty(issue.input)) return { key: 'validation.required' }
      if (issue.expected === 'int') return { key: 'validation.wholeNumber' }
      if (issue.expected === 'number' || issue.expected === 'bigint') {
        return { key: 'validation.invalidNumber' }
      }
      if (issue.expected === 'date') return { key: 'validation.invalidDate' }
      return { key: 'validation.invalidValue' }
    }
    case 'too_small': {
      const min = Number(issue.minimum)
      switch (issue.origin) {
        case 'string':
          return min <= 1
            ? { key: 'validation.required' }
            : { key: 'validation.tooShort', params: { min } }
        case 'number':
        case 'int':
        case 'bigint':
          return { key: 'validation.numberMin', params: { min } }
        case 'array':
        case 'set':
          return { key: 'validation.selectOption' }
        case 'date':
          return { key: 'validation.invalidDate' }
        default:
          return { key: 'validation.invalidValue' }
      }
    }
    case 'too_big': {
      const max = Number(issue.maximum)
      switch (issue.origin) {
        case 'string':
          return { key: 'validation.tooLong', params: { max } }
        case 'number':
        case 'int':
        case 'bigint':
          return { key: 'validation.numberMax', params: { max } }
        case 'date':
          return { key: 'validation.invalidDate' }
        default:
          return { key: 'validation.invalidValue' }
      }
    }
    case 'invalid_format': {
      if (issue.format === 'email') return { key: 'validation.invalidEmail' }
      if (issue.format === 'date' || issue.format === 'datetime' || issue.format === 'time') {
        return { key: 'validation.invalidDate' }
      }
      return { key: 'validation.invalidValue' }
    }
    case 'invalid_value':
      return { key: isEmpty(issue.input) ? 'validation.selectOption' : 'validation.invalidValue' }
    case 'not_multiple_of':
      return issue.divisor === 1
        ? { key: 'validation.wholeNumber' }
        : { key: 'validation.invalidNumber' }
    default:
      return { key: 'validation.invalidValue' }
  }
}

type LooseTranslate = (key: string, options?: Record<string, unknown>) => string

export function translateIssue(issue: RawIssue): string {
  const { key, params } = validationKeyFor(issue)
  return (i18n.t as unknown as LooseTranslate)(key, params)
}

let installed = false

/** Call once at startup (main.tsx, test setup). */
export function installZodI18n(): void {
  if (installed) return
  installed = true
  z.config({ customError: (issue) => translateIssue(issue) })
}

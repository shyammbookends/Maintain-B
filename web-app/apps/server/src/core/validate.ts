import type { Request } from 'express'
import type { z } from 'zod'
import { ValidationError, type FieldErrors } from './errors.js'

export function fieldErrorsFromZod(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_root'
    ;(out[key] ??= []).push(issue.message)
  }
  return out
}

/**
 * NUL characters never belong in text, and PostgreSQL refuses them (a search for
 * "\0" would otherwise end in a 500). Removed from every string before validation.
 */
export function withoutNulBytes(input: unknown, depth = 0): unknown {
  if (typeof input === 'string')
    return input.includes('\u0000') ? input.replaceAll('\u0000', '') : input
  if (depth > 20 || input === null || typeof input !== 'object') return input
  if (Array.isArray(input)) return input.map((v) => withoutNulBytes(v, depth + 1))
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    return input
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) out[k] = withoutNulBytes(v, depth + 1)
  return out
}

/** Parse untrusted input with a Zod schema or throw a 400 ValidationError. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(withoutNulBytes(input))
  if (!result.success) throw new ValidationError(fieldErrorsFromZod(result.error))
  return result.data
}

export const parseBody = <T extends z.ZodType>(schema: T, req: Request): z.output<T> =>
  parse(schema, req.body)

export const parseQuery = <T extends z.ZodType>(schema: T, req: Request): z.output<T> =>
  parse(schema, req.query)

export const parseParams = <T extends z.ZodType>(schema: T, req: Request): z.output<T> =>
  parse(schema, req.params)

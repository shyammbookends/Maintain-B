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

/** Parse untrusted input with a Zod schema or throw a 400 ValidationError. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input)
  if (!result.success) throw new ValidationError(fieldErrorsFromZod(result.error))
  return result.data
}

export const parseBody = <T extends z.ZodType>(schema: T, req: Request): z.output<T> =>
  parse(schema, req.body)

export const parseQuery = <T extends z.ZodType>(schema: T, req: Request): z.output<T> =>
  parse(schema, req.query)

export const parseParams = <T extends z.ZodType>(schema: T, req: Request): z.output<T> =>
  parse(schema, req.params)

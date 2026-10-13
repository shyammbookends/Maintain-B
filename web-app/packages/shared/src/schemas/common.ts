import { z } from 'zod'

export const uuidSchema = z.uuid()

export const idParamSchema = z.object({ id: uuidSchema })
export type IdParam = z.infer<typeof idParamSchema>

export const PAGE_SIZE_DEFAULT = 25
export const PAGE_SIZE_MAX = 100

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export const sortDirectionSchema = z.enum(['asc', 'desc'])
export type SortDirection = z.infer<typeof sortDirectionSchema>

/** `?sort=dueDate:desc` — the allowed field list is supplied per endpoint. */
export function sortQuerySchema<const F extends readonly [string, ...string[]]>(fields: F) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined
      const [field, dir = 'asc'] = raw.split(':')
      if (!field || !fields.includes(field)) {
        ctx.addIssue({ code: 'custom', message: `sort field must be one of: ${fields.join(', ')}` })
        return z.NEVER
      }
      const parsedDir = sortDirectionSchema.safeParse(dir)
      if (!parsedDir.success) {
        ctx.addIssue({ code: 'custom', message: 'sort direction must be asc or desc' })
        return z.NEVER
      }
      return { field: field as F[number], direction: parsedDir.data }
    })
}

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
})

export const dateRangeQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: '"from" must be on or before "to"',
    path: ['to'],
  })

/** Trimmed, non-empty text with a sane upper bound. */
export const nameSchema = z.string().trim().min(1).max(120)
export const descriptionSchema = z.string().trim().max(5000)
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'validation.phone')

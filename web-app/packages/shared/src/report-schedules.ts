import { z } from 'zod'
import {
  PRIORITY,
  REPORT_FORMAT,
  REPORT_FREQUENCY,
  WORK_ORDER_STATUS,
  WORK_ORDER_TYPE,
  type ReportFormat,
  type ReportFrequency,
} from './enums.js'
import { REPORT_KEYS, type ReportKey } from './platform.js'
import type { PersonRef } from './work-orders.js'

/*
 * Scheduled email reports: a report sent daily / weekly / monthly (at a time
 * in the organization's time zone) to people in scope and/or email addresses,
 * as a CSV or PDF attachment. Custom messages are i18n keys.
 */

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/

/** The work-order filters a scheduled report keeps (same as the report page). */
export const reportFiltersSchema = z.object({
  locationId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  userId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  vendorId: z.uuid().optional(),
  priority: z.enum(PRIORITY).optional(),
  status: z.enum(WORK_ORDER_STATUS).optional(),
  type: z.enum(WORK_ORDER_TYPE).optional(),
})
export type ReportFilters = z.infer<typeof reportFiltersSchema>

export const MAX_REPORT_RECIPIENTS = 25

export const reportScheduleSchema = z
  .object({
    reportKey: z.enum(REPORT_KEYS),
    /** Empty = every restaurant the creator can see. */
    restaurantId: z.uuid().or(z.literal('')),
    filters: reportFiltersSchema.default({}),
    frequency: z.enum(REPORT_FREQUENCY),
    timeOfDay: z.string().regex(TIME_OF_DAY, 'validation.invalidValue'),
    /** WEEKLY: 0 = Sunday … 6 = Saturday. */
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    /** MONTHLY: 1–28. */
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    format: z.enum(REPORT_FORMAT),
    recipientUserIds: z.array(z.uuid()).max(MAX_REPORT_RECIPIENTS),
    recipientEmails: z
      .array(z.string().trim().toLowerCase().pipe(z.email('validation.invalidEmail')))
      .max(MAX_REPORT_RECIPIENTS),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.frequency === 'WEEKLY' && v.dayOfWeek === undefined)
      ctx.addIssue({ code: 'custom', path: ['dayOfWeek'], message: 'validation.selectOption' })
    if (v.frequency === 'MONTHLY' && v.dayOfMonth === undefined)
      ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'validation.required' })
    if (v.recipientUserIds.length + v.recipientEmails.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['recipientUserIds'],
        message: 'validation.recipientRequired',
      })
    if (v.recipientUserIds.length + v.recipientEmails.length > MAX_REPORT_RECIPIENTS)
      ctx.addIssue({ code: 'custom', path: ['recipientEmails'], message: 'validation.tooMany' })
  })
export type ReportScheduleInput = z.infer<typeof reportScheduleSchema>

export interface ReportScheduleRunDto {
  id: string
  scheduledFor: string
  /** "sent", "skipped: email not configured", "skipped: no recipients", "failed: …" */
  status: string
  recipients: number
  rows: number | null
  createdAt: string
}

export interface ReportScheduleDto {
  id: string
  reportKey: ReportKey
  restaurant: { id: string; name: string } | null
  filters: ReportFilters
  frequency: ReportFrequency
  timeOfDay: string
  dayOfWeek: number | null
  dayOfMonth: number | null
  format: ReportFormat
  recipientUsers: PersonRef[]
  recipientEmails: string[]
  active: boolean
  nextRunAt: string
  lastRunAt: string | null
  lastRun: ReportScheduleRunDto | null
  createdBy: PersonRef
  /** The organization's time zone (times are in it). */
  timeZone: string
}

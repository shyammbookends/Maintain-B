import { z } from 'zod'
import {
  FREQUENCY,
  INSPECTION_STATUS,
  INSPECTION_TYPE,
  PM_TRIGGER_TYPE,
  PRIORITY,
  STEP_INPUT_TYPE,
  STEP_RESULT,
  WORK_ORDER_CATEGORY,
  type Frequency,
  type InspectionStatus,
  type InspectionType,
  type PmTriggerType,
  type Priority,
  type StepInputType,
  type StepResult,
  type WorkOrderCategory,
  type WorkOrderStatus,
} from './enums.js'
import { paginationQuerySchema, sortQuerySchema } from './schemas/common.js'
import type { AttachmentDto, PersonRef } from './work-orders.js'

/*
 * Preventive maintenance schedules, procedures (step templates), work-order
 * checklists and inspections. Custom messages are i18n keys.
 */

const optionalText = (max: number) => z.string().trim().max(max)
const optionalUuid = z.uuid().or(z.literal(''))
const isoDate = z.iso.date()

// ---------------------------------------------------------------- recurrence

export interface RecurrenceRule {
  frequency: Frequency
  /** YYYY-MM-DD (restaurant-local). */
  startDate: string
  endDate?: string | null
  intervalDays?: number | null
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek?: readonly number[] | null
  /** 1–28. */
  dayOfMonth?: number | null
}

const DAY = 86_400_000
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`)
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * DAY)

function monthDate(year: number, month: number, day: number): string {
  // month may overflow; Date.UTC normalises it.
  return fromUtc(Date.UTC(year, month, day))
}

/**
 * First occurrence of the rule on or after `from` (YYYY-MM-DD), or null when
 * the schedule has ended. Works on calendar dates only; the caller applies
 * the restaurant's time zone and time of day.
 */
export function nextOccurrence(rule: RecurrenceRule, from: string): string | null {
  const start = rule.startDate
  const d = from < start ? start : from
  let result: string | null = null

  switch (rule.frequency) {
    case 'ONCE':
      // A single date: the start date, until it has passed.
      result = d === start ? start : null
      break
    case 'DAILY':
      result = d
      break
    case 'CUSTOM': {
      const every = Math.max(1, rule.intervalDays ?? 1)
      const diff = Math.round((toUtc(d) - toUtc(start)) / DAY)
      const steps = Math.ceil(diff / every)
      result = addDays(start, steps * every)
      break
    }
    case 'WEEKLY': {
      const days = rule.daysOfWeek?.length ? rule.daysOfWeek : [new Date(toUtc(start)).getUTCDay()]
      for (let i = 0; i < 7; i++) {
        const c = addDays(d, i)
        if (days.includes(new Date(toUtc(c)).getUTCDay())) {
          result = c
          break
        }
      }
      break
    }
    case 'MONTHLY':
    case 'QUARTERLY':
    case 'YEARLY': {
      const step = rule.frequency === 'MONTHLY' ? 1 : rule.frequency === 'QUARTERLY' ? 3 : 12
      const s = new Date(toUtc(start))
      const day = rule.dayOfMonth ?? Math.min(28, s.getUTCDate())
      const dd = new Date(toUtc(d))
      // Months since the start month, rounded up to the next allowed slot.
      let months =
        (dd.getUTCFullYear() - s.getUTCFullYear()) * 12 + (dd.getUTCMonth() - s.getUTCMonth())
      months = Math.max(0, Math.ceil(months / step) * step)
      for (let i = 0; i < 3; i++) {
        const c = monthDate(s.getUTCFullYear(), s.getUTCMonth() + months, day)
        if (c >= d && c >= start) {
          result = c
          break
        }
        months += step
      }
      break
    }
  }
  if (result && rule.endDate && result > rule.endDate) return null
  return result
}

/** The next `count` occurrences on or after `from`. */
export function upcomingOccurrences(rule: RecurrenceRule, from: string, count: number): string[] {
  const out: string[] = []
  let cursor = from
  while (out.length < count) {
    const n = nextOccurrence(rule, cursor)
    if (!n) break
    out.push(n)
    cursor = addDays(n, 1)
  }
  return out
}

// ---------------------------------------------------------------- PM schedules

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/
const meterValue = z
  .number()
  .min(0)
  .max(1_000_000_000)
  .multipleOf(0.001, 'validation.threeDecimals')

export const pmScheduleSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    description: optionalText(2000),
    restaurantId: z.uuid(),
    assetId: optionalUuid,
    frequency: z.enum(FREQUENCY),
    intervalDays: z.number().int().min(1).max(365).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    timeOfDay: z.string().regex(TIME_OF_DAY, 'validation.invalidValue').or(z.literal('')),
    procedureId: optionalUuid,
    category: z.enum(WORK_ORDER_CATEGORY),
    priority: z.enum(PRIORITY),
    assignedUserId: optionalUuid,
    assignedTeamId: optionalUuid,
    estimatedMinutes: z.number().int().min(5).max(10_080).optional(),
    leadTimeDays: z.number().int().min(0).max(30),
    startDate: isoDate,
    endDate: isoDate.or(z.literal('')),
    /** TIME = the calendar fields above; METER = a reading on `meterId` (the asset's meter). */
    triggerType: z.enum(PM_TRIGGER_TYPE).default('TIME'),
    meterId: optionalUuid.optional(),
    /** METER: every this many units (500 h …). */
    meterInterval: meterValue.positive().optional(),
    /** METER: first (or, without an interval, the only) work order at this reading. */
    meterThreshold: meterValue.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.assignedUserId && v.assignedTeamId)
      ctx.addIssue({ code: 'custom', path: ['assignedTeamId'], message: 'validation.oneAssignee' })
    if (v.triggerType === 'METER') {
      // The calendar fields are ignored; a meter on the asset decides when.
      if (!v.assetId)
        ctx.addIssue({ code: 'custom', path: ['assetId'], message: 'validation.required' })
      if (!v.meterId)
        ctx.addIssue({ code: 'custom', path: ['meterId'], message: 'validation.required' })
      if (v.meterInterval === undefined && v.meterThreshold === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['meterInterval'],
          message: 'validation.meterIntervalOrThreshold',
        })
      return
    }
    if (v.frequency === 'CUSTOM' && !v.intervalDays)
      ctx.addIssue({ code: 'custom', path: ['intervalDays'], message: 'validation.required' })
    if (v.frequency === 'WEEKLY' && v.daysOfWeek.length === 0)
      ctx.addIssue({ code: 'custom', path: ['daysOfWeek'], message: 'validation.selectOption' })
    // YEARLY repeats on the start date's day; MONTHLY / QUARTERLY need a day.
    if ((v.frequency === 'MONTHLY' || v.frequency === 'QUARTERLY') && !v.dayOfMonth)
      ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'validation.required' })
    if (v.endDate && v.endDate < v.startDate)
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'validation.endBeforeStart' })
  })
export type PmScheduleInput = z.infer<typeof pmScheduleSchema>

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** The first `due + k × interval` above `reading` (missed steps are skipped, like missed dates). */
export function nextMeterDue(due: number, interval: number, reading: number): number {
  if (interval <= 0) return due
  const steps = Math.max(1, Math.floor((reading - due) / interval) + 1)
  return round3(due + steps * interval)
}

/**
 * First reading a METER schedule is due at, given the meter's current value:
 * the threshold while it is still ahead, otherwise the next interval step.
 * Null when nothing can be due (neither interval nor threshold).
 */
export function initialMeterDue(
  interval: number | null,
  threshold: number | null,
  current: number | null,
): number | null {
  const now = current ?? 0
  if (threshold !== null) {
    if (current === null || now < threshold || interval === null) return threshold
    return nextMeterDue(threshold, interval, now)
  }
  return interval === null ? null : round3(now + interval)
}

export const setPmActiveSchema = z.object({ active: z.boolean() })

export const PM_SORT_FIELDS = ['name', 'nextDueAt', 'createdAt'] as const
export const listPmQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(PM_SORT_FIELDS),
  restaurantId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  frequency: z.enum(FREQUENCY).optional(),
  active: z.enum(['true', 'false']).optional(),
})
export type ListPmQuery = z.infer<typeof listPmQuerySchema>

export interface PmScheduleListItem {
  id: string
  name: string
  frequency: Frequency
  intervalDays: number | null
  daysOfWeek: number[]
  dayOfMonth: number | null
  timeOfDay: string | null
  triggerType: PmTriggerType
  /** METER schedules: the meter and the reading that creates the next work order. */
  meter: { id: string; name: string; unit: string; currentValue: number | null } | null
  meterInterval: number | null
  meterThreshold: number | null
  /** Null when nothing more is due (a one-time threshold already reached). */
  nextDueReading: number | null
  lastTriggeredReading: number | null
  restaurant: { id: string; name: string }
  asset: { id: string; name: string; assetCode: string } | null
  procedure: { id: string; name: string } | null
  assignedUser: PersonRef | null
  assignedTeam: { id: string; name: string } | null
  priority: Priority
  category: WorkOrderCategory
  active: boolean
  /** Null when the schedule has ended. */
  nextDueAt: string | null
  /** On-time completion of its work orders due in the last 90 days; null if none. */
  compliance: number | null
}

export interface PmScheduleDetail extends PmScheduleListItem {
  description: string | null
  estimatedMinutes: number | null
  leadTimeDays: number
  startDate: string
  endDate: string | null
  lastGeneratedAt: string | null
  /** Next few due dates (restaurant-local YYYY-MM-DD). */
  upcoming: string[]
  recentWorkOrders: Array<{
    id: string
    code: string
    status: WorkOrderStatus
    dueDate: string | null
    completedAt: string | null
    onTime: boolean | null
  }>
  can: { edit: boolean; delete: boolean }
}

// ---------------------------------------------------------------- procedures

/** "Show only if step 3 is FAIL" / "… if step 2 is 'Dirty'". */
export const stepConditionSchema = z.object({
  step: z.number().int().min(1).max(100),
  /** PASS / FAIL / NA, or one of a multiple-choice step's options. */
  answer: z.string().trim().min(1).max(80),
})
export type StepCondition = z.infer<typeof stepConditionSchema>

export const procedureStepSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    instruction: optionalText(1000),
    inputType: z.enum(STEP_INPUT_TYPE),
    unit: optionalText(20),
    minValue: z.number().min(-1e8).max(1e8).optional(),
    maxValue: z.number().min(-1e8).max(1e8).optional(),
    required: z.boolean(),
    /** MULTIPLE_CHOICE answers (2–10). */
    options: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
    /** A photo must be attached before the step counts as done. */
    requirePhoto: z.boolean().optional(),
    /** Only show this step when step #step (1-based, earlier) was answered `answer`. */
    showIf: stepConditionSchema.nullable().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.minValue !== undefined && s.maxValue !== undefined && s.minValue > s.maxValue)
      ctx.addIssue({ code: 'custom', path: ['maxValue'], message: 'validation.maxBelowMin' })
    if (s.inputType === 'MULTIPLE_CHOICE') {
      const opts = s.options ?? []
      if (opts.length < 2)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'validation.optionsRequired' })
      else if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'validation.duplicateOptions' })
    }
  })
export type ProcedureStepInput = z.infer<typeof procedureStepSchema>

export const procedureSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: optionalText(2000),
  category: z.enum(WORK_ORDER_CATEGORY).or(z.literal('')),
  /** '' = every restaurant. */
  restaurantId: optionalUuid,
  steps: z
    .array(procedureStepSchema)
    .min(1, 'validation.stepsRequired')
    .max(100)
    .superRefine((steps, ctx) => {
      steps.forEach((s, i) => {
        if (!s.showIf) return
        const target = steps[s.showIf.step - 1]
        // Conditions point back to an earlier step that can be answered.
        if (s.showIf.step > i || !target || target.inputType === 'SECTION')
          ctx.addIssue({ code: 'custom', path: [i, 'showIf'], message: 'validation.invalidValue' })
      })
    }),
})
export type ProcedureInput = z.infer<typeof procedureSchema>

export interface ProcedureStepDto {
  id: string
  position: number
  title: string
  instruction: string | null
  inputType: StepInputType
  unit: string | null
  minValue: number | null
  maxValue: number | null
  required: boolean
  options: string[]
  requirePhoto: boolean
  showIf: StepCondition | null
}

export interface ProcedureListItem {
  id: string
  name: string
  category: WorkOrderCategory | null
  restaurant: { id: string; name: string } | null
  stepCount: number
  version: number
  usedBy: { schedules: number; templates: number }
  updatedAt: string
}

export interface ProcedureDetail extends ProcedureListItem {
  description: string | null
  steps: ProcedureStepDto[]
  can: { edit: boolean; delete: boolean }
}

// ---------------------------------------------------------------- checklists

/** Answer for one step (work-order checklist or inspection item). */
export const stepAnswerSchema = z.object({
  result: z.enum(STEP_RESULT).or(z.literal('')),
  numericValue: z.number().min(-1e8).max(1e8).optional(),
  textValue: optionalText(1000),
  note: optionalText(1000),
})
export type StepAnswerInput = z.infer<typeof stepAnswerSchema>

export interface ChecklistItemDto extends Omit<ProcedureStepDto, 'id'> {
  id: string
  /** Photos (and the signature image) attached to this step. */
  attachments: AttachmentDto[]
  result: StepResult | null
  numericValue: number | null
  textValue: string | null
  note: string | null
  completedAt: string | null
  completedBy: PersonRef | null
  correctiveWorkOrder: { id: string; code: string } | null
}

/**
 * Server-side outcome of an answer. A NUMBER reading outside [min, max]
 * fails; inside it passes. TEXT passes when filled. PASS_FAIL_NA uses `result`.
 */
export function evaluateAnswer(
  step: {
    inputType: StepInputType
    minValue: number | null
    maxValue: number | null
    options?: readonly string[]
  },
  answer: StepAnswerInput,
  /** PHOTO / SIGNATURE steps: is the picture (or signature) already attached? */
  hasMedia = false,
): { result: StepResult | null; numericValue: number | null; textValue: string | null } {
  const na = {
    result: answer.result === 'NA' ? ('NA' as const) : null,
    numericValue: null,
    textValue: null,
  }
  switch (step.inputType) {
    case 'SECTION':
      return { result: null, numericValue: null, textValue: null }
    case 'CHECKBOX':
      // Ticked = done. Unticking clears it.
      return {
        result: answer.result === 'PASS' ? 'PASS' : na.result,
        numericValue: null,
        textValue: null,
      }
    case 'MULTIPLE_CHOICE': {
      const choice = answer.textValue.trim()
      if (!choice) return na
      const match = (step.options ?? []).find((o) => o.toLowerCase() === choice.toLowerCase())
      return match ? { result: 'PASS', numericValue: null, textValue: match } : na
    }
    case 'PHOTO':
    case 'SIGNATURE':
      return hasMedia ? { result: 'PASS', numericValue: null, textValue: null } : na
    case 'NUMBER': {
      const v = answer.numericValue
      if (v === undefined || Number.isNaN(v)) {
        return { result: answer.result === 'NA' ? 'NA' : null, numericValue: null, textValue: null }
      }
      const out =
        (step.minValue !== null && v < step.minValue) ||
        (step.maxValue !== null && v > step.maxValue)
      return { result: out ? 'FAIL' : 'PASS', numericValue: v, textValue: null }
    }
    case 'TEXT': {
      const text = answer.textValue.trim()
      if (!text)
        return { result: answer.result === 'NA' ? 'NA' : null, numericValue: null, textValue: null }
      return { result: 'PASS', numericValue: null, textValue: text }
    }
    default:
      return { result: answer.result || null, numericValue: null, textValue: null }
  }
}

// ---------------------------------------------------------------- inspections

export const inspectionTemplateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  type: z.enum(INSPECTION_TYPE),
  procedureId: z.uuid(),
  restaurantId: optionalUuid,
  active: z.boolean(),
})
export type InspectionTemplateInput = z.infer<typeof inspectionTemplateSchema>

export interface InspectionTemplateDto {
  id: string
  name: string
  type: InspectionType
  procedure: { id: string; name: string; stepCount: number }
  restaurant: { id: string; name: string } | null
  active: boolean
}

export const startInspectionSchema = z.object({
  templateId: z.uuid(),
  restaurantId: z.uuid(),
  assetId: optionalUuid,
})
export type StartInspectionInput = z.infer<typeof startInspectionSchema>

export const submitInspectionSchema = z.object({ notes: optionalText(2000) })
export type SubmitInspectionInput = z.infer<typeof submitInspectionSchema>

export const INSPECTION_SORT_FIELDS = ['startedAt', 'submittedAt'] as const
export const listInspectionsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(INSPECTION_SORT_FIELDS),
  restaurantId: z.uuid().optional(),
  type: z.enum(INSPECTION_TYPE).optional(),
  status: z.enum(INSPECTION_STATUS).optional(),
  result: z.enum(['failed', 'passed']).optional(),
  mine: z.enum(['1']).optional(),
})
export type ListInspectionsQuery = z.infer<typeof listInspectionsQuerySchema>

export interface InspectionListItem {
  id: string
  code: string
  name: string
  type: InspectionType
  status: InspectionStatus
  restaurant: { id: string; name: string }
  asset: { id: string; name: string; assetCode: string } | null
  performedBy: PersonRef
  startedAt: string
  submittedAt: string | null
  passCount: number
  failCount: number
  naCount: number
  itemCount: number
}

export interface InspectionDetail extends InspectionListItem {
  notes: string | null
  items: ChecklistItemDto[]
  can: { answer: boolean; submit: boolean }
}

/**
 * Is a step done? Required steps need an answer, and steps that require a
 * photo need at least one photo attached. One rule for app and server.
 */
export function stepIsDone(step: {
  required: boolean
  requirePhoto: boolean
  result: StepResult | null
  photoCount: number
  inputType?: StepInputType
}): boolean {
  if (step.inputType === 'SECTION') return true
  if (step.result === 'NA') return true
  if (step.required && step.result === null) return false
  if (step.requirePhoto && step.result !== null && step.photoCount === 0) return false
  if (step.requirePhoto && step.required && step.photoCount === 0) return false
  return true
}

/** Did this step get the answer a condition asks for? */
export function answerMatches(
  step: { result: StepResult | null; textValue: string | null },
  answer: string,
): boolean {
  if (step.result === null) return false
  if ((STEP_RESULT as readonly string[]).includes(answer)) return step.result === answer
  return (step.textValue ?? '').toLowerCase() === answer.toLowerCase()
}

/**
 * Positions of steps hidden by their condition (the referenced step isn't
 * answered that way, or is itself hidden). Hidden steps don't block completion.
 */
export function hiddenSteps(
  items: ReadonlyArray<{
    position: number
    showIf: StepCondition | null
    result: StepResult | null
    textValue: string | null
  }>,
): Set<number> {
  const byPosition = new Map(items.map((i) => [i.position, i]))
  const hidden = new Set<number>()
  for (const i of [...items].sort((a, b) => a.position - b.position)) {
    if (!i.showIf) continue
    const target = byPosition.get(i.showIf.step)
    if (!target || hidden.has(target.position) || !answerMatches(target, i.showIf.answer))
      hidden.add(i.position)
  }
  return hidden
}

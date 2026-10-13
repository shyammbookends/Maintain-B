import { z } from 'zod'
import {
  AUTOMATION_TRIGGER,
  FAILURE_CATEGORY,
  METER_TYPE,
  PRIORITY,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_TYPE,
  type AutomationRunStatus,
  type AutomationTrigger,
  type FailureCategory,
  type MeterType,
} from './enums.js'
import type { PersonRef } from './work-orders.js'

/*
 * Phase 11: asset meters and readings, the IF/THEN automation engine and
 * root cause analysis. Custom messages are i18n keys.
 */

type Ref = { id: string; name: string }
const optionalText = (max: number) => z.string().trim().max(max)
const optionalUuid = z.uuid().or(z.literal(''))
const reading = z.number().min(-1_000_000_000).max(1_000_000_000)

// ---------------------------------------------------------------- meters

export const meterSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(METER_TYPE),
  unit: z.string().trim().min(1).max(20),
})
export type MeterInput = z.infer<typeof meterSchema>

export const meterReadingSchema = z.object({
  value: reading.multipleOf(0.001, 'validation.threeDecimals'),
  note: optionalText(500),
  /** The job during which it was read (optional). */
  workOrderId: optionalUuid.optional(),
})
export type MeterReadingInput = z.infer<typeof meterReadingSchema>

/** Usual unit per meter type (prefilled in the form). */
export const METER_DEFAULT_UNIT: Record<MeterType, string> = {
  TEMPERATURE: '°C',
  RUNTIME_HOURS: 'h',
  PRESSURE: 'bar',
  CYCLES: 'cycles',
  MILEAGE: 'km',
  ENERGY: 'kWh',
  OTHER: '',
}

export interface MeterReadingDto {
  id: string
  value: number
  previousValue: number | null
  /** value - previous (null for the first reading). */
  delta: number | null
  readAt: string
  user: PersonRef
  note: string | null
  workOrder: { id: string; code: string } | null
}

export interface AssetMeterDto {
  id: string
  name: string
  type: MeterType
  unit: string
  currentValue: number | null
  previousValue: number | null
  lastReadingAt: string | null
  /** Latest readings, newest first (up to 20). */
  readings: MeterReadingDto[]
  can: { read: boolean; manage: boolean }
}

// ---------------------------------------------------------------- automations

export const METER_OPERATORS = ['GTE', 'LTE', 'EVERY'] as const
export type MeterOperator = (typeof METER_OPERATORS)[number]

export const automationConditionsSchema = z.object({
  priorities: z.array(z.enum(PRIORITY)).max(PRIORITY.length).optional(),
  categories: z.array(z.enum(WORK_ORDER_CATEGORY)).max(WORK_ORDER_CATEGORY.length).optional(),
  types: z.array(z.enum(WORK_ORDER_TYPE)).max(WORK_ORDER_TYPE.length).optional(),
  assetId: z.uuid().optional(),
  /** METER_READING: which meter, and when it fires. */
  meterId: z.uuid().optional(),
  meterOperator: z.enum(METER_OPERATORS).optional(),
  meterValue: reading.optional(),
})
export type AutomationConditions = z.infer<typeof automationConditionsSchema>

export const NOTIFY_RECIPIENTS = ['MANAGERS', 'ASSIGNEE', 'STOCK_KEEPERS', 'USER'] as const
export type NotifyRecipients = (typeof NOTIFY_RECIPIENTS)[number]

export const AUTOMATION_ACTION_TYPES = [
  'NOTIFY',
  'CREATE_WORK_ORDER',
  'SET_PRIORITY',
  'ASSIGN',
] as const
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number]

export const automationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('NOTIFY'),
    recipients: z.enum(NOTIFY_RECIPIENTS),
    userId: z.uuid().optional(),
    message: optionalText(300),
  }),
  z.object({
    type: z.literal('CREATE_WORK_ORDER'),
    title: z.string().trim().min(3).max(200),
    priority: z.enum(PRIORITY),
    category: z.enum(WORK_ORDER_CATEGORY),
    workType: z.enum(WORK_ORDER_TYPE),
    assignedUserId: z.uuid().optional(),
    assignedTeamId: z.uuid().optional(),
    procedureId: z.uuid().optional(),
    dueInHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .optional(),
  }),
  z.object({ type: z.literal('SET_PRIORITY'), priority: z.enum(PRIORITY) }),
  z.object({
    type: z.literal('ASSIGN'),
    userId: z.uuid().optional(),
    teamId: z.uuid().optional(),
  }),
])
export type AutomationAction = z.infer<typeof automationActionSchema>

/** Triggers whose subject is a work order (SET_PRIORITY / ASSIGN act on it). */
export const WORK_ORDER_TRIGGERS: readonly AutomationTrigger[] = [
  'WORK_ORDER_CREATED',
  'WORK_ORDER_OVERDUE',
  'WORK_ORDER_COMPLETED',
]

export const automationSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    description: optionalText(500),
    trigger: z.enum(AUTOMATION_TRIGGER),
    restaurantId: optionalUuid,
    conditions: automationConditionsSchema,
    actions: z.array(automationActionSchema).min(1, 'validation.actionRequired').max(5),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const c = v.conditions
    if (v.trigger === 'METER_READING') {
      if (!c.meterId)
        ctx.addIssue({
          code: 'custom',
          path: ['conditions', 'meterId'],
          message: 'validation.required',
        })
      if (!c.meterOperator || c.meterValue === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['conditions', 'meterValue'],
          message: 'validation.required',
        })
      if (c.meterOperator === 'EVERY' && (c.meterValue ?? 0) <= 0)
        ctx.addIssue({
          code: 'custom',
          path: ['conditions', 'meterValue'],
          message: 'validation.positiveQuantity',
        })
    }
    v.actions.forEach((a, i) => {
      const onWorkOrder = WORK_ORDER_TRIGGERS.includes(v.trigger)
      if ((a.type === 'SET_PRIORITY' || a.type === 'ASSIGN') && !onWorkOrder)
        ctx.addIssue({
          code: 'custom',
          path: ['actions', i, 'type'],
          message: 'validation.actionNotForTrigger',
        })
      if (a.type === 'ASSIGN' && !a.userId && !a.teamId)
        ctx.addIssue({
          code: 'custom',
          path: ['actions', i, 'userId'],
          message: 'validation.assigneeRequired',
        })
      if (a.type === 'NOTIFY' && a.recipients === 'USER' && !a.userId)
        ctx.addIssue({
          code: 'custom',
          path: ['actions', i, 'userId'],
          message: 'validation.required',
        })
      if (a.type === 'NOTIFY' && a.recipients === 'ASSIGNEE' && !onWorkOrder)
        ctx.addIssue({
          code: 'custom',
          path: ['actions', i, 'recipients'],
          message: 'validation.actionNotForTrigger',
        })
    })
  })
export type AutomationInput = z.infer<typeof automationSchema>

export const automationActiveSchema = z.object({ active: z.boolean() })

export interface AutomationDto {
  id: string
  name: string
  description: string | null
  trigger: AutomationTrigger
  restaurant: Ref | null
  conditions: AutomationConditions
  actions: AutomationAction[]
  active: boolean
  runCount: number
  lastRunAt: string | null
  createdBy: PersonRef
  createdAt: string
  can: { edit: boolean; delete: boolean }
}

export interface AutomationLogDto {
  id: string
  trigger: AutomationTrigger
  status: AutomationRunStatus
  entityType: string | null
  entityId: string | null
  message: string | null
  createdAt: string
}

/**
 * Does a meter reading fire the rule? GTE / LTE fire when the value crosses
 * the threshold (not on every reading above it); EVERY fires each time the
 * value passes another multiple (every 500 h of runtime …).
 */
export function meterRuleFires(
  operator: MeterOperator,
  threshold: number,
  previous: number | null,
  value: number,
): boolean {
  if (operator === 'GTE') return value >= threshold && (previous === null || previous < threshold)
  if (operator === 'LTE') return value <= threshold && (previous === null || previous > threshold)
  if (threshold <= 0 || previous === null) return false
  return Math.floor(value / threshold) > Math.floor(previous / threshold)
}

// ---------------------------------------------------------------- root cause analysis

export const rootCauseSchema = z.object({
  failure: z.string().trim().min(3).max(500),
  cause: optionalText(1000),
  rootCause: z.string().trim().min(3).max(1000),
  category: z.enum(FAILURE_CATEGORY),
  correctiveAction: optionalText(1000),
  preventiveAction: optionalText(1000),
})
export type RootCauseInput = z.infer<typeof rootCauseSchema>

export interface RootCauseDto {
  id: string
  failure: string
  cause: string | null
  rootCause: string
  category: FailureCategory
  correctiveAction: string | null
  preventiveAction: string | null
  createdBy: PersonRef
  updatedAt: string
  workOrder: { id: string; code: string; title: string }
  asset: { id: string; name: string } | null
}

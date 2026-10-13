import { z } from 'zod'
import {
  ASSET_STATUS,
  PRIORITY,
  REQUEST_STATUS,
  EVIDENCE_STAGE,
  FINAL_CONDITION,
  REPEAT_BASIS,
  REPEAT_UNIT,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_COST_TYPE,
  WORK_ORDER_STATUS,
  WORK_ORDER_TYPE,
  type AssetStatus,
  type AttachmentKind,
  type EvidenceStage,
  type FinalCondition,
  type Priority,
  type RequestStatus,
  type WorkOrderCategory,
  type WorkOrderCostType,
  type WorkOrderStatus,
  type WorkOrderType,
} from './enums.js'
import type { CostBreakdown } from './assets.js'
import type { WorkOrderPartDto, WorkOrderReservationDto } from './inventory.js'
import type { ChecklistItemDto } from './maintenance.js'
import type { RootCauseDto } from './automation.js'
import { customValuesSchema, type CustomValue, type LabelDto } from './custom.js'
import { paginationQuerySchema, sortQuerySchema } from './schemas/common.js'

/*
 * Requests (problem reports), work orders, messages and attachments.
 * Custom messages are i18n keys. Optional text accepts '' from forms.
 */

const optionalText = (max: number) => z.string().trim().max(max)
const optionalUuid = z.uuid().or(z.literal(''))

// ---------------------------------------------------------------- uploads

export const UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const UPLOAD_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const
/** Voice notes recorded in the browser (Chrome: webm/ogg, Safari: mp4). */
export const UPLOAD_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/aac',
  'audio/x-m4a',
] as const
export const UPLOAD_ALLOWED_TYPES: readonly string[] = [
  ...UPLOAD_IMAGE_TYPES,
  ...UPLOAD_VIDEO_TYPES,
  ...UPLOAD_AUDIO_TYPES,
]
/** Photos are resized on the device before upload; this is the safety limit. */
export const UPLOAD_MAX_IMAGE_MB = 10
export const UPLOAD_MAX_FILES = 6

/** Optional form fields sent with an upload. */
export const uploadMetaSchema = z.object({
  stage: z.enum(EVIDENCE_STAGE).or(z.literal('')).optional(),
  caption: z.string().trim().max(300).optional(),
})
export type UploadMeta = z.infer<typeof uploadMetaSchema>

export interface AttachmentDto {
  id: string
  kind: AttachmentKind
  /** Work-order evidence stage; null for general files. */
  stage: EvidenceStage | null
  caption: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  /** Short-lived signed link (valid ~1 hour). */
  url: string
  /** Small preview for lists and galleries (photos only). */
  thumbUrl: string | null
  /** The file was removed by the retention policy; the record stays. */
  removed: boolean
  /** Null for photos a guest sent through the request portal. */
  uploadedBy: { id: string; firstName: string; lastName: string } | null
  createdAt: string
}

// ---------------------------------------------------------------- requests

export const createRequestSchema = z.object({
  restaurantId: z.uuid(),
  locationId: optionalUuid,
  assetId: optionalUuid,
  category: z.enum(WORK_ORDER_CATEGORY),
  /** Optional; derived from the description when empty. */
  title: optionalText(120),
  description: z.string().trim().min(5).max(2000),
  priority: z.enum(PRIORITY),
})
export type CreateRequestInput = z.infer<typeof createRequestSchema>

export const rejectRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})
export type RejectRequestInput = z.infer<typeof rejectRequestSchema>

/** Approve without converting yet: the requester learns it will be handled. */
export const approveRequestSchema = z.object({
  note: optionalText(500),
})
export type ApproveRequestInput = z.infer<typeof approveRequestSchema>

export const REQUEST_SORT_FIELDS = ['createdAt', 'priority'] as const

export const listRequestsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(REQUEST_SORT_FIELDS),
  status: z.enum(REQUEST_STATUS).optional(),
  restaurantId: z.uuid().optional(),
  /** Only requests I reported (workers always get this). */
  mine: z.enum(['1']).optional(),
})
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>

export interface PersonRef {
  id: string
  firstName: string
  lastName: string
}

export interface RequestListItem {
  id: string
  code: string
  title: string
  category: WorkOrderCategory
  priority: Priority
  status: RequestStatus
  restaurant: { id: string; name: string }
  location: { id: string; name: string } | null
  asset: { id: string; name: string; assetCode: string } | null
  /** Null when a guest reported it through the public portal (see guest). */
  requestedBy: PersonRef | null
  guest: { name: string; phone: string | null } | null
  photoCount: number
  createdAt: string
}

export interface RequestDetail extends RequestListItem {
  description: string
  reviewedBy: PersonRef | null
  reviewedAt: string | null
  rejectionReason: string | null
  reviewNote: string | null
  workOrder: { id: string; code: string; status: WorkOrderStatus } | null
  attachments: AttachmentDto[]
  can: { convert: boolean; reject: boolean; approve: boolean }
}

// ---------------------------------------------------------------- work orders

/** "Repeat every 2 weeks, from the due date": the next job is created when this one is done. */
export const repeatSchema = z.object({
  every: z.number().int().min(1).max(365),
  unit: z.enum(REPEAT_UNIT),
  basis: z.enum(REPEAT_BASIS),
})
export type RepeatRule = z.infer<typeof repeatSchema>

/** date + every × unit (months keep the day of month, clamped to the month's end). */
export function addRepeat(date: Date, rule: Pick<RepeatRule, 'every' | 'unit'>): Date {
  const d = new Date(date)
  if (rule.unit === 'DAY') d.setUTCDate(d.getUTCDate() + rule.every)
  else if (rule.unit === 'WEEK') d.setUTCDate(d.getUTCDate() + rule.every * 7)
  else {
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + rule.every)
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(day, last))
  }
  return d
}

const workOrderFields = {
  title: z.string().trim().min(3).max(120),
  description: optionalText(5000),
  category: z.enum(WORK_ORDER_CATEGORY),
  priority: z.enum(PRIORITY),
  restaurantId: z.uuid(),
  locationId: optionalUuid,
  assetId: optionalUuid,
  /** ISO date-time or ''. */
  dueDate: z.iso.datetime({ offset: true }).or(z.literal('')),
  estimatedMinutes: z.number().int().min(5).max(10_080).optional(),
  /** Planned start (ISO) or ''; omitted = unchanged. */
  scheduledStart: z.iso.datetime({ offset: true }).or(z.literal('')).optional(),
  /** Outside contractor; omitted = unchanged. */
  vendorId: optionalUuid.optional(),
  /** Who verifies the finished work; omitted = unchanged. */
  supervisorId: optionalUuid.optional(),
  /** Repeat rule, null = does not repeat; omitted = unchanged. */
  repeat: repeatSchema.nullable().optional(),
  /** Custom field values by field id; omitted = unchanged. */
  customFields: customValuesSchema.optional(),
  /** Labels (custom categories); omitted = unchanged. */
  labelIds: z.array(z.uuid()).max(10).optional(),
}

export const createWorkOrderSchema = z.object({
  ...workOrderFields,
  type: z.enum(WORK_ORDER_TYPE).optional(),
  assignedUserId: optionalUuid,
  assignedTeamId: optionalUuid,
  /** Extra technicians working alongside the assignee. */
  helperIds: z.array(z.uuid()).max(10).optional(),
  /** Make it a sub work order of a bigger job. */
  parentId: optionalUuid.optional(),
  /** Save without publishing: nobody is notified and workers don't see it. */
  asDraft: z.boolean().optional(),
  /** Set when converting a request. */
  requestId: optionalUuid,
  /** Copies the procedure's steps into the work order's checklist. */
  procedureId: optionalUuid.optional(),
})
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>

export const updateWorkOrderSchema = z.object(workOrderFields)
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>

export const assignWorkOrderSchema = z
  .object({
    assignedUserId: optionalUuid,
    assignedTeamId: optionalUuid,
    /** Replaces the extra technicians; omitted = unchanged. */
    helperIds: z.array(z.uuid()).max(10).optional(),
    /** Planned start (ISO) or ''; omitted = unchanged. */
    scheduledStart: z.iso.datetime({ offset: true }).or(z.literal('')).optional(),
  })
  .refine((v) => v.assignedUserId !== '' || v.assignedTeamId !== '', {
    message: 'validation.assigneeRequired',
    path: ['assignedUserId'],
  })
export type AssignWorkOrderInput = z.infer<typeof assignWorkOrderSchema>

export const holdWorkOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) })
export type HoldWorkOrderInput = z.infer<typeof holdWorkOrderSchema>

const reportText = (min: number, max: number) => z.string().trim().min(min).max(max)
const optionalCount = z.number().int().min(0).max(10_000).optional()

/**
 * The repair report a technician hands in. Problem found, work performed, the
 * final condition and the confirmation are mandatory; so is saying something
 * about parts (record them on the job, or tick "no parts used").
 */
export const completeWorkOrderSchema = z.object({
  /** Kept for older clients; filled from workPerformed when absent. */
  notes: z.string().trim().max(5000).optional(),
  /** Required only when the workflow asks for the full repair report. */
  problemFound: reportText(3, 2000).optional(),
  rootCause: optionalText(2000).optional(),
  workPerformed: reportText(3, 5000).optional(),
  newPartsInstalled: optionalText(1000).optional(),
  oldPartsRemoved: optionalText(1000).optional(),
  quantityRepaired: optionalCount,
  quantityReplaced: optionalCount,
  additionalMaterials: optionalText(1000).optional(),
  additionalIssue: optionalText(2000).optional(),
  recommendation: optionalText(2000).optional(),
  finalCondition: z.enum(FINAL_CONDITION).optional(),
  noPartsUsed: z.boolean().optional(),
  /** The technician confirms the report is true and the work is done (full report only). */
  confirmed: z.literal(true, { error: 'validation.confirmRequired' }).optional(),
  /** Optionally set the asset's status (e.g. back to OPERATIONAL). */
  assetStatus: z.enum(ASSET_STATUS).or(z.literal('')).optional(),
})
export type CompleteWorkOrderInput = z.infer<typeof completeWorkOrderSchema>

/** Time a manager adds by hand (forgotten timer, work done offline). Needs work_orders:edit. */
export const manualTimeSchema = z.object({
  userId: z.uuid(),
  minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  /** When the work happened (ISO). */
  startedAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().min(3).max(300),
})
export type ManualTimeInput = z.infer<typeof manualTimeSchema>

/** Calendar drag-and-drop: move the planned start (and keep the due date's gap). */
export const rescheduleWorkOrderSchema = z.object({
  scheduledStart: z.iso.datetime({ offset: true }),
  /** Omitted: the due date moves by the same amount. '' clears it. */
  dueDate: z.iso.datetime({ offset: true }).or(z.literal('')).optional(),
})
export type RescheduleWorkOrderInput = z.infer<typeof rescheduleWorkOrderSchema>

export const reopenWorkOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) })
export type ReopenWorkOrderInput = z.infer<typeof reopenWorkOrderSchema>

/** Supervisor approves the finished work: VERIFIED, then CLOSED. */
export const verifyWorkOrderSchema = z.object({ note: optionalText(500) })
export type VerifyWorkOrderInput = z.infer<typeof verifyWorkOrderSchema>

/** Supervisor sends the work back: REOPENED, reason required. */
export const rejectWorkOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) })
export type RejectWorkOrderInput = z.infer<typeof rejectWorkOrderSchema>

export const cancelWorkOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) })
export type CancelWorkOrderInput = z.infer<typeof cancelWorkOrderSchema>

/** A cost that is not a part or logged labour (vendor charge, materials bought, travel…). */
export const workOrderCostSchema = z.object({
  type: z.enum(WORK_ORDER_COST_TYPE),
  description: z.string().trim().min(2).max(200),
  /** Rupees, up to 2 decimals. */
  amount: z
    .number()
    .positive()
    .max(10_000_000)
    // At most 2 decimals (multipleOf(0.01) misfires on floats like 0.07).
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'validation.invalidNumber'),
  vendorId: optionalUuid.optional(),
})
export type WorkOrderCostInput = z.infer<typeof workOrderCostSchema>

export const messageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  /** Reply to this message. */
  parentId: z.uuid().optional(),
  /** Internal note: managers only, hidden from technicians. */
  internal: z.boolean().optional(),
  /** People @mentioned (they get a notification). */
  mentionIds: z.array(z.uuid()).max(20).optional(),
})
export type MessageInput = z.infer<typeof messageSchema>

export const WORK_ORDER_SORT_FIELDS = [
  'code',
  'dueDate',
  'priority',
  'createdAt',
  'status',
] as const

export const listWorkOrdersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(WORK_ORDER_SORT_FIELDS),
  status: z.enum(WORK_ORDER_STATUS).optional(),
  /** Shortcut views. */
  view: z
    .enum(['active', 'overdue', 'review', 'unassigned', 'scheduled', 'draft', 'done'])
    .optional(),
  priority: z.enum(PRIORITY).optional(),
  category: z.enum(WORK_ORDER_CATEGORY).optional(),
  type: z.enum(WORK_ORDER_TYPE).optional(),
  restaurantId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  assignedUserId: z.uuid().optional(),
  assignedTeamId: z.uuid().optional(),
  vendorId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  labelId: z.uuid().optional(),
  /** Created on/after, before (YYYY-MM-DD). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})
export type ListWorkOrdersQuery = z.infer<typeof listWorkOrdersQuerySchema>

export interface WorkOrderListItem {
  id: string
  code: string
  title: string
  type: WorkOrderType
  category: WorkOrderCategory
  priority: Priority
  status: WorkOrderStatus
  dueDate: string | null
  scheduledStart: string | null
  /** Active and past due (OVERDUE is derived, never stored). */
  overdue: boolean
  restaurant: { id: string; name: string }
  location: { id: string; name: string } | null
  asset: { id: string; name: string; assetCode: string } | null
  assignedUser: PersonRef | null
  assignedTeam: { id: string; name: string } | null
  vendor: { id: string; name: string } | null
  parentId: string | null
  /** Sub work orders: finished / total (0/0 when none). */
  subProgress: { done: number; total: number }
  labels: LabelDto[]
  createdAt: string
}

export interface WorkOrderMessage {
  id: string
  body: string
  author: PersonRef
  createdAt: string
  mine: boolean
  parentId: string | null
  internal: boolean
  mentions: PersonRef[]
  attachments: AttachmentDto[]
}

export interface WorkOrderEvent {
  id: string
  fromStatus: WorkOrderStatus | null
  toStatus: WorkOrderStatus
  actor: PersonRef | null
  note: string | null
  createdAt: string
}

/** Actions the current user may take right now (server-computed). */
export interface WorkOrderActions {
  edit: boolean
  /** DRAFT → published. */
  publish: boolean
  assign: boolean
  start: boolean
  hold: boolean
  resume: boolean
  complete: boolean
  /** Approve finished work (pending verification → verified → closed). */
  verify: boolean
  /** Send finished work back to the technician (→ reopened). */
  reject: boolean
  reopen: boolean
  cancel: boolean
  /** Add / remove cost lines. */
  costs: boolean
  /** Add or remove time by hand. */
  time: boolean
  /** Move the planned start (calendar). */
  reschedule: boolean
  unassign: boolean
  upload: boolean
  message: boolean
  /** Answer checklist steps (owner while in progress). */
  checklist: boolean
  /** Record parts used (deducted from the restaurant's stock). */
  parts: boolean
  /** Reserve stock for the job while planning it. */
  reserve: boolean
  /** Write the root cause analysis. */
  rca: boolean
  /** Post internal notes (hidden from technicians). */
  internalNotes: boolean
}

export interface WorkOrderCompletionReport {
  problemFound: string
  rootCause: string | null
  workPerformed: string
  newPartsInstalled: string | null
  oldPartsRemoved: string | null
  quantityRepaired: number | null
  quantityReplaced: number | null
  additionalMaterials: string | null
  additionalIssue: string | null
  recommendation: string | null
  finalCondition: FinalCondition
  noPartsUsed: boolean
  labourMinutes: number
  confirmedBy: PersonRef
  confirmedAt: string
}

export interface WorkOrderTimeEntryDto {
  id: string
  user: PersonRef
  startedAt: string
  endedAt: string | null
  minutes: number | null
  manual: boolean
  note: string | null
}

/** What still stands between the technician and "Complete". */
export interface CompletionCheck {
  /** Required checklist steps not done yet (incl. missing required photos). */
  stepsLeft: number
  needsBeforePhoto: boolean
  needsAfterPhoto: boolean
  /** Sub work orders still open. */
  subWorkOrdersOpen: number
  /** Photos / videos taken per stage. */
  evidence: Record<EvidenceStage, number>
  /** The full repair report must be filled in (workflow setting). */
  reportRequired: boolean
  /** Finished work goes to a supervisor before it is closed (workflow setting). */
  verificationRequired: boolean
}

export interface WorkOrderCostLine {
  id: string
  type: WorkOrderCostType
  description: string
  amount: number
  vendor: { id: string; name: string } | null
  createdBy: PersonRef
  createdAt: string
}

/** Technician choice with current open work, shown before assigning. */
export interface AssigneeWorkload {
  user: PersonRef
  teams: Array<{ id: string; name: string }>
  openCount: number
  overdueCount: number
  inProgressCount: number
  /** Estimated minutes of the open work assigned to them (when known). */
  plannedMinutes: number
}

export interface WorkOrderDetail extends WorkOrderListItem {
  description: string | null
  /** Custom field values by field id (only filled fields). */
  customFields: Record<string, Exclude<CustomValue, null>>
  repeat: RepeatRule | null
  /** The earlier job this one repeats, and the follow-up created from this one. */
  repeatedFrom: { id: string; code: string } | null
  repeatedBy: { id: string; code: string; dueDate: string | null } | null
  estimatedMinutes: number | null
  /** Minutes worked so far (closed time entries + the running one). */
  minutesWorked: number
  timerRunning: boolean
  startedAt: string | null
  completedAt: string | null
  closedAt: string | null
  holdReason: string | null
  completionNotes: string | null
  reopenCount: number
  createdBy: PersonRef
  closedBy: PersonRef | null
  verifiedAt: string | null
  verifiedBy: PersonRef | null
  cancelledAt: string | null
  cancelReason: string | null
  /** Why the supervisor last sent the work back. */
  rejectionReason: string | null
  supervisor: PersonRef | null
  /** Extra technicians on the job. */
  helpers: PersonRef[]
  parent: { id: string; code: string; title: string; status: WorkOrderStatus } | null
  children: Array<{
    id: string
    code: string
    title: string
    status: WorkOrderStatus
    assignedUser: PersonRef | null
  }>
  cost: CostBreakdown
  costLines: WorkOrderCostLine[]
  completion: WorkOrderCompletionReport | null
  completionCheck: CompletionCheck
  timeEntries: WorkOrderTimeEntryDto[]
  /** Who to call about the job (restaurant, manager, supervisor). */
  contacts: Array<{
    role: 'restaurant' | 'manager' | 'supervisor' | 'creator'
    name: string
    phone: string | null
  }>
  asset: (WorkOrderListItem['asset'] & { status: AssetStatus; publicId: string }) | null
  procedure: { id: string; name: string } | null
  pmSchedule: { id: string; name: string } | null
  checklist: ChecklistItemDto[]
  parts: WorkOrderPartDto[]
  /** Stock reserved for this job and not used yet. */
  reservations: WorkOrderReservationDto[]
  rootCause: RootCauseDto | null
  sourceRequest: {
    id: string
    code: string
    description: string
    requestedBy: PersonRef | null
    guest: { name: string; phone: string | null } | null
    attachments: AttachmentDto[]
  } | null
  attachments: AttachmentDto[]
  messages: WorkOrderMessage[]
  history: WorkOrderEvent[]
  actions: WorkOrderActions
}

// ---------------------------------------------------------------- calendar

export const calendarQuerySchema = z
  .object({
    /** YYYY-MM-DD inclusive range (max 62 days). */
    from: z.iso.date(),
    to: z.iso.date(),
    restaurantId: z.uuid().optional(),
    assignedUserId: z.uuid().optional(),
    teamId: z.uuid().optional(),
  })
  .refine((v) => v.from <= v.to, { message: 'validation.dateRange', path: ['to'] })
export type CalendarQuery = z.infer<typeof calendarQuerySchema>

export interface CalendarWorkOrder {
  kind: 'work_order'
  id: string
  code: string
  title: string
  status: WorkOrderStatus
  priority: Priority
  type: WorkOrderType
  /** Where it sits on the calendar: planned start, else due date. */
  at: string
  scheduledStart: string | null
  dueDate: string | null
  estimatedMinutes: number | null
  overdue: boolean
  restaurant: { id: string; name: string }
  asset: { id: string; name: string } | null
  assignedUser: PersonRef | null
  assignedTeam: { id: string; name: string } | null
  canReschedule: boolean
}

/** A preventive job that will be generated later (not a work order yet). */
export interface CalendarForecast {
  kind: 'forecast'
  id: string
  scheduleId: string
  name: string
  /** YYYY-MM-DD */
  date: string
  priority: Priority
  restaurant: { id: string; name: string }
  asset: { id: string; name: string } | null
  assignedUser: PersonRef | null
  assignedTeam: { id: string; name: string } | null
}

export type CalendarItem = CalendarWorkOrder | CalendarForecast

/*
 * "What kind of problem?" is typed freely on the report form. The category
 * (used by reports, automations and routing) is picked from the words; an
 * admin can still change it when converting the request.
 */
const CATEGORY_WORDS: Array<[WorkOrderCategory, RegExp]> = [
  [
    'REFRIGERATION',
    /fridge|freez|refrig|chiller|cold ?room|walk-?in|\bice\b|cooling|फ्रिज|फ्रीज़र|फ्रीजर|ફ્રિજ|ફ્રીઝર/i,
  ],
  ['AC', /\bac\b|a\/c|air ?con|hvac|\bsplit\b|\bduct|एसी|એસી/i],
  ['FIRE_SAFETY', /\bfire\b|smoke|extinguish|sprinkler|alarm|आग|અગ્નિ|આગ/i],
  ['GAS', /\bgas\b|\blpg\b|\bpng\b|burner|stove|cylinder|गैस|ગેસ/i],
  [
    'ELECTRICAL',
    /electric|power|\blights?\b|bulb|switch|socket|wiring|\bmcb\b|\bfuse|generator|बिजली|लाइट|વીજળી|લાઇટ/i,
  ],
  [
    'PLUMBING',
    /plumb|leak|\bpipe|\btaps?\b|drain|sink|toilet|water|flush|नल|पानी|लीक|નળ|પાણી|લીક/i,
  ],
  [
    'PEST_CONTROL',
    /\bpests?\b|\brats?\b|\bmouse\b|\bmice\b|cockroach|insect|termite|चूहा|कॉकरोच|ઉંદર|વંદો/i,
  ],
  ['IT_POS', /\bpos\b|printer|computer|laptop|wi-?fi|internet|network|tablet|software|billing/i],
  [
    'KITCHEN_EQUIPMENT',
    /oven|fryer|grill|mixer|grinder|dishwash|tandoor|microwave|coffee|equipment|ओवन|मिक्सर|ઓવન|મિક્સર/i,
  ],
  ['CLEANING', /clean|dirty|garbage|trash|waste|\bmop\b|सफाई|કચરો|સફાઈ/i],
  [
    'CIVIL',
    /\bwalls?\b|\bfloor|\btiles?\b|ceiling|\bdoors?\b|window|paint|\broof|crack|दीवार|दरवाज|દીવાલ|દરવાજ/i,
  ],
]

export function guessCategory(text: string): WorkOrderCategory {
  for (const [category, words] of CATEGORY_WORDS) if (words.test(text)) return category
  return 'OTHER'
}

// ---------------------------------------------------------------- workflow settings

/**
 * How strict the work order flow is. The defaults follow MaintainX: finish a
 * job with one tap; photos, the full repair report and supervisor
 * verification are switches an admin turns on.
 */
export const workflowSettingsSchema = z.object({
  requireBeforePhoto: z.boolean(),
  requireAfterPhoto: z.boolean(),
  requireRepairReport: z.boolean(),
  requireVerification: z.boolean(),
  /** Show the 4 MaintainX statuses (Open, On hold, In progress, Done) instead of every stage. */
  simpleStatuses: z.boolean(),
  /** Extra inventory tools, hidden unless used. */
  showReservations: z.boolean(),
  showCycleCounts: z.boolean(),
  /** Anyone with the restaurant's portal link / QR can report a problem without logging in. */
  requestPortal: z.boolean(),
})
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>

export const DEFAULT_WORKFLOW: WorkflowSettings = {
  requireBeforePhoto: false,
  requireAfterPhoto: false,
  requireRepairReport: false,
  requireVerification: false,
  simpleStatuses: true,
  showReservations: false,
  showCycleCounts: false,
  requestPortal: false,
}

/** Everything on: before/after photos, full report, verification. */
export const STRICT_WORKFLOW: WorkflowSettings = {
  requireBeforePhoto: true,
  requireAfterPhoto: true,
  requireRepairReport: true,
  requireVerification: true,
  simpleStatuses: false,
  showReservations: true,
  showCycleCounts: true,
  requestPortal: false,
}

/** REVIEW only occurs when verification is switched on: finished work awaiting approval. */
export const SIMPLE_STATUS = [
  'OPEN',
  'ON_HOLD',
  'IN_PROGRESS',
  'REVIEW',
  'DONE',
  'CANCELLED',
] as const
export type SimpleStatus = (typeof SIMPLE_STATUS)[number]

/** The MaintainX-style bucket a detailed status falls into. */
export function simpleStatusOf(s: WorkOrderStatus): SimpleStatus {
  switch (s) {
    case 'IN_PROGRESS':
      return 'IN_PROGRESS'
    case 'ON_HOLD':
      return 'ON_HOLD'
    case 'REVIEW':
      return 'REVIEW'
    case 'COMPLETED':
    case 'VERIFIED':
    case 'CLOSED':
      return 'DONE'
    case 'CANCELLED':
      return 'CANCELLED'
    default:
      return 'OPEN'
  }
}

/**
 * Domain enums. These MUST stay in sync with the Prisma enums in
 * apps/server/prisma/schema.prisma — the server has a test that asserts this.
 *
 * Plain `as const` objects (not TS enums) so they are erasable, tree-shakeable
 * and usable as Zod enum sources on both sides.
 */

export const USER_STATUS = ['ACTIVE', 'INVITED', 'DISABLED'] as const
export type UserStatus = (typeof USER_STATUS)[number]

/** Which application shell a role lands in. */
export const ROLE_KIND = ['ADMIN', 'WORKER'] as const
export type RoleKind = (typeof ROLE_KIND)[number]

export const RESTAURANT_STATUS = ['ACTIVE', 'INACTIVE'] as const
export type RestaurantStatus = (typeof RESTAURANT_STATUS)[number]

export const LOCATION_TYPE = [
  'BUILDING',
  'FLOOR',
  'AREA',
  'ROOM',
  'KITCHEN',
  'HOT_KITCHEN',
  'COLD_KITCHEN',
  'PREPARATION',
  'DISHWASHING',
  'DINING',
  'STORAGE',
  'BAR',
  'UTILITY',
  'OFFICE',
  'OTHER',
] as const
export type LocationType = (typeof LOCATION_TYPE)[number]

export const ASSET_STATUS = [
  'OPERATIONAL',
  'WARNING',
  'UNDER_MAINTENANCE',
  'BROKEN',
  'INACTIVE',
  'RETIRED',
] as const
export type AssetStatus = (typeof ASSET_STATUS)[number]

export const ASSET_EVENT_TYPE = [
  'CREATED',
  'TRANSFERRED',
  'UPDATED',
  'STATUS_CHANGED',
  'MOVED',
  'WORK_ORDER_COMPLETED',
  'PART_REPLACED',
  'DOCUMENT_ADDED',
  'NOTE',
] as const
export type AssetEventType = (typeof ASSET_EVENT_TYPE)[number]

export const ASSET_CRITICALITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type AssetCriticality = (typeof ASSET_CRITICALITY)[number]

export const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type Priority = (typeof PRIORITY)[number]

/**
 * REVIEW is shown as "Pending verification". OVERDUE is not a stored status:
 * it is any active work order whose due date has passed.
 */
export const WORK_ORDER_STATUS = [
  'DRAFT',
  'OPEN',
  'ASSIGNED',
  'SCHEDULED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'REVIEW',
  'VERIFIED',
  'CLOSED',
  'REOPENED',
  'CANCELLED',
] as const
export type WorkOrderStatus = (typeof WORK_ORDER_STATUS)[number]

export const WORK_ORDER_COST_TYPE = ['VENDOR', 'MATERIAL', 'TRAVEL', 'OTHER'] as const
export type WorkOrderCostType = (typeof WORK_ORDER_COST_TYPE)[number]

export const WORK_ORDER_TYPE = ['REACTIVE', 'PREVENTIVE', 'INSPECTION_FOLLOWUP'] as const
export type WorkOrderType = (typeof WORK_ORDER_TYPE)[number]

export const WORK_ORDER_CATEGORY = [
  'REFRIGERATION',
  'AC',
  'ELECTRICAL',
  'PLUMBING',
  'GAS',
  'FIRE_SAFETY',
  'KITCHEN_EQUIPMENT',
  'PEST_CONTROL',
  'CLEANING',
  'IT_POS',
  'CIVIL',
  'OTHER',
] as const
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORY)[number]

export const REQUEST_STATUS = ['NEW', 'APPROVED', 'CONVERTED', 'REJECTED'] as const
export type RequestStatus = (typeof REQUEST_STATUS)[number]

/** NUMBER doubles as a measurement (unit + allowed range). */
export const STEP_INPUT_TYPE = [
  'PASS_FAIL_NA',
  'NUMBER',
  'TEXT',
  'CHECKBOX',
  'MULTIPLE_CHOICE',
  'PHOTO',
  'SIGNATURE',
  /** A heading that groups the steps below it; nothing to answer. */
  'SECTION',
] as const
export type StepInputType = (typeof STEP_INPUT_TYPE)[number]

export const STEP_RESULT = ['PASS', 'FAIL', 'NA'] as const
export type StepResult = (typeof STEP_RESULT)[number]

export const ATTACHMENT_OWNER_TYPE = [
  'WORK_ORDER',
  'REQUEST',
  'CHECKLIST_ITEM',
  'INSPECTION_ITEM',
  'MESSAGE',
  'CHAT_MESSAGE',
] as const
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPE)[number]

export const ATTACHMENT_KIND = ['PHOTO', 'VIDEO', 'AUDIO', 'FILE'] as const
export type AttachmentKind = (typeof ATTACHMENT_KIND)[number]

export const FREQUENCY = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
  'CUSTOM',
  'ONCE',
] as const
export type Frequency = (typeof FREQUENCY)[number]

export const INSPECTION_TYPE = ['OPENING', 'CLOSING', 'SAFETY', 'ASSET'] as const
export type InspectionType = (typeof INSPECTION_TYPE)[number]

export const INSPECTION_STATUS = ['IN_PROGRESS', 'SUBMITTED'] as const
export type InspectionStatus = (typeof INSPECTION_STATUS)[number]

export const INVENTORY_TXN_TYPE = [
  'RECEIPT',
  'CONSUMPTION',
  'ADJUSTMENT',
  'RETURN',
  'TRANSFER',
  'ISSUE',
  'DAMAGED',
  'CYCLE_COUNT',
] as const
export type InventoryTxnType = (typeof INVENTORY_TXN_TYPE)[number]

export const RESERVATION_STATUS = ['ACTIVE', 'FULFILLED', 'RELEASED'] as const
export type ReservationStatus = (typeof RESERVATION_STATUS)[number]

export const STOCK_COUNT_STATUS = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
export type StockCountStatus = (typeof STOCK_COUNT_STATUS)[number]

export const PURCHASE_ORDER_STATUS = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUS)[number]

export const VENDOR_CATEGORY = [
  'REFRIGERATION',
  'AC',
  'ELECTRICAL',
  'PLUMBING',
  'GAS',
  'FIRE_SAFETY',
  'KITCHEN_EQUIPMENT',
  'PEST_CONTROL',
  'OTHER',
] as const
export type VendorCategory = (typeof VENDOR_CATEGORY)[number]

export const DOCUMENT_OWNER_TYPE = ['RESTAURANT', 'ASSET', 'VENDOR', 'WORK_ORDER'] as const
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPE)[number]

export const DOCUMENT_TYPE = [
  'LICENSE',
  'CERTIFICATE',
  'AMC',
  'CONTRACT',
  'MANUAL',
  'WARRANTY',
  'INVOICE',
  'SERVICE',
  'OTHER',
] as const
export type DocumentType = (typeof DOCUMENT_TYPE)[number]

export const NOTIFICATION_TYPE = [
  'NEW_REQUEST',
  'TASK_ASSIGNED',
  'TASK_OVERDUE',
  'PM_DUE',
  'CRITICAL_ISSUE',
  'LOW_STOCK',
  'PO_APPROVAL',
  'WARRANTY_EXPIRY',
  'TASK_COMPLETED',
  'INSPECTION_FAILED',
  'NEW_MESSAGE',
  'DOCUMENT_EXPIRY',
  'REQUEST_APPROVED',
  'REQUEST_REJECTED',
  'WORK_REJECTED',
  'WORK_CANCELLED',
  'WORK_STARTED',
  'WORK_RESCHEDULED',
  'PO_RECEIVED',
  'CONTRACT_EXPIRY',
  'AUTOMATION',
  'MENTION',
  'WORK_REASSIGNED',
  'DUE_SOON',
  'WORK_REOPENED',
  'METER_ALERT',
  'STORAGE_ALERT',
  'CHAT_MESSAGE',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPE)[number]

export const SETTING_SCOPE = ['ORGANIZATION', 'RESTAURANT'] as const
export type SettingScope = (typeof SETTING_SCOPE)[number]

export const AUDIT_ENTITY_TYPE = [
  'USER',
  'ROLE',
  'TEAM',
  'RESTAURANT',
  'LOCATION',
  'ASSET',
  'REQUEST',
  'WORK_ORDER',
  'PROCEDURE',
  'PM_SCHEDULE',
  'INSPECTION',
  'PART',
  'INVENTORY',
  'VENDOR',
  'PURCHASE_ORDER',
  'DOCUMENT',
  'SETTING',
  'AUTH',
  'REPORT',
  'STOCK_COUNT',
  'VENDOR_CONTRACT',
  'AUTOMATION',
  'METER',
] as const
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPE)[number]

/** When a work-order photo / video was taken. */
export const EVIDENCE_STAGE = ['BEFORE', 'DURING', 'AFTER'] as const
export type EvidenceStage = (typeof EVIDENCE_STAGE)[number]

/** State the equipment was left in when the job was handed in. */
export const FINAL_CONDITION = [
  'FULLY_WORKING',
  'WORKING_WITH_LIMITATIONS',
  'NOT_WORKING',
  'NEEDS_REPLACEMENT',
] as const
export type FinalCondition = (typeof FINAL_CONDITION)[number]

export const PART_CONDITION = ['NEW', 'REFURBISHED', 'USED'] as const
export type PartCondition = (typeof PART_CONDITION)[number]

export const METER_TYPE = [
  'TEMPERATURE',
  'RUNTIME_HOURS',
  'PRESSURE',
  'CYCLES',
  'MILEAGE',
  'ENERGY',
  'OTHER',
] as const
export type MeterType = (typeof METER_TYPE)[number]

export const AUTOMATION_TRIGGER = [
  'WORK_ORDER_CREATED',
  'WORK_ORDER_OVERDUE',
  'WORK_ORDER_COMPLETED',
  'INSPECTION_FAILED',
  'METER_READING',
  'LOW_STOCK',
  'REQUEST_CREATED',
] as const
export type AutomationTrigger = (typeof AUTOMATION_TRIGGER)[number]

export const AUTOMATION_RUN_STATUS = ['SUCCESS', 'SKIPPED', 'FAILED'] as const
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUS)[number]

export const FAILURE_CATEGORY = [
  'MECHANICAL',
  'ELECTRICAL',
  'HUMAN_ERROR',
  'ENVIRONMENTAL',
  'WEAR_AND_TEAR',
  'INSTALLATION',
  'UNKNOWN',
  'OTHER',
] as const
export type FailureCategory = (typeof FAILURE_CATEGORY)[number]

export const REPEAT_UNIT = ['DAY', 'WEEK', 'MONTH'] as const
export type RepeatUnit = (typeof REPEAT_UNIT)[number]

export const REPEAT_BASIS = ['SCHEDULE', 'COMPLETION'] as const
export type RepeatBasis = (typeof REPEAT_BASIS)[number]

export const CUSTOM_FIELD_ENTITY = ['WORK_ORDER', 'ASSET'] as const
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITY)[number]

export const CUSTOM_FIELD_TYPE = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'CHECKBOX'] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPE)[number]

export const CONVERSATION_TYPE = ['DIRECT', 'GROUP'] as const
export type ConversationType = (typeof CONVERSATION_TYPE)[number]

/** How a PM schedule creates work orders: by the calendar or by a meter reading. */
export const PM_TRIGGER_TYPE = ['TIME', 'METER'] as const
export type PmTriggerType = (typeof PM_TRIGGER_TYPE)[number]

export const REPORT_FREQUENCY = ['DAILY', 'WEEKLY', 'MONTHLY'] as const
export type ReportFrequency = (typeof REPORT_FREQUENCY)[number]

export const REPORT_FORMAT = ['CSV', 'PDF'] as const
export type ReportFormat = (typeof REPORT_FORMAT)[number]

import type {
  AssetCriticality,
  AssetStatus,
  Priority,
  PurchaseOrderStatus,
  RequestStatus,
  RestaurantStatus,
  StepResult,
  UserStatus,
  WorkOrderStatus,
} from '@maintainx/shared'
import type { BadgeTone } from '@/components/ui/badge'

/**
 * Status → tone. One mapping for the whole app so the same state always has the
 * same colour. Exhaustive records: adding an enum value is a compile error here.
 *
 *   neutral  open / draft / inactive         info     assigned / ordered / new
 *   warning  in progress / waiting           success  done / healthy / received
 *   danger   broken / critical / failed      review   awaiting review
 *   outline  closed / retired / cancelled (finished, out of the way)
 */
export const WORK_ORDER_STATUS_TONE: Record<WorkOrderStatus, BadgeTone> = {
  DRAFT: 'outline',
  OPEN: 'neutral',
  ASSIGNED: 'info',
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  ON_HOLD: 'warning',
  COMPLETED: 'success',
  REVIEW: 'review',
  VERIFIED: 'success',
  CLOSED: 'outline',
  REOPENED: 'danger',
  CANCELLED: 'outline',
}

export const ASSET_STATUS_TONE: Record<AssetStatus, BadgeTone> = {
  OPERATIONAL: 'success',
  WARNING: 'warning',
  UNDER_MAINTENANCE: 'warning',
  BROKEN: 'danger',
  INACTIVE: 'neutral',
  RETIRED: 'outline',
}

export const PURCHASE_ORDER_STATUS_TONE: Record<PurchaseOrderStatus, BadgeTone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  ORDERED: 'info',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'outline',
}

export const REQUEST_STATUS_TONE: Record<RequestStatus, BadgeTone> = {
  NEW: 'info',
  APPROVED: 'review',
  CONVERTED: 'success',
  REJECTED: 'neutral',
}

export const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
}

export const ASSET_CRITICALITY_TONE: Record<AssetCriticality, BadgeTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
}

export const STEP_RESULT_TONE: Record<StepResult, BadgeTone> = {
  PASS: 'success',
  FAIL: 'danger',
  NA: 'neutral',
}

export const USER_STATUS_TONE: Record<UserStatus, BadgeTone> = {
  ACTIVE: 'success',
  INVITED: 'info',
  DISABLED: 'neutral',
}

export const RESTAURANT_STATUS_TONE: Record<RestaurantStatus, BadgeTone> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
}

export interface StatusValueMap {
  workOrderStatus: WorkOrderStatus
  assetStatus: AssetStatus
  assetCriticality: AssetCriticality
  purchaseOrderStatus: PurchaseOrderStatus
  requestStatus: RequestStatus
  priority: Priority
  stepResult: StepResult
  userStatus: UserStatus
  restaurantStatus: RestaurantStatus
}

export type StatusKind = keyof StatusValueMap

export const STATUS_TONES: { [K in StatusKind]: Record<StatusValueMap[K], BadgeTone> } = {
  workOrderStatus: WORK_ORDER_STATUS_TONE,
  assetStatus: ASSET_STATUS_TONE,
  assetCriticality: ASSET_CRITICALITY_TONE,
  purchaseOrderStatus: PURCHASE_ORDER_STATUS_TONE,
  requestStatus: REQUEST_STATUS_TONE,
  priority: PRIORITY_TONE,
  stepResult: STEP_RESULT_TONE,
  userStatus: USER_STATUS_TONE,
  restaurantStatus: RESTAURANT_STATUS_TONE,
}

export function statusTone<K extends StatusKind>(kind: K, value: StatusValueMap[K]): BadgeTone {
  return STATUS_TONES[kind][value]
}

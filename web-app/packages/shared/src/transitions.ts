import type { PurchaseOrderStatus, WorkOrderStatus } from './enums.js'

/**
 * Pure state-machine definitions. Services call `canTransition` before writing;
 * the UI uses the same maps to decide which action buttons to render.
 */

/**
 * Work order lifecycle:
 *   DRAFT → OPEN → ASSIGNED / SCHEDULED → IN_PROGRESS ⇄ ON_HOLD → COMPLETED
 *   → REVIEW ("pending verification") → VERIFIED → CLOSED
 * A supervisor who rejects the work, or anyone reopening a finished job, sends
 * it to REOPENED; from there it is worked again. CANCELLED is final.
 */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  DRAFT: ['OPEN', 'ASSIGNED', 'SCHEDULED', 'CANCELLED'],
  OPEN: ['ASSIGNED', 'SCHEDULED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'OPEN', 'SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['IN_PROGRESS', 'OPEN', 'ASSIGNED', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  // COMPLETED → REVIEW happens automatically on submission.
  COMPLETED: ['REVIEW', 'REOPENED'],
  REVIEW: ['VERIFIED', 'REOPENED'],
  // VERIFIED → CLOSED happens automatically when the supervisor approves.
  VERIFIED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['IN_PROGRESS', 'OPEN', 'CANCELLED'],
  CANCELLED: [],
}

/** Statuses that count as "open work" for dashboards, workload and overdue scans. */
export const WORK_ORDER_ACTIVE_STATUSES: readonly WorkOrderStatus[] = [
  'OPEN',
  'ASSIGNED',
  'SCHEDULED',
  'IN_PROGRESS',
  'ON_HOLD',
  'REOPENED',
]

/** Work the technician has finished (whether or not it is verified yet). */
export const WORK_ORDER_DONE_STATUSES: readonly WorkOrderStatus[] = [
  'COMPLETED',
  'REVIEW',
  'VERIFIED',
  'CLOSED',
]

/** Statuses a technician can start work from. */
export const WORK_ORDER_STARTABLE_STATUSES: readonly WorkOrderStatus[] = [
  'ASSIGNED',
  'SCHEDULED',
  'REOPENED',
]

/** Statuses from which a manager may reopen. */
export const WORK_ORDER_REOPENABLE_STATUSES: readonly WorkOrderStatus[] = [
  'COMPLETED',
  'VERIFIED',
  'CLOSED',
]

/** Statuses from which a manager may cancel. */
export const WORK_ORDER_CANCELLABLE_STATUSES: readonly WorkOrderStatus[] = [
  'DRAFT',
  ...WORK_ORDER_ACTIVE_STATUSES,
]

/** Active and past its due date. */
export function isWorkOrderOverdue(
  w: { status: WorkOrderStatus; dueDate: string | Date | null },
  now: Date = new Date(),
): boolean {
  if (!w.dueDate || !WORK_ORDER_ACTIVE_STATUSES.includes(w.status)) return false
  return new Date(w.dueDate).getTime() < now.getTime()
}

export const PURCHASE_ORDER_TRANSITIONS: Record<
  PurchaseOrderStatus,
  readonly PurchaseOrderStatus[]
> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['ORDERED', 'CANCELLED'],
  ORDERED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
}

export function canTransition<S extends string>(
  map: Record<S, readonly S[]>,
  from: S,
  to: S,
): boolean {
  return map[from].includes(to)
}

export function canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return canTransition(WORK_ORDER_TRANSITIONS, from, to)
}

export function canTransitionPurchaseOrder(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean {
  return canTransition(PURCHASE_ORDER_TRANSITIONS, from, to)
}

import type { WorkOrderActions, WorkOrderDetail } from '@maintainx/shared'

/** Work-order fields that most UI tests don't care about, with neutral values. */
export const WO_DEFAULTS = {
  scheduledStart: null,
  overdue: false,
  vendor: null,
  parentId: null,
  subProgress: { done: 0, total: 0 },
  verifiedAt: null,
  verifiedBy: null,
  cancelledAt: null,
  cancelReason: null,
  rejectionReason: null,
  supervisor: null,
  helpers: [],
  parent: null,
  children: [],
  cost: { parts: 0, labour: 0, vendor: 0, other: 0, total: 0 },
  costLines: [],
  completion: null,
  completionCheck: {
    stepsLeft: 0,
    needsBeforePhoto: false,
    needsAfterPhoto: false,
    subWorkOrdersOpen: 0,
    evidence: { BEFORE: 0, DURING: 0, AFTER: 0 },
    reportRequired: true,
    verificationRequired: true,
  },
  timeEntries: [],
  contacts: [],
  reservations: [],
  rootCause: null,
  repeat: null,
  customFields: {},
  labels: [],
  repeatedFrom: null,
  repeatedBy: null,
} satisfies Partial<WorkOrderDetail>

/** Engine actions added with the CMMS status flow (all off). */
export const NEW_ACTIONS = {
  publish: false,
  verify: false,
  reject: false,
  cancel: false,
  costs: false,
  time: false,
  reschedule: false,
  reserve: false,
  rca: false,
  internalNotes: false,
} satisfies Partial<WorkOrderActions>

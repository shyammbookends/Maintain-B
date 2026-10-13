import { z } from 'zod'
import type { CostBreakdown } from './assets.js'
import {
  PRIORITY,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_TYPE,
  type Priority,
  type WorkOrderStatus,
  type WorkOrderType,
} from './enums.js'

/** Longest period a dashboard covers (keeps the trend and the queries bounded). */
export const DASHBOARD_MAX_DAYS = 366

export const dashboardQuerySchema = z
  .object({
    /** Limit to one restaurant (must be in the user's scope); omitted = all of them. */
    restaurantId: z.uuid().optional(),
    /** Period (YYYY-MM-DD, inclusive). Default: the last 30 days. */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    // Work-order filters (apply to work-order numbers, not to stock or requests).
    priority: z.enum(PRIORITY).optional(),
    type: z.enum(WORK_ORDER_TYPE).optional(),
    category: z.enum(WORK_ORDER_CATEGORY).optional(),
    assignedUserId: z.uuid().optional(),
    teamId: z.uuid().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'validation.dateRange',
    path: ['to'],
  })
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>

export interface DashboardWorkOrder {
  id: string
  code: string
  title: string
  priority: Priority
  status: WorkOrderStatus
  dueDate: string | null
  restaurant: { id: string; name: string }
  assignee: { id: string; firstName: string; lastName: string } | null
}

export interface DashboardActivity {
  id: string
  /** dot.separated audit action, e.g. "user.created" */
  action: string
  entityType: string
  actor: { id: string; firstName: string; lastName: string } | null
  restaurant: { id: string; name: string } | null
  createdAt: string
}

export interface DashboardRestaurantRow {
  id: string
  code: string
  name: string
  open: number
  overdue: number
  critical: number
  /** Finished in the period. */
  completed: number
  /** Assets broken or under maintenance right now. */
  assetsDown: number
  /** Maintenance spend in the period. */
  cost: number
  /** Preventive work due in the period done on time (0–100), null when none was due. */
  pmCompliance: number | null
}

export interface DashboardTechnicianRow {
  user: { id: string; firstName: string; lastName: string }
  open: number
  inProgress: number
  overdue: number
  /** Finished in the period. */
  completed: number
}

export interface DashboardTrendPoint {
  /** YYYY-MM-DD (organization time zone). */
  date: string
  created: number
  completed: number
}

export interface DashboardSummary {
  generatedAt: string
  period: { from: string; to: string }
  counts: {
    restaurants: number
    /** Restaurants in scope that are open for business (status ACTIVE). */
    activeRestaurants: number
    users: number
    activeWorkers: number
    open: number
    overdue: number
    inProgress: number
    /** Finished, waiting for a supervisor to verify. */
    pendingVerification: number
    /** Completed in the selected period (historic name kept for the API). */
    completed30d: number
    critical: number
    lowStock: number
    openRequests: number
    /** Assets broken or under maintenance right now. */
    assetsDown: number
    /** …of which marked HIGH or CRITICAL criticality. */
    criticalAssetsDown: number
    /** Inspections submitted in the period with at least one failed step. */
    failedInspections: number
  }
  /** What happened today (organization time zone). */
  today: {
    newRequests: number
    created: number
    inProgress: number
    completed: number
    overdue: number
    critical: number
    pmDue: number
    failedInspections: number
  }
  /** Preventive work orders due in the period completed on time (0–100), or null if none were due. */
  pmCompliance: number | null
  /** Work orders created in the period by type (reactive vs preventive vs follow-ups). */
  mix: Record<WorkOrderType, number>
  cost: CostBreakdown
  /** Asset downtime in the period, hours. */
  downtimeHours: number
  /** Mean time to repair: average hours from start to completion of reactive jobs finished in the period. */
  mttrHours: number | null
  /** Finished in the period by their due date (0–100), null when none had one. */
  onTimeRate: number | null
  trend: DashboardTrendPoint[]
  /** Open work by priority. */
  byPriority: Record<Priority, number>
  /** Work in each status right now (excluding closed and cancelled). */
  byStatus: Array<{ status: WorkOrderStatus; count: number }>
  workload: DashboardTechnicianRow[]
  todaysTasks: DashboardWorkOrder[]
  criticalIssues: DashboardWorkOrder[]
  overdueTasks: DashboardWorkOrder[]
  /** Audit viewers: all activity; others: operational activity in their restaurants. */
  recentActivity: DashboardActivity[]
  restaurants: DashboardRestaurantRow[]
}

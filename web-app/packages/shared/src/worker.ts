import { z } from 'zod'
import {
  PRIORITY,
  WORK_ORDER_STATUS,
  type Priority,
  type WorkOrderStatus,
  type WorkOrderType,
} from './enums.js'
import { paginationQuerySchema } from './schemas/common.js'

/** The worker app's view of a task (a work order assigned to them or their team). */
export interface WorkerTask {
  id: string
  code: string
  title: string
  priority: Priority
  status: WorkOrderStatus
  type: WorkOrderType
  dueDate: string | null
  scheduledStart: string | null
  overdue: boolean
  completedAt: string | null
  restaurant: { id: string; name: string }
  location: { id: string; name: string } | null
  asset: { id: string; name: string } | null
  /** Set when the task reached the worker through a team rather than directly. */
  team: { id: string; name: string } | null
}

export interface WorkerHome {
  counts: {
    /** Active tasks due today or earlier. */
    today: number
    overdue: number
    inProgress: number
    /** Completed in the last 7 days. */
    doneThisWeek: number
    /** Open work marked HIGH or CRITICAL. */
    highPriority: number
    /** Open preventive maintenance jobs. */
    preventive: number
    /** Opening / closing checklists still to do today in my restaurants. */
    checklistsDue: number
  }
  /** Next tasks to do: overdue first, then soonest due. */
  next: WorkerTask[]
}

export const WORKER_TASK_VIEWS = ['today', 'upcoming', 'overdue', 'done'] as const
export type WorkerTaskView = (typeof WORKER_TASK_VIEWS)[number]

export const workerTasksQuerySchema = paginationQuerySchema.extend({
  view: z.enum(WORKER_TASK_VIEWS).default('today'),
  priority: z.enum(PRIORITY).optional(),
  status: z.enum(WORK_ORDER_STATUS).optional(),
  restaurantId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  /** Only preventive maintenance. */
  pm: z.enum(['1']).optional(),
})
export type WorkerTasksQuery = z.infer<typeof workerTasksQuerySchema>

export const workerScheduleQuerySchema = z.object({
  /** First day (YYYY-MM-DD, in the organisation's time zone). Defaults to today. */
  from: z.iso.date().optional(),
  days: z.coerce.number().int().min(1).max(31).default(14),
})
export type WorkerScheduleQuery = z.infer<typeof workerScheduleQuerySchema>

export interface WorkerScheduleDay {
  /** YYYY-MM-DD in the organisation's time zone. */
  date: string
  tasks: WorkerTask[]
}

export interface WorkerSchedule {
  timeZone: string
  days: WorkerScheduleDay[]
}

export interface WorkerRestaurant {
  id: string
  code: string
  name: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  phone: string | null
  opensAt: string | null
  closesAt: string | null
  openTasks: number
}

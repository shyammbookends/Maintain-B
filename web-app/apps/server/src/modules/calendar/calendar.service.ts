import {
  WORK_ORDER_ACTIVE_STATUSES,
  addDays,
  isWorkOrderOverdue,
  upcomingOccurrences,
  type CalendarForecast,
  type CalendarItem,
  type CalendarQuery,
  type CalendarWorkOrder,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import { startOfDateInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'
import { ruleOf } from '../maintenance/pm-generator.js'
import { visibleWhere } from '../work-orders/work-orders.service.js'

/*
 * The maintenance calendar: work orders placed at their planned start (or due
 * date when not planned), plus preventive jobs that will be generated later
 * ("forecast"), so the coming weeks are visible before the work orders exist.
 */

const MAX_DAYS = 62
const DAY = 86_400_000
const person = { select: { id: true, firstName: true, lastName: true } } as const

export async function getCalendar(auth: AuthContext, q: CalendarQuery): Promise<CalendarItem[]> {
  const days = Math.round((Date.parse(q.to) - Date.parse(q.from)) / DAY) + 1
  if (days > MAX_DAYS) throw new ValidationError({ to: ['validation.periodTooLong'] })
  if (q.restaurantId && !canAccessRestaurant(auth, q.restaurantId)) return []

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: auth.organizationId },
    select: { timezone: true },
  })
  const start = startOfDateInZone(org.timezone, q.from)
  const end = startOfDateInZone(org.timezone, addDays(q.to, 1))
  const range = { gte: start, lt: end }

  const filters: Prisma.WorkOrderWhereInput[] = [
    await visibleWhere(auth),
    { status: { not: 'CANCELLED' } },
    { OR: [{ scheduledStart: range }, { scheduledStart: null, dueDate: range }] },
  ]
  if (q.restaurantId) filters.push({ restaurantId: q.restaurantId })
  if (q.assignedUserId)
    filters.push({
      OR: [
        { assignedUserId: q.assignedUserId },
        { helpers: { some: { userId: q.assignedUserId } } },
      ],
    })
  if (q.teamId) filters.push({ assignedTeamId: q.teamId })

  const rows = await prisma.workOrder.findMany({
    where: { AND: filters },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      priority: true,
      type: true,
      scheduledStart: true,
      dueDate: true,
      estimatedMinutes: true,
      restaurant: { select: { id: true, name: true } },
      asset: { select: { id: true, name: true } },
      assignedUser: person,
      assignedTeam: { select: { id: true, name: true } },
    },
    orderBy: [{ scheduledStart: 'asc' }, { dueDate: 'asc' }],
    take: 1000,
  })
  const canMove = auth.user.roleKind !== 'WORKER' && hasPermission(auth, 'work_orders:assign')
  const now = new Date()
  const items: CalendarItem[] = rows.map((w): CalendarWorkOrder => ({
    kind: 'work_order',
    id: w.id,
    code: w.code,
    title: w.title,
    status: w.status,
    priority: w.priority,
    type: w.type,
    at: (w.scheduledStart ?? w.dueDate)!.toISOString(),
    scheduledStart: w.scheduledStart?.toISOString() ?? null,
    dueDate: w.dueDate?.toISOString() ?? null,
    estimatedMinutes: w.estimatedMinutes,
    overdue: isWorkOrderOverdue(w, now),
    restaurant: w.restaurant,
    asset: w.asset,
    assignedUser: w.assignedUser,
    assignedTeam: w.assignedTeam,
    canReschedule:
      canMove &&
      (w.status === 'DRAFT' ||
        ((WORK_ORDER_ACTIVE_STATUSES as readonly string[]).includes(w.status) &&
          w.status !== 'IN_PROGRESS')),
  }))

  if (hasPermission(auth, 'maintenance:view')) items.push(...(await forecast(auth, q)))
  return items
}

/** Occurrences of active schedules in the range that have no work order yet. */
async function forecast(auth: AuthContext, q: CalendarQuery): Promise<CalendarForecast[]> {
  const schedules = await prisma.pmSchedule.findMany({
    where: {
      organizationId: auth.organizationId,
      active: true,
      archivedAt: null,
      restaurantId: q.restaurantId ?? restaurantScope(auth),
      ...(q.assignedUserId ? { defaultAssigneeUserId: q.assignedUserId } : {}),
      ...(q.teamId ? { defaultAssigneeTeamId: q.teamId } : {}),
    },
    include: {
      restaurant: { select: { id: true, name: true } },
      asset: { select: { id: true, name: true } },
      defaultAssigneeUser: person,
      defaultAssigneeTeam: { select: { id: true, name: true } },
      workOrders: {
        where: { pmDueDate: { gte: new Date(`${q.from}T00:00:00Z`) } },
        select: { pmDueDate: true },
      },
    },
    take: 500,
  })
  const out: CalendarForecast[] = []
  for (const s of schedules) {
    const nextKey = s.nextDueAt.toISOString().slice(0, 10)
    const fromKey = q.from > nextKey ? q.from : nextKey
    const generated = new Set(
      s.workOrders.map((w) => w.pmDueDate?.toISOString().slice(0, 10)).filter(Boolean),
    )
    for (const date of upcomingOccurrences(ruleOf(s), fromKey, MAX_DAYS)) {
      if (date > q.to) break
      if (generated.has(date)) continue
      out.push({
        kind: 'forecast',
        id: `${s.id}:${date}`,
        scheduleId: s.id,
        name: s.name,
        date,
        priority: s.priority,
        restaurant: s.restaurant,
        asset: s.asset,
        assignedUser: s.defaultAssigneeUser,
        assignedTeam: s.defaultAssigneeTeam,
      })
    }
  }
  return out
}

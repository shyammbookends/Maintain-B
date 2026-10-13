import {
  DASHBOARD_MAX_DAYS,
  PRIORITY,
  WORK_ORDER_ACTIVE_STATUSES,
  WORK_ORDER_TYPE,
  type DashboardActivity,
  type DashboardQuery,
  type DashboardSummary,
  type DashboardTrendPoint,
  type DashboardWorkOrder,
  type Priority,
  type WorkOrderStatus,
  type WorkOrderType,
} from '@maintainx/shared'
import { Prisma } from '@prisma/client'
import { canAccessRestaurant, hasPermission } from '../../core/authz.js'
import { costBreakdown, costByRestaurant } from '../../core/costs.js'
import { ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import { dateKeyInZone, dayRangeInZone, startOfDateInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * One summary for the Super Admin control centre and the Admin command centre.
 * Scope = the restaurants the user can see (optionally one of them). Period
 * defaults to the last 30 days. Work-order filters narrow work-order numbers;
 * stock, requests and inspections follow scope and period only.
 */

const LIST_LIMIT = 6
const ACTIVITY_LIMIT = 10
const WORKLOAD_LIMIT = 12
const DAY = 86_400_000
const DOWN = ['BROKEN', 'UNDER_MAINTENANCE'] as const

const workOrderSelect = {
  id: true,
  code: true,
  title: true,
  priority: true,
  status: true,
  dueDate: true,
  restaurant: { select: { id: true, name: true } },
  assignedUser: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.WorkOrderSelect

type WorkOrderRow = Prisma.WorkOrderGetPayload<{ select: typeof workOrderSelect }>

function toItem(w: WorkOrderRow): DashboardWorkOrder {
  return {
    id: w.id,
    code: w.code,
    title: w.title,
    priority: w.priority,
    status: w.status,
    dueDate: w.dueDate?.toISOString() ?? null,
    restaurant: w.restaurant,
    assignee: w.assignedUser,
  }
}

/** Restaurant ids the summary covers: the requested one (if in scope) or the whole scope. */
function resolveRestaurantIds(auth: AuthContext, restaurantId?: string): string[] {
  if (restaurantId) return canAccessRestaurant(auth, restaurantId) ? [restaurantId] : []
  return auth.user.restaurants.map((r) => r.id)
}

/** Super Admin / audit viewers see everything; others see operational activity in their restaurants. */
function activityWhere(
  auth: AuthContext,
  restaurantIds: string[],
  oneRestaurant: boolean,
): Prisma.AuditLogWhereInput {
  const base: Prisma.AuditLogWhereInput = {
    organizationId: auth.organizationId,
    entityType: { not: 'AUTH' },
  }
  if (hasPermission(auth, 'audit_logs:view') && !oneRestaurant) return base
  return {
    ...base,
    restaurantId: { in: restaurantIds },
    entityType: { notIn: ['AUTH', 'USER', 'ROLE', 'SETTING'] },
  }
}

const pct = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100))
const onTime = (r: { completedAt: Date | null; dueDate: Date | null }) =>
  !!r.completedAt && !!r.dueDate && r.completedAt <= r.dueDate

export async function getDashboard(
  auth: AuthContext,
  q: DashboardQuery = {},
): Promise<DashboardSummary> {
  const restaurantIds = resolveRestaurantIds(auth, q.restaurantId)
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: auth.organizationId },
    select: { timezone: true },
  })
  const tz = org.timezone
  const now = new Date()
  const today = dayRangeInZone(tz, now)

  // Period [from, to) in the organization's time zone; default the last 30 days.
  const toKey = q.to ?? dateKeyInZone(tz, now)
  const fromKey = q.from ?? dateKeyInZone(tz, new Date(now.getTime() - 29 * DAY))
  const from = startOfDateInZone(tz, fromKey)
  const to = new Date(startOfDateInZone(tz, toKey).getTime() + DAY)
  const days = Math.round((to.getTime() - from.getTime()) / DAY)
  if (days > DASHBOARD_MAX_DAYS) throw new ValidationError({ from: ['validation.periodTooLong'] })
  const periodEnd = to < now ? to : now

  // ---- shared filters
  const scope: Prisma.WorkOrderWhereInput = {
    organizationId: auth.organizationId,
    archivedAt: null,
    restaurantId: { in: restaurantIds },
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.teamId ? { assignedTeamId: q.teamId } : {}),
    ...(q.assignedUserId
      ? {
          OR: [
            { assignedUserId: q.assignedUserId },
            { helpers: { some: { userId: q.assignedUserId } } },
          ],
        }
      : {}),
  }
  const active: Prisma.WorkOrderWhereInput = {
    ...scope,
    status: { in: [...WORK_ORDER_ACTIVE_STATUSES] },
  }
  const overdueWhere: Prisma.WorkOrderWhereInput = { ...active, dueDate: { lt: now } }
  const criticalWhere: Prisma.WorkOrderWhereInput = { ...active, priority: 'CRITICAL' }
  const inPeriod = { gte: from, lt: to }
  const assetScope: Prisma.AssetWhereInput = {
    organizationId: auth.organizationId,
    archivedAt: null,
    restaurantId: { in: restaurantIds },
  }
  const failedInspection = (range: { gte: Date; lt: Date }): Prisma.InspectionWhereInput => ({
    organizationId: auth.organizationId,
    restaurantId: { in: restaurantIds },
    status: 'SUBMITTED',
    submittedAt: range,
    items: { some: { result: 'FAIL' } },
  })
  const userInScope: Prisma.UserWhereInput = {
    organizationId: auth.organizationId,
    archivedAt: null,
    status: 'ACTIVE',
    userRestaurants: { some: { restaurantId: { in: restaurantIds } } },
  }

  const [
    open,
    overdue,
    inProgress,
    pendingVerification,
    completedInPeriod,
    critical,
    todaysTasks,
    criticalIssues,
    overdueTasks,
    pmRows,
    lowStockRows,
    restaurants,
    openBy,
    overdueBy,
    criticalBy,
    completedBy,
    activity,
    users,
    activeWorkers,
    openRequests,
    assetsDownBy,
    criticalAssetsDown,
    failedInspections,
    todayCounts,
    mixRows,
    priorityRows,
    statusRows,
    finishedRows,
    downtime,
    cost,
    costBy,
    trend,
    workload,
  ] = await Promise.all([
    prisma.workOrder.count({ where: active }),
    prisma.workOrder.count({ where: overdueWhere }),
    prisma.workOrder.count({ where: { ...scope, status: 'IN_PROGRESS' } }),
    prisma.workOrder.count({ where: { ...scope, status: 'REVIEW' } }),
    prisma.workOrder.count({ where: { ...scope, completedAt: inPeriod } }),
    prisma.workOrder.count({ where: criticalWhere }),
    prisma.workOrder.findMany({
      where: { ...active, dueDate: { gte: today.start, lt: today.end } },
      select: workOrderSelect,
      orderBy: [{ dueDate: 'asc' }],
      take: LIST_LIMIT,
    }),
    prisma.workOrder.findMany({
      where: criticalWhere,
      select: workOrderSelect,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: LIST_LIMIT,
    }),
    prisma.workOrder.findMany({
      where: overdueWhere,
      select: workOrderSelect,
      orderBy: { dueDate: 'asc' },
      take: LIST_LIMIT,
    }),
    prisma.workOrder.findMany({
      where: {
        ...scope,
        type: 'PREVENTIVE',
        status: { not: 'CANCELLED' },
        dueDate: { gte: from, lt: periodEnd },
      },
      select: { restaurantId: true, dueDate: true, completedAt: true },
    }),
    restaurantIds.length === 0
      ? Promise.resolve([{ count: 0n }])
      : prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM inventory i
          JOIN parts p ON p.id = i.part_id
          WHERE i.organization_id = ${auth.organizationId}::uuid
            AND p.archived_at IS NULL
            AND i.restaurant_id = ANY(${restaurantIds}::uuid[])
            AND COALESCE(i.min_stock, p.min_stock) > 0
            AND i.quantity <= COALESCE(i.min_stock, p.min_stock)`,
    prisma.restaurant.findMany({
      where: { id: { in: restaurantIds }, archivedAt: null },
      select: { id: true, code: true, name: true, status: true },
      orderBy: { name: 'asc' },
    }),
    prisma.workOrder.groupBy({ by: ['restaurantId'], where: active, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ['restaurantId'], where: overdueWhere, _count: { _all: true } }),
    prisma.workOrder.groupBy({
      by: ['restaurantId'],
      where: criticalWhere,
      _count: { _all: true },
    }),
    prisma.workOrder.groupBy({
      by: ['restaurantId'],
      where: { ...scope, completedAt: inPeriod },
      _count: { _all: true },
    }),
    prisma.auditLog.findMany({
      where: activityWhere(auth, restaurantIds, !!q.restaurantId),
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
        restaurant: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_LIMIT,
    }),
    prisma.user.count({ where: userInScope }),
    prisma.user.count({
      where: { ...userInScope, userRoles: { some: { role: { kind: 'WORKER' } } } },
    }),
    prisma.request.count({
      where: {
        organizationId: auth.organizationId,
        restaurantId: { in: restaurantIds },
        status: { in: ['NEW', 'APPROVED'] },
      },
    }),
    prisma.asset.groupBy({
      by: ['restaurantId'],
      where: { ...assetScope, status: { in: [...DOWN] } },
      _count: { _all: true },
    }),
    prisma.asset.count({
      where: {
        ...assetScope,
        status: { in: [...DOWN] },
        criticality: { in: ['HIGH', 'CRITICAL'] },
      },
    }),
    prisma.inspection.count({ where: failedInspection(inPeriod) }),
    Promise.all([
      prisma.request.count({
        where: {
          organizationId: auth.organizationId,
          restaurantId: { in: restaurantIds },
          createdAt: { gte: today.start, lt: today.end },
        },
      }),
      prisma.workOrder.count({
        where: { ...scope, createdAt: { gte: today.start, lt: today.end } },
      }),
      prisma.workOrder.count({
        where: { ...scope, completedAt: { gte: today.start, lt: today.end } },
      }),
      prisma.workOrder.count({
        where: { ...active, type: 'PREVENTIVE', dueDate: { gte: today.start, lt: today.end } },
      }),
      prisma.inspection.count({ where: failedInspection({ gte: today.start, lt: today.end }) }),
    ]),
    prisma.workOrder.groupBy({
      by: ['type'],
      where: { ...scope, createdAt: inPeriod, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    }),
    prisma.workOrder.groupBy({ by: ['priority'], where: active, _count: { _all: true } }),
    prisma.workOrder.groupBy({
      by: ['status'],
      where: { ...scope, status: { notIn: ['CLOSED', 'CANCELLED'] } },
      _count: { _all: true },
    }),
    prisma.workOrder.findMany({
      where: { ...scope, completedAt: inPeriod },
      select: { type: true, startedAt: true, completedAt: true, dueDate: true },
    }),
    restaurantIds.length === 0
      ? Promise.resolve([{ hours: 0 }])
      : prisma.$queryRaw<Array<{ hours: number | null }>>`
          SELECT SUM(EXTRACT(EPOCH FROM (
                   LEAST(COALESCE(d.ended_at, now()), ${periodEnd}) - GREATEST(d.started_at, ${from})
                 ))) / 3600 AS hours
            FROM asset_downtime d JOIN assets a ON a.id = d.asset_id
           WHERE a.organization_id = ${auth.organizationId}::uuid
             AND a.restaurant_id = ANY(${restaurantIds}::uuid[])
             AND d.started_at < ${periodEnd}
             AND COALESCE(d.ended_at, now()) > ${from}`,
    costBreakdown({ organizationId: auth.organizationId, restaurantIds, from, to }),
    costByRestaurant({ organizationId: auth.organizationId, restaurantIds, from, to }),
    trendSeries(auth.organizationId, restaurantIds, tz, from, to, fromKey, days, q),
    technicianWorkload(scope, inPeriod, now),
  ])

  const countBy = <K extends string>(
    rows: Array<Record<K, string> & { _count: { _all: number } }>,
    key: K,
  ) => new Map(rows.map((r) => [r[key], r._count._all]))
  const openMap = countBy(openBy, 'restaurantId')
  const overdueMap = countBy(overdueBy, 'restaurantId')
  const criticalMap = countBy(criticalBy, 'restaurantId')
  const completedMap = countBy(completedBy, 'restaurantId')
  const downMap = countBy(assetsDownBy, 'restaurantId')
  const mixMap = countBy(mixRows, 'type')
  const priorityMap = countBy(priorityRows, 'priority')

  const reactiveDone = finishedRows.filter((r) => r.type !== 'PREVENTIVE' && r.startedAt)
  const repairHours = reactiveDone.map(
    (r) => (r.completedAt!.getTime() - r.startedAt!.getTime()) / 3_600_000,
  )
  const withDue = finishedRows.filter((r) => r.dueDate)
  const [newRequests, createdToday, completedToday, pmDueToday, failedToday] = todayCounts

  return {
    generatedAt: now.toISOString(),
    period: { from: fromKey, to: toKey },
    counts: {
      restaurants: restaurants.length,
      activeRestaurants: restaurants.filter((r) => r.status === 'ACTIVE').length,
      users,
      activeWorkers,
      open,
      overdue,
      inProgress,
      pendingVerification,
      completed30d: completedInPeriod,
      critical,
      lowStock: Number(lowStockRows[0]?.count ?? 0n),
      openRequests,
      assetsDown: [...downMap.values()].reduce((a, b) => a + b, 0),
      criticalAssetsDown,
      failedInspections,
    },
    today: {
      newRequests,
      created: createdToday,
      inProgress,
      completed: completedToday,
      overdue,
      critical,
      pmDue: pmDueToday,
      failedInspections: failedToday,
    },
    pmCompliance: pct(pmRows.filter(onTime).length, pmRows.length),
    mix: Object.fromEntries(WORK_ORDER_TYPE.map((t) => [t, mixMap.get(t) ?? 0])) as Record<
      WorkOrderType,
      number
    >,
    cost,
    downtimeHours: Math.round(Number(downtime[0]?.hours ?? 0) * 10) / 10,
    mttrHours: repairHours.length
      ? Math.round((repairHours.reduce((a, b) => a + b, 0) / repairHours.length) * 10) / 10
      : null,
    onTimeRate: pct(withDue.filter(onTime).length, withDue.length),
    trend,
    byPriority: Object.fromEntries(PRIORITY.map((p) => [p, priorityMap.get(p) ?? 0])) as Record<
      Priority,
      number
    >,
    byStatus: statusRows
      .map((r) => ({ status: r.status as WorkOrderStatus, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    workload,
    todaysTasks: todaysTasks.map(toItem),
    criticalIssues: criticalIssues.map(toItem),
    overdueTasks: overdueTasks.map(toItem),
    recentActivity: activity.map((a): DashboardActivity => ({
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      actor: a.actor,
      restaurant: a.restaurant,
      createdAt: a.createdAt.toISOString(),
    })),
    restaurants: restaurants.map((r) => {
      const pm = pmRows.filter((p) => p.restaurantId === r.id)
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        open: openMap.get(r.id) ?? 0,
        overdue: overdueMap.get(r.id) ?? 0,
        critical: criticalMap.get(r.id) ?? 0,
        completed: completedMap.get(r.id) ?? 0,
        assetsDown: downMap.get(r.id) ?? 0,
        cost: costBy.get(r.id)?.total ?? 0,
        pmCompliance: pct(pm.filter(onTime).length, pm.length),
      }
    }),
  }
}

/** Work created and finished per day of the period (organization time zone). */
async function trendSeries(
  organizationId: string,
  restaurantIds: string[],
  tz: string,
  from: Date,
  to: Date,
  fromKey: string,
  days: number,
  q: DashboardQuery,
): Promise<DashboardTrendPoint[]> {
  const series = new Map<string, DashboardTrendPoint>()
  for (let i = 0; i < days; i++) {
    const date = dateKeyInZone(
      tz,
      new Date(startOfDate(fromKey).getTime() + i * DAY + 12 * 3_600_000),
    )
    series.set(date, { date, created: 0, completed: 0 })
  }
  if (restaurantIds.length === 0) return [...series.values()]
  const filters: Prisma.Sql[] = [
    Prisma.sql`w.organization_id = ${organizationId}::uuid`,
    Prisma.sql`w.archived_at IS NULL`,
    Prisma.sql`w.restaurant_id = ANY(${restaurantIds}::uuid[])`,
  ]
  if (q.priority) filters.push(Prisma.sql`w.priority = ${q.priority}::"Priority"`)
  if (q.type) filters.push(Prisma.sql`w.type = ${q.type}::"WorkOrderType"`)
  if (q.category) filters.push(Prisma.sql`w.category = ${q.category}::"WorkOrderCategory"`)
  if (q.teamId) filters.push(Prisma.sql`w.assigned_team_id = ${q.teamId}::uuid`)
  if (q.assignedUserId)
    filters.push(
      Prisma.sql`(w.assigned_user_id = ${q.assignedUserId}::uuid OR EXISTS (
        SELECT 1 FROM work_order_assignments h
         WHERE h.work_order_id = w.id AND h.user_id = ${q.assignedUserId}::uuid))`,
    )
  const where = Prisma.join(filters, ' AND ')
  const rows = await prisma.$queryRaw<Array<{ day: string; kind: string; n: bigint }>>`
    SELECT to_char(w.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, 'created' AS kind, COUNT(*)::bigint AS n
      FROM work_orders w
     WHERE ${where} AND w.created_at >= ${from} AND w.created_at < ${to}
     GROUP BY 1
    UNION ALL
    SELECT to_char(w.completed_at AT TIME ZONE ${tz}, 'YYYY-MM-DD'), 'completed', COUNT(*)::bigint
      FROM work_orders w
     WHERE ${where} AND w.completed_at >= ${from} AND w.completed_at < ${to}
     GROUP BY 1`
  for (const r of rows) {
    const point = series.get(r.day)
    if (!point) continue
    if (r.kind === 'created') point.created = Number(r.n)
    else point.completed = Number(r.n)
  }
  return [...series.values()]
}

/** Calendar date at UTC midnight (only used to step through dates). */
function startOfDate(key: string) {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
}

/** Busiest technicians first: open work, what is running, overdue, finished in the period. */
async function technicianWorkload(
  scope: Prisma.WorkOrderWhereInput,
  inPeriod: { gte: Date; lt: Date },
  now: Date,
) {
  const [activeRows, doneRows] = await Promise.all([
    prisma.workOrder.findMany({
      where: { ...scope, status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } },
      select: {
        status: true,
        dueDate: true,
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
      },
      take: 5000,
    }),
    prisma.workOrder.groupBy({
      by: ['assignedUserId'],
      where: { ...scope, completedAt: inPeriod, assignedUserId: { not: null } },
      _count: { _all: true },
    }),
  ])
  const done = new Map(doneRows.map((r) => [r.assignedUserId!, r._count._all]))
  const rows = new Map<string, DashboardSummary['workload'][number]>()
  for (const w of activeRows) {
    if (!w.assignedUser) continue
    const row = rows.get(w.assignedUser.id) ?? {
      user: w.assignedUser,
      open: 0,
      inProgress: 0,
      overdue: 0,
      completed: done.get(w.assignedUser.id) ?? 0,
    }
    row.open++
    if (w.status === 'IN_PROGRESS') row.inProgress++
    if (w.dueDate && w.dueDate < now) row.overdue++
    rows.set(w.assignedUser.id, row)
  }
  return [...rows.values()]
    .sort((a, b) => b.open - a.open || b.overdue - a.overdue)
    .slice(0, WORKLOAD_LIMIT)
}

import {
  WORK_ORDER_ACTIVE_STATUSES,
  fullName,
  isLowStock,
  type ReportCell,
  type ReportColumn,
  type ReportColumnType,
  type ReportKey,
  type ReportQuery,
  type ReportResult,
} from '@maintainx/shared'
import { canAccessRestaurant } from '../../core/authz.js'
import { ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { Prisma } from '@prisma/client'
import * as kpi from './reports.kpi.js'
import { dateKeyInZone, startOfDateInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Reports run over the restaurants the user can access (or one of them), for
 * a date range in the organization's time zone. Every report returns columns,
 * rows and a few headline numbers; the CSV export uses the same data.
 */

const MAX_ROWS = 5000
const HOUR = 3_600_000
const DAY = 24 * HOUR

interface Ctx {
  orgId: string
  restaurantIds: string[]
  from: Date
  /** Exclusive end (start of the day after `to`). */
  to: Date
  now: Date
  /** Work-order filters (location, asset, technician, team, vendor, priority, status, type). */
  wo: Prisma.WorkOrderWhereInput
  /** The organization's time zone (report days are its calendar days). */
  timeZone: string
}

type Row = Record<string, ReportCell>
interface Built {
  columns: ReportColumn[]
  rows: Row[]
  summary: ReportResult['summary']
}

const col = (key: string, type: ReportColumnType = 'text'): ReportColumn => ({
  key,
  label: key,
  type,
})
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const pct = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null
const dateOnly = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const person = { select: { id: true, firstName: true, lastName: true } } as const

async function context(auth: AuthContext, q: ReportQuery): Promise<Ctx> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: auth.organizationId },
    select: { timezone: true },
  })
  let restaurantIds: string[]
  if (q.restaurantId) {
    if (!canAccessRestaurant(auth, q.restaurantId))
      throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
    restaurantIds = [q.restaurantId]
  } else {
    const rows = await prisma.restaurant.findMany({
      where: {
        organizationId: auth.organizationId,
        archivedAt: null,
        ...(auth.isSuperAdmin ? {} : { id: { in: [...auth.restaurantIds] } }),
      },
      select: { id: true },
    })
    restaurantIds = rows.map((r) => r.id)
  }
  const toNext = new Date(Date.parse(`${q.to}T00:00:00Z`) + DAY).toISOString().slice(0, 10)
  return {
    orgId: auth.organizationId,
    restaurantIds,
    from: startOfDateInZone(org.timezone, q.from),
    to: startOfDateInZone(org.timezone, toNext),
    now: new Date(),
    wo: kpi.workOrderFilters(q),
    timeZone: org.timezone,
  }
}

const inRange = (c: Ctx) => ({ gte: c.from, lt: c.to })

// ---------------------------------------------------------------- work

async function workOrderSummary(c: Ctx): Promise<Built> {
  const restaurants = await prisma.restaurant.findMany({
    where: { id: { in: c.restaurantIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  const scope = { organizationId: c.orgId, restaurantId: { in: c.restaurantIds }, archivedAt: null }
  const group = async (where: Prisma.WorkOrderWhereInput) => {
    const rows = await prisma.workOrder.groupBy({
      by: ['restaurantId'],
      where: { AND: [scope, c.wo, where] },
      _count: { _all: true },
    })
    return new Map(rows.map((r) => [r.restaurantId, r._count._all]))
  }
  const active = { status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } }
  const [created, completed, open, overdue, critical] = await Promise.all([
    group({ createdAt: inRange(c) }),
    group({ completedAt: inRange(c) }),
    group(active),
    group({ ...active, dueDate: { lt: c.now } }),
    group({ ...active, priority: 'CRITICAL' }),
  ])
  const rows = restaurants.map((r) => ({
    restaurant: r.name,
    created: created.get(r.id) ?? 0,
    completed: completed.get(r.id) ?? 0,
    open: open.get(r.id) ?? 0,
    overdue: overdue.get(r.id) ?? 0,
    critical: critical.get(r.id) ?? 0,
  }))
  const total = (k: keyof (typeof rows)[number]) => sum(rows.map((r) => r[k] as number))
  return {
    columns: [
      col('restaurant'),
      col('created', 'number'),
      col('completed', 'number'),
      col('open', 'number'),
      col('overdue', 'number'),
      col('critical', 'number'),
    ],
    rows,
    summary: [
      { label: 'created', value: total('created'), type: 'number' },
      { label: 'completed', value: total('completed'), type: 'number' },
      { label: 'open', value: total('open'), type: 'number' },
      { label: 'overdue', value: total('overdue'), type: 'number' },
    ],
  }
}

async function workOrdersCompleted(c: Ctx): Promise<Built> {
  const rows = await prisma.workOrder.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      AND: [c.wo],
      completedAt: inRange(c),
    },
    include: {
      restaurant: { select: { name: true } },
      asset: { select: { name: true } },
      assignedUser: person,
      assignedTeam: { select: { name: true } },
    },
    orderBy: { completedAt: 'desc' },
    take: MAX_ROWS + 1,
  })
  const out = rows.map((w) => ({
    code: w.code,
    title: w.title,
    restaurant: w.restaurant.name,
    asset: w.asset?.name ?? null,
    type: w.type,
    category: w.category,
    priority: w.priority,
    assignee: w.assignedUser ? fullName(w.assignedUser) : (w.assignedTeam?.name ?? null),
    completedAt: iso(w.completedAt),
    hoursWorked: r1((w.actualMinutes ?? 0) / 60),
    onTime: w.dueDate ? (w.completedAt! <= w.dueDate ? 'yes' : 'no') : null,
  }))
  const withDue = out.filter((r) => r.onTime !== null)
  return {
    columns: [
      col('code'),
      col('title'),
      col('restaurant'),
      col('asset'),
      col('type'),
      col('category'),
      col('priority'),
      col('assignee'),
      col('completedAt', 'datetime'),
      col('hoursWorked', 'hours'),
      col('onTime'),
    ],
    rows: out,
    summary: [
      { label: 'completed', value: out.length, type: 'number' },
      { label: 'hoursWorked', value: r1(sum(out.map((r) => r.hoursWorked))), type: 'hours' },
      {
        label: 'onTimeRate',
        value: pct(withDue.filter((r) => r.onTime === 'yes').length, withDue.length) ?? 0,
        type: 'percent',
      },
    ],
  }
}

async function overdueWorkOrders(c: Ctx): Promise<Built> {
  const rows = await prisma.workOrder.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      AND: [c.wo],
      archivedAt: null,
      status: { in: [...WORK_ORDER_ACTIVE_STATUSES] },
      dueDate: { lt: c.now },
    },
    include: {
      restaurant: { select: { name: true } },
      assignedUser: person,
      assignedTeam: { select: { name: true } },
    },
    orderBy: { dueDate: 'asc' },
    take: MAX_ROWS + 1,
  })
  const out = rows.map((w) => ({
    code: w.code,
    title: w.title,
    restaurant: w.restaurant.name,
    status: w.status,
    priority: w.priority,
    assignee: w.assignedUser ? fullName(w.assignedUser) : (w.assignedTeam?.name ?? null),
    dueDate: iso(w.dueDate),
    daysOverdue: Math.floor((c.now.getTime() - w.dueDate!.getTime()) / DAY),
  }))
  return {
    columns: [
      col('code'),
      col('title'),
      col('restaurant'),
      col('status'),
      col('priority'),
      col('assignee'),
      col('dueDate', 'datetime'),
      col('daysOverdue', 'number'),
    ],
    rows: out,
    summary: [
      { label: 'overdue', value: out.length, type: 'number' },
      {
        label: 'critical',
        value: out.filter((r) => r.priority === 'CRITICAL').length,
        type: 'number',
      },
    ],
  }
}

async function repairTime(c: Ctx): Promise<Built> {
  const rows = await prisma.workOrder.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      AND: [c.wo],
      completedAt: inRange(c),
      type: { not: 'PREVENTIVE' },
    },
    select: { category: true, createdAt: true, completedAt: true, actualMinutes: true },
  })
  const byCat = new Map<string, { n: number; resolve: number; work: number }>()
  for (const w of rows) {
    const t = byCat.get(w.category) ?? { n: 0, resolve: 0, work: 0 }
    t.n++
    t.resolve += (w.completedAt!.getTime() - w.createdAt.getTime()) / HOUR
    t.work += (w.actualMinutes ?? 0) / 60
    byCat.set(w.category, t)
  }
  const out = [...byCat].map(([category, t]) => ({
    category,
    completed: t.n,
    avgHoursToFix: r1(t.resolve / t.n),
    avgHoursWorked: r1(t.work / t.n),
  }))
  out.sort((a, b) => b.completed - a.completed)
  return {
    columns: [
      col('category'),
      col('completed', 'number'),
      col('avgHoursToFix', 'hours'),
      col('avgHoursWorked', 'hours'),
    ],
    rows: out,
    summary: [
      { label: 'completed', value: rows.length, type: 'number' },
      {
        label: 'mttr',
        value: rows.length
          ? r1(
              sum(rows.map((w) => (w.completedAt!.getTime() - w.createdAt.getTime()) / HOUR)) /
                rows.length,
            )
          : 0,
        type: 'hours',
      },
    ],
  }
}

async function technicianPerformance(c: Ctx): Promise<Built> {
  const rows = await prisma.workOrder.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      AND: [c.wo],
      completedAt: inRange(c),
      assignedUserId: { not: null },
    },
    select: {
      assignedUser: person,
      dueDate: true,
      completedAt: true,
      actualMinutes: true,
      reopenCount: true,
    },
  })
  const by = new Map<
    string,
    { name: string; n: number; due: number; onTime: number; minutes: number; reopened: number }
  >()
  for (const w of rows) {
    const u = w.assignedUser!
    const t = by.get(u.id) ?? {
      name: fullName(u),
      n: 0,
      due: 0,
      onTime: 0,
      minutes: 0,
      reopened: 0,
    }
    t.n++
    if (w.dueDate) {
      t.due++
      if (w.completedAt! <= w.dueDate) t.onTime++
    }
    t.minutes += w.actualMinutes ?? 0
    if (w.reopenCount > 0) t.reopened++
    by.set(u.id, t)
  }
  const out = [...by.values()]
    .map((t) => ({
      technician: t.name,
      completed: t.n,
      onTimeRate: pct(t.onTime, t.due),
      hoursWorked: r1(t.minutes / 60),
      avgHoursPerJob: r1(t.minutes / 60 / t.n),
      reopened: t.reopened,
    }))
    .sort((a, b) => b.completed - a.completed)
  return {
    columns: [
      col('technician'),
      col('completed', 'number'),
      col('onTimeRate', 'percent'),
      col('hoursWorked', 'hours'),
      col('avgHoursPerJob', 'hours'),
      col('reopened', 'number'),
    ],
    rows: out,
    summary: [
      { label: 'technicians', value: out.length, type: 'number' },
      { label: 'completed', value: rows.length, type: 'number' },
    ],
  }
}

async function requestsSummary(c: Ctx): Promise<Built> {
  const rows = await prisma.request.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      createdAt: inRange(c),
    },
    select: {
      status: true,
      createdAt: true,
      reviewedAt: true,
      restaurant: { select: { name: true } },
    },
  })
  const by = new Map<
    string,
    {
      reported: number
      converted: number
      rejected: number
      pending: number
      hours: number
      decided: number
    }
  >()
  for (const r of rows) {
    const t = by.get(r.restaurant.name) ?? {
      reported: 0,
      converted: 0,
      rejected: 0,
      pending: 0,
      hours: 0,
      decided: 0,
    }
    t.reported++
    if (r.status === 'CONVERTED') t.converted++
    else if (r.status === 'REJECTED') t.rejected++
    else t.pending++
    if (r.reviewedAt) {
      t.decided++
      t.hours += (r.reviewedAt.getTime() - r.createdAt.getTime()) / HOUR
    }
    by.set(r.restaurant.name, t)
  }
  const out = [...by]
    .map(([restaurant, t]) => ({
      restaurant,
      reported: t.reported,
      converted: t.converted,
      rejected: t.rejected,
      pending: t.pending,
      avgHoursToDecide: t.decided ? r1(t.hours / t.decided) : null,
    }))
    .sort((a, b) => a.restaurant.localeCompare(b.restaurant))
  return {
    columns: [
      col('restaurant'),
      col('reported', 'number'),
      col('converted', 'number'),
      col('rejected', 'number'),
      col('pending', 'number'),
      col('avgHoursToDecide', 'hours'),
    ],
    rows: out,
    summary: [
      { label: 'reported', value: rows.length, type: 'number' },
      { label: 'pending', value: sum(out.map((r) => r.pending)), type: 'number' },
    ],
  }
}

// ---------------------------------------------------------------- assets

async function pmCompliance(c: Ctx): Promise<Built> {
  const rows = await prisma.workOrder.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      pmScheduleId: { not: null },
      // Same basis as the dashboard: cancelled or archived occurrences aren't "missed".
      archivedAt: null,
      status: { not: 'CANCELLED' },
      dueDate: { gte: c.from, lt: c.to < c.now ? c.to : c.now },
    },
    select: {
      dueDate: true,
      completedAt: true,
      pmSchedule: { select: { id: true, name: true, restaurant: { select: { name: true } } } },
    },
  })
  const by = new Map<
    string,
    { name: string; restaurant: string; due: number; onTime: number; late: number; missed: number }
  >()
  for (const w of rows) {
    const s = w.pmSchedule!
    const t = by.get(s.id) ?? {
      name: s.name,
      restaurant: s.restaurant.name,
      due: 0,
      onTime: 0,
      late: 0,
      missed: 0,
    }
    t.due++
    if (!w.completedAt) t.missed++
    else if (w.completedAt <= w.dueDate!) t.onTime++
    else t.late++
    by.set(s.id, t)
  }
  const out = [...by.values()]
    .map((t) => ({
      schedule: t.name,
      restaurant: t.restaurant,
      due: t.due,
      onTime: t.onTime,
      late: t.late,
      notDone: t.missed,
      compliance: pct(t.onTime, t.due),
    }))
    .sort((a, b) => (a.compliance ?? 0) - (b.compliance ?? 0))
  const due = sum(out.map((r) => r.due))
  return {
    columns: [
      col('schedule'),
      col('restaurant'),
      col('due', 'number'),
      col('onTime', 'number'),
      col('late', 'number'),
      col('notDone', 'number'),
      col('compliance', 'percent'),
    ],
    rows: out,
    summary: [
      { label: 'compliance', value: pct(sum(out.map((r) => r.onTime)), due) ?? 0, type: 'percent' },
      { label: 'due', value: due, type: 'number' },
    ],
  }
}

async function assetDowntime(c: Ctx): Promise<Built> {
  const rows = await prisma.assetDowntime.findMany({
    where: {
      asset: { organizationId: c.orgId, restaurantId: { in: c.restaurantIds } },
      startedAt: { lt: c.to },
      OR: [{ endedAt: null }, { endedAt: { gt: c.from } }],
    },
    select: {
      startedAt: true,
      endedAt: true,
      asset: {
        select: {
          id: true,
          name: true,
          assetCode: true,
          status: true,
          restaurant: { select: { name: true } },
        },
      },
    },
  })
  const end = c.to < c.now ? c.to : c.now
  const by = new Map<
    string,
    {
      asset: string
      code: string
      restaurant: string
      status: string
      hours: number
      incidents: number
    }
  >()
  for (const d of rows) {
    const a = d.asset
    const t = by.get(a.id) ?? {
      asset: a.name,
      code: a.assetCode,
      restaurant: a.restaurant.name,
      status: a.status,
      hours: 0,
      incidents: 0,
    }
    const s = Math.max(d.startedAt.getTime(), c.from.getTime())
    const e = Math.min((d.endedAt ?? end).getTime(), end.getTime())
    t.hours += Math.max(0, e - s) / HOUR
    t.incidents++
    by.set(a.id, t)
  }
  const out = [...by.values()]
    .map((t) => ({
      asset: t.asset,
      assetCode: t.code,
      restaurant: t.restaurant,
      incidents: t.incidents,
      downtimeHours: r1(t.hours),
      currentStatus: t.status,
    }))
    .sort((a, b) => b.downtimeHours - a.downtimeHours)
  return {
    columns: [
      col('asset'),
      col('assetCode'),
      col('restaurant'),
      col('incidents', 'number'),
      col('downtimeHours', 'hours'),
      col('currentStatus'),
    ],
    rows: out,
    summary: [
      { label: 'downtimeHours', value: r1(sum(out.map((r) => r.downtimeHours))), type: 'hours' },
      { label: 'assetsAffected', value: out.length, type: 'number' },
    ],
  }
}

async function assetCost(c: Ctx): Promise<Built> {
  const wos = await prisma.workOrder.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      assetId: { not: null },
      completedAt: inRange(c),
    },
    select: {
      actualMinutes: true,
      asset: {
        select: { id: true, name: true, assetCode: true, restaurant: { select: { name: true } } },
      },
      parts: { select: { qtyUsed: true, unitCostSnapshot: true } },
      vendorInvoices: { select: { amount: true } },
    },
  })
  const by = new Map<
    string,
    {
      asset: string
      code: string
      restaurant: string
      jobs: number
      minutes: number
      parts: number
      vendor: number
    }
  >()
  for (const w of wos) {
    const a = w.asset!
    const t = by.get(a.id) ?? {
      asset: a.name,
      code: a.assetCode,
      restaurant: a.restaurant.name,
      jobs: 0,
      minutes: 0,
      parts: 0,
      vendor: 0,
    }
    t.jobs++
    t.minutes += w.actualMinutes ?? 0
    t.parts += sum(w.parts.map((p) => Number(p.qtyUsed) * Number(p.unitCostSnapshot ?? 0)))
    t.vendor += sum(w.vendorInvoices.map((i) => Number(i.amount)))
    by.set(a.id, t)
  }
  const out = [...by.values()]
    .map((t) => ({
      asset: t.asset,
      assetCode: t.code,
      restaurant: t.restaurant,
      jobs: t.jobs,
      hoursWorked: r1(t.minutes / 60),
      partsCost: r2(t.parts),
      vendorCost: r2(t.vendor),
      totalCost: r2(t.parts + t.vendor),
    }))
    .sort((a, b) => b.totalCost - a.totalCost)
  return {
    columns: [
      col('asset'),
      col('assetCode'),
      col('restaurant'),
      col('jobs', 'number'),
      col('hoursWorked', 'hours'),
      col('partsCost', 'money'),
      col('vendorCost', 'money'),
      col('totalCost', 'money'),
    ],
    rows: out,
    summary: [
      { label: 'totalCost', value: r2(sum(out.map((r) => r.totalCost))), type: 'money' },
      { label: 'jobs', value: wos.length, type: 'number' },
    ],
  }
}

// ---------------------------------------------------------------- quality

async function inspectionResults(c: Ctx): Promise<Built> {
  const rows = await prisma.inspection.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      status: 'SUBMITTED',
      submittedAt: inRange(c),
    },
    select: {
      passCount: true,
      failCount: true,
      naCount: true,
      template: { select: { id: true, name: true, type: true } },
      restaurant: { select: { name: true } },
    },
  })
  const by = new Map<
    string,
    {
      template: string
      type: string
      restaurant: string
      n: number
      withFail: number
      pass: number
      fail: number
    }
  >()
  for (const i of rows) {
    const key = `${i.template.id}:${i.restaurant.name}`
    const t = by.get(key) ?? {
      template: i.template.name,
      type: i.template.type,
      restaurant: i.restaurant.name,
      n: 0,
      withFail: 0,
      pass: 0,
      fail: 0,
    }
    t.n++
    if (i.failCount > 0) t.withFail++
    t.pass += i.passCount
    t.fail += i.failCount
    by.set(key, t)
  }
  const out = [...by.values()]
    .map((t) => ({
      checklist: t.template,
      type: t.type,
      restaurant: t.restaurant,
      inspections: t.n,
      withFailures: t.withFail,
      passRate: pct(t.pass, t.pass + t.fail),
    }))
    .sort((a, b) => b.inspections - a.inspections)
  return {
    columns: [
      col('checklist'),
      col('type'),
      col('restaurant'),
      col('inspections', 'number'),
      col('withFailures', 'number'),
      col('passRate', 'percent'),
    ],
    rows: out,
    summary: [
      { label: 'inspections', value: rows.length, type: 'number' },
      { label: 'withFailures', value: rows.filter((i) => i.failCount > 0).length, type: 'number' },
    ],
  }
}

async function failedChecks(c: Ctx): Promise<Built> {
  const [insp, wo] = await Promise.all([
    prisma.inspectionItem.findMany({
      where: {
        result: 'FAIL',
        inspection: {
          organizationId: c.orgId,
          restaurantId: { in: c.restaurantIds },
          submittedAt: inRange(c),
        },
      },
      select: { title: true },
    }),
    prisma.workOrderChecklistItem.findMany({
      where: {
        result: 'FAIL',
        completedAt: inRange(c),
        workOrder: { organizationId: c.orgId, restaurantId: { in: c.restaurantIds } },
      },
      select: { title: true },
    }),
  ])
  const by = new Map<string, { inspections: number; workOrders: number }>()
  for (const i of insp) {
    const t = by.get(i.title) ?? { inspections: 0, workOrders: 0 }
    t.inspections++
    by.set(i.title, t)
  }
  for (const i of wo) {
    const t = by.get(i.title) ?? { inspections: 0, workOrders: 0 }
    t.workOrders++
    by.set(i.title, t)
  }
  const out = [...by]
    .map(([check, t]) => ({
      check,
      failures: t.inspections + t.workOrders,
      inInspections: t.inspections,
      inWorkOrders: t.workOrders,
    }))
    .sort((a, b) => b.failures - a.failures)
  return {
    columns: [
      col('check'),
      col('failures', 'number'),
      col('inInspections', 'number'),
      col('inWorkOrders', 'number'),
    ],
    rows: out,
    summary: [{ label: 'failures', value: insp.length + wo.length, type: 'number' }],
  }
}

// ---------------------------------------------------------------- inventory & purchasing

async function stockRows(c: Ctx) {
  return prisma.inventory.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      part: { archivedAt: null },
    },
    select: {
      quantity: true,
      minStock: true,
      restaurant: { select: { name: true } },
      part: {
        select: {
          name: true,
          partNumber: true,
          unit: true,
          unitCost: true,
          minStock: true,
          preferredVendor: { select: { name: true } },
        },
      },
    },
  })
}

async function inventoryValuation(c: Ctx): Promise<Built> {
  const rows = await stockRows(c)
  const out = rows
    .filter((s) => Number(s.quantity) > 0)
    .map((s) => ({
      part: s.part.name,
      partNumber: s.part.partNumber,
      restaurant: s.restaurant.name,
      quantity: Number(s.quantity),
      unit: s.part.unit,
      unitCost: Number(s.part.unitCost),
      value: r2(Number(s.quantity) * Number(s.part.unitCost)),
    }))
    .sort((a, b) => b.value - a.value)
  return {
    columns: [
      col('part'),
      col('partNumber'),
      col('restaurant'),
      col('quantity', 'number'),
      col('unit'),
      col('unitCost', 'money'),
      col('value', 'money'),
    ],
    rows: out,
    summary: [
      { label: 'stockValue', value: r2(sum(out.map((r) => r.value))), type: 'money' },
      { label: 'lines', value: out.length, type: 'number' },
    ],
  }
}

async function lowStock(c: Ctx): Promise<Built> {
  const rows = await stockRows(c)
  const out = rows
    .map((s) => {
      const qty = Number(s.quantity)
      const min = Number(s.minStock ?? s.part.minStock)
      return { s, qty, min }
    })
    .filter(({ qty, min }) => isLowStock(qty, min))
    .map(({ s, qty, min }) => ({
      part: s.part.name,
      partNumber: s.part.partNumber,
      restaurant: s.restaurant.name,
      quantity: qty,
      minimum: min,
      shortfall: Math.max(0, Math.round((min - qty) * 1000) / 1000),
      unit: s.part.unit,
      preferredVendor: s.part.preferredVendor?.name ?? null,
    }))
    .sort((a, b) => b.shortfall - a.shortfall)
  return {
    columns: [
      col('part'),
      col('partNumber'),
      col('restaurant'),
      col('quantity', 'number'),
      col('minimum', 'number'),
      col('shortfall', 'number'),
      col('unit'),
      col('preferredVendor'),
    ],
    rows: out,
    summary: [
      { label: 'lowItems', value: out.length, type: 'number' },
      { label: 'outOfStock', value: out.filter((r) => r.quantity === 0).length, type: 'number' },
    ],
  }
}

async function partsConsumption(c: Ctx): Promise<Built> {
  const rows = await prisma.inventoryTransaction.findMany({
    where: {
      organizationId: c.orgId,
      restaurantId: { in: c.restaurantIds },
      type: { in: ['CONSUMPTION', 'RETURN'] },
      referenceType: 'WORK_ORDER',
      createdAt: inRange(c),
    },
    select: {
      quantityDelta: true,
      unitCost: true,
      part: { select: { id: true, name: true, partNumber: true, unit: true } },
    },
  })
  const by = new Map<
    string,
    { part: string; pn: string; unit: string; qty: number; cost: number }
  >()
  for (const t of rows) {
    const x = by.get(t.part.id) ?? {
      part: t.part.name,
      pn: t.part.partNumber,
      unit: t.part.unit,
      qty: 0,
      cost: 0,
    }
    const used = -Number(t.quantityDelta)
    x.qty += used
    x.cost += used * Number(t.unitCost ?? 0)
    by.set(t.part.id, x)
  }
  const out = [...by.values()]
    .filter((x) => Math.abs(x.qty) > 0.0005)
    .map((x) => ({
      part: x.part,
      partNumber: x.pn,
      quantityUsed: Math.round(x.qty * 1000) / 1000,
      unit: x.unit,
      cost: r2(x.cost),
    }))
    .sort((a, b) => b.cost - a.cost)
  return {
    columns: [
      col('part'),
      col('partNumber'),
      col('quantityUsed', 'number'),
      col('unit'),
      col('cost', 'money'),
    ],
    rows: out,
    summary: [{ label: 'partsCost', value: r2(sum(out.map((r) => r.cost))), type: 'money' }],
  }
}

async function vendorSpend(c: Ctx): Promise<Built> {
  const [lines, invoices] = await Promise.all([
    prisma.poReceiptLine.findMany({
      where: {
        receipt: {
          receivedAt: inRange(c),
          purchaseOrder: { organizationId: c.orgId, restaurantId: { in: c.restaurantIds } },
        },
      },
      select: {
        quantity: true,
        purchaseOrderItem: {
          select: {
            unitCost: true,
            purchaseOrder: { select: { id: true, vendor: { select: { id: true, name: true } } } },
          },
        },
      },
    }),
    prisma.vendorInvoice.findMany({
      where: {
        organizationId: c.orgId,
        // invoiceDate is a calendar date (stored as UTC midnight): compare dates,
        // not the organization's local midnights.
        invoiceDate: {
          gte: new Date(`${dateKeyInZone(c.timeZone, c.from)}T00:00:00Z`),
          lt: new Date(`${dateKeyInZone(c.timeZone, c.to)}T00:00:00Z`),
        },
        OR: [{ restaurantId: { in: c.restaurantIds } }, { restaurantId: null }],
      },
      select: { amount: true, paidAt: true, vendor: { select: { id: true, name: true } } },
    }),
  ])
  const by = new Map<
    string,
    { vendor: string; received: number; orders: Set<string>; invoiced: number; unpaid: number }
  >()
  const get = (v: { id: string; name: string }) => {
    const t = by.get(v.id) ?? {
      vendor: v.name,
      received: 0,
      orders: new Set<string>(),
      invoiced: 0,
      unpaid: 0,
    }
    by.set(v.id, t)
    return t
  }
  for (const l of lines) {
    const po = l.purchaseOrderItem.purchaseOrder
    const t = get(po.vendor)
    t.received += Number(l.quantity) * Number(l.purchaseOrderItem.unitCost)
    t.orders.add(po.id)
  }
  for (const i of invoices) {
    const t = get(i.vendor)
    t.invoiced += Number(i.amount)
    if (!i.paidAt) t.unpaid += Number(i.amount)
  }
  const out = [...by.values()]
    .map((t) => ({
      vendor: t.vendor,
      orders: t.orders.size,
      receivedValue: r2(t.received),
      invoiced: r2(t.invoiced),
      unpaid: r2(t.unpaid),
    }))
    .sort((a, b) => b.invoiced + b.receivedValue - (a.invoiced + a.receivedValue))
  return {
    columns: [
      col('vendor'),
      col('orders', 'number'),
      col('receivedValue', 'money'),
      col('invoiced', 'money'),
      col('unpaid', 'money'),
    ],
    rows: out,
    summary: [
      { label: 'receivedValue', value: r2(sum(out.map((r) => r.receivedValue))), type: 'money' },
      { label: 'invoiced', value: r2(sum(out.map((r) => r.invoiced))), type: 'money' },
    ],
  }
}

async function unpaidInvoices(c: Ctx): Promise<Built> {
  const rows = await prisma.vendorInvoice.findMany({
    where: {
      organizationId: c.orgId,
      paidAt: null,
      OR: [{ restaurantId: { in: c.restaurantIds } }, { restaurantId: null }],
    },
    include: { vendor: { select: { name: true } }, restaurant: { select: { name: true } } },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { invoiceDate: 'asc' }],
    take: MAX_ROWS + 1,
  })
  const today = dateKeyInZone(c.timeZone, c.now)
  const out = rows.map((i) => {
    const due = dateOnly(i.dueDate)
    return {
      vendor: i.vendor.name,
      invoiceNumber: i.invoiceNumber,
      restaurant: i.restaurant?.name ?? null,
      invoiceDate: dateOnly(i.invoiceDate),
      dueDate: due,
      amount: Number(i.amount),
      daysOverdue: due && due < today ? Math.floor((Date.parse(today) - Date.parse(due)) / DAY) : 0,
    }
  })
  return {
    columns: [
      col('vendor'),
      col('invoiceNumber'),
      col('restaurant'),
      col('invoiceDate', 'date'),
      col('dueDate', 'date'),
      col('amount', 'money'),
      col('daysOverdue', 'number'),
    ],
    rows: out,
    summary: [
      { label: 'unpaid', value: r2(sum(out.map((r) => r.amount))), type: 'money' },
      {
        label: 'overdueAmount',
        value: r2(sum(out.filter((r) => r.daysOverdue > 0).map((r) => r.amount))),
        type: 'money',
      },
    ],
  }
}

const REPORTS: Record<ReportKey, (c: Ctx) => Promise<Built>> = {
  'work-order-summary': workOrderSummary,
  'work-orders-completed': workOrdersCompleted,
  'overdue-work-orders': overdueWorkOrders,
  'repair-time': repairTime,
  'technician-performance': technicianPerformance,
  'pm-compliance': pmCompliance,
  'asset-downtime': assetDowntime,
  'asset-cost': assetCost,
  'requests-summary': requestsSummary,
  'inspection-results': inspectionResults,
  'failed-checks': failedChecks,
  'inventory-valuation': inventoryValuation,
  'low-stock': lowStock,
  'parts-consumption': partsConsumption,
  'vendor-spend': vendorSpend,
  'unpaid-invoices': unpaidInvoices,
  'maintenance-mix': kpi.maintenanceMix,
  labour: kpi.labour,
  reliability: kpi.reliability,
  'repeat-failures': kpi.repeatFailures,
  'failure-analysis': kpi.failureAnalysis,
  'cost-breakdown': kpi.costBreakdownReport,
  'vendor-performance': kpi.vendorPerformance,
}

/** Trend series and headline KPIs for the analytics page. */
export async function analyticsTrends(auth: AuthContext, q: ReportQuery) {
  const c = await context(auth, q)
  if (c.restaurantIds.length === 0)
    return kpi.trends({ ...c, restaurantIds: ['00000000-0000-0000-0000-000000000000'] })
  return kpi.trends(c)
}

export async function runReport(
  auth: AuthContext,
  key: ReportKey,
  q: ReportQuery,
): Promise<ReportResult> {
  const c = await context(auth, q)
  const built =
    c.restaurantIds.length === 0 ? { columns: [], rows: [], summary: [] } : await REPORTS[key](c)
  return {
    key,
    columns: built.columns,
    rows: built.rows.slice(0, MAX_ROWS),
    summary: built.summary,
    truncated: built.rows.length > MAX_ROWS,
    generatedAt: c.now.toISOString(),
  }
}

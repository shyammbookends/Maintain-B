import {
  WORK_ORDER_DONE_STATUSES,
  addDays,
  fullName,
  type AnalyticsTrends,
  type ReportCell,
  type ReportColumn,
  type ReportColumnType,
  type ReportQuery,
  type ReportResult,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { costBreakdown, costByRestaurant } from '../../core/costs.js'
import { prisma } from '../../core/prisma.js'
import { dateKeyInZone } from '../../core/time.js'

/*
 * Phase 13 KPIs: maintenance mix, labour, reliability (MTTR / MTBF), repeat
 * failures, failure analysis (root causes), cost breakdown, vendor
 * performance, and the trend series behind the analytics charts.
 *
 * Definitions:
 *  - a failure is a reactive or inspection-follow-up work order on an asset;
 *  - MTTR = average hours from creation to completion of failures fixed in the range;
 *  - MTBF = hours in the range ÷ failures (per asset, or summed over assets).
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR

export interface KpiCtx {
  orgId: string
  restaurantIds: string[]
  from: Date
  to: Date
  now: Date
  /** Work-order filters from the report query. */
  wo: Prisma.WorkOrderWhereInput
  /** The organization's time zone: trend buckets are its calendar days. */
  timeZone: string
}

type Row = Record<string, ReportCell>
export interface Built {
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
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const avg = (xs: number[]) => (xs.length ? r1(sum(xs) / xs.length) : null)
const person = { select: { id: true, firstName: true, lastName: true } } as const
const inRange = (c: KpiCtx) => ({ gte: c.from, lt: c.to })
const FAILURE_TYPES = ['REACTIVE', 'INSPECTION_FOLLOWUP'] as const

/** The work-order filters from the query, as a Prisma where. */
export function workOrderFilters(q: ReportQuery): Prisma.WorkOrderWhereInput {
  return {
    ...(q.locationId ? { locationId: q.locationId } : {}),
    ...(q.assetId ? { assetId: q.assetId } : {}),
    ...(q.userId
      ? { OR: [{ assignedUserId: q.userId }, { helpers: { some: { userId: q.userId } } }] }
      : {}),
    ...(q.teamId ? { assignedTeamId: q.teamId } : {}),
    ...(q.vendorId ? { vendorId: q.vendorId } : {}),
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.type ? { type: q.type } : {}),
  }
}

const scoped = (c: KpiCtx): Prisma.WorkOrderWhereInput => ({
  AND: [{ organizationId: c.orgId, restaurantId: { in: c.restaurantIds }, archivedAt: null }, c.wo],
})

// ---------------------------------------------------------------- maintenance mix

export async function maintenanceMix(c: KpiCtx): Promise<Built> {
  const [restaurants, groups] = await Promise.all([
    prisma.restaurant.findMany({
      where: { id: { in: c.restaurantIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.workOrder.groupBy({
      by: ['restaurantId', 'type'],
      where: { AND: [scoped(c), { createdAt: inRange(c) }] },
      _count: { _all: true },
    }),
  ])
  const n = (rid: string, type: string) =>
    groups.find((g) => g.restaurantId === rid && g.type === type)?._count._all ?? 0
  const rows = restaurants.map((r) => {
    const reactive = n(r.id, 'REACTIVE')
    const preventive = n(r.id, 'PREVENTIVE')
    const followUp = n(r.id, 'INSPECTION_FOLLOWUP')
    const total = reactive + preventive + followUp
    return {
      restaurant: r.name,
      total,
      reactive,
      preventive,
      followUp,
      preventivePct: pct(preventive, total),
      reactivePct: pct(reactive + followUp, total),
    }
  })
  const total = sum(rows.map((r) => r.total))
  const preventive = sum(rows.map((r) => r.preventive))
  return {
    columns: [
      col('restaurant'),
      col('total', 'number'),
      col('reactive', 'number'),
      col('preventive', 'number'),
      col('followUp', 'number'),
      col('preventivePct', 'percent'),
      col('reactivePct', 'percent'),
    ],
    rows,
    summary: [
      { label: 'created', value: total, type: 'number' },
      { label: 'preventivePct', value: pct(preventive, total) ?? 0, type: 'percent' },
      { label: 'reactivePct', value: pct(total - preventive, total) ?? 0, type: 'percent' },
    ],
  }
}

// ---------------------------------------------------------------- labour

export async function labour(c: KpiCtx): Promise<Built> {
  const entries = await prisma.workOrderTimeEntry.findMany({
    where: { startedAt: inRange(c), workOrder: scoped(c) },
    select: {
      workOrderId: true,
      startedAt: true,
      endedAt: true,
      minutes: true,
      manual: true,
      user: { select: { id: true, firstName: true, lastName: true, hourlyRate: true } },
    },
  })
  const by = new Map<
    string,
    { name: string; rate: number; minutes: number; jobs: Set<string>; manual: number }
  >()
  for (const e of entries) {
    const minutes =
      e.minutes ?? Math.round(((e.endedAt ?? c.now).getTime() - e.startedAt.getTime()) / 60_000)
    const b = by.get(e.user.id) ?? {
      name: fullName(e.user),
      rate: Number(e.user.hourlyRate ?? 0),
      minutes: 0,
      jobs: new Set<string>(),
      manual: 0,
    }
    b.minutes += Math.max(0, minutes)
    b.jobs.add(e.workOrderId)
    if (e.manual) b.manual += Math.max(0, minutes)
    by.set(e.user.id, b)
  }
  const rows = [...by.values()]
    .map((b) => ({
      technician: b.name,
      hours: r1(b.minutes / 60),
      jobs: b.jobs.size,
      hoursPerJob: b.jobs.size ? r1(b.minutes / 60 / b.jobs.size) : null,
      manualHours: r1(b.manual / 60),
      hourlyRate: b.rate || null,
      labourCost: r2((b.minutes / 60) * b.rate),
    }))
    .sort((a, b) => b.hours - a.hours)
  return {
    columns: [
      col('technician'),
      col('hours', 'hours'),
      col('jobs', 'number'),
      col('hoursPerJob', 'hours'),
      col('manualHours', 'hours'),
      col('hourlyRate', 'money'),
      col('labourCost', 'money'),
    ],
    rows,
    summary: [
      { label: 'hoursWorked', value: r1(sum(rows.map((r) => r.hours))), type: 'hours' },
      { label: 'labourCost', value: r2(sum(rows.map((r) => r.labourCost))), type: 'money' },
      { label: 'technicians', value: rows.length, type: 'number' },
    ],
  }
}

// ---------------------------------------------------------------- reliability

async function failuresByAsset(c: KpiCtx) {
  return prisma.workOrder.findMany({
    where: {
      AND: [
        scoped(c),
        { assetId: { not: null }, type: { in: [...FAILURE_TYPES] }, createdAt: inRange(c) },
      ],
    },
    select: {
      assetId: true,
      createdAt: true,
      completedAt: true,
      category: true,
      asset: { select: { name: true, assetCode: true, restaurant: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })
}

export async function reliability(c: KpiCtx): Promise<Built> {
  const failures = await failuresByAsset(c)
  const rangeHours = (Math.min(c.to.getTime(), c.now.getTime()) - c.from.getTime()) / HOUR
  const downtime = await prisma.assetDowntime.findMany({
    where: {
      assetId: { in: [...new Set(failures.map((f) => f.assetId!))] },
      startedAt: { lt: c.to },
      OR: [{ endedAt: null }, { endedAt: { gt: c.from } }],
    },
    select: { assetId: true, startedAt: true, endedAt: true },
  })
  const by = new Map<string, typeof failures>()
  for (const f of failures) by.set(f.assetId!, [...(by.get(f.assetId!) ?? []), f])
  const rows = [...by.entries()]
    .map(([assetId, list]) => {
      const repairs = list
        .filter((f) => f.completedAt)
        .map((f) => (f.completedAt!.getTime() - f.createdAt.getTime()) / HOUR)
      const down = sum(
        downtime
          .filter((d) => d.assetId === assetId)
          .map(
            (d) =>
              (Math.min((d.endedAt ?? c.now).getTime(), c.to.getTime()) -
                Math.max(d.startedAt.getTime(), c.from.getTime())) /
              HOUR,
          ),
      )
      const a = list[0]!.asset!
      return {
        asset: a.name,
        assetCode: a.assetCode,
        restaurant: a.restaurant.name,
        failures: list.length,
        mttrHours: avg(repairs),
        mtbfHours: r1(Math.max(0, rangeHours) / list.length),
        downtimeHours: r1(Math.max(0, down)),
        availabilityPct: rangeHours > 0 ? pct(rangeHours - Math.max(0, down), rangeHours) : null,
      }
    })
    .sort((a, b) => b.failures - a.failures)
  const allRepairs = failures
    .filter((f) => f.completedAt)
    .map((f) => (f.completedAt!.getTime() - f.createdAt.getTime()) / HOUR)
  const assetCount = rows.length
  return {
    columns: [
      col('asset'),
      col('assetCode'),
      col('restaurant'),
      col('failures', 'number'),
      col('mttrHours', 'hours'),
      col('mtbfHours', 'hours'),
      col('downtimeHours', 'hours'),
      col('availabilityPct', 'percent'),
    ],
    rows,
    summary: [
      { label: 'failures', value: failures.length, type: 'number' },
      { label: 'mttrHours', value: avg(allRepairs) ?? 0, type: 'hours' },
      {
        label: 'mtbfHours',
        value: failures.length ? r1((Math.max(0, rangeHours) * assetCount) / failures.length) : 0,
        type: 'hours',
      },
    ],
  }
}

export async function repeatFailures(c: KpiCtx): Promise<Built> {
  const failures = await failuresByAsset(c)
  const rcas = await prisma.rootCauseAnalysis.groupBy({
    by: ['assetId'],
    where: { assetId: { in: [...new Set(failures.map((f) => f.assetId!))] } },
    _count: { _all: true },
  })
  const by = new Map<string, typeof failures>()
  for (const f of failures) by.set(f.assetId!, [...(by.get(f.assetId!) ?? []), f])
  const rows = [...by.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([assetId, list]) => {
      const cats = new Map<string, number>()
      for (const f of list) cats.set(f.category, (cats.get(f.category) ?? 0) + 1)
      const top = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]![0]
      const gaps = list
        .slice(1)
        .map((f, i) => (f.createdAt.getTime() - list[i]!.createdAt.getTime()) / DAY)
      const a = list[0]!.asset!
      return {
        asset: a.name,
        assetCode: a.assetCode,
        restaurant: a.restaurant.name,
        failures: list.length,
        lastFailure: list.at(-1)!.createdAt.toISOString(),
        daysBetween: avg(gaps),
        topCategory: top,
        rootCauses: rcas.find((r) => r.assetId === assetId)?._count._all ?? 0,
      }
    })
    .sort((a, b) => b.failures - a.failures)
  return {
    columns: [
      col('asset'),
      col('assetCode'),
      col('restaurant'),
      col('failures', 'number'),
      col('lastFailure', 'datetime'),
      col('daysBetween', 'number'),
      col('topCategory'),
      col('rootCauses', 'number'),
    ],
    rows,
    summary: [
      { label: 'assets', value: rows.length, type: 'number' },
      { label: 'failures', value: sum(rows.map((r) => r.failures)), type: 'number' },
    ],
  }
}

// ---------------------------------------------------------------- failure analysis

export async function failureAnalysis(c: KpiCtx): Promise<Built> {
  const rcas = await prisma.rootCauseAnalysis.findMany({
    where: {
      organizationId: c.orgId,
      createdAt: inRange(c),
      workOrder: { restaurantId: { in: c.restaurantIds } },
    },
    include: {
      workOrder: { select: { code: true, restaurant: { select: { name: true } } } },
      asset: { select: { name: true } },
      createdBy: person,
    },
    orderBy: { createdAt: 'desc' },
  })
  const rows = rcas.map((r) => ({
    code: r.workOrder.code,
    restaurant: r.workOrder.restaurant.name,
    asset: r.asset?.name ?? null,
    category: r.category,
    failure: r.failure,
    rootCause: r.rootCause,
    correctiveAction: r.correctiveAction,
    preventiveAction: r.preventiveAction,
    recordedBy: fullName(r.createdBy),
    recordedAt: r.createdAt.toISOString(),
  }))
  const counts = new Map<string, number>()
  for (const r of rcas) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
  const withPrevention = rcas.filter((r) => r.preventiveAction).length
  return {
    columns: [
      col('code'),
      col('restaurant'),
      col('asset'),
      col('category'),
      col('failure'),
      col('rootCause'),
      col('correctiveAction'),
      col('preventiveAction'),
      col('recordedBy'),
      col('recordedAt', 'datetime'),
    ],
    rows,
    summary: [
      { label: 'rootCauses', value: rcas.length, type: 'number' },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => ({ label: `category_${k}`, value: v, type: 'number' as const })),
      { label: 'preventionPct', value: pct(withPrevention, rcas.length) ?? 0, type: 'percent' },
    ],
  }
}

// ---------------------------------------------------------------- costs

export async function costBreakdownReport(c: KpiCtx): Promise<Built> {
  const [restaurants, costs] = await Promise.all([
    prisma.restaurant.findMany({
      where: { id: { in: c.restaurantIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    costByRestaurant({
      organizationId: c.orgId,
      restaurantIds: c.restaurantIds,
      from: c.from,
      to: c.to,
    }),
  ])
  const rows = restaurants.map((r) => {
    const x = costs.get(r.id)
    return {
      restaurant: r.name,
      parts: x?.parts ?? 0,
      labour: x?.labour ?? 0,
      vendor: x?.vendor ?? 0,
      other: x?.other ?? 0,
      total: x?.total ?? 0,
    }
  })
  const t = (k: 'parts' | 'labour' | 'vendor' | 'other' | 'total') => r2(sum(rows.map((r) => r[k])))
  return {
    columns: [
      col('restaurant'),
      col('parts', 'money'),
      col('labour', 'money'),
      col('vendor', 'money'),
      col('other', 'money'),
      col('total', 'money'),
    ],
    rows,
    summary: [
      { label: 'total', value: t('total'), type: 'money' },
      { label: 'parts', value: t('parts'), type: 'money' },
      { label: 'labour', value: t('labour'), type: 'money' },
      { label: 'vendor', value: t('vendor'), type: 'money' },
    ],
  }
}

// ---------------------------------------------------------------- vendors

export async function vendorPerformance(c: KpiCtx): Promise<Built> {
  const jobs = await prisma.workOrder.findMany({
    where: { AND: [scoped(c), { vendorId: { not: null }, createdAt: inRange(c) }] },
    select: {
      id: true,
      vendorId: true,
      vendor: { select: { name: true } },
      status: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      dueDate: true,
    },
  })
  const vendorCosts = await prisma.workOrderCost.groupBy({
    by: ['vendorId'],
    where: { workOrderId: { in: jobs.map((j) => j.id) }, vendorId: { not: null } },
    _sum: { amount: true },
  })
  const by = new Map<string, typeof jobs>()
  for (const j of jobs) by.set(j.vendorId!, [...(by.get(j.vendorId!) ?? []), j])
  const done = (s: string) => (WORK_ORDER_DONE_STATUSES as readonly string[]).includes(s)
  const rows = [...by.entries()]
    .map(([vendorId, list]) => {
      const finished = list.filter((j) => done(j.status) && j.completedAt)
      const withDue = finished.filter((j) => j.dueDate)
      return {
        vendor: list[0]!.vendor!.name,
        jobs: list.length,
        completed: finished.length,
        avgResponseHours: avg(
          list
            .filter((j) => j.startedAt)
            .map((j) => (j.startedAt!.getTime() - j.createdAt.getTime()) / HOUR),
        ),
        avgCompletionHours: avg(
          finished.map((j) => (j.completedAt!.getTime() - j.createdAt.getTime()) / HOUR),
        ),
        onTimePct: pct(withDue.filter((j) => j.completedAt! <= j.dueDate!).length, withDue.length),
        jobCost: r2(Number(vendorCosts.find((v) => v.vendorId === vendorId)?._sum.amount ?? 0)),
      }
    })
    .sort((a, b) => b.jobs - a.jobs)
  return {
    columns: [
      col('vendor'),
      col('jobs', 'number'),
      col('completed', 'number'),
      col('avgResponseHours', 'hours'),
      col('avgCompletionHours', 'hours'),
      col('onTimePct', 'percent'),
      col('jobCost', 'money'),
    ],
    rows,
    summary: [
      { label: 'vendors', value: rows.length, type: 'number' },
      { label: 'jobs', value: sum(rows.map((r) => r.jobs)), type: 'number' },
      { label: 'jobCost', value: r2(sum(rows.map((r) => r.jobCost))), type: 'money' },
    ],
  }
}

// ---------------------------------------------------------------- trends

/** Monday of the week containing the calendar date `key` (YYYY-MM-DD). */
function mondayOf(key: string) {
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay()
  return addDays(key, -((weekday + 6) % 7))
}

/** Day or week buckets of work created / completed and repair time. */
export async function trends(c: KpiCtx): Promise<AnalyticsTrends> {
  const days = Math.round((c.to.getTime() - c.from.getTime()) / DAY)
  const bucket: AnalyticsTrends['bucket'] = days <= 31 ? 'day' : 'week'
  // Buckets are the organization's calendar days (c.from / c.to are its midnights).
  const dayKey = (d: Date) => dateKeyInZone(c.timeZone, d)
  const keyOf = (d: Date) => (bucket === 'day' ? dayKey(d) : mondayOf(dayKey(d)))
  const [created, completed, pm, cost] = await Promise.all([
    prisma.workOrder.findMany({
      where: { AND: [scoped(c), { createdAt: inRange(c) }] },
      select: { createdAt: true, type: true },
    }),
    prisma.workOrder.findMany({
      where: { AND: [scoped(c), { completedAt: inRange(c) }] },
      select: { createdAt: true, completedAt: true, type: true },
    }),
    prisma.workOrder.findMany({
      where: {
        AND: [
          scoped(c),
          {
            type: 'PREVENTIVE',
            status: { not: 'CANCELLED' },
            dueDate: { gte: c.from, lt: c.to, lte: c.now },
          },
        ],
      },
      select: { completedAt: true, dueDate: true },
    }),
    costBreakdown({
      organizationId: c.orgId,
      restaurantIds: c.restaurantIds,
      from: c.from,
      to: c.to,
    }),
  ])
  const points = new Map<string, AnalyticsTrends['points'][number] & { repairs: number[] }>()
  for (let t = keyOf(c.from); t < dayKey(c.to);) {
    points.set(t, {
      start: t,
      created: 0,
      completed: 0,
      reactive: 0,
      preventive: 0,
      mttrHours: null,
      repairs: [],
    })
    t = addDays(t, bucket === 'day' ? 1 : 7)
  }
  for (const w of created) {
    const p = points.get(keyOf(w.createdAt))
    if (!p) continue
    p.created++
    if (w.type === 'PREVENTIVE') p.preventive++
    else p.reactive++
  }
  for (const w of completed) {
    const p = points.get(keyOf(w.completedAt!))
    if (!p) continue
    p.completed++
    if (w.type !== 'PREVENTIVE')
      p.repairs.push((w.completedAt!.getTime() - w.createdAt.getTime()) / HOUR)
  }
  const out = [...points.values()].map(({ repairs, ...p }) => ({ ...p, mttrHours: avg(repairs) }))
  const failures = created.filter((w) => w.type !== 'PREVENTIVE').length
  const rangeHours = (Math.min(c.to.getTime(), c.now.getTime()) - c.from.getTime()) / HOUR
  const repairs = completed
    .filter((w) => w.type !== 'PREVENTIVE')
    .map((w) => (w.completedAt!.getTime() - w.createdAt.getTime()) / HOUR)
  return {
    bucket,
    points: out,
    totals: {
      created: created.length,
      completed: completed.length,
      reactive: failures,
      preventive: created.length - failures,
      mttrHours: avg(repairs),
      mtbfHours: failures ? r1(Math.max(0, rangeHours) / failures) : null,
      pmCompliance: pct(
        pm.filter((p) => p.completedAt && p.completedAt <= p.dueDate!).length,
        pm.length,
      ),
      cost,
    },
  }
}

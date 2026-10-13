import {
  CONTRACT_EXPIRING_DAYS,
  DOCUMENT_EXPIRING_DAYS,
  WARRANTY_EXPIRING_DAYS,
  WORK_ORDER_ACTIVE_STATUSES,
  type NotificationType,
} from '@maintainx/shared'
import { runAutomations } from '../core/automations.js'
import { notify, usersWithPermission } from '../core/notify.js'
import { Prisma } from '@prisma/client'
import { prisma } from '../core/prisma.js'
import { formatCalendarDate, formatDateTimeInZone } from '../core/time.js'

/*
 * Time-based alerts. Each alert is sent once per record: before notifying we
 * check whether that record already produced the same type of notification
 * (within `windowDays`), so running the job every hour never repeats itself.
 */

const DAY = 86_400_000

const zones = new Map<string, string>()
/** The organization's time zone (times in notification text are local). */
async function orgTimeZone(organizationId: string): Promise<string> {
  let tz = zones.get(organizationId)
  if (!tz) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    })
    tz = org?.timezone ?? 'Asia/Kolkata'
    zones.set(organizationId, tz)
  }
  return tz
}

async function alreadySent(
  type: NotificationType,
  entityType: string,
  entityIds: string[],
  sinceDays: number,
  now: Date,
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set()
  const rows = await prisma.notification.findMany({
    where: {
      type,
      entityType,
      entityId: { in: entityIds },
      createdAt: { gte: new Date(now.getTime() - sinceDays * DAY) },
    },
    select: { entityId: true },
    distinct: ['entityId'],
  })
  return new Set(rows.map((r) => r.entityId!))
}

/** How long an overdue alert counts as sent (pruning keeps them this long too). */
export const OVERDUE_ALERT_DAYS = 365

/**
 * Overdue work orders not alerted yet, oldest due first. Filtering in SQL
 * (rather than taking any 500 and dropping the alerted ones afterwards) keeps
 * newly overdue work from starving once hundreds of old ones are overdue.
 */
async function unalertedOverdueIds(now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - OVERDUE_ALERT_DAYS * DAY)
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT w.id FROM work_orders w
    WHERE w.archived_at IS NULL
      AND w.status::text IN (${Prisma.join([...WORK_ORDER_ACTIVE_STATUSES])})
      AND w.due_date < ${now}
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.entity_type = 'WORK_ORDER' AND n.entity_id = w.id
          AND n.type::text = 'TASK_OVERDUE' AND n.created_at >= ${since})
    ORDER BY w.due_date ASC
    LIMIT 500`
  return rows.map((r) => r.id)
}

/** Active work orders past their due date: the assignee (or team) and the admins. */
export async function overdueWorkOrderAlerts(now = new Date()): Promise<number> {
  const pending = await unalertedOverdueIds(now)
  if (pending.length === 0) return 0
  const rows = await prisma.workOrder.findMany({
    where: { id: { in: pending } },
    select: {
      id: true,
      code: true,
      title: true,
      organizationId: true,
      restaurantId: true,
      priority: true,
      category: true,
      type: true,
      assetId: true,
      assignedUserId: true,
      assignedTeamId: true,
    },
    take: 500,
  })
  // A work order is reported overdue once (a long-overdue job doesn't repeat every hour).
  const sent = await alreadySent(
    'TASK_OVERDUE',
    'WORK_ORDER',
    rows.map((r) => r.id),
    OVERDUE_ALERT_DAYS,
    now,
  )
  let count = 0
  for (const w of rows.filter((r) => !sent.has(r.id))) {
    const doers = w.assignedUserId
      ? [w.assignedUserId]
      : w.assignedTeamId
        ? (
            await prisma.teamMember.findMany({
              where: { teamId: w.assignedTeamId },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : []
    const admins = await usersWithPermission(w.organizationId, w.restaurantId, 'work_orders:assign')
    const base = {
      organizationId: w.organizationId,
      type: 'TASK_OVERDUE' as const,
      title: `${w.code} · ${w.title}`,
      entityType: 'WORK_ORDER',
      entityId: w.id,
      priority: w.priority,
    }
    // Workers get their task link; admins get the admin page.
    await notify(doers, { ...base, actionUrl: `/w/tasks/${w.id}` })
    await notify(
      admins.filter((a) => !doers.includes(a)),
      { ...base, actionUrl: `/work-orders/${w.id}` },
    )
    await runAutomations('WORK_ORDER_OVERDUE', {
      organizationId: w.organizationId,
      restaurantId: w.restaurantId,
      workOrderId: w.id,
      assetId: w.assetId,
      priority: w.priority,
      category: w.category,
      type: w.type,
      label: `${w.code} · ${w.title}`,
    })
    count++
  }
  return count
}

/** Hours before the due date a "due soon" reminder goes to whoever does the job. */
export const DUE_SOON_HOURS = 24

/** Assigned work due within a day: one reminder to the assignee (or team). */
export async function dueSoonAlerts(now = new Date()): Promise<number> {
  const rows = await prisma.workOrder.findMany({
    where: {
      archivedAt: null,
      status: { in: ['ASSIGNED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'] },
      dueDate: { gt: now, lte: new Date(now.getTime() + DUE_SOON_HOURS * 3_600_000) },
    },
    select: {
      id: true,
      code: true,
      title: true,
      organizationId: true,
      priority: true,
      dueDate: true,
      assignedUserId: true,
      assignedTeamId: true,
    },
    take: 500,
  })
  const sent = await alreadySent(
    'DUE_SOON',
    'WORK_ORDER',
    rows.map((r) => r.id),
    30,
    now,
  )
  let count = 0
  for (const w of rows.filter((r) => !sent.has(r.id))) {
    const doers = w.assignedUserId
      ? [w.assignedUserId]
      : w.assignedTeamId
        ? (
            await prisma.teamMember.findMany({
              where: { teamId: w.assignedTeamId },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : []
    if (doers.length === 0) continue
    await notify(doers, {
      organizationId: w.organizationId,
      type: 'DUE_SOON',
      title: `${w.code} · ${w.title}`,
      body: `Due ${formatDateTimeInZone(await orgTimeZone(w.organizationId), w.dueDate!)}`,
      entityType: 'WORK_ORDER',
      entityId: w.id,
      actionUrl: `/w/tasks/${w.id}`,
      priority: w.priority,
    })
    count++
  }
  return count
}

/** Asset warranties ending within 30 days, once per asset per warranty period. */
export async function warrantyAlerts(now = new Date()): Promise<number> {
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z')
  const rows = await prisma.asset.findMany({
    where: {
      archivedAt: null,
      warrantyEnd: { gte: today, lte: new Date(today.getTime() + WARRANTY_EXPIRING_DAYS * DAY) },
    },
    select: {
      id: true,
      name: true,
      assetCode: true,
      organizationId: true,
      restaurantId: true,
      warrantyEnd: true,
    },
    take: 500,
  })
  const sent = await alreadySent(
    'WARRANTY_EXPIRY',
    'ASSET',
    rows.map((r) => r.id),
    WARRANTY_EXPIRING_DAYS + 5,
    now,
  )
  let count = 0
  for (const a of rows.filter((r) => !sent.has(r.id))) {
    await notify(await usersWithPermission(a.organizationId, a.restaurantId, 'assets:edit'), {
      organizationId: a.organizationId,
      type: 'WARRANTY_EXPIRY',
      title: `${a.name} (${a.assetCode})`,
      body: `Warranty ends ${formatCalendarDate(a.warrantyEnd!)}`,
      entityType: 'ASSET',
      entityId: a.id,
      actionUrl: `/assets/${a.id}`,
    })
    count++
  }
  return count
}

/** Licenses, AMCs, certificates… expiring within 30 days. */
export async function documentExpiryAlerts(now = new Date()): Promise<number> {
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z')
  const rows = await prisma.document.findMany({
    where: {
      archivedAt: null,
      expiresAt: { gte: today, lte: new Date(today.getTime() + DOCUMENT_EXPIRING_DAYS * DAY) },
    },
    select: {
      id: true,
      title: true,
      organizationId: true,
      restaurantId: true,
      expiresAt: true,
      ownerType: true,
      ownerId: true,
    },
    take: 500,
  })
  const sent = await alreadySent(
    'DOCUMENT_EXPIRY',
    'DOCUMENT',
    rows.map((r) => r.id),
    DOCUMENT_EXPIRING_DAYS + 5,
    now,
  )
  let count = 0
  for (const d of rows.filter((r) => !sent.has(r.id))) {
    const recipients = d.restaurantId
      ? await usersWithPermission(d.organizationId, d.restaurantId, 'documents:edit')
      : (
          await prisma.user.findMany({
            where: {
              organizationId: d.organizationId,
              archivedAt: null,
              status: 'ACTIVE',
              userRoles: { some: { role: { systemKey: 'SUPER_ADMIN' } } },
            },
            select: { id: true },
          })
        ).map((u) => u.id)
    await notify(recipients, {
      organizationId: d.organizationId,
      type: 'DOCUMENT_EXPIRY',
      title: d.title,
      body: `Expires ${formatCalendarDate(d.expiresAt!)}`,
      entityType: 'DOCUMENT',
      entityId: d.id,
      actionUrl: `/documents?highlight=${d.id}`,
      priority: 'HIGH',
    })
    count++
  }
  return count
}

/** Vendor contracts ending soon: whoever manages vendors at that restaurant (or the Super Admins). */
export async function contractExpiryAlerts(now = new Date()): Promise<number> {
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z')
  const rows = await prisma.vendorContract.findMany({
    where: {
      archivedAt: null,
      vendor: { archivedAt: null },
      endDate: { gte: today, lte: new Date(today.getTime() + CONTRACT_EXPIRING_DAYS * DAY) },
    },
    select: {
      id: true,
      title: true,
      organizationId: true,
      restaurantId: true,
      endDate: true,
      vendor: { select: { id: true, name: true } },
    },
    take: 500,
  })
  const sent = await alreadySent(
    'CONTRACT_EXPIRY',
    'VENDOR_CONTRACT',
    rows.map((r) => r.id),
    CONTRACT_EXPIRING_DAYS + 5,
    now,
  )
  let count = 0
  for (const c of rows.filter((r) => !sent.has(r.id))) {
    const recipients = c.restaurantId
      ? await usersWithPermission(c.organizationId, c.restaurantId, 'vendors:edit')
      : (
          await prisma.user.findMany({
            where: {
              organizationId: c.organizationId,
              archivedAt: null,
              status: 'ACTIVE',
              userRoles: { some: { role: { systemKey: 'SUPER_ADMIN' } } },
            },
            select: { id: true },
          })
        ).map((u) => u.id)
    await notify(recipients, {
      organizationId: c.organizationId,
      type: 'CONTRACT_EXPIRY',
      title: `${c.vendor.name}: ${c.title}`,
      body: `Contract ends ${formatCalendarDate(c.endDate!)}`,
      entityType: 'VENDOR_CONTRACT',
      entityId: c.id,
      actionUrl: `/vendors/${c.vendor.id}`,
      priority: 'HIGH',
    })
    count++
  }
  return count
}

export async function runAlerts(now = new Date()) {
  return {
    overdue: await overdueWorkOrderAlerts(now),
    dueSoon: await dueSoonAlerts(now),
    warranty: await warrantyAlerts(now),
    documents: await documentExpiryAlerts(now),
    contracts: await contractExpiryAlerts(now),
  }
}

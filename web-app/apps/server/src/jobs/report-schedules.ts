import { fullName, type ReportFilters, type ReportKey } from '@maintainx/shared'
import { Prisma } from '@prisma/client'
import { env } from '../config/env.js'
import { canAccessRestaurant, hasPermission } from '../core/authz.js'
import { emailEnabled, sendMail } from '../core/delivery.js'
import { logger } from '../core/logger.js'
import { prisma } from '../core/prisma.js'
import { buildAuthContext } from '../modules/auth/auth.context.js'
import { loadUser } from '../modules/auth/auth.repository.js'
import {
  nextRunAfter,
  reportPeriod,
  requiredRestaurants,
  usersInScope,
} from '../modules/report-schedules/report-schedules.service.js'
import { buildReportFile, reportMeta } from '../modules/reports/reports.export.js'
import { formatCell, humanize, reportTitle } from '../modules/reports/reports.pdf.js'

/*
 * Sends scheduled email reports that are due. Safe to run as often as wanted
 * (every 15 minutes on Vercel via GitHub Actions, every 5 in-process):
 *   - a due schedule is claimed by moving `nextRunAt` forward, guarded by its
 *     old value, so two runners can't both send it;
 *   - a run is logged once per (schedule, due time);
 *   - missed runs (server down for days) send only the latest one.
 * Without SMTP_URL nothing is sent, and the run is logged as
 * "skipped: email not configured".
 */

const BATCH = 25

const STATUS = {
  sent: 'sent',
  noEmail: 'skipped: email not configured',
  noRecipients: 'skipped: no recipients',
  owner: 'skipped: owner can no longer export reports',
  restaurant: 'skipped: restaurant not available',
} as const

type Due = Prisma.ReportScheduleGetPayload<{
  include: { organization: { select: { timezone: true } } }
}>

async function sendOne(s: Due, scheduledFor: Date) {
  const owner = await loadUser(s.createdById)
  if (
    !owner ||
    owner.record.status !== 'ACTIVE' ||
    owner.record.archivedAt ||
    owner.record.organizationId !== s.organizationId
  )
    return { status: STATUS.owner, recipients: 0, rows: null }
  const auth = buildAuthContext(owner.authUser, owner.orgRestaurantIds)
  if (!hasPermission(auth, 'reports:view') || !hasPermission(auth, 'reports:export'))
    return { status: STATUS.owner, recipients: 0, rows: null }
  if (s.restaurantId) {
    const live = await prisma.restaurant.count({
      where: { id: s.restaurantId, archivedAt: null },
    })
    if (!live || !canAccessRestaurant(auth, s.restaurantId))
      return { status: STATUS.restaurant, recipients: 0, rows: null }
  }

  // People are checked again at send time: someone moved to another restaurant stops getting it.
  const users = await usersInScope(
    s.organizationId,
    s.recipientUserIds,
    requiredRestaurants(auth, s.restaurantId),
  )
  const to = [
    ...new Set(
      [...users.map((u) => u.email), ...s.recipientEmails]
        .filter((e): e is string => !!e)
        .map((e) => e.toLowerCase()),
    ),
  ]
  if (to.length === 0) return { status: STATUS.noRecipients, recipients: 0, rows: null }
  if (!emailEnabled()) return { status: STATUS.noEmail, recipients: to.length, rows: null }

  const key = s.reportKey as ReportKey
  const period = reportPeriod(s.frequency, s.organization.timezone, scheduledFor)
  const query = {
    ...(s.filters as ReportFilters),
    ...period,
    restaurantId: s.restaurantId ?? undefined,
  }
  const file = await buildReportFile(auth, key, query, s.format)
  const meta = await reportMeta(auth, key, query)
  const title = reportTitle(key)
  const link = new URL(
    `/reports/${key}?${new URLSearchParams({
      from: period.from,
      to: period.to,
      ...(s.restaurantId ? { restaurantId: s.restaurantId } : {}),
    })}`,
    env.APP_URL,
  ).toString()
  const summary = file.result.summary.map(
    (x) => `${humanize(x.label)}: ${formatCell({ key: x.label, type: x.type }, x.value, meta)}`,
  )
  await sendMail(to, {
    subject: `${title} · ${meta.restaurant} · ${meta.period}`,
    text: [
      `${title}`,
      `${meta.organization} · ${meta.restaurant} · ${meta.period}`,
      summary.join('\n'),
      `${file.result.rows.length} rows, attached as ${s.format}.`,
      `Open in the app: ${link}`,
      `Scheduled by ${fullName(owner.authUser)}.`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    attachments: [{ filename: file.fileName, content: file.body, contentType: file.contentType }],
  })
  return { status: STATUS.sent, recipients: to.length, rows: file.result.rows.length }
}

/** Sends every scheduled report that is due. */
export async function runReportSchedules(now = new Date()) {
  const due = await prisma.reportSchedule.findMany({
    where: { active: true, archivedAt: null, nextRunAt: { lte: now } },
    include: { organization: { select: { timezone: true } } },
    orderBy: { nextRunAt: 'asc' },
    take: BATCH,
  })
  const tally: Record<string, number> = {}
  for (const s of due) {
    const scheduledFor = s.nextRunAt
    // Claim it: only the runner that moves nextRunAt sends it.
    const claimed = await prisma.reportSchedule.updateMany({
      where: { id: s.id, nextRunAt: scheduledFor, active: true, archivedAt: null },
      data: { nextRunAt: nextRunAfter(s, s.organization.timezone, now), lastRunAt: now },
    })
    if (claimed.count === 0) continue
    let outcome: { status: string; recipients: number; rows: number | null }
    let error: string | null = null
    try {
      outcome = await sendOne(s, scheduledFor)
    } catch (err) {
      logger.error({ err, scheduleId: s.id }, 'scheduled report failed')
      error = err instanceof Error ? err.message.slice(0, 500) : 'unknown error'
      outcome = { status: 'failed', recipients: 0, rows: null }
    }
    try {
      await prisma.reportScheduleRun.create({
        data: { scheduleId: s.id, scheduledFor, ...outcome, error },
      })
    } catch (err) {
      // Already logged for this due time (can only happen if a claim raced): ignore.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
    }
    tally[outcome.status] = (tally[outcome.status] ?? 0) + 1
  }
  return tally
}

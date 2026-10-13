import {
  SYSTEM_ROLES,
  addDays,
  type ReportFilters,
  type ReportKey,
  type ReportScheduleDto,
  type ReportScheduleInput,
  type ReportScheduleRunDto,
} from '@maintainx/shared'
import type { Prisma, ReportFrequency } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, restaurantScope } from '../../core/authz.js'
import { NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import { dateKeyInZone, startOfDateInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Scheduled email reports. A schedule runs with the access of whoever last
 * saved it (its owner): the report covers only their restaurants, and only
 * people who can see those restaurants can be recipients. Super Admins see
 * every schedule; others see their own and those for their restaurants.
 */

const person = { select: { id: true, firstName: true, lastName: true } } as const

const include = {
  restaurant: { select: { id: true, name: true } },
  createdBy: person,
  organization: { select: { timezone: true } },
  runs: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.ReportScheduleInclude

type Row = Prisma.ReportScheduleGetPayload<{ include: typeof include }>
type RunRow = Row['runs'][number]

// ---------------------------------------------------------------- timing

interface Timing {
  frequency: ReportFrequency
  timeOfDay: string
  dayOfWeek: number | null
  dayOfMonth: number | null
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()

/** The first send instant strictly after `after`, in the organization's time zone. */
export function nextRunAfter(t: Timing, timeZone: string, after: Date): Date {
  const [h, m] = t.timeOfDay.split(':').map(Number) as [number, number]
  let date = dateKeyInZone(timeZone, after)
  // A month at most (monthly on the 28th), plus slack.
  for (let i = 0; i < 64; i++, date = addDays(date, 1)) {
    const matches =
      t.frequency === 'DAILY' ||
      (t.frequency === 'WEEKLY' && weekday(date) === t.dayOfWeek) ||
      (t.frequency === 'MONTHLY' && Number(date.slice(8, 10)) === t.dayOfMonth)
    if (!matches) continue
    const at = new Date(startOfDateInZone(timeZone, date).getTime() + (h * 60 + m) * 60_000)
    if (at > after) return at
  }
  throw new Error('report schedule: no next run found')
}

/**
 * The period a run reports on, ending the day before it is sent:
 * DAILY = yesterday, WEEKLY = the last 7 days, MONTHLY = last calendar month.
 */
export function reportPeriod(
  frequency: ReportFrequency,
  timeZone: string,
  at: Date,
): { from: string; to: string } {
  const today = dateKeyInZone(timeZone, at)
  const yesterday = addDays(today, -1)
  if (frequency === 'DAILY') return { from: yesterday, to: yesterday }
  if (frequency === 'WEEKLY') return { from: addDays(today, -7), to: yesterday }
  const firstOfThisMonth = `${today.slice(0, 8)}01`
  const lastOfPrevious = addDays(firstOfThisMonth, -1)
  return { from: `${lastOfPrevious.slice(0, 8)}01`, to: lastOfPrevious }
}

// ---------------------------------------------------------------- recipients

/**
 * Restaurants a recipient must be able to see: the schedule's restaurant, or
 * (for "all restaurants") every restaurant of the owner. `null` = all of the
 * organization's restaurants (a Super Admin's "all"): only Super Admins qualify.
 */
export function requiredRestaurants(
  owner: Pick<AuthContext, 'isSuperAdmin' | 'restaurantIds'>,
  restaurantId: string | null,
): string[] | null {
  if (restaurantId) return [restaurantId]
  return owner.isSuperAdmin ? null : [...owner.restaurantIds]
}

/**
 * Recipients (of `userIds`) who are active, have an email, may view reports
 * (a User/Worker never sees costs or invoices in the app, so not by email
 * either) and can see `restaurants`.
 */
export async function usersInScope(
  organizationId: string,
  userIds: string[],
  restaurants: string[] | null,
) {
  if (userIds.length === 0) return []
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId, archivedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      userRoles: {
        select: {
          role: {
            select: {
              systemKey: true,
              rolePermissions: {
                where: { permission: { key: 'reports:view' } },
                select: { permissionId: true },
              },
            },
          },
        },
      },
      userRestaurants: { select: { restaurantId: true } },
    },
  })
  return rows.filter((u) => {
    if (u.userRoles.some((r) => r.role.systemKey === SYSTEM_ROLES.SUPER_ADMIN)) return true
    if (!u.userRoles.some((r) => r.role.rolePermissions.length > 0)) return false
    if (restaurants === null) return false
    const mine = new Set(u.userRestaurants.map((r) => r.restaurantId))
    return restaurants.every((r) => mine.has(r))
  })
}

// ---------------------------------------------------------------- CRUD

const visibleWhere = (auth: AuthContext): Prisma.ReportScheduleWhereInput => ({
  organizationId: auth.organizationId,
  archivedAt: null,
  ...(auth.isSuperAdmin
    ? {}
    : {
        OR: [{ createdById: auth.userId }, { restaurantId: restaurantScope(auth) }],
      }),
})

const toRun = (r: RunRow): ReportScheduleRunDto => ({
  id: r.id,
  scheduledFor: r.scheduledFor.toISOString(),
  status: r.status,
  recipients: r.recipients,
  rows: r.rows,
  createdAt: r.createdAt.toISOString(),
})

async function toDtos(rows: Row[]): Promise<ReportScheduleDto[]> {
  const ids = [...new Set(rows.flatMap((r) => r.recipientUserIds))]
  const people = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, ...person })
    : []
  const byId = new Map(people.map((p) => [p.id, p]))
  return rows.map((s) => ({
    id: s.id,
    reportKey: s.reportKey as ReportKey,
    restaurant: s.restaurant,
    filters: (s.filters ?? {}) as ReportFilters,
    frequency: s.frequency,
    timeOfDay: s.timeOfDay,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    format: s.format,
    recipientUsers: s.recipientUserIds.flatMap((id) => {
      const p = byId.get(id)
      return p ? [p] : []
    }),
    recipientEmails: s.recipientEmails,
    active: s.active,
    nextRunAt: s.nextRunAt.toISOString(),
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    lastRun: s.runs[0] ? toRun(s.runs[0]) : null,
    createdBy: s.createdBy,
    timeZone: s.organization.timezone,
  }))
}

export async function listSchedules(
  auth: AuthContext,
  reportKey?: ReportKey,
): Promise<ReportScheduleDto[]> {
  const rows = await prisma.reportSchedule.findMany({
    where: { AND: [visibleWhere(auth), reportKey ? { reportKey } : {}] },
    include,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return toDtos(rows)
}

async function load(auth: AuthContext, id: string): Promise<Row> {
  const s = await prisma.reportSchedule.findFirst({
    where: { AND: [visibleWhere(auth), { id }] },
    include,
  })
  if (!s) throw new NotFoundError('Schedule')
  return s
}

export async function getSchedule(auth: AuthContext, id: string): Promise<ReportScheduleDto> {
  return (await toDtos([await load(auth, id)]))[0]!
}

export async function listRuns(auth: AuthContext, id: string): Promise<ReportScheduleRunDto[]> {
  await load(auth, id)
  const runs = await prisma.reportScheduleRun.findMany({
    where: { scheduleId: id },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  return runs.map(toRun)
}

export const MAX_SCHEDULES_PER_USER = 10
export const MAX_SCHEDULES_PER_ORG = 50

async function validate(auth: AuthContext, input: ReportScheduleInput) {
  const restaurantId = input.restaurantId || null
  if (restaurantId) {
    const ok =
      canAccessRestaurant(auth, restaurantId) &&
      (await prisma.restaurant.count({
        where: { id: restaurantId, organizationId: auth.organizationId, archivedAt: null },
      }))
    if (!ok) throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  }
  const userIds = [...new Set(input.recipientUserIds)]
  const allowed = await usersInScope(
    auth.organizationId,
    userIds,
    requiredRestaurants(auth, restaurantId),
  )
  if (allowed.length !== userIds.length)
    throw new ValidationError({ recipientUserIds: ['validation.recipientOutOfScope'] })
  if (allowed.some((u) => !u.email))
    throw new ValidationError({ recipientUserIds: ['validation.recipientNoEmail'] })
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: auth.organizationId },
    select: { timezone: true },
  })
  return { restaurantId, userIds, timeZone: org.timezone }
}

function toData(input: ReportScheduleInput, restaurantId: string | null, userIds: string[]) {
  return {
    reportKey: input.reportKey,
    restaurantId,
    filters: input.filters as Prisma.InputJsonValue,
    frequency: input.frequency,
    timeOfDay: input.timeOfDay,
    dayOfWeek: input.frequency === 'WEEKLY' ? (input.dayOfWeek ?? null) : null,
    dayOfMonth: input.frequency === 'MONTHLY' ? (input.dayOfMonth ?? null) : null,
    format: input.format,
    recipientUserIds: userIds,
    recipientEmails: [...new Set(input.recipientEmails)],
    active: input.active,
  }
}

const audit = (auth: AuthContext, s: { id: string; restaurantId: string | null }) => ({
  organizationId: auth.organizationId,
  restaurantId: s.restaurantId,
  actorId: auth.userId,
  entityType: 'REPORT' as const,
  entityId: s.id,
})

export async function createSchedule(
  auth: AuthContext,
  input: ReportScheduleInput,
  req: Request,
): Promise<ReportScheduleDto> {
  const { restaurantId, userIds, timeZone } = await validate(auth, input)
  // Each schedule emails up to 25 addresses on its own: cap how many exist so
  // the app's mail sender can't be turned into a bulk mailer.
  const [mine, org] = await Promise.all([
    prisma.reportSchedule.count({ where: { createdById: auth.userId, archivedAt: null } }),
    prisma.reportSchedule.count({ where: { organizationId: auth.organizationId, archivedAt: null } }),
  ])
  if (mine >= MAX_SCHEDULES_PER_USER || org >= MAX_SCHEDULES_PER_ORG)
    throw new ValidationError({ reportKey: ['validation.tooMany'] })
  const data = toData(input, restaurantId, userIds)
  const s = await prisma.reportSchedule.create({
    data: {
      ...data,
      organizationId: auth.organizationId,
      createdById: auth.userId,
      nextRunAt: nextRunAfter(data, timeZone, new Date()),
    },
  })
  await recordAudit(
    {
      ...audit(auth, s),
      action: 'report_schedule.created',
      newValue: { report: s.reportKey, frequency: s.frequency, format: s.format },
    },
    req,
  )
  return getSchedule(auth, s.id)
}

export async function updateSchedule(
  auth: AuthContext,
  id: string,
  input: ReportScheduleInput,
  req: Request,
): Promise<ReportScheduleDto> {
  const before = await load(auth, id)
  const { restaurantId, userIds, timeZone } = await validate(auth, input)
  const data = toData(input, restaurantId, userIds)
  await prisma.reportSchedule.update({
    where: { id },
    // Whoever saves it owns it: it then runs with their access.
    data: {
      ...data,
      createdById: auth.userId,
      nextRunAt: nextRunAfter(data, timeZone, new Date()),
    },
  })
  await recordAudit(
    {
      ...audit(auth, { id, restaurantId }),
      action: 'report_schedule.updated',
      oldValue: { report: before.reportKey, frequency: before.frequency, active: before.active },
      newValue: { report: data.reportKey, frequency: data.frequency, active: data.active },
    },
    req,
  )
  return getSchedule(auth, id)
}

export async function archiveSchedule(auth: AuthContext, id: string, req: Request) {
  const s = await load(auth, id)
  await prisma.reportSchedule.update({
    where: { id },
    data: { archivedAt: new Date(), active: false },
  })
  await recordAudit(
    { ...audit(auth, s), action: 'report_schedule.archived', oldValue: { report: s.reportKey } },
    req,
  )
}

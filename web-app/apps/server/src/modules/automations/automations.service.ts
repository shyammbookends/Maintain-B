import type {
  AutomationAction,
  AutomationConditions,
  AutomationDto,
  AutomationInput,
  AutomationLogDto,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Rules are per restaurant, or organization-wide (restaurantId empty, Super
 * Admin only). Everything a rule points at (people, teams, procedures,
 * assets, meters) is checked to belong to the organization and, for a
 * restaurant rule, to that restaurant.
 */

const person = { select: { id: true, firstName: true, lastName: true } } as const
const include = {
  restaurant: { select: { id: true, name: true } },
  createdBy: person,
} satisfies Prisma.AutomationInclude
type Row = Prisma.AutomationGetPayload<{ include: typeof include }>

const visibleWhere = (auth: AuthContext): Prisma.AutomationWhereInput => ({
  organizationId: auth.organizationId,
  archivedAt: null,
  ...(auth.isSuperAdmin
    ? {}
    : { OR: [{ restaurantId: null }, { restaurantId: restaurantScope(auth) }] }),
})

/** Org-wide rules are managed by Super Admins only. */
const canManage = (auth: AuthContext, r: { restaurantId: string | null }) =>
  auth.isSuperAdmin || (r.restaurantId !== null && canAccessRestaurant(auth, r.restaurantId))

function toDto(auth: AuthContext, r: Row): AutomationDto {
  const manage = canManage(auth, r)
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    trigger: r.trigger,
    restaurant: r.restaurant,
    conditions: (r.conditions ?? {}) as AutomationConditions,
    actions: (r.actions ?? []) as AutomationAction[],
    active: r.active,
    runCount: r.runCount,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    can: {
      edit: manage && hasPermission(auth, 'automations:edit'),
      delete: manage && hasPermission(auth, 'automations:delete'),
    },
  }
}

export async function listAutomations(auth: AuthContext): Promise<AutomationDto[]> {
  const rows = await prisma.automation.findMany({
    where: visibleWhere(auth),
    include,
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  })
  return rows.map((r) => toDto(auth, r))
}

async function load(auth: AuthContext, id: string) {
  const r = await prisma.automation.findFirst({
    where: { AND: [{ id }, visibleWhere(auth)] },
    include,
  })
  if (!r) throw new NotFoundError('Automation')
  return r
}

export async function getAutomation(auth: AuthContext, id: string) {
  return toDto(auth, await load(auth, id))
}

async function validate(auth: AuthContext, input: AutomationInput) {
  const errors: Record<string, string[]> = {}
  const org = auth.organizationId
  const restaurantId = input.restaurantId || null
  if (!restaurantId && !auth.isSuperAdmin) errors.restaurantId = ['validation.restaurantRequired']
  if (restaurantId && !canAccessRestaurant(auth, restaurantId))
    errors.restaurantId = ['validation.restaurantOutOfScope']
  const inPlace = restaurantId ? { restaurantId } : {}

  const c = input.conditions
  if (c.assetId) {
    const ok = await prisma.asset.count({
      where: { id: c.assetId, organizationId: org, archivedAt: null, ...inPlace },
    })
    if (!ok) errors['conditions.assetId'] = ['validation.invalidValue']
  }
  if (c.meterId) {
    const ok = await prisma.assetMeter.count({
      where: {
        id: c.meterId,
        organizationId: org,
        archivedAt: null,
        ...(restaurantId ? { asset: { restaurantId } } : {}),
      },
    })
    if (!ok) errors['conditions.meterId'] = ['validation.invalidValue']
  }

  const userOk = async (userId: string) =>
    (await prisma.user.count({
      where: {
        id: userId,
        organizationId: org,
        archivedAt: null,
        ...(restaurantId ? { userRestaurants: { some: { restaurantId } } } : {}),
      },
    })) > 0
  for (const [i, a] of input.actions.entries()) {
    if (a.type === 'NOTIFY' && a.userId && !(await userOk(a.userId)))
      errors[`actions.${i}.userId`] = ['validation.invalidValue']
    if (a.type === 'CREATE_WORK_ORDER' || a.type === 'ASSIGN') {
      const userId = a.type === 'ASSIGN' ? a.userId : a.assignedUserId
      const teamId = a.type === 'ASSIGN' ? a.teamId : a.assignedTeamId
      if (userId && !(await userOk(userId)))
        errors[`actions.${i}.${a.type === 'ASSIGN' ? 'userId' : 'assignedUserId'}`] = [
          'validation.invalidValue',
        ]
      if (teamId) {
        // The rule's restaurant's own teams, or organization-wide ones.
        const ok = await prisma.team.count({
          where: {
            id: teamId,
            organizationId: org,
            archivedAt: null,
            ...(restaurantId ? { OR: [{ restaurantId: null }, { restaurantId }] } : {}),
          },
        })
        if (!ok)
          errors[`actions.${i}.${a.type === 'ASSIGN' ? 'teamId' : 'assignedTeamId'}`] = [
            'validation.invalidValue',
          ]
      }
    }
    if (a.type === 'CREATE_WORK_ORDER' && a.procedureId) {
      const ok = await prisma.procedure.count({
        where: {
          id: a.procedureId,
          organizationId: org,
          archivedAt: null,
          ...(restaurantId ? { OR: [{ restaurantId: null }, { restaurantId }] } : {}),
        },
      })
      if (!ok) errors[`actions.${i}.procedureId`] = ['validation.invalidValue']
    }
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
}

const data = (input: AutomationInput) => ({
  name: input.name,
  description: input.description || null,
  trigger: input.trigger,
  restaurantId: input.restaurantId || null,
  conditions: input.conditions as Prisma.InputJsonValue,
  actions: input.actions as unknown as Prisma.InputJsonValue,
  active: input.active,
})

const auditAutomation = (
  auth: AuthContext,
  id: string,
  restaurantId: string | null,
  action: string,
  extra: object = {},
) => ({
  organizationId: auth.organizationId,
  restaurantId,
  actorId: auth.userId,
  action,
  entityType: 'AUTOMATION' as const,
  entityId: id,
  ...extra,
})

export async function createAutomation(auth: AuthContext, input: AutomationInput, req: Request) {
  await validate(auth, input)
  const r = await prisma.automation.create({
    data: { ...data(input), organizationId: auth.organizationId, createdById: auth.userId },
  })
  await recordAudit(
    auditAutomation(auth, r.id, r.restaurantId, 'automation.created', {
      newValue: { name: input.name, trigger: input.trigger, actions: input.actions.length },
    }),
    req,
  )
  return getAutomation(auth, r.id)
}

export async function updateAutomation(
  auth: AuthContext,
  id: string,
  input: AutomationInput,
  req: Request,
) {
  const before = await load(auth, id)
  if (!canManage(auth, before)) throw new ForbiddenError()
  await validate(auth, input)
  await prisma.automation.update({ where: { id }, data: data(input) })
  await recordAudit(
    auditAutomation(auth, id, input.restaurantId || null, 'automation.updated', {
      oldValue: { name: before.name, trigger: before.trigger, active: before.active },
      newValue: { name: input.name, trigger: input.trigger, active: input.active },
    }),
    req,
  )
  return getAutomation(auth, id)
}

export async function setAutomationActive(
  auth: AuthContext,
  id: string,
  active: boolean,
  req: Request,
) {
  const r = await load(auth, id)
  if (!canManage(auth, r)) throw new ForbiddenError()
  await prisma.automation.update({ where: { id }, data: { active } })
  await recordAudit(
    auditAutomation(
      auth,
      id,
      r.restaurantId,
      active ? 'automation.enabled' : 'automation.disabled',
    ),
    req,
  )
  return getAutomation(auth, id)
}

export async function archiveAutomation(auth: AuthContext, id: string, req: Request) {
  const r = await load(auth, id)
  if (!canManage(auth, r)) throw new ForbiddenError()
  await prisma.automation.update({ where: { id }, data: { archivedAt: new Date(), active: false } })
  await recordAudit(
    auditAutomation(auth, id, r.restaurantId, 'automation.archived', {
      oldValue: { name: r.name },
    }),
    req,
  )
}

export async function automationLogs(auth: AuthContext, id: string): Promise<AutomationLogDto[]> {
  await load(auth, id)
  const rows = await prisma.automationLog.findMany({
    where: { automationId: id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return rows.map((l) => ({
    id: l.id,
    trigger: l.trigger,
    status: l.status,
    entityType: l.entityType,
    entityId: l.entityId,
    message: l.message,
    createdAt: l.createdAt.toISOString(),
  }))
}

/** Meters the automation form can point at (assets in scope). */
export async function meterOptions(auth: AuthContext, restaurantId?: string) {
  const rows = await prisma.assetMeter.findMany({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      asset: {
        archivedAt: null,
        restaurantId:
          restaurantId && canAccessRestaurant(auth, restaurantId)
            ? restaurantId
            : restaurantScope(auth),
      },
    },
    select: { id: true, name: true, unit: true, asset: { select: { id: true, name: true } } },
    orderBy: [{ asset: { name: 'asc' } }, { name: 'asc' }],
    take: 500,
  })
  return rows
}

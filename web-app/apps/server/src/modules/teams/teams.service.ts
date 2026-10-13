import { SYSTEM_ROLES, type TeamDto, type TeamInput } from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant } from '../../core/authz.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

const teamInclude = {
  restaurant: { select: { id: true, code: true, name: true } },
  lead: { select: { id: true, firstName: true, lastName: true } },
  members: {
    where: { user: { archivedAt: null } },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.TeamInclude

type TeamRow = Prisma.TeamGetPayload<{ include: typeof teamInclude }>

function toTeamDto(t: TeamRow): TeamDto {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    restaurant: t.restaurant,
    lead: t.lead,
    members: t.members
      .map((m) => ({
        id: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        role: m.user.userRoles[0]?.role.name ?? null,
      }))
      .sort((a, b) => a.firstName.localeCompare(b.firstName)),
  }
}

/** Teams visible to the actor: their restaurants' teams plus organization-wide teams. */
function visibilityWhere(auth: AuthContext): Prisma.TeamWhereInput {
  if (auth.isSuperAdmin) return {}
  return { OR: [{ restaurantId: null }, { restaurantId: { in: [...auth.restaurantIds] } }] }
}

async function loadTeam(auth: AuthContext, id: string): Promise<TeamRow> {
  const t = await prisma.team.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null, ...visibilityWhere(auth) },
    include: teamInclude,
  })
  if (!t) throw new NotFoundError('Team')
  return t
}

/** Only Super Admin manages organization-wide teams; others manage their restaurants' teams. */
function assertCanManage(auth: AuthContext, restaurantId: string | null) {
  if (restaurantId === null ? !auth.isSuperAdmin : !canAccessRestaurant(auth, restaurantId)) {
    throw new ForbiddenError('You can only manage teams in your restaurants.')
  }
}

async function validateInput(auth: AuthContext, input: TeamInput): Promise<string[]> {
  if (input.restaurantId === null) {
    if (!auth.isSuperAdmin) throw new ValidationError({ restaurantId: ['validation.selectOption'] })
  } else {
    if (!canAccessRestaurant(auth, input.restaurantId)) {
      throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
    }
    const exists = await prisma.restaurant.count({
      where: { id: input.restaurantId, organizationId: auth.organizationId, archivedAt: null },
    })
    if (!exists) throw new ValidationError({ restaurantId: ['validation.invalidValue'] })
  }

  const memberIds = [
    ...new Set([...input.memberIds, ...(input.leadUserId ? [input.leadUserId] : [])]),
  ]
  if (memberIds.length === 0) return []

  // Members must be active users the actor can see, assigned to the team's restaurant
  // (Super Admins are valid members of any team).
  const users = await prisma.user.findMany({
    where: {
      id: { in: memberIds },
      organizationId: auth.organizationId,
      archivedAt: null,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      userRestaurants: { select: { restaurantId: true } },
      userRoles: { select: { role: { select: { systemKey: true } } } },
    },
  })
  const valid = users.filter((u) => {
    const isSuper = u.userRoles.some((r) => r.role.systemKey === SYSTEM_ROLES.SUPER_ADMIN)
    if (isSuper) return auth.isSuperAdmin
    const rids = u.userRestaurants.map((r) => r.restaurantId)
    if (input.restaurantId) return rids.includes(input.restaurantId)
    return true
  })
  if (valid.length !== memberIds.length) {
    throw new ValidationError({ memberIds: ['validation.memberNotInRestaurant'] })
  }
  return memberIds
}

async function assertNameFree(organizationId: string, name: string, exceptId?: string) {
  const clash = await prisma.team.findFirst({
    where: {
      organizationId,
      archivedAt: null,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) throw new ValidationError({ name: ['validation.alreadyInUse'] })
}

export async function listTeams(auth: AuthContext, restaurantId?: string): Promise<TeamDto[]> {
  if (restaurantId && !canAccessRestaurant(auth, restaurantId)) return []
  const rows = await prisma.team.findMany({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      ...visibilityWhere(auth),
      ...(restaurantId ? { restaurantId } : {}),
    },
    include: teamInclude,
    orderBy: { name: 'asc' },
  })
  return rows.map(toTeamDto)
}

export async function getTeam(auth: AuthContext, id: string): Promise<TeamDto> {
  return toTeamDto(await loadTeam(auth, id))
}

export async function createTeam(
  auth: AuthContext,
  input: TeamInput,
  req: Request,
): Promise<TeamDto> {
  const memberIds = await validateInput(auth, input)
  await assertNameFree(auth.organizationId, input.name)
  const id = await prisma.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: {
        organizationId: auth.organizationId,
        restaurantId: input.restaurantId,
        name: input.name,
        description: input.description || null,
        leadUserId: input.leadUserId,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: input.restaurantId,
        actorId: auth.userId,
        action: 'team.created',
        entityType: 'TEAM',
        entityId: team.id,
        newValue: {
          name: input.name,
          restaurantId: input.restaurantId,
          leadUserId: input.leadUserId,
          memberIds,
        },
      },
      req,
      tx,
    )
    return team.id
  })
  return getTeam(auth, id)
}

export async function updateTeam(
  auth: AuthContext,
  id: string,
  input: TeamInput,
  req: Request,
): Promise<TeamDto> {
  const before = await loadTeam(auth, id)
  assertCanManage(auth, before.restaurantId)
  const memberIds = await validateInput(auth, input)
  await assertNameFree(auth.organizationId, input.name, id)

  await prisma.$transaction(async (tx) => {
    await tx.team.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description || null,
        restaurantId: input.restaurantId,
        leadUserId: input.leadUserId,
      },
    })
    await tx.teamMember.deleteMany({ where: { teamId: id } })
    await tx.teamMember.createMany({ data: memberIds.map((userId) => ({ teamId: id, userId })) })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: input.restaurantId,
        actorId: auth.userId,
        action: 'team.updated',
        entityType: 'TEAM',
        entityId: id,
        oldValue: {
          name: before.name,
          restaurantId: before.restaurantId,
          leadUserId: before.leadUserId,
          memberIds: before.members.map((m) => m.user.id).sort(),
        },
        newValue: {
          name: input.name,
          restaurantId: input.restaurantId,
          leadUserId: input.leadUserId,
          memberIds: [...memberIds].sort(),
        },
      },
      req,
      tx,
    )
  })
  return getTeam(auth, id)
}

export async function archiveTeam(auth: AuthContext, id: string, req: Request): Promise<void> {
  const before = await loadTeam(auth, id)
  assertCanManage(auth, before.restaurantId)
  await prisma.$transaction(async (tx) => {
    await tx.team.update({ where: { id }, data: { archivedAt: new Date() } })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: before.restaurantId,
        actorId: auth.userId,
        action: 'team.archived',
        entityType: 'TEAM',
        entityId: id,
        oldValue: { name: before.name },
      },
      req,
      tx,
    )
  })
}

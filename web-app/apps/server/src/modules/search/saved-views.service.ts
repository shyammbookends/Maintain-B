import type { CreateSavedViewInput, SavedViewDto, SavedViewResource } from '@maintainx/shared'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

const MAX_VIEWS_PER_USER = 30

const select = {
  id: true,
  resource: true,
  name: true,
  query: true,
  shared: true,
  userId: true,
  createdAt: true,
  user: { select: { id: true, firstName: true, lastName: true } },
} as const

/** Paging is never part of a view: it always opens on page 1. */
function cleanQuery(query: string): string {
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  params.delete('page')
  params.delete('open')
  return params.toString()
}

export async function listSavedViews(
  auth: AuthContext,
  resource: SavedViewResource,
): Promise<SavedViewDto[]> {
  const rows = await prisma.savedView.findMany({
    where: {
      organizationId: auth.organizationId,
      resource,
      OR: [{ userId: auth.userId }, { shared: true }],
    },
    select,
    orderBy: [{ shared: 'asc' }, { name: 'asc' }],
  })
  return rows.map((v) => ({
    id: v.id,
    resource: v.resource as SavedViewResource,
    name: v.name,
    query: v.query,
    shared: v.shared,
    mine: v.userId === auth.userId,
    owner: v.user,
    createdAt: v.createdAt.toISOString(),
  }))
}

export async function createSavedView(
  auth: AuthContext,
  input: CreateSavedViewInput,
  req: Request,
): Promise<SavedViewDto[]> {
  // A shared view shows up in everyone's lists: managers only.
  if (input.shared && auth.user.roleKind === 'WORKER') throw new ForbiddenError()
  const count = await prisma.savedView.count({ where: { userId: auth.userId } })
  if (count >= MAX_VIEWS_PER_USER) throw new ValidationError({ name: ['validation.tooMany'] })
  const view = await prisma.savedView.create({
    data: {
      organizationId: auth.organizationId,
      userId: auth.userId,
      resource: input.resource,
      name: input.name,
      query: cleanQuery(input.query),
      shared: input.shared,
    },
  })
  if (view.shared)
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'saved_view.shared',
        entityType: 'SETTING',
        entityId: view.id,
        newValue: { name: view.name, resource: view.resource, query: view.query },
      },
      req,
    )
  return listSavedViews(auth, input.resource as SavedViewResource)
}

/** Owners delete their views; shared views also by whoever may edit settings. */
export async function deleteSavedView(auth: AuthContext, id: string): Promise<SavedViewDto[]> {
  const view = await prisma.savedView.findFirst({
    where: { id, organizationId: auth.organizationId },
    select: { userId: true, shared: true, resource: true },
  })
  if (!view || (view.userId !== auth.userId && !view.shared)) throw new NotFoundError('View')
  if (view.userId !== auth.userId && !auth.permissions.has('settings:edit') && !auth.isSuperAdmin)
    throw new ForbiddenError()
  await prisma.savedView.delete({ where: { id } })
  return listSavedViews(auth, view.resource as SavedViewResource)
}

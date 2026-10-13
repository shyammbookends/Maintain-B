import {
  DEFAULT_ASSET_CATEGORIES,
  ERROR_CODES,
  type AssetCategoryDto,
  type AssetCategoryInput,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { restaurantScope } from '../../core/authz.js'
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/** Creates the default categories for an organization (idempotent). */
export async function ensureDefaultCategories(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
) {
  await db.assetCategory.createMany({
    data: DEFAULT_ASSET_CATEGORIES.map((name) => ({ organizationId, name })),
    skipDuplicates: true,
  })
}

/** Categories are organization-wide; counts only include assets the user can see. */
export async function listCategories(auth: AuthContext): Promise<AssetCategoryDto[]> {
  const rows = await prisma.assetCategory.findMany({
    where: { organizationId: auth.organizationId, archivedAt: null },
    select: {
      id: true,
      name: true,
      _count: {
        select: { assets: { where: { archivedAt: null, restaurantId: restaurantScope(auth) } } },
      },
    },
    orderBy: { name: 'asc' },
  })
  return rows.map((c) => ({ id: c.id, name: c.name, assetCount: c._count.assets }))
}

async function assertNameFree(organizationId: string, name: string, exceptId?: string) {
  const clash = await prisma.assetCategory.findFirst({
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

export async function createCategory(
  auth: AuthContext,
  input: AssetCategoryInput,
  req: Request,
): Promise<AssetCategoryDto> {
  await assertNameFree(auth.organizationId, input.name)
  const archived = await prisma.assetCategory.findFirst({
    where: {
      organizationId: auth.organizationId,
      name: { equals: input.name, mode: 'insensitive' },
    },
  })
  const c = await prisma.$transaction(async (tx) => {
    const cat = archived
      ? await tx.assetCategory.update({
          where: { id: archived.id },
          data: { name: input.name, archivedAt: null },
        })
      : await tx.assetCategory.create({
          data: { organizationId: auth.organizationId, name: input.name },
        })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'asset_category.created',
        entityType: 'ASSET',
        entityId: cat.id,
        newValue: { name: input.name },
      },
      req,
      tx,
    )
    return cat
  })
  return { id: c.id, name: c.name, assetCount: 0 }
}

export async function renameCategory(
  auth: AuthContext,
  id: string,
  input: AssetCategoryInput,
  req: Request,
): Promise<AssetCategoryDto> {
  const before = await prisma.assetCategory.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null },
  })
  if (!before) throw new NotFoundError('Category')
  await assertNameFree(auth.organizationId, input.name, id)
  await prisma.$transaction(async (tx) => {
    await tx.assetCategory.update({ where: { id }, data: { name: input.name } })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'asset_category.renamed',
        entityType: 'ASSET',
        entityId: id,
        oldValue: { name: before.name },
        newValue: { name: input.name },
      },
      req,
      tx,
    )
  })
  return (await listCategories(auth)).find((c) => c.id === id)!
}

export async function archiveCategory(auth: AuthContext, id: string, req: Request): Promise<void> {
  const cat = await prisma.assetCategory.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null },
    select: {
      id: true,
      name: true,
      _count: { select: { assets: { where: { archivedAt: null } } } },
    },
  })
  if (!cat) throw new NotFoundError('Category')
  if (cat._count.assets > 0) {
    throw new ConflictError(
      'Move its assets to another category first.',
      ERROR_CODES.CATEGORY_IN_USE,
    )
  }
  await prisma.$transaction(async (tx) => {
    await tx.assetCategory.update({ where: { id }, data: { archivedAt: new Date() } })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'asset_category.archived',
        entityType: 'ASSET',
        entityId: id,
        oldValue: { name: cat.name },
      },
      req,
      tx,
    )
  })
}

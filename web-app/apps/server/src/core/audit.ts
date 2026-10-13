import type { AuditEntityType, Prisma, PrismaClient } from '@prisma/client'
import type { Request } from 'express'
import { prisma } from './prisma.js'

type Db = PrismaClient | Prisma.TransactionClient

export interface AuditEntry {
  organizationId: string
  actorId?: string | null
  /** dot.separated verb, e.g. "auth.login", "work_order.assigned" */
  action: string
  entityType: AuditEntityType
  entityId?: string | null
  restaurantId?: string | null
  oldValue?: Prisma.InputJsonValue
  newValue?: Prisma.InputJsonValue
  metadata?: Prisma.InputJsonValue
}

/**
 * Append one audit record. Pass the transaction client when the audited change
 * runs in a transaction so both commit (or roll back) together.
 * Never put secrets (passwords, tokens, hashes) in values or metadata.
 */
export async function recordAudit(
  entry: AuditEntry,
  req?: Request,
  db: Db = prisma,
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      restaurantId: entry.restaurantId ?? null,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      metadata: entry.metadata,
      ip: req?.ip ?? null,
      userAgent: req?.get('user-agent')?.slice(0, 500) ?? null,
      requestId: req?.requestId ?? null,
    },
  })
}

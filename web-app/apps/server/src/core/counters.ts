import type { Prisma } from '@prisma/client'
import { formatCode } from './ids.js'

/**
 * Next human-readable code (AST-0001, WO-000123…). The upsert+increment runs as
 * one statement, so concurrent creates never get the same number. Call inside
 * the creating transaction so a rolled-back create doesn't burn the number.
 */
export async function nextCode(
  tx: Prisma.TransactionClient,
  organizationId: string,
  key: string,
  width: number,
): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return formatCode(key, counter.value, width)
}

import type { EvidenceStage } from '@maintainx/shared'
import { randomUUID } from 'node:crypto'
import { prisma } from '../core/prisma.js'

/**
 * Before / after photos for a work order, written straight to the table (the
 * upload path itself is covered by its own tests). Completion requires them.
 */
export async function giveEvidence(
  workOrderId: string,
  userId: string,
  stages: EvidenceStage[] = ['BEFORE', 'AFTER'],
) {
  await prisma.attachment.createMany({
    data: stages.map((stage) => ({
      ownerType: 'WORK_ORDER' as const,
      ownerId: workOrderId,
      kind: 'PHOTO' as const,
      storageKey: `test/${randomUUID()}.jpg`,
      fileName: `${stage.toLowerCase()}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      stage,
      uploadedById: userId,
    })),
  })
}

/** A complete, valid repair report; override what the test cares about. */
export const report = (o: Record<string, unknown> = {}) => ({
  problemFound: 'Door gasket torn',
  rootCause: 'Wear and tear',
  workPerformed: (o.notes as string | undefined) ?? 'Replaced the gasket',
  finalCondition: 'FULLY_WORKING',
  noPartsUsed: true,
  confirmed: true,
  assetStatus: '',
  ...o,
})

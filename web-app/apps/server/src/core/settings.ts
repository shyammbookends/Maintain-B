import {
  DEFAULT_STORAGE_POLICY,
  DEFAULT_WORKFLOW,
  type StoragePolicy,
  type WorkflowSettings,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

/*
 * Organization settings stored as JSON rows (scopeKey "org"). Every reader
 * supplies its defaults, so a missing or partial row never breaks anything.
 */

export async function getOrgSetting<T extends object>(
  organizationId: string,
  key: string,
  defaults: T,
): Promise<T> {
  const row = await prisma.setting.findUnique({
    where: { organizationId_scopeKey_key: { organizationId, scopeKey: 'org', key } },
    select: { value: true },
  })
  const value = row?.value
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...defaults, ...(value as Partial<T>) }
    : defaults
}

export async function setOrgSetting(
  organizationId: string,
  key: string,
  value: Prisma.InputJsonValue,
  updatedById: string,
) {
  await prisma.setting.upsert({
    where: { organizationId_scopeKey_key: { organizationId, scopeKey: 'org', key } },
    update: { value, updatedById },
    create: { organizationId, scope: 'ORGANIZATION', scopeKey: 'org', key, value, updatedById },
  })
}

/**
 * How strict the work order flow is (photos, full repair report,
 * verification, simple statuses). Defaults follow MaintainX; see
 * DEFAULT_WORKFLOW in the shared package.
 */
export const COMPLETION_POLICY_KEY = 'workOrders.completion'

export const completionPolicy = (organizationId: string) =>
  getOrgSetting<WorkflowSettings>(organizationId, COMPLETION_POLICY_KEY, { ...DEFAULT_WORKFLOW })

export const workflowSettings = completionPolicy

/** Inventory automation. */
export interface InventorySettingsValue {
  autoPurchaseRequest: boolean
}

export const INVENTORY_SETTINGS_KEY = 'inventory.settings'

export const inventorySettings = (organizationId: string) =>
  getOrgSetting<InventorySettingsValue>(organizationId, INVENTORY_SETTINGS_KEY, {
    autoPurchaseRequest: false,
  })

/** File retention: compaction age, video lifetime, years files are kept. */
export const STORAGE_POLICY_KEY = 'storage.policy'

export const storagePolicy = (organizationId: string) =>
  getOrgSetting<StoragePolicy>(organizationId, STORAGE_POLICY_KEY, { ...DEFAULT_STORAGE_POLICY })

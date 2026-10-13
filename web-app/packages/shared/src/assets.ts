import { z } from 'zod'
import {
  ASSET_CRITICALITY,
  ASSET_STATUS,
  LOCATION_TYPE,
  type AssetCriticality,
  type AssetEventType,
  type AssetStatus,
  type LocationType,
  type Priority,
  type WorkOrderStatus,
} from './enums.js'
import { paginationQuerySchema, sortQuerySchema } from './schemas/common.js'
import { customValuesSchema, type CustomValue } from './custom.js'

/*
 * Locations, asset categories and assets. Custom messages are i18n keys.
 * Optional text accepts '' from forms; the API stores '' as null.
 */

const optionalText = (max: number) => z.string().trim().max(max)
/** '' or YYYY-MM-DD */
const optionalDate = z.iso.date().or(z.literal(''))

// ---------------------------------------------------------------- locations

export const locationSchema = z.object({
  restaurantId: z.uuid(),
  /** Parent in the site tree (building → floor → area → room); '' = top level. Omitted = unchanged. */
  parentId: z.uuid().or(z.literal('')).optional(),
  name: z.string().trim().min(1).max(80),
  type: z.enum(LOCATION_TYPE),
  description: optionalText(300),
})
export type LocationInput = z.infer<typeof locationSchema>

export const listLocationsQuerySchema = z.object({
  restaurantId: z.uuid().optional(),
})

export interface LocationDto {
  id: string
  restaurantId: string
  parentId: string | null
  /** For the location QR code (/l/<publicId>). */
  publicId: string
  name: string
  type: LocationType
  description: string | null
  assetCount: number
}

/** Location QR landing: where you are, what is here, what is wrong here. */
export interface LocationLanding {
  id: string
  publicId: string
  name: string
  type: LocationType
  description: string | null
  restaurant: { id: string; code: string; name: string }
  /** Root first, e.g. Main building › Ground floor. */
  path: Array<{ id: string; name: string; type: LocationType }>
  /** Sub-locations; `publicId` opens their landing page (/l/<publicId>). */
  children: Array<{ id: string; publicId: string; name: string; type: LocationType }>
  assets: Array<{
    id: string
    publicId: string
    assetCode: string
    name: string
    status: AssetStatus
    criticality: AssetCriticality
  }>
  openWorkOrders: AssetWorkOrderItem[]
  can: { report: boolean }
}

// --------------------------------------------------------------- categories

export const assetCategorySchema = z.object({
  name: z.string().trim().min(2).max(60),
})
export type AssetCategoryInput = z.infer<typeof assetCategorySchema>

export interface AssetCategoryDto {
  id: string
  name: string
  assetCount: number
}

/** Seeded for every organization; admins can add more. */
export const DEFAULT_ASSET_CATEGORIES = [
  'Refrigerator',
  'Freezer',
  'Deep freezer',
  'Oven',
  'Microwave',
  'Dishwasher',
  'Exhaust system',
  'AC unit',
  'RO / water purifier',
  'Generator',
  'POS hardware',
  'CCTV',
  'Fire extinguisher',
  'Electrical panel',
  'Plumbing equipment',
  'Coffee machine',
  'Ice machine',
] as const

// ------------------------------------------------------------------- assets

export const assetSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    categoryId: z.uuid(),
    restaurantId: z.uuid(),
    locationId: z.uuid().or(z.literal('')),
    /** Parent asset (this one is a component of it); omitted = unchanged. */
    parentId: z.uuid().or(z.literal('')).optional(),
    criticality: z.enum(ASSET_CRITICALITY).optional(),
    installDate: optionalDate.optional(),
    manufacturer: optionalText(80),
    model: optionalText(80),
    serialNumber: optionalText(80),
    purchaseDate: optionalDate,
    /** Rupees; '' = unknown. */
    purchaseCost: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\d{1,10}(\.\d{1,2})?$/.test(v), 'validation.invalidNumber'),
    warrantyStart: optionalDate,
    warrantyEnd: optionalDate,
    notes: optionalText(2000),
    /** Service vendor; omitted = unchanged. */
    vendorId: z.uuid().or(z.literal('')).optional(),
    /** Custom field values by field id; omitted = unchanged. */
    customFields: customValuesSchema.optional(),
  })
  .refine((v) => !v.warrantyStart || !v.warrantyEnd || v.warrantyStart <= v.warrantyEnd, {
    message: 'validation.warrantyEndBeforeStart',
    path: ['warrantyEnd'],
  })
export type AssetInput = z.infer<typeof assetSchema>

export const assetStatusChangeSchema = z.object({
  status: z.enum(ASSET_STATUS),
  note: optionalText(500),
})
export type AssetStatusChangeInput = z.infer<typeof assetStatusChangeSchema>

/** Move an asset (and its components) to another restaurant / location. */
export const assetTransferSchema = z.object({
  restaurantId: z.uuid(),
  locationId: z.uuid().or(z.literal('')),
  note: z.string().trim().min(3).max(500),
})
export type AssetTransferInput = z.infer<typeof assetTransferSchema>

export const ASSET_SORT_FIELDS = ['name', 'assetCode', 'warrantyEnd', 'createdAt'] as const

export const listAssetsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(ASSET_SORT_FIELDS),
  restaurantId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  status: z.enum(ASSET_STATUS).optional(),
  criticality: z.enum(ASSET_CRITICALITY).optional(),
  /** Only top-level assets (no parent). */
  topLevel: z.enum(['1']).optional(),
  parentId: z.uuid().optional(),
})
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>

export type WarrantyState = 'none' | 'active' | 'expiring' | 'expired'

/** Expiring = within this many days. */
export const WARRANTY_EXPIRING_DAYS = 30

export function warrantyState(warrantyEnd: string | null, today: Date = new Date()): WarrantyState {
  if (!warrantyEnd) return 'none'
  const end = new Date(`${warrantyEnd}T23:59:59`)
  const days = (end.getTime() - today.getTime()) / 86_400_000
  if (days < 0) return 'expired'
  if (days <= WARRANTY_EXPIRING_DAYS) return 'expiring'
  return 'active'
}

export interface AssetListItem {
  id: string
  publicId: string
  assetCode: string
  name: string
  status: AssetStatus
  criticality: AssetCriticality
  category: { id: string; name: string }
  restaurant: { id: string; code: string; name: string }
  location: { id: string; name: string } | null
  parent: { id: string; name: string; assetCode: string } | null
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  /** YYYY-MM-DD */
  warrantyEnd: string | null
}

export interface AssetHistoryItem {
  id: string
  eventType: AssetEventType
  actor: { id: string; firstName: string; lastName: string } | null
  oldValue: unknown
  newValue: unknown
  note: string | null
  occurredAt: string
}

export interface AssetWorkOrderItem {
  id: string
  code: string
  title: string
  status: WorkOrderStatus
  priority: Priority
  dueDate: string | null
}

/** Maintenance spend in rupees. */
export interface CostBreakdown {
  parts: number
  labour: number
  vendor: number
  other: number
  total: number
}

export interface AssetDetail extends AssetListItem {
  /** Custom field values by field id (only filled fields). */
  customFields: Record<string, Exclude<CustomValue, null>>
  vendor: { id: string; name: string; phone: string | null } | null
  installDate: string | null
  /** Components of this asset. */
  children: Array<{ id: string; name: string; assetCode: string; status: AssetStatus }>
  /** Lifetime maintenance cost of this asset. */
  cost: CostBreakdown
  /** All work orders ever raised on the asset, and how many were failures (reactive). */
  workOrderStats: { total: number; reactive: number; completed: number }
  /** Recently finished jobs, newest first. */
  recentWorkOrders: AssetWorkOrderItem[]
  purchaseDate: string | null
  purchaseCost: string | null
  warrantyStart: string | null
  notes: string | null
  createdAt: string
  /** Hours of downtime in the last 90 days (closed + ongoing). */
  downtimeHours90d: number
  /** Currently broken since… (open downtime record). */
  downSince: string | null
  openWorkOrders: AssetWorkOrderItem[]
  history: AssetHistoryItem[]
  can: { edit: boolean; delete: boolean; transfer: boolean }
}

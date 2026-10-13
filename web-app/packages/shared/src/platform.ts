import { z } from 'zod'
import {
  AUDIT_ENTITY_TYPE,
  DOCUMENT_OWNER_TYPE,
  DOCUMENT_TYPE,
  NOTIFICATION_TYPE,
  PRIORITY,
  WORK_ORDER_STATUS,
  WORK_ORDER_TYPE,
  type AuditEntityType,
  type DocumentOwnerType,
  type DocumentType,
  type NotificationType,
  type Priority,
} from './enums.js'
import { paginationQuerySchema } from './schemas/common.js'
import type { PersonRef } from './work-orders.js'

/*
 * Notifications, documents, reports and the audit log.
 */

type Ref = { id: string; name: string }
const optionalDate = z.iso.date().or(z.literal(''))

// ---------------------------------------------------------------- notifications

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unread: z.enum(['1']).optional(),
})
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>

export interface NotificationDto {
  id: string
  type: NotificationType
  title: string
  body: string | null
  actionUrl: string | null
  priority: Priority
  readAt: string | null
  createdAt: string
}

export const notificationPreferencesSchema = z.object({
  /** Types the user does NOT want in the app. */
  muted: z.array(z.enum(NOTIFICATION_TYPE)).max(NOTIFICATION_TYPE.length),
  /** Types the user also wants by email (when email is set up). */
  email: z.array(z.enum(NOTIFICATION_TYPE)).max(NOTIFICATION_TYPE.length).optional(),
})
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>

export interface NotificationPreferences {
  muted: NotificationType[]
  email: NotificationType[]
  /** Which extra channels the server is configured for. */
  channels: { email: boolean; push: boolean; pushKey: string | null }
}

/**
 * Browser push services (Chrome/Android, Firefox, Edge/Windows, Safari). The
 * server POSTs to the endpoint on every notification, so anything else would
 * let a user point it at internal hosts (or at a phone-app `native:` device).
 */
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
  '.push.apple.com',
] as const

export function isPushServiceUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  const host = url.hostname.toLowerCase()
  return PUSH_SERVICE_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h))
}

/** A browser Web Push subscription (PushSubscription.toJSON()). */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(1000).refine(isPushServiceUrl, 'validation.invalidValue'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
})
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>

export const pushUnsubscribeSchema = z.object({ endpoint: z.url().max(1000) })

/** Critical alerts can't be muted. */
export const UNMUTABLE_NOTIFICATIONS: readonly NotificationType[] = ['CRITICAL_ISSUE']

/** Admin links (/work-orders/…) become worker links (/w/tasks/…) for workers. */
export function notificationLinkFor(url: string | null, isWorker: boolean): string | null {
  if (!url) return url
  if (!isWorker) {
    // Admins can be assignees too; a worker-app task link would bounce them home.
    const task = url.match(/^\/w\/tasks\/([0-9a-f-]{36})/)
    if (task) return `/work-orders/${task[1]}`
    return url.startsWith('/w/reports') ? '/requests' : url
  }
  const wo = url.match(/^\/work-orders\/([0-9a-f-]{36})/)
  if (wo) return `/w/tasks/${wo[1]}`
  if (url.startsWith('/requests')) return '/w/reports'
  if (url.startsWith('/chat')) return `/w${url}`
  if (url.startsWith('/inspections/')) return url.replace('/inspections/', '/w/inspections/')
  if (url.startsWith('/w/')) return url
  return null
}

// ---------------------------------------------------------------- documents

/** PDFs, photos and Office files. Checked by content on the server. */
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

export const documentMetaSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    docType: z.enum(DOCUMENT_TYPE),
    issuedAt: optionalDate,
    expiresAt: optionalDate,
  })
  .refine((v) => !v.issuedAt || !v.expiresAt || v.expiresAt >= v.issuedAt, {
    message: 'validation.endBeforeStart',
    path: ['expiresAt'],
  })
export type DocumentMetaInput = z.infer<typeof documentMetaSchema>

/** Multipart form fields sent with the file. */
export const uploadDocumentSchema = z
  .object({
    ownerType: z.enum(DOCUMENT_OWNER_TYPE),
    ownerId: z.uuid(),
    title: z.string().trim().min(2).max(160),
    docType: z.enum(DOCUMENT_TYPE),
    issuedAt: optionalDate,
    expiresAt: optionalDate,
  })
  .refine((v) => !v.issuedAt || !v.expiresAt || v.expiresAt >= v.issuedAt, {
    message: 'validation.endBeforeStart',
    path: ['expiresAt'],
  })
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  ownerType: z.enum(DOCUMENT_OWNER_TYPE).optional(),
  ownerId: z.uuid().optional(),
  restaurantId: z.uuid().optional(),
  docType: z.enum(DOCUMENT_TYPE).optional(),
  /** expiring = within 30 days; expired = already past. */
  expiry: z.enum(['expiring', 'expired']).optional(),
  q: z.string().trim().max(200).optional(),
})
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>

export const DOCUMENT_EXPIRING_DAYS = 30

export interface DocumentDto {
  id: string
  title: string
  docType: DocumentType
  ownerType: DocumentOwnerType
  owner: { id: string; name: string }
  restaurant: Ref | null
  fileName: string
  mimeType: string
  sizeBytes: number
  issuedAt: string | null
  expiresAt: string | null
  expiry: 'none' | 'valid' | 'expiring' | 'expired'
  uploadedBy: PersonRef
  createdAt: string
  url: string
  downloadUrl: string
  can: { edit: boolean; delete: boolean }
}

export function documentExpiry(
  expiresAt: string | null,
  today = new Date(),
): DocumentDto['expiry'] {
  if (!expiresAt) return 'none'
  const todayKey = today.toISOString().slice(0, 10)
  if (expiresAt < todayKey) return 'expired'
  const soon = new Date(today.getTime() + DOCUMENT_EXPIRING_DAYS * 86_400_000)
  return expiresAt <= soon.toISOString().slice(0, 10) ? 'expiring' : 'valid'
}

// ---------------------------------------------------------------- reports

export const REPORT_KEYS = [
  'work-order-summary',
  'work-orders-completed',
  'overdue-work-orders',
  'repair-time',
  'technician-performance',
  'pm-compliance',
  'asset-downtime',
  'asset-cost',
  'requests-summary',
  'inspection-results',
  'failed-checks',
  'inventory-valuation',
  'low-stock',
  'parts-consumption',
  'vendor-spend',
  'unpaid-invoices',
  'maintenance-mix',
  'labour',
  'reliability',
  'repeat-failures',
  'failure-analysis',
  'cost-breakdown',
  'vendor-performance',
] as const
export type ReportKey = (typeof REPORT_KEYS)[number]

export const REPORT_GROUPS: Record<
  'work' | 'assets' | 'quality' | 'inventory' | 'purchasing',
  readonly ReportKey[]
> = {
  work: [
    'work-order-summary',
    'work-orders-completed',
    'overdue-work-orders',
    'repair-time',
    'technician-performance',
    'requests-summary',
    'maintenance-mix',
    'labour',
  ],
  assets: [
    'pm-compliance',
    'asset-downtime',
    'asset-cost',
    'reliability',
    'repeat-failures',
    'failure-analysis',
    'cost-breakdown',
  ],
  quality: ['inspection-results', 'failed-checks'],
  inventory: ['inventory-valuation', 'low-stock', 'parts-consumption'],
  purchasing: ['vendor-spend', 'unpaid-invoices', 'vendor-performance'],
}

/** Reports that describe "now" ignore the date range. */
export const SNAPSHOT_REPORTS: readonly ReportKey[] = [
  'overdue-work-orders',
  'inventory-valuation',
  'low-stock',
  'unpaid-invoices',
]

export const reportQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    restaurantId: z.uuid().optional(),
    // Work-order filters (reports in WORK_ORDER_FILTER_REPORTS).
    locationId: z.uuid().optional(),
    assetId: z.uuid().optional(),
    userId: z.uuid().optional(),
    teamId: z.uuid().optional(),
    vendorId: z.uuid().optional(),
    priority: z.enum(PRIORITY).optional(),
    status: z.enum(WORK_ORDER_STATUS).optional(),
    type: z.enum(WORK_ORDER_TYPE).optional(),
  })
  .refine((v) => v.from <= v.to, { message: 'validation.endBeforeStart', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86_400_000, {
    message: 'validation.rangeTooLong',
    path: ['from'],
  })
export type ReportQuery = z.infer<typeof reportQuerySchema>

export type ReportColumnType =
  'text' | 'number' | 'money' | 'percent' | 'hours' | 'date' | 'datetime'

export interface ReportColumn {
  key: string
  /** i18n key under reports.col.* */
  label: string
  type: ReportColumnType
}

export type ReportCell = string | number | null

export interface ReportResult {
  key: ReportKey
  columns: ReportColumn[]
  rows: Array<Record<string, ReportCell>>
  /** Headline numbers shown above the table. */
  summary: Array<{ label: string; value: number; type: ReportColumnType }>
  /** Rows were cut at this many (CSV has everything up to the same cap). */
  truncated: boolean
  generatedAt: string
}

// ---------------------------------------------------------------- audit log

export const listAuditQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPE).optional(),
  entityId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  restaurantId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>

export interface AuditLogDto {
  id: string
  action: string
  entityType: AuditEntityType
  entityId: string | null
  actor: PersonRef | null
  restaurant: Ref | null
  oldValue: unknown
  newValue: unknown
  metadata: unknown
  ip: string | null
  userAgent: string | null
  requestId: string | null
  createdAt: string
}

/**
 * Neutralises spreadsheet formulas in CSV cells (=, +, -, @, tab, CR), so an
 * exported value like "=HYPERLINK(…)" can't run when opened in Excel.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = typeof value === 'string' ? value : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 (Hindi/Gujarati names) correctly.
  return (
    '﻿' +
    [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') +
    '\r\n'
  )
}

/** Reports built from work orders: they accept the work-order filters. */
export const WORK_ORDER_FILTER_REPORTS: readonly ReportKey[] = [
  'work-order-summary',
  'work-orders-completed',
  'overdue-work-orders',
  'repair-time',
  'technician-performance',
  'maintenance-mix',
  'labour',
  'reliability',
  'repeat-failures',
  'vendor-performance',
]

export const REPORT_FILTER_KEYS = [
  'locationId',
  'assetId',
  'userId',
  'teamId',
  'vendorId',
  'priority',
  'status',
  'type',
] as const

/** Work done over time, for the analytics charts. */
export interface AnalyticsTrends {
  /** "day" for ranges up to 31 days, otherwise "week" (weeks start Monday). */
  bucket: 'day' | 'week'
  points: Array<{
    /** First day of the bucket (YYYY-MM-DD). */
    start: string
    created: number
    completed: number
    reactive: number
    preventive: number
    /** Average hours from creation to completion of the jobs completed in the bucket. */
    mttrHours: number | null
  }>
  totals: {
    created: number
    completed: number
    reactive: number
    preventive: number
    mttrHours: number | null
    mtbfHours: number | null
    pmCompliance: number | null
    cost: { parts: number; labour: number; vendor: number; other: number; total: number }
  }
}

// ---------------------------------------------------------------- storage

/** How long files are kept and when they are made smaller. */
export const storagePolicySchema = z.object({
  /** Photos older than this are re-saved at a smaller size. */
  compactPhotosAfterDays: z.number().int().min(30).max(3650),
  /** Videos older than this are removed (the job record and photos stay). */
  keepVideosDays: z.number().int().min(30).max(3650),
  /** Every file older than this is removed. Records (text) are always kept. */
  keepFilesYears: z.number().int().min(1).max(20),
})
export type StoragePolicy = z.infer<typeof storagePolicySchema>

export const DEFAULT_STORAGE_POLICY: StoragePolicy = {
  compactPhotosAfterDays: 180,
  keepVideosDays: 365,
  keepFilesYears: 5,
}

export interface StorageUsage {
  /** Bytes of files in storage, by kind. */
  files: { photos: number; videos: number; audio: number; documents: number; total: number }
  counts: { photos: number; videos: number; audio: number; documents: number }
  /** Size of the database itself. */
  databaseBytes: number
  /** Plan limits (Supabase free: 1 GB files, 500 MB database). */
  fileQuotaBytes: number
  databaseQuotaBytes: number
  /** Average bytes added per day over the last 30 days. */
  dailyGrowthBytes: number
  /** Days until the file quota is reached at the current pace (null = not growing). */
  daysUntilFull: number | null
  policy: StoragePolicy
  /** Where files are kept: "local" disk or "s3" (Supabase Storage). */
  driver: string
}

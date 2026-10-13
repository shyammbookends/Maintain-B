import { z } from 'zod'
import { ALL_PERMISSIONS, type Permission } from './permissions.js'

// ---------------------------------------------------------------- API keys

/** Prefix of every API key ("mx_live_…"); the rest is random. */
export const API_KEY_PREFIX = 'mx_live_'

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(60),
  /** Permissions the key may use; must be ones the creator has. */
  scopes: z
    .array(z.enum(ALL_PERMISSIONS as unknown as [Permission, ...Permission[]]))
    .min(1)
    .max(ALL_PERMISSIONS.length),
  /** Days until it stops working (every key expires: at most two years). */
  expiresInDays: z.number().int().min(1).max(730).default(365),
})
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>

export interface ApiKeyDto {
  id: string
  name: string
  prefix: string
  scopes: Permission[]
  createdBy: { id: string; firstName: string; lastName: string }
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

/** Returned once, at creation: the full key is never shown again. */
export interface CreatedApiKey extends ApiKeyDto {
  key: string
}

/** Sensible preset scopes offered in the form. */
export const API_KEY_PRESETS: Record<'readOnly' | 'workOrders', Permission[]> = {
  readOnly: [
    'work_orders:view',
    'requests:view',
    'assets:view',
    'parts:view',
    'inventory:view',
    'restaurants:view',
    'locations:view',
  ] as Permission[],
  workOrders: [
    'work_orders:view',
    'work_orders:create',
    'work_orders:edit',
    'requests:view',
    'requests:create',
    'assets:view',
  ] as Permission[],
}

// ---------------------------------------------------------------- webhooks

export const WEBHOOK_EVENTS = [
  'work_order.created',
  'work_order.completed',
  'work_order.overdue',
  'request.created',
  'inspection.failed',
  'stock.low',
  'meter.reading',
] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export const webhookSchema = z.object({
  url: z
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), 'validation.httpsRequired'),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1)
    .max(WEBHOOK_EVENTS.length * 2)
    .transform((list) => [...new Set(list)]),
  active: z.boolean().default(true),
})
export type WebhookInput = z.infer<typeof webhookSchema>

export interface WebhookDto {
  id: string
  url: string
  events: WebhookEvent[]
  active: boolean
  lastStatus: number | null
  lastError: string | null
  lastSentAt: string | null
  failureCount: number
  createdAt: string
  recent: Array<{ event: string; status: number | null; error: string | null; createdAt: string }>
}

export interface CreatedWebhook extends WebhookDto {
  /** Signing secret, shown once. */
  secret: string
}

/** Header carrying "sha256=<hex HMAC of the raw body>". */
export const WEBHOOK_SIGNATURE_HEADER = 'x-bookends-signature'

// ---------------------------------------------------------------- single sign-on

export const SSO_PROVIDERS = ['google', 'microsoft'] as const
export type SsoProvider = (typeof SSO_PROVIDERS)[number]

// ---------------------------------------------------------------- notifications setup

export interface DeliveryStatus {
  email: boolean
  push: boolean
  /** Public VAPID key the browser needs to subscribe (null when push is off). */
  vapidPublicKey: string | null
}

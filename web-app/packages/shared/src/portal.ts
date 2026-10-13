import { z } from 'zod'
import {
  PRIORITY,
  type Priority,
  type RequestStatus,
  type WorkOrderCategory,
  type WorkOrderStatus,
} from './enums.js'
import { looksLikePhone } from './phone.js'

/*
 * Public request portal: anyone with a restaurant's link or a location's QR
 * code reports a problem without an account, then checks its status with
 * their phone number. Turned on per organisation (workflow setting
 * `requestPortal`).
 */

export interface PortalInfo {
  organization: string
  restaurant: { name: string; city: string | null }
  /** Set when the link came from a location's QR code. */
  location: { id: string; name: string } | null
  locations: Array<{ id: string; name: string }>
}

const phone = z
  .string()
  .trim()
  .refine((v) => looksLikePhone(v), 'validation.phone')

/** Sent as multipart form fields (photos ride along as files). */
export const portalRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone,
  /** What kind of problem, in the guest's own words. */
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).default(''),
  locationId: z.uuid().or(z.literal('')).default(''),
  priority: z.enum(PRIORITY).default('MEDIUM'),
  /** Honeypot: real people never fill this hidden field. */
  website: z.string().max(0).optional(),
})
export type PortalRequestInput = z.infer<typeof portalRequestSchema>

export const portalStatusSchema = z.object({ phone })
export type PortalStatusInput = z.infer<typeof portalStatusSchema>

/** What a guest may see about their own report: no names, no internal notes. */
export interface PortalRequestStatus {
  code: string
  title: string
  category: WorkOrderCategory
  priority: Priority
  status: RequestStatus
  /** Progress of the job made from it, if any. */
  workOrderStatus: WorkOrderStatus | null
  createdAt: string
  updatedAt: string
}

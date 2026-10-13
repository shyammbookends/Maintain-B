import { z } from 'zod'

// ---------------------------------------------------------------- global search

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
})

export const SEARCH_KINDS = [
  'workOrder',
  'request',
  'asset',
  'part',
  'location',
  'vendor',
  'procedure',
] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

export interface SearchHit {
  kind: SearchKind
  id: string
  /** Main line, e.g. "WO-000123 · Fridge not cooling". */
  title: string
  /** Second line: restaurant, status, part number… */
  subtitle: string | null
  /** Where the hit opens in the admin app. */
  url: string
}

export interface SearchResults {
  q: string
  hits: SearchHit[]
}

// ---------------------------------------------------------------- saved views

export const SAVED_VIEW_RESOURCES = ['work_orders', 'requests', 'assets', 'parts'] as const
export type SavedViewResource = (typeof SAVED_VIEW_RESOURCES)[number]

export const savedViewQuerySchema = z.object({ resource: z.enum(SAVED_VIEW_RESOURCES) })

export const createSavedViewSchema = z.object({
  resource: z.enum(SAVED_VIEW_RESOURCES),
  name: z.string().trim().min(1).max(60),
  /** The list's query string without "?"; page numbers are dropped. */
  query: z.string().max(2000),
  /** Visible to everyone who can open the list. */
  shared: z.boolean().default(false),
})
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>

export interface SavedViewDto {
  id: string
  resource: SavedViewResource
  name: string
  query: string
  shared: boolean
  /** Created by the person looking (they may delete it). */
  mine: boolean
  owner: { id: string; firstName: string; lastName: string }
  createdAt: string
}

import { z } from 'zod'
import type { ConversationType } from './enums.js'

// ---------------------------------------------------------------- team chat

export const startConversationSchema = z
  .object({
    /** Other people in the chat (the creator is added automatically). */
    userIds: z.array(z.uuid()).min(1).max(50),
    /** Group name; required for groups (more than one other person). */
    name: z.string().trim().max(60).default(''),
  })
  .refine((v) => v.userIds.length === 1 || v.name.length >= 2, {
    path: ['name'],
    message: 'validation.required',
  })
export type StartConversationInput = z.infer<typeof startConversationSchema>

export const chatMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  /** Link a work order (its card shows in the chat). */
  workOrderId: z.uuid().or(z.literal('')).default(''),
})
export type ChatMessageInput = z.infer<typeof chatMessageSchema>

// ---------------------------------------------------------------- voice messages

/** A voice message is at most three minutes long. */
export const CHAT_VOICE_MAX_SECONDS = 180
/**
 * Upload limit for one voice message: three minutes of AAC at 128 kbps is
 * ~2.9 MB (Opus in the browser is far smaller); it also fits a Vercel request.
 */
export const CHAT_VOICE_MAX_MB = 4

/**
 * Form fields sent with POST /chats/:id/voice (multipart, the recording in
 * `files`). The duration is what the recorder measured.
 */
export const chatVoiceSchema = z.object({
  durationSec: z.coerce.number().int().min(1).max(CHAT_VOICE_MAX_SECONDS),
  /** Optional caption. */
  body: z.string().trim().max(2000).default(''),
})
export type ChatVoiceInput = z.infer<typeof chatVoiceSchema>

/** "0:12", "2:05". */
export function formatVoiceDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface ChatVoiceDto {
  /** Short-lived signed link (valid ~1 hour); '' once removed by retention. */
  url: string
  mimeType: string
  durationSec: number
  sizeBytes: number
  /** The file was removed by the storage retention policy. */
  removed: boolean
}

export const chatMessagesQuerySchema = z.object({
  /** Messages created before this message id (older page). */
  before: z.uuid().optional(),
  /** Messages created after this message id (polling for new ones). */
  after: z.uuid().optional(),
})

export const addMembersSchema = z.object({ userIds: z.array(z.uuid()).min(1).max(50) })

/**
 * GET /chats: "mine" (default) lists the chats I'm in; "all" (Super Admin and
 * Admin only) adds the chats I may oversee, flagged `viewOnly`.
 */
export const chatListQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
})
export type ChatListScope = z.infer<typeof chatListQuerySchema>['scope']

export interface ChatPerson {
  id: string
  firstName: string
  lastName: string
  role: string | null
}

export interface ConversationListItem {
  id: string
  type: ConversationType
  /** Group name, or the other person's name for a direct chat. */
  title: string
  members: ChatPerson[]
  lastMessage: {
    body: string
    authorName: string
    createdAt: string
    /** Seconds, when the last message is a voice message. */
    voiceSec: number | null
  } | null
  unread: number
  lastMessageAt: string
  /**
   * An admin overseeing a chat they are not in: they can read it but not
   * send, delete, mark read, add members or leave. Always 0 unread.
   */
  viewOnly: boolean
}

export interface ChatMessageDto {
  id: string
  body: string
  author: { id: string; firstName: string; lastName: string }
  workOrder: { id: string; code: string; title: string } | null
  /** Voice message (null for text, and once the message is deleted). */
  voice: ChatVoiceDto | null
  createdAt: string
  mine: boolean
  deleted: boolean
}

export interface ChatMessagesPage {
  messages: ChatMessageDto[]
  /** More older messages exist. */
  hasMore: boolean
}

// ---------------------------------------------------------------- dashboard layout

/** Admin dashboard blocks a person can show, hide and reorder. */
export const DASHBOARD_WIDGETS = [
  'today',
  'kpis',
  'secondary',
  'trend',
  'cost',
  'mix',
  'priority',
  'status',
  'workload',
  'lists',
  'restaurants',
  'activity',
] as const
export type DashboardWidget = (typeof DASHBOARD_WIDGETS)[number]

export const dashboardLayoutSchema = z.object({
  /** Shown widgets in order; anything missing is hidden. */
  widgets: z.array(z.enum(DASHBOARD_WIDGETS)).max(DASHBOARD_WIDGETS.length),
})
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = { widgets: [...DASHBOARD_WIDGETS] }

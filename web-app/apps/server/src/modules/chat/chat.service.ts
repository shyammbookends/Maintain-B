import { randomUUID } from 'node:crypto'
import {
  SYSTEM_ROLES,
  formatVoiceDuration,
  fullName,
  type ChatListScope,
  type ChatMessageDto,
  type ChatMessageInput,
  type ChatMessagesPage,
  type ChatPerson,
  type ChatVoiceDto,
  type ChatVoiceInput,
  type ConversationListItem,
  type StartConversationInput,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { removeStoredFiles, saveAttachments } from '../../core/attachments.js'
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../../core/errors.js'
import { notify } from '../../core/notify.js'
import { prisma } from '../../core/prisma.js'
import { storage } from '../../storage/index.js'
import type { AuthContext } from '../auth/auth.context.js'
import { visibilityWhere as visibleUsers } from '../users/users.service.js'
import { visibleWhere as visibleWorkOrders } from '../work-orders/work-orders.service.js'

/*
 * Team chat: one-to-one chats and named groups. People can chat with anyone
 * who works at one of their restaurants (and the Super Admins). The apps poll
 * for new messages; each person gets at most one unread notification per chat.
 *
 * Groups are created and managed (add / remove members) by Super Admins and
 * Admins only. Admins can also oversee chats they are not in, read-only: a
 * Super Admin every chat in the organization, an Admin every chat whose
 * members are all people they can see in the Users list.
 *
 * A message can carry one voice note: an AUDIO attachment owned by
 * CHAT_MESSAGE (stored like work-order voice notes, served by signed link,
 * removed with the message and by the storage retention jobs).
 */

const PAGE = 30
const SIGNED_URL_SECONDS = 3600

/** "🎤 Voice message (0:12)" for notifications (the apps translate their own previews). */
const voiceLabel = (sec: number) => `🎤 Voice message (${formatVoiceDuration(sec)})`

type VoiceRow = {
  ownerId: string
  storageKey: string
  mimeType: string
  fileName: string
  durationSec: number | null
  sizeBytes: number
  fileRemovedAt: Date | null
}

/** Voice notes of these messages by message id, each with a short-lived signed link. */
async function voiceNotes(messageIds: string[]): Promise<Map<string, ChatVoiceDto>> {
  const out = new Map<string, ChatVoiceDto>()
  if (!messageIds.length) return out
  const rows: VoiceRow[] = await prisma.attachment.findMany({
    where: { ownerType: 'CHAT_MESSAGE', ownerId: { in: messageIds }, kind: 'AUDIO' },
    select: {
      ownerId: true,
      storageKey: true,
      mimeType: true,
      fileName: true,
      durationSec: true,
      sizeBytes: true,
      fileRemovedAt: true,
    },
  })
  for (const r of rows)
    out.set(r.ownerId, {
      url: r.fileRemovedAt
        ? ''
        : await storage.getSignedUrl(r.storageKey, {
            expiresInSeconds: SIGNED_URL_SECONDS,
            mimeType: r.mimeType,
            fileName: r.fileName,
            disposition: 'inline',
          }),
      mimeType: r.mimeType,
      durationSec: r.durationSec ?? 0,
      sizeBytes: r.sizeBytes,
      removed: !!r.fileRemovedAt,
    })
  return out
}
const person = { select: { id: true, firstName: true, lastName: true } } as const

/** Super Admins and Admins: may run groups and oversee chats. */
export const isChatAdmin = (auth: AuthContext) =>
  auth.isSuperAdmin || auth.user.roleKind === 'ADMIN'

/** Chats an admin may read without being in them (see the header). Workers: none. */
function oversightWhere(auth: AuthContext): Prisma.ConversationWhereInput | null {
  if (!isChatAdmin(auth)) return null
  const org = { organizationId: auth.organizationId }
  if (auth.isSuperAdmin) return org
  return {
    ...org,
    AND: [
      { members: { some: { leftAt: null } } },
      // Every current member is someone this Admin can see (never a Super Admin).
      { members: { none: { leftAt: null, user: { NOT: visibleUsers(auth) } } } },
    ],
  }
}

/** Everyone this person may chat with (active, same restaurant, or a Super Admin). */
function reachableWhere(auth: AuthContext): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = {
    organizationId: auth.organizationId,
    status: 'ACTIVE',
    archivedAt: null,
    id: { not: auth.userId },
  }
  if (auth.isSuperAdmin) return base
  return {
    ...base,
    OR: [
      { userRestaurants: { some: { restaurantId: { in: [...auth.restaurantIds] } } } },
      { userRoles: { some: { role: { systemKey: SYSTEM_ROLES.SUPER_ADMIN } } } },
    ],
  }
}

export async function chatPeople(auth: AuthContext, q = ''): Promise<ChatPerson[]> {
  const term = q.trim()
  const rows = await prisma.user.findMany({
    where: {
      ...reachableWhere(auth),
      ...(term
        ? {
            AND: [
              {
                OR: [
                  { firstName: { contains: term, mode: 'insensitive' } },
                  { lastName: { contains: term, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    },
    select: {
      ...person.select,
      userRoles: { select: { role: { select: { name: true } } }, take: 1 },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 100,
  })
  return rows.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.userRoles[0]?.role.name ?? null,
  }))
}

async function canOversee(auth: AuthContext, conversationId: string): Promise<boolean> {
  const where = oversightWhere(auth)
  if (!where) return false
  return (await prisma.conversation.count({ where: { AND: [where, { id: conversationId }] } })) > 0
}

async function activeMember(auth: AuthContext, conversationId: string) {
  const m = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: auth.userId } },
    include: { conversation: { select: { organizationId: true, type: true, name: true } } },
  })
  return m && !m.leftAt && m.conversation.organizationId === auth.organizationId ? m : null
}

/**
 * The caller's current membership. Admins overseeing the chat get 403 (they
 * can read it but not act in it); everyone else 404.
 */
async function membership(auth: AuthContext, conversationId: string) {
  const m = await activeMember(auth, conversationId)
  if (m) return m
  if (await canOversee(auth, conversationId)) throw new ForbiddenError()
  throw new NotFoundError('Chat')
}

/**
 * Checked before a voice upload is read, so people who can't send here never
 * get the server to buffer a recording.
 */
export async function assertCanSend(auth: AuthContext, conversationId: string): Promise<void> {
  await membership(auth, conversationId)
}

/**
 * Voice notes a person may send per rolling day (bytes). Each recording is
 * capped at CHAT_VOICE_MAX_MB; this stops one account (or a stolen session)
 * filling the organization's file storage.
 */
export const CHAT_VOICE_DAILY_BYTES = 50 * 1024 * 1024

async function assertVoiceBudget(auth: AuthContext, bytes: number) {
  const used = await prisma.attachment.aggregate({
    where: {
      kind: 'AUDIO',
      ownerType: 'CHAT_MESSAGE',
      uploadedById: auth.userId,
      createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) },
    },
    _sum: { sizeBytes: true },
  })
  if ((used._sum.sizeBytes ?? 0) + bytes > CHAT_VOICE_DAILY_BYTES)
    throw new RateLimitedError(
      'You have sent a lot of voice messages today. Please type your message or try again later.',
    )
}

/** Members, and admins overseeing the chat, may read it. */
async function readAccess(auth: AuthContext, conversationId: string) {
  if (await activeMember(auth, conversationId)) return
  if (await canOversee(auth, conversationId)) return
  throw new NotFoundError('Chat')
}

export async function listConversations(
  auth: AuthContext,
  scope: ChatListScope = 'mine',
): Promise<ConversationListItem[]> {
  const mine: Prisma.ConversationWhereInput = {
    organizationId: auth.organizationId,
    members: { some: { userId: auth.userId, leftAt: null } },
  }
  let where = mine
  if (scope === 'all') {
    const oversee = oversightWhere(auth)
    if (!oversee) throw new ForbiddenError()
    where = { OR: [mine, oversee] }
  }
  const rows = await prisma.conversation.findMany({
    where,
    include: {
      members: {
        where: { leftAt: null },
        select: {
          userId: true,
          lastReadAt: true,
          user: {
            select: {
              ...person.select,
              userRoles: { select: { role: { select: { name: true } } }, take: 1 },
            },
          },
        },
      },
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { author: person },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: scope === 'all' ? 200 : 100,
  })
  const lastIds = rows.flatMap((c) => (c.messages[0] ? [c.messages[0].id] : []))
  const voiceOf = new Map(
    (
      await prisma.attachment.findMany({
        where: { ownerType: 'CHAT_MESSAGE', ownerId: { in: lastIds }, kind: 'AUDIO' },
        select: { ownerId: true, durationSec: true },
      })
    ).map((a) => [a.ownerId, a.durationSec ?? 0]),
  )
  const unread = await Promise.all(
    rows.map((c) => {
      const me = c.members.find((m) => m.userId === auth.userId)
      // Oversight never has unread counts.
      if (!me) return 0
      return prisma.chatMessage.count({
        where: {
          conversationId: c.id,
          deletedAt: null,
          authorId: { not: auth.userId },
          createdAt: { gt: me?.lastReadAt ?? new Date(0) },
        },
      })
    }),
  )
  return rows.map((c, i) => {
    const viewOnly = !c.members.some((m) => m.userId === auth.userId)
    const others = c.members.filter((m) => m.userId !== auth.userId)
    const last = c.messages[0]
    return {
      id: c.id,
      type: c.type,
      title:
        c.type === 'GROUP'
          ? (c.name ?? '')
          : viewOnly
            ? c.members.map((m) => fullName(m.user)).join(' & ') || '—'
            : others[0]
              ? fullName(others[0].user)
              : '—',
      members: c.members.map((m) => ({
        id: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        role: m.user.userRoles[0]?.role.name ?? null,
      })),
      lastMessage: last
        ? {
            body: last.body.slice(0, 140),
            authorName: fullName(last.author),
            createdAt: last.createdAt.toISOString(),
            voiceSec: voiceOf.get(last.id) ?? null,
          }
        : null,
      unread: unread[i]!,
      lastMessageAt: c.lastMessageAt.toISOString(),
      viewOnly,
    }
  })
}

export async function unreadTotal(auth: AuthContext): Promise<number> {
  const mine = await prisma.conversationMember.findMany({
    where: {
      userId: auth.userId,
      leftAt: null,
      conversation: { organizationId: auth.organizationId },
    },
    select: { conversationId: true, lastReadAt: true },
  })
  if (mine.length === 0) return 0
  return prisma.chatMessage.count({
    where: {
      deletedAt: null,
      authorId: { not: auth.userId },
      OR: mine.map((m) => ({ conversationId: m.conversationId, createdAt: { gt: m.lastReadAt } })),
    },
  })
}

async function assertReachable(auth: AuthContext, userIds: string[]) {
  const found = await prisma.user.count({ where: { ...reachableWhere(auth), id: { in: userIds } } })
  if (found !== userIds.length) throw new ValidationError({ userIds: ['validation.invalidValue'] })
}

/** Opens (or reuses) a one-to-one chat, or creates a group. Returns its id. */
export async function startConversation(
  auth: AuthContext,
  input: StartConversationInput,
): Promise<{ id: string }> {
  const others = [...new Set(input.userIds)].filter((id) => id !== auth.userId)
  if (others.length === 0) throw new ValidationError({ userIds: ['validation.required'] })
  // Only Super Admins and Admins start groups; everyone can start a direct chat.
  if ((others.length > 1 || input.name) && !isChatAdmin(auth)) throw new ForbiddenError()
  await assertReachable(auth, others)
  if (others.length === 1 && !input.name) {
    const directKey = [auth.userId, others[0]!].sort().join(':')
    const existing = await prisma.conversation.findUnique({ where: { directKey } })
    if (existing) {
      // Re-open it for both if either had left.
      await prisma.conversationMember.updateMany({
        where: { conversationId: existing.id },
        data: { leftAt: null },
      })
      return { id: existing.id }
    }
    const c = await prisma.conversation.create({
      data: {
        organizationId: auth.organizationId,
        type: 'DIRECT',
        directKey,
        createdById: auth.userId,
        members: { create: [{ userId: auth.userId }, { userId: others[0]! }] },
      },
    })
    return { id: c.id }
  }
  if (input.name.length < 2) throw new ValidationError({ name: ['validation.required'] })
  const c = await prisma.conversation.create({
    data: {
      organizationId: auth.organizationId,
      type: 'GROUP',
      name: input.name,
      createdById: auth.userId,
      members: { create: [auth.userId, ...others].map((userId) => ({ userId })) },
    },
  })
  return { id: c.id }
}

function toMessage(
  auth: AuthContext,
  m: Prisma.ChatMessageGetPayload<{ include: { author: typeof person } }>,
  workOrders: Map<string, { id: string; code: string; title: string }>,
  voices: Map<string, ChatVoiceDto> = new Map(),
): ChatMessageDto {
  return {
    id: m.id,
    body: m.deletedAt ? '' : m.body,
    author: m.author,
    workOrder: m.workOrderId && !m.deletedAt ? (workOrders.get(m.workOrderId) ?? null) : null,
    voice: m.deletedAt ? null : (voices.get(m.id) ?? null),
    createdAt: m.createdAt.toISOString(),
    mine: m.authorId === auth.userId,
    deleted: !!m.deletedAt,
  }
}

async function workOrderCards(auth: AuthContext, ids: string[]) {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  // Each reader only gets cards for work they can see themselves.
  const rows = await prisma.workOrder.findMany({
    where: { AND: [await visibleWorkOrders(auth), { id: { in: unique } }] },
    select: { id: true, code: true, title: true },
  })
  return new Map(rows.map((w) => [w.id, w]))
}

export async function listMessages(
  auth: AuthContext,
  conversationId: string,
  q: { before?: string; after?: string },
): Promise<ChatMessagesPage> {
  await readAccess(auth, conversationId)
  const cursorId = q.before ?? q.after
  const cursor = cursorId
    ? await prisma.chatMessage.findFirst({
        where: { id: cursorId, conversationId },
        select: { createdAt: true },
      })
    : null
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      ...(cursor
        ? { createdAt: q.before ? { lt: cursor.createdAt } : { gt: cursor.createdAt } }
        : {}),
    },
    include: { author: person },
    orderBy: { createdAt: q.after ? 'asc' : 'desc' },
    take: PAGE + 1,
  })
  const hasMore = rows.length > PAGE
  const page = rows.slice(0, PAGE)
  const ordered = q.after ? page : page.reverse()
  const cards = await workOrderCards(
    auth,
    ordered.map((m) => m.workOrderId).filter((x): x is string => !!x),
  )
  const voices = await voiceNotes(ordered.filter((m) => !m.deletedAt).map((m) => m.id))
  return {
    messages: ordered.map((m) => toMessage(auth, m, cards, voices)),
    hasMore: q.after ? false : hasMore,
  }
}

export async function sendMessage(
  auth: AuthContext,
  conversationId: string,
  input: ChatMessageInput,
): Promise<ChatMessageDto> {
  return createMessage(auth, conversationId, input, null)
}

/**
 * A voice message: one recording (checked by its content, audio only), with
 * an optional caption. Members only; overseeing admins can play it but not send.
 */
export async function sendVoiceMessage(
  auth: AuthContext,
  conversationId: string,
  input: ChatVoiceInput,
  files: Express.Multer.File[] | undefined,
): Promise<ChatMessageDto> {
  if (!files || files.length !== 1) throw new ValidationError({ files: ['validation.required'] })
  return createMessage(
    auth,
    conversationId,
    { body: input.body, workOrderId: '' },
    { file: files[0]!, durationSec: input.durationSec },
  )
}

async function createMessage(
  auth: AuthContext,
  conversationId: string,
  input: ChatMessageInput,
  voice: { file: Express.Multer.File; durationSec: number } | null,
): Promise<ChatMessageDto> {
  const m = await membership(auth, conversationId)
  let workOrderId: string | null = null
  if (input.workOrderId) {
    const wo = await prisma.workOrder.findFirst({
      where: { AND: [await visibleWorkOrders(auth), { id: input.workOrderId }] },
      select: { id: true },
    })
    if (!wo) throw new ValidationError({ workOrderId: ['validation.invalidValue'] })
    workOrderId = wo.id
  }
  const messageId = randomUUID()
  // The recording is checked and stored first, outside the transaction, so a
  // slow upload to remote storage never holds a database connection; if the
  // message then can't be saved, the recording is removed again.
  let voiceIds: string[] = []
  if (voice) {
    await assertVoiceBudget(auth, voice.file.size)
    voiceIds = await saveAttachments(
      [voice.file],
      { type: 'CHAT_MESSAGE', id: messageId },
      auth.userId,
      prisma,
      { audioOnly: true, durationSec: voice.durationSec },
    )
  }
  const now = new Date()
  let msg: Prisma.ChatMessageGetPayload<{ include: { author: typeof person } }>
  try {
    msg = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          id: messageId,
          conversationId,
          authorId: auth.userId,
          body: input.body,
          workOrderId,
          createdAt: now,
        },
        include: { author: person },
      })
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } })
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId: auth.userId } },
        data: { lastReadAt: now },
      })
      return created
    })
  } catch (err) {
    if (voiceIds.length) await removeVoiceFiles({ id: { in: voiceIds } })
    throw err
  }

  // One unread notification per chat per person: skip people who already have one.
  const others = await prisma.conversationMember.findMany({
    where: { conversationId, leftAt: null, userId: { not: auth.userId } },
    select: { userId: true },
  })
  const pending = await prisma.notification.findMany({
    where: {
      recipientId: { in: others.map((o) => o.userId) },
      entityType: 'CONVERSATION',
      entityId: conversationId,
      readAt: null,
    },
    select: { recipientId: true },
  })
  const skip = new Set(pending.map((p) => p.recipientId))
  const author = fullName(auth.user)
  await notify(
    others.map((o) => o.userId).filter((id) => !skip.has(id)),
    {
      organizationId: auth.organizationId,
      type: 'CHAT_MESSAGE',
      title: m.conversation.type === 'GROUP' ? `${m.conversation.name} · ${author}` : author,
      body: voice
        ? [voiceLabel(voice.durationSec), input.body].filter(Boolean).join(' · ').slice(0, 200)
        : input.body.slice(0, 200),
      entityType: 'CONVERSATION',
      entityId: conversationId,
      actionUrl: `/chat/${conversationId}`,
    },
  )
  const cards = await workOrderCards(auth, workOrderId ? [workOrderId] : [])
  return toMessage(auth, msg, cards, voice ? await voiceNotes([msg.id]) : undefined)
}

/** Marks the chat read (and its notification). */
export async function markRead(auth: AuthContext, conversationId: string) {
  await membership(auth, conversationId)
  const now = new Date()
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: auth.userId } },
    data: { lastReadAt: now },
  })
  await prisma.notification.updateMany({
    where: {
      recipientId: auth.userId,
      entityType: 'CONVERSATION',
      entityId: conversationId,
      readAt: null,
    },
    data: { readAt: now },
  })
}

/** Super Admins and Admins in the group add people they can reach (same rule as starting a chat). */
export async function addMembers(auth: AuthContext, conversationId: string, userIds: string[]) {
  const m = await membership(auth, conversationId)
  if (m.conversation.type !== 'GROUP' || !isChatAdmin(auth)) throw new ForbiddenError()
  const ids = [...new Set(userIds)].filter((id) => id !== auth.userId)
  if (ids.length === 0) return
  await assertReachable(auth, ids)
  for (const userId of ids)
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId },
      update: { leftAt: null },
    })
}

/**
 * Super Admins and Admins in the group remove someone else (to remove
 * yourself, leave). Admins can't remove a Super Admin.
 */
export async function removeMember(auth: AuthContext, conversationId: string, userId: string) {
  const m = await membership(auth, conversationId)
  if (m.conversation.type !== 'GROUP' || !isChatAdmin(auth)) throw new ForbiddenError()
  if (userId === auth.userId) throw new ValidationError({ userId: ['validation.invalidValue'] })
  const target = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: {
      leftAt: true,
      user: { select: { userRoles: { select: { role: { select: { systemKey: true } } } } } },
    },
  })
  if (!target || target.leftAt) throw new NotFoundError('Member')
  const targetIsSuperAdmin = target.user.userRoles.some(
    (r) => r.role.systemKey === SYSTEM_ROLES.SUPER_ADMIN,
  )
  if (targetIsSuperAdmin && !auth.isSuperAdmin) throw new ForbiddenError()
  // An Admin only removes people they can see (the same people they can add):
  // not someone from a restaurant they don't run whom a Super Admin added.
  if (
    !auth.isSuperAdmin &&
    !(await prisma.user.count({ where: { AND: [visibleUsers(auth), { id: userId }] } }))
  )
    throw new ForbiddenError()
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { leftAt: new Date() },
  })
}

export async function leaveConversation(auth: AuthContext, conversationId: string) {
  const m = await membership(auth, conversationId)
  if (m.conversation.type !== 'GROUP') throw new ForbiddenError()
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: auth.userId } },
    data: { leftAt: new Date() },
  })
}

/** Authors can remove their own message ("message deleted" stays in place). */
export async function deleteMessage(auth: AuthContext, conversationId: string, messageId: string) {
  await membership(auth, conversationId)
  const done = await prisma.chatMessage.updateMany({
    where: { id: messageId, conversationId, authorId: auth.userId, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  if (!done.count) throw new NotFoundError('Message')
  // Its voice note goes with it (file and record).
  await removeVoiceFiles({ ownerId: messageId })
}

/** Deletes chat voice notes (files and records) matching `where`. */
async function removeVoiceFiles(where: Prisma.AttachmentWhereInput) {
  const files = await prisma.attachment.findMany({
    where: { AND: [where, { ownerType: 'CHAT_MESSAGE' }] },
    select: { id: true, storageKey: true, thumbKey: true },
  })
  if (!files.length) return
  await removeStoredFiles(
    files.flatMap((f) => (f.thumbKey ? [f.storageKey, f.thumbKey] : [f.storageKey])),
  )
  await prisma.attachment.deleteMany({ where: { id: { in: files.map((f) => f.id) } } })
}

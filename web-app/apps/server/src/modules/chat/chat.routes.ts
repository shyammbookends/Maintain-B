import {
  DEFAULT_DASHBOARD_LAYOUT,
  CHAT_VOICE_MAX_MB,
  addMembersSchema,
  chatListQuerySchema,
  chatMessageSchema,
  chatMessagesQuerySchema,
  chatVoiceSchema,
  dashboardLayoutSchema,
  idParamSchema,
  startConversationSchema,
  type DeliveryStatus,
} from '@maintainx/shared'
import { ipKeyGenerator } from 'express-rate-limit'
import { Router, type Request, type RequestHandler } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { uploadParser } from '../../core/attachments.js'
import { emailEnabled, pushEnabled } from '../../core/delivery.js'
import { sendCreated, sendData, sendNoContent } from '../../core/http.js'
import { notify } from '../../core/notify.js'
import { prisma } from '../../core/prisma.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { createRateLimiter, createSharedRateLimiter } from '../../middleware/security.js'
import * as chat from './chat.service.js'

/** Team chat, the personal dashboard layout and a "send me a test" notification. */
export const chatRouter = Router()
chatRouter.use(
  ['/chats', '/me/dashboard-layout', '/notifications/delivery', '/notifications/test'],
  ...requireAuth({ sessionOnly: true }),
)

const messageParams = z.object({ id: z.uuid(), messageId: z.uuid() })
const memberParams = z.object({ id: z.uuid(), userId: z.uuid() })
const peopleQuery = z.object({ q: z.string().max(60).optional() })
/**
 * Per person (not per IP: a restaurant's staff share one Wi-Fi), counted
 * across server instances.
 */
const perUser = (req: Request) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? '')
/** Chat sends are cheap but capped against runaway clients. */
const sendLimiter = createSharedRateLimiter('chat-send', {
  windowMs: 60_000,
  limit: 60,
  keyGenerator: perUser,
})
/** Voice messages also count against a smaller budget (each is an upload). */
const voiceLimiter = createSharedRateLimiter('chat-voice', {
  windowMs: 60_000,
  limit: 20,
  keyGenerator: perUser,
})
/**
 * One recording, within the voice limit and the server's upload limit; the
 * caption field is small (2000 characters at most).
 */
const parseVoice = uploadParser(
  1,
  Math.min(CHAT_VOICE_MAX_MB, env.MAX_UPLOAD_MB) * 1024 * 1024,
  16 * 1024,
)
/** Members only, checked before the recording is read into memory. */
const canSend: RequestHandler = async (req, _res, next) => {
  await chat.assertCanSend(getAuth(req), parseParams(idParamSchema, req).id)
  next()
}

chatRouter.get('/chats', async (req, res) => {
  const { scope } = parseQuery(chatListQuerySchema, req)
  sendData(res, await chat.listConversations(getAuth(req), scope))
})
chatRouter.get('/chats/unread', async (req, res) => {
  sendData(res, { count: await chat.unreadTotal(getAuth(req)) })
})
chatRouter.get('/chats/people', async (req, res) => {
  sendData(res, await chat.chatPeople(getAuth(req), parseQuery(peopleQuery, req).q))
})
chatRouter.post('/chats', async (req, res) => {
  sendCreated(
    res,
    await chat.startConversation(getAuth(req), parseBody(startConversationSchema, req)),
  )
})
chatRouter.get('/chats/:id/messages', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await chat.listMessages(getAuth(req), id, parseQuery(chatMessagesQuerySchema, req)))
})
chatRouter.post('/chats/:id/messages', sendLimiter, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendCreated(res, await chat.sendMessage(getAuth(req), id, parseBody(chatMessageSchema, req)))
})
/** Voice message: multipart with the recording in `files`, plus `durationSec` and an optional `body`. */
chatRouter.post(
  '/chats/:id/voice',
  sendLimiter,
  voiceLimiter,
  canSend,
  parseVoice,
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendCreated(
      res,
      await chat.sendVoiceMessage(
        getAuth(req),
        id,
        parseBody(chatVoiceSchema, req),
        req.files as Express.Multer.File[] | undefined,
      ),
    )
  },
)
chatRouter.delete('/chats/:id/messages/:messageId', async (req, res) => {
  const { id, messageId } = parseParams(messageParams, req)
  await chat.deleteMessage(getAuth(req), id, messageId)
  sendNoContent(res)
})
chatRouter.post('/chats/:id/read', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await chat.markRead(getAuth(req), id)
  sendNoContent(res)
})
chatRouter.post('/chats/:id/members', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await chat.addMembers(getAuth(req), id, parseBody(addMembersSchema, req).userIds)
  sendNoContent(res)
})
chatRouter.delete('/chats/:id/members/:userId', async (req, res) => {
  const { id, userId } = parseParams(memberParams, req)
  await chat.removeMember(getAuth(req), id, userId)
  sendNoContent(res)
})
chatRouter.post('/chats/:id/leave', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await chat.leaveConversation(getAuth(req), id)
  sendNoContent(res)
})

// ---------------------------------------------------------------- personal dashboard

chatRouter.get('/me/dashboard-layout', async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: getAuth(req).userId },
    select: { dashboardLayout: true },
  })
  const parsed = dashboardLayoutSchema.safeParse(u.dashboardLayout)
  sendData(res, parsed.success ? parsed.data : DEFAULT_DASHBOARD_LAYOUT)
})
chatRouter.put('/me/dashboard-layout', async (req, res) => {
  const layout = parseBody(dashboardLayoutSchema, req)
  const widgets = [...new Set(layout.widgets)]
  await prisma.user.update({
    where: { id: getAuth(req).userId },
    data: { dashboardLayout: { widgets } },
  })
  sendData(res, { widgets })
})

// ---------------------------------------------------------------- notification delivery

chatRouter.get('/notifications/delivery', (_req, res) => {
  const status: DeliveryStatus = {
    email: emailEnabled(),
    push: pushEnabled(),
    vapidPublicKey: pushEnabled() ? (env.VAPID_PUBLIC_KEY ?? null) : null,
  }
  sendData(res, status)
})

const testLimiter = createRateLimiter({ windowMs: 10 * 60_000, limit: 5 })
/** Sends the caller a test notification (in-app, plus email / push if set up). */
chatRouter.post('/notifications/test', testLimiter, async (req, res) => {
  const auth = getAuth(req)
  await notify([auth.userId], {
    organizationId: auth.organizationId,
    type: 'AUTOMATION',
    title: 'Test notification',
    body: 'Notifications are working on this device.',
    entityType: 'USER',
    entityId: auth.userId,
    actionUrl: '/notifications',
  })
  sendNoContent(res)
})

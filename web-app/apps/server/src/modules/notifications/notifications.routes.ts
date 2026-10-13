import {
  idParamSchema,
  listNotificationsQuerySchema,
  notificationPreferencesSchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './notifications.service.js'

/* Personal inbox: every signed-in user has one, so no permission check beyond sign-in. */
export const notificationsRouter = Router()
notificationsRouter.use('/notifications', ...requireAuth({ sessionOnly: true }))

notificationsRouter.get('/notifications', async (req, res) => {
  res.json(
    await service.listNotifications(getAuth(req), parseQuery(listNotificationsQuerySchema, req)),
  )
})

notificationsRouter.get('/notifications/unread-count', async (req, res) => {
  sendData(res, { count: await service.unreadCount(getAuth(req)) })
})

notificationsRouter.post('/notifications/read-all', async (req, res) => {
  sendData(res, await service.markAllRead(getAuth(req)))
})

notificationsRouter.get('/notifications/preferences', async (req, res) => {
  sendData(res, await service.getPreferences(getAuth(req)))
})

notificationsRouter.put('/notifications/preferences', async (req, res) => {
  sendData(
    res,
    await service.setPreferences(getAuth(req), parseBody(notificationPreferencesSchema, req)),
  )
})

notificationsRouter.post('/notifications/push', async (req, res) => {
  await service.subscribePush(
    getAuth(req),
    parseBody(pushSubscriptionSchema, req),
    req.get('user-agent'),
  )
  res.status(204).end()
})

notificationsRouter.delete('/notifications/push', async (req, res) => {
  await service.unsubscribePush(getAuth(req), parseBody(pushUnsubscribeSchema, req).endpoint)
  res.status(204).end()
})

notificationsRouter.post('/notifications/:id/read', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.markRead(getAuth(req), id))
})

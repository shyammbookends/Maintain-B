import { Router } from 'express'
import { z } from 'zod'
import { sendData } from '../../core/http.js'
import { parseParams } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as devices from './devices.service.js'

/* Phone app (Android) notification devices; see devices.service.ts. */
export const devicesRouter = Router()

devicesRouter.post('/push-devices', ...requireAuth({ sessionOnly: true }), async (req, res) => {
  sendData(res, await devices.registerDevice(getAuth(req), req.get('user-agent')), 201)
})

devicesRouter.delete('/push-devices/:deviceId', ...requireAuth({ sessionOnly: true }), async (req, res) => {
  const { deviceId } = parseParams(z.object({ deviceId: z.uuid() }), req)
  await devices.removeDevice(getAuth(req), deviceId)
  res.status(204).end()
})

/** Polled by the app's background service with its device key (no sign-in token). */
devicesRouter.get('/push-feed', async (req, res) => {
  const after = typeof req.query.after === 'string' ? req.query.after : undefined
  // ?wait=25 holds the request until something changes (max 25 s); ?unread=N is the count the phone shows.
  const wait = Math.min(25, Math.max(0, Number(req.query.wait) || 0))
  const known = req.query.unread === undefined ? undefined : Number(req.query.unread)
  const abort = new AbortController()
  // The phone went away (closed the app / lost signal): stop waiting.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  res.setHeader('Cache-Control', 'no-store')
  const data = await devices.deviceFeed(req.get('x-device-key'), after, {
    waitMs: wait * 1000,
    knownUnread: Number.isFinite(known) ? known : undefined,
    signal: abort.signal,
  })
  if (!res.headersSent && !abort.signal.aborted) sendData(res, data)
})

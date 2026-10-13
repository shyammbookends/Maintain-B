import { portalRequestSchema, portalStatusSchema } from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { MAX_GUEST_PHOTOS, parseGuestUploads } from '../../core/attachments.js'
import { ValidationError } from '../../core/errors.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams } from '../../core/validate.js'
import { createSharedRateLimiter } from '../../middleware/security.js'
import * as service from './portal.service.js'

/** Public, no login: tight per-IP limits keep the portal from being abused. */
const readLimiter = createSharedRateLimiter('portal-read', { windowMs: 60_000, limit: 30 })
const submitLimiter = createSharedRateLimiter('portal-submit', { windowMs: 10 * 60_000, limit: 5 })
const statusLimiter = createSharedRateLimiter('portal-status', { windowMs: 10 * 60_000, limit: 20 })

const tokenParam = z.object({ token: z.string().min(1).max(64) })

export const portalRouter = Router()

portalRouter.get('/public/portal/:token', readLimiter, async (req, res) => {
  const { token } = parseParams(tokenParam, req)
  sendData(res, await service.portalInfo(token))
})

portalRouter.post(
  '/public/portal/:token/requests',
  submitLimiter,
  parseGuestUploads,
  async (req, res) => {
    const { token } = parseParams(tokenParam, req)
    const input = parseBody(portalRequestSchema, req)
    const files = req.files as Express.Multer.File[] | undefined
    if ((files?.length ?? 0) > MAX_GUEST_PHOTOS)
      throw new ValidationError({ files: ['validation.tooManyFiles'] })
    sendCreated(res, await service.submitPortalRequest(token, input, files, req))
  },
)

portalRouter.post('/public/portal/:token/status', statusLimiter, async (req, res) => {
  const { token } = parseParams(tokenParam, req)
  const { phone } = parseBody(portalStatusSchema, req)
  sendData(res, await service.portalStatus(token, phone))
})

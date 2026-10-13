import {
  approveRequestSchema,
  createRequestSchema,
  idParamSchema,
  listRequestsQuerySchema,
  rejectRequestSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { parseUploads } from '../../core/attachments.js'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { createRateLimiter } from '../../middleware/security.js'
import * as service from './requests.service.js'

/** Uploads are heavier than normal requests: a separate, tighter limit. */
const uploadLimiter = createRateLimiter({ windowMs: 60_000, limit: 30 })

export const requestsRouter = Router()
requestsRouter.use('/requests', ...requireAuth())

requestsRouter.get('/requests', requirePermission('requests:view'), async (req, res) => {
  res.json(await service.listRequests(getAuth(req), parseQuery(listRequestsQuerySchema, req)))
})

requestsRouter.get('/requests/:id', requirePermission('requests:view'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getRequest(getAuth(req), id))
})

requestsRouter.post('/requests', requirePermission('requests:create'), async (req, res) => {
  sendCreated(
    res,
    await service.createRequest(getAuth(req), parseBody(createRequestSchema, req), req),
  )
})

requestsRouter.post(
  '/requests/:id/attachments',
  uploadLimiter,
  requirePermission('requests:create'),
  parseUploads,
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.addRequestPhotos(getAuth(req), id, req.files as Express.Multer.File[], req),
    )
  },
)

requestsRouter.post(
  '/requests/:id/reject',
  requirePermission('requests:approve'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.rejectRequest(getAuth(req), id, parseBody(rejectRequestSchema, req), req),
    )
  },
)

requestsRouter.post(
  '/requests/:id/approve',
  requirePermission('requests:approve'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.approveRequest(getAuth(req), id, parseBody(approveRequestSchema, req), req),
    )
  },
)

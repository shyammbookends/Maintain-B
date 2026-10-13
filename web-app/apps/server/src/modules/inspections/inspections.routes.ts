import {
  idParamSchema,
  listInspectionsQuerySchema,
  startInspectionSchema,
  stepAnswerSchema,
  submitInspectionSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { parseUploads } from '../../core/attachments.js'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { createRateLimiter } from '../../middleware/security.js'
import * as service from './inspections.service.js'

export const inspectionsRouter = Router()
inspectionsRouter.use('/inspections', ...requireAuth())

const view = requirePermission('inspections:view')
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() })

inspectionsRouter.get('/inspections', view, async (req, res) => {
  res.json(await service.listInspections(getAuth(req), parseQuery(listInspectionsQuerySchema, req)))
})

inspectionsRouter.get('/inspections/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getInspection(getAuth(req), id))
})

inspectionsRouter.post(
  '/inspections',
  requirePermission('inspections:create'),
  async (req, res) => {
    sendCreated(
      res,
      await service.startInspection(getAuth(req), parseBody(startInspectionSchema, req), req),
    )
  },
)

inspectionsRouter.put(
  '/inspections/:id/items/:itemId',
  requirePermission('inspections:edit'),
  async (req, res) => {
    const { id, itemId } = parseParams(itemParams, req)
    sendData(
      res,
      await service.answerInspectionItem(
        getAuth(req),
        id,
        itemId,
        parseBody(stepAnswerSchema, req),
      ),
    )
  },
)

inspectionsRouter.post(
  '/inspections/:id/submit',
  requirePermission('inspections:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.submitInspection(getAuth(req), id, parseBody(submitInspectionSchema, req), req),
    )
  },
)

inspectionsRouter.delete('/inspections/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await service.discardInspection(getAuth(req), id, req)
  res.status(204).end()
})

/** A photo or signature for one inspection step. */
inspectionsRouter.post(
  '/inspections/:id/items/:itemId/attachments',
  createRateLimiter({ windowMs: 60_000, limit: 30 }),
  requirePermission('inspections:edit'),
  parseUploads,
  async (req, res) => {
    const { id, itemId } = parseParams(itemParams, req)
    sendData(
      res,
      await service.uploadInspectionStepAttachment(
        getAuth(req),
        id,
        itemId,
        req.files as Express.Multer.File[],
        req,
      ),
    )
  },
)

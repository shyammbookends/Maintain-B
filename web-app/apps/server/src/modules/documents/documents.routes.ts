import {
  documentMetaSchema,
  idParamSchema,
  listDocumentsQuerySchema,
  uploadDocumentSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { createRateLimiter } from '../../middleware/security.js'
import * as service from './documents.service.js'

const uploadLimiter = createRateLimiter({ windowMs: 60_000, limit: 30 })

export const documentsRouter = Router()
documentsRouter.use('/documents', ...requireAuth())

documentsRouter.get('/documents', requirePermission('documents:view'), async (req, res) => {
  res.json(await service.listDocuments(getAuth(req), parseQuery(listDocumentsQuerySchema, req)))
})

documentsRouter.post(
  '/documents',
  uploadLimiter,
  requirePermission('documents:create'),
  service.parseDocumentUpload,
  async (req, res) => {
    sendCreated(
      res,
      await service.uploadDocument(
        getAuth(req),
        parseBody(uploadDocumentSchema, req),
        req.file,
        req,
      ),
    )
  },
)

documentsRouter.put('/documents/:id', requirePermission('documents:view'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.updateDocument(getAuth(req), id, parseBody(documentMetaSchema, req), req),
  )
})

documentsRouter.delete('/documents/:id', requirePermission('documents:view'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await service.archiveDocument(getAuth(req), id, req)
  res.status(204).end()
})

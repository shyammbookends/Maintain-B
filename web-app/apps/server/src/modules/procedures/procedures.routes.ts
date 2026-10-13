import {
  SUPPORTED_LOCALES,
  idParamSchema,
  inspectionTemplateSchema,
  procedureSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './procedures.service.js'

export const proceduresRouter = Router()
proceduresRouter.use(['/procedures', '/inspection-templates'], ...requireAuth())

const listQuery = z.object({
  restaurantId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
})

proceduresRouter.get('/procedures', requirePermission('procedures:view'), async (req, res) => {
  sendData(res, await service.listProcedures(getAuth(req), parseQuery(listQuery, req)))
})

proceduresRouter.get('/procedures/:id', requirePermission('procedures:view'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getProcedure(getAuth(req), id))
})

proceduresRouter.post('/procedures', requirePermission('procedures:create'), async (req, res) => {
  sendCreated(
    res,
    await service.createProcedure(getAuth(req), parseBody(procedureSchema, req), req),
  )
})

const libraryParams = z.object({ key: z.string().regex(/^[a-z0-9-]{2,40}$/) })
const libraryBody = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
  /** '' = every restaurant. */
  restaurantId: z.uuid().or(z.literal('')),
})

proceduresRouter.post(
  '/procedures/library/:key',
  requirePermission('procedures:create'),
  async (req, res) => {
    const { key } = parseParams(libraryParams, req)
    sendCreated(
      res,
      await service.importLibraryProcedure(getAuth(req), key, parseBody(libraryBody, req), req),
    )
  },
)

proceduresRouter.put('/procedures/:id', requirePermission('procedures:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.updateProcedure(getAuth(req), id, parseBody(procedureSchema, req), req),
  )
})

proceduresRouter.delete(
  '/procedures/:id',
  requirePermission('procedures:delete'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    await service.archiveProcedure(getAuth(req), id, req)
    res.status(204).end()
  },
)

const templateQuery = z.object({
  restaurantId: z.uuid().optional(),
  active: z.enum(['true']).optional(),
})

proceduresRouter.get(
  '/inspection-templates',
  requirePermission('inspections:view'),
  async (req, res) => {
    const q = parseQuery(templateQuery, req)
    sendData(
      res,
      await service.listTemplates(getAuth(req), {
        restaurantId: q.restaurantId,
        activeOnly: q.active === 'true',
      }),
    )
  },
)

proceduresRouter.post(
  '/inspection-templates',
  requirePermission('procedures:create'),
  async (req, res) => {
    sendCreated(
      res,
      await service.createTemplate(getAuth(req), parseBody(inspectionTemplateSchema, req), req),
    )
  },
)

proceduresRouter.put(
  '/inspection-templates/:id',
  requirePermission('procedures:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.updateTemplate(getAuth(req), id, parseBody(inspectionTemplateSchema, req), req),
    )
  },
)

proceduresRouter.delete(
  '/inspection-templates/:id',
  requirePermission('procedures:delete'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    await service.archiveTemplate(getAuth(req), id, req)
    res.status(204).end()
  },
)

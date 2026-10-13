import {
  idParamSchema,
  listPartsQuerySchema,
  partSchema,
  stockAdjustmentSchema,
  stockSettingsSchema,
  stockTransferSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './inventory.service.js'

export const inventoryRouter = Router()
inventoryRouter.use('/parts', ...requireAuth())

const view = requirePermission('parts:view')

inventoryRouter.get('/parts', view, async (req, res) => {
  res.json(await service.listParts(getAuth(req), parseQuery(listPartsQuerySchema, req)))
})

inventoryRouter.get('/parts/categories', view, async (req, res) => {
  sendData(res, await service.partCategories(getAuth(req)))
})

inventoryRouter.get('/parts/by-public/:publicId', view, async (req, res) => {
  const { publicId } = parseParams(
    z.object({ publicId: z.string().regex(/^[0-9A-Za-z]{8,40}$/) }),
    req,
  )
  sendData(res, await service.getPartByPublicId(getAuth(req), publicId))
})

inventoryRouter.get('/parts/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getPart(getAuth(req), id))
})

inventoryRouter.post('/parts', requirePermission('parts:create'), async (req, res) => {
  sendCreated(res, await service.createPart(getAuth(req), parseBody(partSchema, req), req))
})

inventoryRouter.put('/parts/:id', requirePermission('parts:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.updatePart(getAuth(req), id, parseBody(partSchema, req), req))
})

inventoryRouter.delete('/parts/:id', requirePermission('parts:delete'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await service.archivePart(getAuth(req), id, req)
  res.status(204).end()
})

inventoryRouter.post('/parts/:id/adjust', requirePermission('inventory:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.adjustStock(getAuth(req), id, parseBody(stockAdjustmentSchema, req), req),
  )
})

inventoryRouter.post(
  '/parts/:id/transfer',
  requirePermission('inventory:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.transferStock(getAuth(req), id, parseBody(stockTransferSchema, req), req),
    )
  },
)

inventoryRouter.put(
  '/parts/:id/stock-settings',
  requirePermission('inventory:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.updateStockSettings(getAuth(req), id, parseBody(stockSettingsSchema, req), req),
    )
  },
)

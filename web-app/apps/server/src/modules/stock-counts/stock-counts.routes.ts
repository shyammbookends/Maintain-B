import {
  createStockCountSchema,
  idParamSchema,
  inventorySettingsSchema,
  listStockCountsQuerySchema,
  saveStockCountSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './stock-counts.service.js'

/** Cycle counts and inventory automation settings. */
export const stockCountsRouter = Router()
stockCountsRouter.use('/stock-counts', ...requireAuth())
stockCountsRouter.use('/inventory/settings', ...requireAuth())

const view = requirePermission('inventory:view')
const edit = requirePermission('inventory:edit')

stockCountsRouter.get('/stock-counts', view, async (req, res) => {
  res.json(await service.listStockCounts(getAuth(req), parseQuery(listStockCountsQuerySchema, req)))
})

stockCountsRouter.get('/stock-counts/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getStockCount(getAuth(req), id))
})

stockCountsRouter.post('/stock-counts', edit, async (req, res) => {
  sendCreated(
    res,
    await service.createStockCount(getAuth(req), parseBody(createStockCountSchema, req), req),
  )
})

stockCountsRouter.put('/stock-counts/:id/lines', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.saveCounts(getAuth(req), id, parseBody(saveStockCountSchema, req)))
})

stockCountsRouter.post('/stock-counts/:id/complete', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.completeStockCount(getAuth(req), id, req))
})

stockCountsRouter.post('/stock-counts/:id/cancel', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.cancelStockCount(getAuth(req), id, req))
})

stockCountsRouter.get('/inventory/settings', view, async (req, res) => {
  sendData(res, await service.getInventorySettings(getAuth(req)))
})

stockCountsRouter.put('/inventory/settings', edit, async (req, res) => {
  sendData(
    res,
    await service.updateInventorySettings(
      getAuth(req),
      parseBody(inventorySettingsSchema, req),
      req,
    ),
  )
})

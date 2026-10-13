import {
  idParamSchema,
  listPurchaseOrdersQuerySchema,
  lowStockOrderSchema,
  purchaseOrderSchema,
  reasonSchema,
  receivePoSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './purchase-orders.service.js'

/* Every action re-checks status and permission in the service (computeActions). */
export const purchaseOrdersRouter = Router()
purchaseOrdersRouter.use('/purchase-orders', ...requireAuth())

const view = requirePermission('purchase_orders:view')

purchaseOrdersRouter.get('/purchase-orders', view, async (req, res) => {
  res.json(
    await service.listPurchaseOrders(getAuth(req), parseQuery(listPurchaseOrdersQuerySchema, req)),
  )
})

/** Draft purchase requests for everything low at one restaurant (one per preferred vendor). */
purchaseOrdersRouter.post(
  '/purchase-orders/from-low-stock',
  requirePermission('purchase_orders:create'),
  async (req, res) => {
    sendCreated(
      res,
      await service.orderLowStock(getAuth(req), parseBody(lowStockOrderSchema, req), req),
    )
  },
)

purchaseOrdersRouter.get('/purchase-orders/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getPurchaseOrder(getAuth(req), id))
})

purchaseOrdersRouter.post(
  '/purchase-orders',
  requirePermission('purchase_orders:create'),
  async (req, res) => {
    sendCreated(
      res,
      await service.createPurchaseOrder(getAuth(req), parseBody(purchaseOrderSchema, req), req),
    )
  },
)

purchaseOrdersRouter.put('/purchase-orders/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.updatePurchaseOrder(getAuth(req), id, parseBody(purchaseOrderSchema, req), req),
  )
})

purchaseOrdersRouter.post('/purchase-orders/:id/submit', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.submitPurchaseOrder(getAuth(req), id, req))
})

purchaseOrdersRouter.post('/purchase-orders/:id/approve', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.approvePurchaseOrder(getAuth(req), id, req))
})

purchaseOrdersRouter.post('/purchase-orders/:id/reject', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  const { reason } = parseBody(reasonSchema, req)
  sendData(res, await service.rejectPurchaseOrder(getAuth(req), id, reason, req))
})

purchaseOrdersRouter.post('/purchase-orders/:id/order', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.markOrdered(getAuth(req), id, req))
})

purchaseOrdersRouter.post('/purchase-orders/:id/receive', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.receivePurchaseOrder(getAuth(req), id, parseBody(receivePoSchema, req), req),
  )
})

purchaseOrdersRouter.post('/purchase-orders/:id/cancel', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  const { reason } = parseBody(reasonSchema, req)
  sendData(res, await service.cancelPurchaseOrder(getAuth(req), id, reason, req))
})

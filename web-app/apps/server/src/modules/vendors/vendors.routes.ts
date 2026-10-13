import {
  idParamSchema,
  invoicePaidSchema,
  listVendorsQuerySchema,
  vendorContractSchema,
  vendorInvoiceSchema,
  vendorSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { hasPermission, requirePermission } from '../../core/authz.js'
import { ForbiddenError } from '../../core/errors.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './vendors.service.js'

export const vendorsRouter = Router()
vendorsRouter.use('/vendors', ...requireAuth())

const view = requirePermission('vendors:view')
const edit = requirePermission('vendors:edit')
const invoiceParams = z.object({ id: z.uuid(), invoiceId: z.uuid() })

vendorsRouter.get('/vendors', view, async (req, res) => {
  res.json(await service.listVendors(getAuth(req), parseQuery(listVendorsQuerySchema, req)))
})

/** Picker list: anyone who orders parts, edits assets or plans work needs it (not Users). */
vendorsRouter.get('/vendors/options', async (req, res) => {
  const auth = getAuth(req)
  const pickers = ['vendors:view', 'purchase_orders:view', 'assets:edit', 'work_orders:assign'] as const
  if (!pickers.some((p) => hasPermission(auth, p))) throw new ForbiddenError()
  const { restaurantId } = parseQuery(z.object({ restaurantId: z.uuid().optional() }), req)
  sendData(res, await service.vendorOptions(getAuth(req), restaurantId))
})

vendorsRouter.get('/vendors/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getVendor(getAuth(req), id))
})

vendorsRouter.post('/vendors', requirePermission('vendors:create'), async (req, res) => {
  sendCreated(res, await service.createVendor(getAuth(req), parseBody(vendorSchema, req), req))
})

vendorsRouter.put('/vendors/:id', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.updateVendor(getAuth(req), id, parseBody(vendorSchema, req), req))
})

vendorsRouter.delete('/vendors/:id', requirePermission('vendors:delete'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await service.archiveVendor(getAuth(req), id, req)
  res.status(204).end()
})

vendorsRouter.get('/vendors/:id/invoices', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.listInvoices(getAuth(req), id))
})

vendorsRouter.post('/vendors/:id/invoices', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendCreated(
    res,
    await service.createInvoice(getAuth(req), id, parseBody(vendorInvoiceSchema, req), req),
  )
})

vendorsRouter.put('/vendors/:id/invoices/:invoiceId/paid', edit, async (req, res) => {
  const { id, invoiceId } = parseParams(invoiceParams, req)
  const { paid } = parseBody(invoicePaidSchema, req)
  sendData(res, await service.setInvoicePaid(getAuth(req), id, invoiceId, paid, req))
})

vendorsRouter.delete('/vendors/:id/invoices/:invoiceId', edit, async (req, res) => {
  const { id, invoiceId } = parseParams(invoiceParams, req)
  await service.deleteInvoice(getAuth(req), id, invoiceId, req)
  res.status(204).end()
})

vendorsRouter.get('/vendors/:id/contracts', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.listContracts(getAuth(req), id))
})

vendorsRouter.post('/vendors/:id/contracts', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendCreated(
    res,
    await service.createContract(getAuth(req), id, parseBody(vendorContractSchema, req), req),
  )
})

vendorsRouter.put('/vendors/:id/contracts/:contractId', edit, async (req, res) => {
  const { id, contractId } = parseParams(z.object({ id: z.uuid(), contractId: z.uuid() }), req)
  sendData(
    res,
    await service.updateContract(
      getAuth(req),
      id,
      contractId,
      parseBody(vendorContractSchema, req),
      req,
    ),
  )
})

vendorsRouter.delete('/vendors/:id/contracts/:contractId', edit, async (req, res) => {
  const { id, contractId } = parseParams(z.object({ id: z.uuid(), contractId: z.uuid() }), req)
  sendData(res, await service.archiveContract(getAuth(req), id, contractId, req))
})

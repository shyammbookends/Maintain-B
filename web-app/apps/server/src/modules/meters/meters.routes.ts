import { meterReadingSchema, meterSchema } from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './meters.service.js'

/** Asset meters, readings and the asset's root cause analyses. */
export const metersRouter = Router()
metersRouter.use('/assets/:assetId/meters', ...requireAuth())
metersRouter.use('/assets/:assetId/root-causes', ...requireAuth())

const assetParam = z.object({ assetId: z.uuid() })
const meterParam = z.object({ assetId: z.uuid(), meterId: z.uuid() })
const view = requirePermission('assets:view', 'meters:view')

metersRouter.get('/assets/:assetId/meters', view, async (req, res) => {
  const { assetId } = parseParams(assetParam, req)
  sendData(res, await service.listMeters(getAuth(req), assetId))
})

metersRouter.post('/assets/:assetId/meters', requirePermission('meters:edit'), async (req, res) => {
  const { assetId } = parseParams(assetParam, req)
  sendCreated(
    res,
    await service.createMeter(getAuth(req), assetId, parseBody(meterSchema, req), req),
  )
})

metersRouter.put(
  '/assets/:assetId/meters/:meterId',
  requirePermission('meters:edit'),
  async (req, res) => {
    const { assetId, meterId } = parseParams(meterParam, req)
    sendData(
      res,
      await service.updateMeter(getAuth(req), assetId, meterId, parseBody(meterSchema, req), req),
    )
  },
)

metersRouter.delete(
  '/assets/:assetId/meters/:meterId',
  requirePermission('meters:delete'),
  async (req, res) => {
    const { assetId, meterId } = parseParams(meterParam, req)
    sendData(res, await service.archiveMeter(getAuth(req), assetId, meterId, req))
  },
)

metersRouter.post(
  '/assets/:assetId/meters/:meterId/readings',
  requirePermission('assets:view', 'meters:create'),
  async (req, res) => {
    const { assetId, meterId } = parseParams(meterParam, req)
    sendCreated(
      res,
      await service.addReading(
        getAuth(req),
        assetId,
        meterId,
        parseBody(meterReadingSchema, req),
        req,
      ),
    )
  },
)

metersRouter.get(
  '/assets/:assetId/root-causes',
  requirePermission('assets:view'),
  async (req, res) => {
    const { assetId } = parseParams(assetParam, req)
    sendData(res, await service.assetRootCauses(getAuth(req), assetId))
  },
)

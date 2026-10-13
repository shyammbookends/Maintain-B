import { idParamSchema, listLocationsQuerySchema, locationSchema } from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData, sendNoContent } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './locations.service.js'

export const locationsRouter = Router()
locationsRouter.use('/locations', ...requireAuth())

locationsRouter.get('/locations', requirePermission('locations:view'), async (req, res) => {
  const { restaurantId } = parseQuery(listLocationsQuerySchema, req)
  sendData(res, await service.listLocations(getAuth(req), restaurantId))
})

/** Location QR landing lookup (codes are base-58 from the app or hex from older rows). */
locationsRouter.get(
  '/locations/by-public/:publicId',
  requirePermission('locations:view'),
  async (req, res) => {
    const { publicId } = parseParams(
      z.object({ publicId: z.string().regex(/^[0-9A-Za-z]{8,40}$/) }),
      req,
    )
    sendData(res, await service.getLocationByPublicId(getAuth(req), publicId))
  },
)

locationsRouter.post('/locations', requirePermission('locations:create'), async (req, res) => {
  sendCreated(res, await service.createLocation(getAuth(req), parseBody(locationSchema, req), req))
})

locationsRouter.put('/locations/:id', requirePermission('locations:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.updateLocation(getAuth(req), id, parseBody(locationSchema, req), req))
})

locationsRouter.delete(
  '/locations/:id',
  requirePermission('locations:delete'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    await service.archiveLocation(getAuth(req), id, req)
    sendNoContent(res)
  },
)

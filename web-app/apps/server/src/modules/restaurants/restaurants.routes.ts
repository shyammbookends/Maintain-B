import { idParamSchema, listRestaurantsQuerySchema, restaurantSchema } from '@maintainx/shared'
import { Router } from 'express'
import { requirePermission, requireSuperAdmin } from '../../core/authz.js'
import { sendCreated, sendData, sendNoContent } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './restaurants.service.js'

export const restaurantsRouter = Router()
restaurantsRouter.use('/restaurants', ...requireAuth())

restaurantsRouter.get('/restaurants', requirePermission('restaurants:view'), async (req, res) => {
  const query = parseQuery(listRestaurantsQuerySchema, req)
  sendData(res, await service.listRestaurants(getAuth(req), query))
})

restaurantsRouter.get(
  '/restaurants/:id',
  requirePermission('restaurants:view'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(res, await service.getRestaurant(getAuth(req), id))
  },
)

restaurantsRouter.post(
  '/restaurants',
  requirePermission('restaurants:create'),
  async (req, res) => {
    const input = parseBody(restaurantSchema, req)
    sendCreated(res, await service.createRestaurant(getAuth(req), input, req))
  },
)

restaurantsRouter.put(
  '/restaurants/:id',
  requirePermission('restaurants:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    const input = parseBody(restaurantSchema, req)
    sendData(res, await service.updateRestaurant(getAuth(req), id, input, req))
  },
)

restaurantsRouter.get(
  '/restaurants/:id/stats',
  requirePermission('restaurants:view'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(res, await service.restaurantStats(getAuth(req), id))
  },
)

restaurantsRouter.delete(
  '/restaurants/:id',
  requirePermission('restaurants:delete'),
  requireSuperAdmin(),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    await service.archiveRestaurant(getAuth(req), id, req)
    sendNoContent(res)
  },
)

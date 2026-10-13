import { automationActiveSchema, automationSchema, idParamSchema } from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './automations.service.js'

/** IF / THEN rules configured by admins. */
export const automationsRouter = Router()
automationsRouter.use('/automations', ...requireAuth())

const view = requirePermission('automations:view')

automationsRouter.get('/automations', view, async (req, res) => {
  sendData(res, await service.listAutomations(getAuth(req)))
})

automationsRouter.get('/automations/meter-options', view, async (req, res) => {
  const { restaurantId } = parseQuery(z.object({ restaurantId: z.uuid().optional() }), req)
  sendData(res, await service.meterOptions(getAuth(req), restaurantId))
})

automationsRouter.get('/automations/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getAutomation(getAuth(req), id))
})

automationsRouter.get('/automations/:id/logs', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.automationLogs(getAuth(req), id))
})

automationsRouter.post(
  '/automations',
  requirePermission('automations:create'),
  async (req, res) => {
    sendCreated(
      res,
      await service.createAutomation(getAuth(req), parseBody(automationSchema, req), req),
    )
  },
)

automationsRouter.put(
  '/automations/:id',
  requirePermission('automations:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.updateAutomation(getAuth(req), id, parseBody(automationSchema, req), req),
    )
  },
)

automationsRouter.put(
  '/automations/:id/active',
  requirePermission('automations:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    const { active } = parseBody(automationActiveSchema, req)
    sendData(res, await service.setAutomationActive(getAuth(req), id, active, req))
  },
)

automationsRouter.delete(
  '/automations/:id',
  requirePermission('automations:delete'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    await service.archiveAutomation(getAuth(req), id, req)
    res.status(204).end()
  },
)

import {
  idParamSchema,
  listPmQuerySchema,
  pmScheduleSchema,
  setPmActiveSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './maintenance.service.js'

export const maintenanceRouter = Router()
maintenanceRouter.use('/pm-schedules', ...requireAuth())

const view = requirePermission('maintenance:view')
const edit = requirePermission('maintenance:edit')

maintenanceRouter.get('/pm-schedules', view, async (req, res) => {
  res.json(await service.listSchedules(getAuth(req), parseQuery(listPmQuerySchema, req)))
})

maintenanceRouter.get('/pm-schedules/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getSchedule(getAuth(req), id))
})

maintenanceRouter.post(
  '/pm-schedules',
  requirePermission('maintenance:create'),
  async (req, res) => {
    sendCreated(
      res,
      await service.createSchedule(getAuth(req), parseBody(pmScheduleSchema, req), req),
    )
  },
)

maintenanceRouter.put('/pm-schedules/:id', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.updateSchedule(getAuth(req), id, parseBody(pmScheduleSchema, req), req),
  )
})

maintenanceRouter.put('/pm-schedules/:id/active', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  const { active } = parseBody(setPmActiveSchema, req)
  sendData(res, await service.setScheduleActive(getAuth(req), id, active, req))
})

maintenanceRouter.post(
  '/pm-schedules/:id/generate',
  requirePermission('maintenance:create', 'work_orders:create'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(res, await service.generateNow(getAuth(req), id, req))
  },
)

maintenanceRouter.delete(
  '/pm-schedules/:id',
  requirePermission('maintenance:delete'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    await service.archiveSchedule(getAuth(req), id, req)
    res.status(204).end()
  },
)

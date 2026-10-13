import { workerScheduleQuerySchema, workerTasksQuerySchema } from '@maintainx/shared'
import { Router } from 'express'
import { requirePermission } from '../../core/authz.js'
import { sendData } from '../../core/http.js'
import { parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './me.service.js'

/** "My work" endpoints for the worker app. Always limited to the caller's own tasks. */
export const meRouter = Router()
meRouter.use('/me', ...requireAuth())

meRouter.get('/me/home', requirePermission('work_orders:view'), async (req, res) => {
  sendData(res, await service.getHome(getAuth(req)))
})

meRouter.get('/me/tasks', requirePermission('work_orders:view'), async (req, res) => {
  res.json(await service.listTasks(getAuth(req), parseQuery(workerTasksQuerySchema, req)))
})

meRouter.get('/me/schedule', requirePermission('work_orders:view'), async (req, res) => {
  sendData(res, await service.getSchedule(getAuth(req), parseQuery(workerScheduleQuerySchema, req)))
})

meRouter.get('/me/restaurants', requirePermission('restaurants:view'), async (req, res) => {
  sendData(res, await service.listMyRestaurants(getAuth(req)))
})

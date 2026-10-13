import { REPORT_KEYS, idParamSchema, reportScheduleSchema } from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './report-schedules.service.js'

/** Scheduled email reports: whoever may export reports may schedule them. */
export const reportSchedulesRouter = Router()
reportSchedulesRouter.use(
  '/report-schedules',
  ...requireAuth(),
  requirePermission('reports:view', 'reports:export'),
)

const listQuery = z.object({ reportKey: z.enum(REPORT_KEYS).optional() })

reportSchedulesRouter.get('/report-schedules', async (req, res) => {
  const { reportKey } = parseQuery(listQuery, req)
  sendData(res, await service.listSchedules(getAuth(req), reportKey))
})

reportSchedulesRouter.post('/report-schedules', async (req, res) => {
  sendCreated(
    res,
    await service.createSchedule(getAuth(req), parseBody(reportScheduleSchema, req), req),
  )
})

reportSchedulesRouter.get('/report-schedules/:id', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getSchedule(getAuth(req), id))
})

reportSchedulesRouter.get('/report-schedules/:id/runs', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.listRuns(getAuth(req), id))
})

reportSchedulesRouter.put('/report-schedules/:id', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.updateSchedule(getAuth(req), id, parseBody(reportScheduleSchema, req), req),
  )
})

reportSchedulesRouter.delete('/report-schedules/:id', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await service.archiveSchedule(getAuth(req), id, req)
  res.status(204).end()
})

import { calendarQuerySchema } from '@maintainx/shared'
import { Router } from 'express'
import { requirePermission } from '../../core/authz.js'
import { sendData } from '../../core/http.js'
import { parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { getCalendar } from './calendar.service.js'

export const calendarRouter = Router()

calendarRouter.get(
  '/calendar',
  ...requireAuth(),
  requirePermission('work_orders:view'),
  async (req, res) => {
    sendData(res, await getCalendar(getAuth(req), parseQuery(calendarQuerySchema, req)))
  },
)

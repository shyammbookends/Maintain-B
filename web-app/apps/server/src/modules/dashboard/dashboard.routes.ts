import { dashboardQuerySchema } from '@maintainx/shared'
import { Router } from 'express'
import { requirePermission } from '../../core/authz.js'
import { ForbiddenError } from '../../core/errors.js'
import { sendData } from '../../core/http.js'
import { parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { getDashboard } from './dashboard.service.js'

export const dashboardRouter = Router()

dashboardRouter.get(
  '/dashboard',
  ...requireAuth(),
  requirePermission('dashboard:view'),
  async (req, res) => {
    const auth = getAuth(req)
    // Organisation-wide lists include other people's tasks; workers get their own home in Phase 6.
    if (auth.user.roleKind === 'WORKER') throw new ForbiddenError()
    const query = parseQuery(dashboardQuerySchema, req)
    res.setHeader('Cache-Control', 'private, no-store')
    sendData(res, await getDashboard(auth, query))
  },
)

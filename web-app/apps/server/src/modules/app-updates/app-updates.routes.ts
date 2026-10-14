import { Router } from 'express'
import { z } from 'zod'
import { sendData } from '../../core/http.js'
import { parseQuery } from '../../core/validate.js'
import { requireAuth } from '../../middleware/authenticate.js'
import * as service from './app-updates.service.js'

const updateQuery = z.object({
  platform: z.enum(['android', 'ios']),
  build: z.coerce.number().int().min(0).max(1_000_000),
  locale: z.enum(['en', 'hi', 'gu']).default('en'),
})

/** "Is there a newer phone app?" Signed-in users only (also before a forced password change). */
export const appUpdatesRouter = Router()

appUpdatesRouter.get(
  '/app/update',
  ...requireAuth({ allowPendingPasswordChange: true, sessionOnly: true }),
  async (req, res) => {
    const { platform, build, locale } = parseQuery(updateQuery, req)
    res.set('Cache-Control', 'no-store')
    sendData(res, await service.getUpdate(platform, build, locale))
  },
)

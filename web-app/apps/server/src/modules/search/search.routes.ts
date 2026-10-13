import {
  createSavedViewSchema,
  globalSearchQuerySchema,
  idParamSchema,
  savedViewQuerySchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { ipKeyGenerator } from 'express-rate-limit'
import { createRateLimiter } from '../../middleware/security.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { globalSearch } from './search.service.js'
import * as views from './saved-views.service.js'

/** Global search and saved list views (each result is still permission-checked). */
export const searchRouter = Router()
/** Every keystroke runs several ILIKE scans: a per-person brake. */
const searchLimiter = createRateLimiter({
  windowMs: 60_000,
  limit: 90,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
})
searchRouter.use('/search', ...requireAuth(), searchLimiter)
searchRouter.use('/saved-views', ...requireAuth({ sessionOnly: true }))

searchRouter.get('/search', async (req, res) => {
  const { q } = parseQuery(globalSearchQuerySchema, req)
  sendData(res, await globalSearch(getAuth(req), q))
})

searchRouter.get('/saved-views', async (req, res) => {
  const { resource } = parseQuery(savedViewQuerySchema, req)
  sendData(res, await views.listSavedViews(getAuth(req), resource))
})

searchRouter.post('/saved-views', async (req, res) => {
  sendCreated(res, await views.createSavedView(getAuth(req), parseBody(createSavedViewSchema, req), req))
})

searchRouter.delete('/saved-views/:id', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await views.deleteSavedView(getAuth(req), id))
})

import {
  createUserSchema,
  idParamSchema,
  listUsersQuerySchema,
  setUserStatusSchema,
  updateUserAccessSchema,
  updateUserSchema,
} from '@maintainx/shared'
import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { hasPermission, requirePermission } from '../../core/authz.js'
import { ForbiddenError } from '../../core/errors.js'
import { sendCreated, sendData, sendNoContent } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './users.service.js'

export const usersRouter = Router()
usersRouter.use('/users', ...requireAuth())

const noStore: RequestHandler = (_req, res, next) => {
  // Responses can contain one-time temporary passwords.
  res.setHeader('Cache-Control', 'no-store')
  next()
}

usersRouter.get('/users', requirePermission('users:view'), async (req, res) => {
  res.json(await service.listUsers(getAuth(req), parseQuery(listUsersQuerySchema, req)))
})

/** Compact list for pickers. Anyone who can assign work or manage teams needs it. */
usersRouter.get('/users/options', async (req, res) => {
  const auth = getAuth(req)
  if (
    !['users:view', 'teams:edit', 'teams:create', 'work_orders:assign'].some((p) =>
      hasPermission(auth, p as never),
    )
  ) {
    throw new ForbiddenError()
  }
  const { restaurantId, permission } = parseQuery(
    z.object({
      restaurantId: z.uuid().optional(),
      permission: z
        .enum(['work_orders:approve', 'work_orders:complete', 'reports:view'])
        .optional(),
    }),
    req,
  )
  sendData(res, await service.listUserOptions(auth, restaurantId, permission))
})

usersRouter.get('/users/:id', requirePermission('users:view'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getUser(getAuth(req), id))
})

usersRouter.post('/users', noStore, requirePermission('users:create'), async (req, res) => {
  const input = parseBody(createUserSchema, req)
  sendCreated(res, await service.createUser(getAuth(req), input, req))
})

usersRouter.put('/users/:id', requirePermission('users:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.updateUser(getAuth(req), id, parseBody(updateUserSchema, req), req))
})

usersRouter.put('/users/:id/access', requirePermission('users:assign'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.updateUserAccess(getAuth(req), id, parseBody(updateUserAccessSchema, req), req),
  )
})

usersRouter.put('/users/:id/status', requirePermission('users:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.setUserStatus(getAuth(req), id, parseBody(setUserStatusSchema, req), req),
  )
})

usersRouter.post(
  '/users/:id/reset-password',
  noStore,
  requirePermission('users:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(res, await service.resetUserPassword(getAuth(req), id, req))
  },
)

usersRouter.delete('/users/:id', requirePermission('users:delete'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await service.archiveUser(getAuth(req), id, req)
  sendNoContent(res)
})

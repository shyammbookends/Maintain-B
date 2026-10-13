import { idParamSchema } from '@maintainx/shared'
import { Router } from 'express'
import { hasPermission, requirePermission } from '../../core/authz.js'
import { ForbiddenError } from '../../core/errors.js'
import { sendData } from '../../core/http.js'
import { parseParams } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './roles.service.js'

export const rolesRouter = Router()
// Read-only: the three roles are fixed, so there is no create, edit or delete.
rolesRouter.use('/roles', ...requireAuth())

/** Roles the caller may give to users — used by the user forms (needs users:create or users:assign). */
rolesRouter.get('/roles/assignable', async (req, res) => {
  const auth = getAuth(req)
  if (!hasPermission(auth, 'users:create') && !hasPermission(auth, 'users:assign')) {
    throw new ForbiddenError()
  }
  sendData(res, await service.listAssignableRoles(auth))
})

rolesRouter.get('/roles', requirePermission('roles:view'), async (req, res) => {
  sendData(res, await service.listRoles(getAuth(req)))
})

rolesRouter.get('/roles/:id', requirePermission('roles:view'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getRole(getAuth(req), id))
})

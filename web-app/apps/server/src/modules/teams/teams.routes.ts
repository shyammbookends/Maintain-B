import { idParamSchema, teamSchema } from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData, sendNoContent } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './teams.service.js'

export const teamsRouter = Router()
teamsRouter.use('/teams', ...requireAuth())

teamsRouter.get('/teams', requirePermission('teams:view'), async (req, res) => {
  const { restaurantId } = parseQuery(z.object({ restaurantId: z.uuid().optional() }), req)
  sendData(res, await service.listTeams(getAuth(req), restaurantId))
})

teamsRouter.get('/teams/:id', requirePermission('teams:view'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getTeam(getAuth(req), id))
})

teamsRouter.post('/teams', requirePermission('teams:create'), async (req, res) => {
  sendCreated(res, await service.createTeam(getAuth(req), parseBody(teamSchema, req), req))
})

teamsRouter.put('/teams/:id', requirePermission('teams:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.updateTeam(getAuth(req), id, parseBody(teamSchema, req), req))
})

teamsRouter.delete('/teams/:id', requirePermission('teams:delete'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await service.archiveTeam(getAuth(req), id, req)
  sendNoContent(res)
})

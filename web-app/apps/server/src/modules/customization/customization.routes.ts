import {
  CUSTOM_FIELD_ENTITY,
  customFieldSchema,
  idParamSchema,
  labelSchema,
  reorderCustomFieldsSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './customization.service.js'

/**
 * Custom fields and labels. Everyone signed in reads them (forms and lists
 * need them); changing them needs settings:edit.
 */
export const customizationRouter = Router()
customizationRouter.use(['/custom-fields', '/labels'], ...requireAuth())

const entityQuery = z.object({ entity: z.enum(CUSTOM_FIELD_ENTITY) })
const edit = requirePermission('settings:edit')

customizationRouter.get('/custom-fields', async (req, res) => {
  const { entity } = parseQuery(entityQuery, req)
  sendData(res, await service.listCustomFields(getAuth(req), entity))
})

customizationRouter.post('/custom-fields', edit, async (req, res) => {
  sendCreated(
    res,
    await service.createCustomField(getAuth(req), parseBody(customFieldSchema, req), req),
  )
})

customizationRouter.put('/custom-fields/order', edit, async (req, res) => {
  const { entity } = parseQuery(entityQuery, req)
  const { ids } = parseBody(reorderCustomFieldsSchema, req)
  sendData(res, await service.reorderCustomFields(getAuth(req), entity, ids))
})

customizationRouter.put('/custom-fields/:id', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.updateCustomField(getAuth(req), id, parseBody(customFieldSchema, req), req),
  )
})

customizationRouter.delete('/custom-fields/:id', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.archiveCustomField(getAuth(req), id, req))
})

customizationRouter.get('/labels', async (req, res) => {
  sendData(res, await service.listLabels(getAuth(req)))
})

customizationRouter.post('/labels', edit, async (req, res) => {
  sendCreated(res, await service.createLabel(getAuth(req), parseBody(labelSchema, req), req))
})

customizationRouter.put('/labels/:id', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.updateLabel(getAuth(req), id, parseBody(labelSchema, req), req))
})

customizationRouter.delete('/labels/:id', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.archiveLabel(getAuth(req), id, req))
})

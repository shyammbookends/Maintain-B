import {
  assetCategorySchema,
  assetSchema,
  assetStatusChangeSchema,
  assetTransferSchema,
  idParamSchema,
  listAssetsQuerySchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData, sendNoContent } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as assets from './assets.service.js'
import * as categories from './categories.service.js'

export const assetsRouter = Router()
assetsRouter.use(['/assets', '/asset-categories'], ...requireAuth())

// ---- categories
assetsRouter.get('/asset-categories', requirePermission('assets:view'), async (req, res) => {
  sendData(res, await categories.listCategories(getAuth(req)))
})
assetsRouter.post('/asset-categories', requirePermission('assets:create'), async (req, res) => {
  sendCreated(
    res,
    await categories.createCategory(getAuth(req), parseBody(assetCategorySchema, req), req),
  )
})
assetsRouter.put('/asset-categories/:id', requirePermission('assets:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await categories.renameCategory(getAuth(req), id, parseBody(assetCategorySchema, req), req),
  )
})
assetsRouter.delete(
  '/asset-categories/:id',
  requirePermission('assets:delete'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    await categories.archiveCategory(getAuth(req), id, req)
    sendNoContent(res)
  },
)

// ---- assets
assetsRouter.get('/assets', requirePermission('assets:view'), async (req, res) => {
  res.json(await assets.listAssets(getAuth(req), parseQuery(listAssetsQuerySchema, req)))
})

/** QR landing lookup. Requires sign-in and restaurant access like any other read. */
assetsRouter.get(
  '/assets/by-public/:publicId',
  requirePermission('assets:view'),
  async (req, res) => {
    const { publicId } = parseParams(
      z.object({ publicId: z.string().regex(/^[0-9A-Za-z]{8,40}$/) }),
      req,
    )
    sendData(res, await assets.getAssetByPublicId(getAuth(req), publicId))
  },
)

assetsRouter.get('/assets/:id', requirePermission('assets:view'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await assets.getAsset(getAuth(req), id))
})

assetsRouter.post('/assets', requirePermission('assets:create'), async (req, res) => {
  sendCreated(res, await assets.createAsset(getAuth(req), parseBody(assetSchema, req), req))
})

assetsRouter.put('/assets/:id', requirePermission('assets:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await assets.updateAsset(getAuth(req), id, parseBody(assetSchema, req), req))
})

assetsRouter.post('/assets/:id/transfer', requirePermission('assets:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await assets.transferAsset(getAuth(req), id, parseBody(assetTransferSchema, req), req),
  )
})

assetsRouter.put('/assets/:id/status', requirePermission('assets:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await assets.changeAssetStatus(getAuth(req), id, parseBody(assetStatusChangeSchema, req), req),
  )
})

assetsRouter.delete('/assets/:id', requirePermission('assets:delete'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await assets.archiveAsset(getAuth(req), id, req)
  sendNoContent(res)
})

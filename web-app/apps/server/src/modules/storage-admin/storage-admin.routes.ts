import { storagePolicySchema } from '@maintainx/shared'
import { Router } from 'express'
import { recordAudit } from '../../core/audit.js'
import { requirePermission } from '../../core/authz.js'
import { sendData } from '../../core/http.js'
import { STORAGE_POLICY_KEY, setOrgSetting, storagePolicy } from '../../core/settings.js'
import { parseBody } from '../../core/validate.js'
import { storageUsage } from '../../jobs/storage.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'

/** Storage meter and file retention policy (organization settings). */
export const storageAdminRouter = Router()
storageAdminRouter.use('/storage', ...requireAuth())

storageAdminRouter.get('/storage', requirePermission('settings:view'), async (req, res) => {
  sendData(res, await storageUsage(getAuth(req).organizationId))
})

storageAdminRouter.put('/storage/policy', requirePermission('settings:edit'), async (req, res) => {
  const auth = getAuth(req)
  const input = parseBody(storagePolicySchema, req)
  const before = await storagePolicy(auth.organizationId)
  await setOrgSetting(auth.organizationId, STORAGE_POLICY_KEY, { ...input }, auth.userId)
  await recordAudit(
    {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'setting.updated',
      entityType: 'SETTING',
      oldValue: { ...before },
      newValue: { ...input },
      metadata: { key: STORAGE_POLICY_KEY },
    },
    req,
  )
  sendData(res, await storageUsage(auth.organizationId))
})

import { workflowSettingsSchema } from '@maintainx/shared'
import { Router } from 'express'
import { recordAudit } from '../../core/audit.js'
import { requirePermission } from '../../core/authz.js'
import { sendData } from '../../core/http.js'
import { COMPLETION_POLICY_KEY, setOrgSetting, workflowSettings } from '../../core/settings.js'
import { parseBody } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'

/** Organization-wide workflow rules (how strict completing a job is). */
export const settingsRouter = Router()
settingsRouter.use('/settings', ...requireAuth())

// Every signed-in user reads it: screens adapt (status names, which fields are required).
settingsRouter.get('/settings/workflow', async (req, res) => {
  sendData(res, await workflowSettings(getAuth(req).organizationId))
})

settingsRouter.put('/settings/workflow', requirePermission('settings:edit'), async (req, res) => {
  const auth = getAuth(req)
  const input = parseBody(workflowSettingsSchema, req)
  const before = await workflowSettings(auth.organizationId)
  await setOrgSetting(auth.organizationId, COMPLETION_POLICY_KEY, { ...input }, auth.userId)
  await recordAudit(
    {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'setting.updated',
      entityType: 'SETTING',
      oldValue: { ...before },
      newValue: { ...input },
      metadata: { key: COMPLETION_POLICY_KEY },
    },
    req,
  )
  sendData(res, await workflowSettings(auth.organizationId))
})

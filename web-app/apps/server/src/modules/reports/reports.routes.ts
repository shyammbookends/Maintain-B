import { REPORT_KEYS, reportQuerySchema } from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { recordAudit } from '../../core/audit.js'
import { requirePermission } from '../../core/authz.js'
import { sendData } from '../../core/http.js'
import { parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { ipKeyGenerator } from 'express-rate-limit'
import { createRateLimiter, createSharedRateLimiter } from '../../middleware/security.js'
import { buildReportFile } from './reports.export.js'
import { analyticsTrends, runReport } from './reports.service.js'

/** Reports scan a lot of rows: keep bursts in check. */
const reportLimiter = createRateLimiter({ windowMs: 60_000, limit: 60 })
/** Files are the expensive part (PDF layout): a few per person per minute, across instances. */
const exportLimiter = createSharedRateLimiter('report-export', {
  windowMs: 60_000,
  limit: 10,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
})
const keyParam = z.object({ key: z.enum(REPORT_KEYS) })

export const reportsRouter = Router()
reportsRouter.use('/reports', ...requireAuth(), reportLimiter)

reportsRouter.get(
  '/reports/analytics/trends',
  requirePermission('reports:view'),
  async (req, res) => {
    sendData(res, await analyticsTrends(getAuth(req), parseQuery(reportQuerySchema, req)))
  },
)

reportsRouter.get('/reports/:key', requirePermission('reports:view'), async (req, res) => {
  const { key } = parseParams(keyParam, req)
  sendData(res, await runReport(getAuth(req), key, parseQuery(reportQuerySchema, req)))
})

/**
 * Downloads: CSV for Excel (column keys as headers; the app translates them on
 * screen) and PDF (a printable table). Same data, scope and audit trail.
 */
const FORMATS = { csv: 'CSV', pdf: 'PDF' } as const
for (const [ext, format] of Object.entries(FORMATS)) {
  reportsRouter.get(
    `/reports/:key/${ext}`,
    exportLimiter,
    requirePermission('reports:view', 'reports:export'),
    async (req, res) => {
      const auth = getAuth(req)
      const { key } = parseParams(keyParam, req)
      const q = parseQuery(reportQuerySchema, req)
      const file = await buildReportFile(auth, key, q, format)
      await recordAudit(
        {
          organizationId: auth.organizationId,
          restaurantId: q.restaurantId ?? null,
          actorId: auth.userId,
          action: 'report.exported',
          entityType: 'REPORT',
          metadata: { report: key, format, from: q.from, to: q.to, rows: file.result.rows.length },
        },
        req,
      )
      res.setHeader('Content-Type', file.contentType)
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
      res.setHeader('Cache-Control', 'no-store')
      res.send(file.body)
    },
  )
}

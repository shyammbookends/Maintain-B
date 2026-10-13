import { fullName, listAuditQuerySchema, toCsv } from '@maintainx/shared'
import { Router } from 'express'
import { recordAudit } from '../../core/audit.js'
import { requirePermission } from '../../core/authz.js'
import { parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { exportAudit, listAudit } from './audit.service.js'

export const auditRouter = Router()
auditRouter.use('/audit-logs', ...requireAuth())

auditRouter.get('/audit-logs', requirePermission('audit_logs:view'), async (req, res) => {
  res.json(await listAudit(getAuth(req), parseQuery(listAuditQuerySchema, req)))
})

auditRouter.get(
  '/audit-logs/csv',
  requirePermission('audit_logs:view', 'audit_logs:export'),
  async (req, res) => {
    const auth = getAuth(req)
    const q = parseQuery(listAuditQuerySchema, req)
    const rows = await exportAudit(auth, q)
    // Exporting the audit trail is itself audited.
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: q.restaurantId ?? null,
        actorId: auth.userId,
        action: 'audit.exported',
        entityType: 'REPORT',
        metadata: { rows: rows.length, filters: { ...q, page: undefined, pageSize: undefined } },
      },
      req,
    )
    const csv = toCsv(
      [
        'time',
        'action',
        'entityType',
        'entityId',
        'actor',
        'restaurant',
        'oldValue',
        'newValue',
        'metadata',
        'ip',
        'requestId',
      ],
      rows.map((a) => [
        a.createdAt,
        a.action,
        a.entityType,
        a.entityId,
        a.actor ? fullName(a.actor) : '',
        a.restaurant?.name ?? '',
        a.oldValue == null ? '' : JSON.stringify(a.oldValue),
        a.newValue == null ? '' : JSON.stringify(a.newValue),
        a.metadata == null ? '' : JSON.stringify(a.metadata),
        a.ip,
        a.requestId,
      ]),
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"')
    res.setHeader('Cache-Control', 'no-store')
    res.send(csv)
  },
)

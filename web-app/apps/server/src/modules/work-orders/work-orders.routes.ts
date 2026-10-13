import {
  assignWorkOrderSchema,
  cancelWorkOrderSchema,
  completeWorkOrderSchema,
  createWorkOrderSchema,
  holdWorkOrderSchema,
  idParamSchema,
  manualTimeSchema,
  rescheduleWorkOrderSchema,
  uploadMetaSchema,
  listWorkOrdersQuerySchema,
  messageSchema,
  rejectWorkOrderSchema,
  reopenWorkOrderSchema,
  stepAnswerSchema,
  reservePartSchema,
  rootCauseSchema,
  useWorkOrderPartSchema,
  updateWorkOrderSchema,
  verifyWorkOrderSchema,
  workOrderCostSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { parseUploads } from '../../core/attachments.js'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { createRateLimiter } from '../../middleware/security.js'
import * as service from './work-orders.service.js'

const uploadLimiter = createRateLimiter({ windowMs: 60_000, limit: 30 })

/*
 * Every action route re-checks permission, restaurant scope and ownership in
 * the service (computeActions), so the UI's buttons are never the only guard.
 */
export const workOrdersRouter = Router()
workOrdersRouter.use('/work-orders', ...requireAuth())

const checklistParamsSchema = z.object({ id: z.uuid(), itemId: z.uuid() })

const view = requirePermission('work_orders:view')

workOrdersRouter.get('/work-orders', view, async (req, res) => {
  res.json(await service.listWorkOrders(getAuth(req), parseQuery(listWorkOrdersQuerySchema, req)))
})

/** Who can take the job, with their current open work (shown before assigning). */
workOrdersRouter.get(
  '/work-orders/workload',
  requirePermission('work_orders:assign'),
  async (req, res) => {
    const { restaurantId } = parseQuery(z.object({ restaurantId: z.uuid() }), req)
    sendData(res, await service.assigneeWorkload(getAuth(req), restaurantId))
  },
)

workOrdersRouter.get('/work-orders/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getWorkOrder(getAuth(req), id))
})

workOrdersRouter.post('/work-orders', requirePermission('work_orders:create'), async (req, res) => {
  sendCreated(
    res,
    await service.createWorkOrder(getAuth(req), parseBody(createWorkOrderSchema, req), req),
  )
})

workOrdersRouter.put(
  '/work-orders/:id',
  requirePermission('work_orders:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.updateWorkOrder(getAuth(req), id, parseBody(updateWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/assign',
  requirePermission('work_orders:assign'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.assignWorkOrder(getAuth(req), id, parseBody(assignWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/unassign',
  requirePermission('work_orders:assign'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(res, await service.unassignWorkOrder(getAuth(req), id, req))
  },
)

workOrdersRouter.post('/work-orders/:id/start', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.startWorkOrder(getAuth(req), id, req))
})

workOrdersRouter.post('/work-orders/:id/hold', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.holdWorkOrder(getAuth(req), id, parseBody(holdWorkOrderSchema, req), req),
  )
})

workOrdersRouter.post('/work-orders/:id/resume', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.resumeWorkOrder(getAuth(req), id, req))
})

workOrdersRouter.post(
  '/work-orders/:id/complete',
  requirePermission('work_orders:complete'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.completeWorkOrder(
        getAuth(req),
        id,
        parseBody(completeWorkOrderSchema, req),
        req,
      ),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/publish',
  requirePermission('work_orders:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(res, await service.publishWorkOrder(getAuth(req), id, req))
  },
)

workOrdersRouter.post(
  '/work-orders/:id/verify',
  requirePermission('work_orders:approve'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.verifyWorkOrder(getAuth(req), id, parseBody(verifyWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/reject',
  requirePermission('work_orders:approve'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.rejectWorkOrder(getAuth(req), id, parseBody(rejectWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/cancel',
  requirePermission('work_orders:close'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.cancelWorkOrder(getAuth(req), id, parseBody(cancelWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/costs',
  requirePermission('work_orders:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.addCostLine(getAuth(req), id, parseBody(workOrderCostSchema, req), req),
    )
  },
)

workOrdersRouter.delete(
  '/work-orders/:id/costs/:costId',
  requirePermission('work_orders:edit'),
  async (req, res) => {
    const { id, costId } = parseParams(z.object({ id: z.uuid(), costId: z.uuid() }), req)
    sendData(res, await service.removeCostLine(getAuth(req), id, costId, req))
  },
)

workOrdersRouter.post(
  '/work-orders/:id/reopen',
  requirePermission('work_orders:approve'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.reopenWorkOrder(getAuth(req), id, parseBody(reopenWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/messages',
  requirePermission('messages:create'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(res, await service.addMessage(getAuth(req), id, parseBody(messageSchema, req), req))
  },
)

workOrdersRouter.post(
  '/work-orders/:id/attachments',
  uploadLimiter,
  view,
  parseUploads,
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.uploadAttachments(
        getAuth(req),
        id,
        req.files as Express.Multer.File[],
        parseBody(uploadMetaSchema, req),
        req,
      ),
    )
  },
)

/** A photo or signature for one checklist step. */
workOrdersRouter.post(
  '/work-orders/:id/checklist/:itemId/attachments',
  uploadLimiter,
  view,
  parseUploads,
  async (req, res) => {
    const { id, itemId } = parseParams(checklistParamsSchema, req)
    sendData(
      res,
      await service.uploadStepAttachment(
        getAuth(req),
        id,
        itemId,
        req.files as Express.Multer.File[],
        req,
      ),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/time',
  requirePermission('work_orders:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.addManualTime(getAuth(req), id, parseBody(manualTimeSchema, req), req),
    )
  },
)

workOrdersRouter.delete(
  '/work-orders/:id/time/:entryId',
  requirePermission('work_orders:edit'),
  async (req, res) => {
    const { id, entryId } = parseParams(z.object({ id: z.uuid(), entryId: z.uuid() }), req)
    sendData(res, await service.removeManualTime(getAuth(req), id, entryId, req))
  },
)

workOrdersRouter.post(
  '/work-orders/:id/schedule',
  requirePermission('work_orders:assign'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.rescheduleWorkOrder(
        getAuth(req),
        id,
        parseBody(rescheduleWorkOrderSchema, req),
        req,
      ),
    )
  },
)

workOrdersRouter.put('/work-orders/:id/checklist/:itemId', view, async (req, res) => {
  const { id, itemId } = parseParams(checklistParamsSchema, req)
  sendData(
    res,
    await service.answerChecklistItem(getAuth(req), id, itemId, parseBody(stepAnswerSchema, req)),
  )
})

workOrdersRouter.post('/work-orders/:id/parts', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.useWorkOrderPart(getAuth(req), id, parseBody(useWorkOrderPartSchema, req), req),
  )
})

workOrdersRouter.get('/work-orders/:id/people', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.mentionablePeople(getAuth(req), id))
})

workOrdersRouter.put('/work-orders/:id/root-cause', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.saveRootCause(getAuth(req), id, parseBody(rootCauseSchema, req), req))
})

workOrdersRouter.post(
  '/work-orders/:id/messages/:messageId/attachments',
  uploadLimiter,
  view,
  parseUploads,
  async (req, res) => {
    const { id, messageId } = parseParams(z.object({ id: z.uuid(), messageId: z.uuid() }), req)
    sendData(
      res,
      await service.uploadMessageAttachments(
        getAuth(req),
        id,
        messageId,
        req.files as Express.Multer.File[] | undefined,
        req,
      ),
    )
  },
)

workOrdersRouter.post('/work-orders/:id/reservations', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.reservePart(getAuth(req), id, parseBody(reservePartSchema, req), req))
})

workOrdersRouter.delete('/work-orders/:id/reservations/:reservationId', view, async (req, res) => {
  const { id, reservationId } = parseParams(
    z.object({ id: z.uuid(), reservationId: z.uuid() }),
    req,
  )
  sendData(res, await service.releaseReservation(getAuth(req), id, reservationId, req))
})

workOrdersRouter.delete('/work-orders/:id/parts/:lineId', view, async (req, res) => {
  const { id, lineId } = parseParams(z.object({ id: z.uuid(), lineId: z.uuid() }), req)
  sendData(res, await service.removeWorkOrderPart(getAuth(req), id, lineId, req))
})

import {
  meterRuleFires,
  type AutomationAction,
  type AutomationConditions,
  type AutomationTrigger,
  type Priority,
  type WorkOrderCategory,
  type WorkOrderType,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { recordAudit } from './audit.js'
import { copyStepsToWorkOrder } from './checklist.js'
import { nextCode } from './counters.js'
import { logger } from './logger.js'
import { notify, usersWithPermission } from './notify.js'
import { prisma } from './prisma.js'
import { dispatchWebhooks } from '../modules/integrations/webhooks.service.js'

/*
 * IF <trigger> AND <conditions> THEN <actions>.
 *
 * Every event that can trigger an automation calls runAutomations() after its
 * own transaction has committed. The engine never throws: a broken rule is
 * logged (automation_logs + server log) and the user's action still succeeds.
 * Work orders created by an automation don't trigger WORK_ORDER_CREATED rules
 * again, so rules can't loop.
 */

export interface AutomationContext {
  organizationId: string
  restaurantId: string
  /** Subject of the event. */
  workOrderId?: string
  requestId?: string
  inspectionId?: string
  partId?: string
  assetId?: string | null
  meter?: { id: string; name: string; unit: string; previous: number | null; value: number }
  /** Facts the conditions look at. */
  priority?: Priority
  category?: WorkOrderCategory
  type?: WorkOrderType
  /** A short human description used in notifications ("WO-000012 · Fridge not cooling"). */
  label: string
  /** Set when the event was itself caused by an automation. */
  fromAutomation?: boolean
}

type Rule = Prisma.AutomationGetPayload<object>

function matches(rule: Rule, ctx: AutomationContext): boolean {
  const c = (rule.conditions ?? {}) as AutomationConditions
  if (c.priorities?.length && (!ctx.priority || !c.priorities.includes(ctx.priority))) return false
  if (c.categories?.length && (!ctx.category || !c.categories.includes(ctx.category))) return false
  if (c.types?.length && (!ctx.type || !c.types.includes(ctx.type))) return false
  if (c.assetId && ctx.assetId !== c.assetId) return false
  if (rule.trigger === 'METER_READING') {
    if (!ctx.meter || c.meterId !== ctx.meter.id) return false
    if (!c.meterOperator || c.meterValue === undefined) return false
    return meterRuleFires(c.meterOperator, c.meterValue, ctx.meter.previous, ctx.meter.value)
  }
  return true
}

function subjectUrl(ctx: AutomationContext): string | null {
  if (ctx.workOrderId) return `/work-orders/${ctx.workOrderId}`
  if (ctx.requestId) return `/requests?highlight=${ctx.requestId}`
  if (ctx.inspectionId) return `/inspections/${ctx.inspectionId}`
  if (ctx.partId) return `/inventory/parts/${ctx.partId}`
  if (ctx.assetId) return `/assets/${ctx.assetId}`
  return null
}

async function assigneesOf(workOrderId: string): Promise<string[]> {
  const w = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { assignedUserId: true, assignedTeamId: true },
  })
  if (!w) return []
  if (w.assignedUserId) return [w.assignedUserId]
  if (!w.assignedTeamId) return []
  const members = await prisma.teamMember.findMany({
    where: { teamId: w.assignedTeamId },
    select: { userId: true },
  })
  return members.map((m) => m.userId)
}

/** Runs one action; returns a short description for the log. */
async function runAction(rule: Rule, a: AutomationAction, ctx: AutomationContext): Promise<string> {
  const org = ctx.organizationId
  switch (a.type) {
    case 'NOTIFY': {
      const to =
        a.recipients === 'MANAGERS'
          ? await usersWithPermission(org, ctx.restaurantId, 'work_orders:assign')
          : a.recipients === 'STOCK_KEEPERS'
            ? await usersWithPermission(org, ctx.restaurantId, 'inventory:edit')
            : a.recipients === 'ASSIGNEE'
              ? ctx.workOrderId
                ? await assigneesOf(ctx.workOrderId)
                : []
              : a.userId
                ? [a.userId]
                : []
      await notify(to, {
        organizationId: org,
        type: 'AUTOMATION',
        title: rule.name,
        body: [a.message, ctx.label].filter(Boolean).join(' · ').slice(0, 300),
        entityType: ctx.workOrderId ? 'WORK_ORDER' : 'AUTOMATION',
        entityId: ctx.workOrderId ?? rule.id,
        actionUrl: subjectUrl(ctx) ?? '/automations',
        priority: ctx.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
      })
      return `notified ${to.length}`
    }
    case 'CREATE_WORK_ORDER': {
      const assignedUserId = a.assignedUserId ?? null
      const assignedTeamId = assignedUserId ? null : (a.assignedTeamId ?? null)
      const status = assignedUserId || assignedTeamId ? 'ASSIGNED' : 'OPEN'
      const wo = await prisma.$transaction(async (tx) => {
        const code = await nextCode(tx, org, 'WO', 6)
        const created = await tx.workOrder.create({
          data: {
            organizationId: org,
            code,
            title: a.title.slice(0, 200),
            description: `Created by automation “${rule.name}” · ${ctx.label}`.slice(0, 5000),
            type: a.workType,
            category: a.category,
            priority: a.priority,
            status,
            restaurantId: ctx.restaurantId,
            assetId: ctx.assetId ?? null,
            assignedUserId,
            assignedTeamId,
            procedureId: a.procedureId ?? null,
            dueDate: a.dueInHours ? new Date(Date.now() + a.dueInHours * 3_600_000) : null,
            createdById: rule.createdById,
          },
          select: { id: true, code: true, title: true },
        })
        if (a.procedureId) await copyStepsToWorkOrder(tx, a.procedureId, created.id)
        await tx.workOrderStatusHistory.create({
          data: { workOrderId: created.id, toStatus: 'OPEN', note: `Automation: ${rule.name}` },
        })
        if (status !== 'OPEN')
          await tx.workOrderStatusHistory.create({
            data: { workOrderId: created.id, fromStatus: 'OPEN', toStatus: status },
          })
        await recordAudit(
          {
            organizationId: org,
            restaurantId: ctx.restaurantId,
            actorId: null,
            action: 'work_order.created',
            entityType: 'WORK_ORDER',
            entityId: created.id,
            newValue: { code, title: created.title, status },
            metadata: { automationId: rule.id, automation: rule.name },
          },
          undefined,
          tx,
        )
        return created
      })
      const crew = assignedUserId
        ? [assignedUserId]
        : assignedTeamId
          ? await assigneesOf(wo.id)
          : await usersWithPermission(org, ctx.restaurantId, 'work_orders:assign')
      await notify(crew, {
        organizationId: org,
        type: assignedUserId || assignedTeamId ? 'TASK_ASSIGNED' : 'AUTOMATION',
        title: `${wo.code} · ${wo.title}`,
        body: `Created by automation “${rule.name}”`,
        entityType: 'WORK_ORDER',
        entityId: wo.id,
        actionUrl: `/work-orders/${wo.id}`,
        priority: a.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
      })
      return `created ${wo.code}`
    }
    case 'SET_PRIORITY': {
      if (!ctx.workOrderId) return 'no work order'
      const before = await prisma.workOrder.findUnique({
        where: { id: ctx.workOrderId },
        select: { priority: true },
      })
      if (!before || before.priority === a.priority) return 'priority unchanged'
      await prisma.workOrder.update({
        where: { id: ctx.workOrderId },
        data: { priority: a.priority },
      })
      await recordAudit({
        organizationId: org,
        restaurantId: ctx.restaurantId,
        actorId: null,
        action: 'work_order.priority_changed',
        entityType: 'WORK_ORDER',
        entityId: ctx.workOrderId,
        oldValue: { priority: before.priority },
        newValue: { priority: a.priority },
        metadata: { automationId: rule.id, automation: rule.name },
      })
      return `priority ${a.priority}`
    }
    case 'ASSIGN': {
      if (!ctx.workOrderId) return 'no work order'
      const w = await prisma.workOrder.findUnique({
        where: { id: ctx.workOrderId },
        select: {
          status: true,
          code: true,
          title: true,
          assignedUserId: true,
          assignedTeamId: true,
        },
      })
      if (!w || !['OPEN', 'ASSIGNED', 'SCHEDULED'].includes(w.status)) return 'not assignable'
      const userId = a.userId ?? null
      const teamId = userId ? null : (a.teamId ?? null)
      await prisma.$transaction(async (tx) => {
        await tx.workOrder.update({
          where: { id: ctx.workOrderId },
          data: {
            assignedUserId: userId,
            assignedTeamId: teamId,
            ...(w.status === 'OPEN' ? { status: 'ASSIGNED' } : {}),
          },
        })
        if (w.status === 'OPEN')
          await tx.workOrderStatusHistory.create({
            data: {
              workOrderId: ctx.workOrderId!,
              fromStatus: 'OPEN',
              toStatus: 'ASSIGNED',
              note: `Automation: ${rule.name}`,
            },
          })
        await recordAudit(
          {
            organizationId: org,
            restaurantId: ctx.restaurantId,
            actorId: null,
            action: 'work_order.assigned',
            entityType: 'WORK_ORDER',
            entityId: ctx.workOrderId,
            oldValue: { userId: w.assignedUserId, teamId: w.assignedTeamId },
            newValue: { userId, teamId },
            metadata: { automationId: rule.id, automation: rule.name },
          },
          undefined,
          tx,
        )
      })
      await notify(await assigneesOf(ctx.workOrderId), {
        organizationId: org,
        type: 'TASK_ASSIGNED',
        title: `${w.code} · ${w.title}`,
        body: `Assigned by automation “${rule.name}”`,
        entityType: 'WORK_ORDER',
        entityId: ctx.workOrderId,
        actionUrl: `/work-orders/${ctx.workOrderId}`,
      })
      return 'assigned'
    }
  }
}

/** Runs every active rule for the trigger that matches the event. Never throws. */
export async function runAutomations(
  trigger: AutomationTrigger,
  ctx: AutomationContext,
): Promise<number> {
  // Integrations hear about every event, including automation-made work.
  await dispatchWebhooks(trigger, { ...ctx })
  if (trigger === 'WORK_ORDER_CREATED' && ctx.fromAutomation) return 0
  try {
    const rules = await prisma.automation.findMany({
      where: {
        organizationId: ctx.organizationId,
        trigger,
        active: true,
        archivedAt: null,
        OR: [{ restaurantId: null }, { restaurantId: ctx.restaurantId }],
      },
      orderBy: { createdAt: 'asc' },
    })
    let ran = 0
    for (const rule of rules) {
      if (!matches(rule, ctx)) continue
      const done: string[] = []
      let failed: string | null = null
      for (const action of (rule.actions ?? []) as AutomationAction[]) {
        try {
          done.push(await runAction(rule, action, ctx))
        } catch (err) {
          failed = err instanceof Error ? err.message : String(err)
          logger.error({ err, automationId: rule.id }, 'automation action failed')
          break
        }
      }
      await prisma.$transaction([
        prisma.automationLog.create({
          data: {
            automationId: rule.id,
            trigger,
            status: failed ? 'FAILED' : 'SUCCESS',
            entityType: ctx.workOrderId
              ? 'WORK_ORDER'
              : ctx.meter
                ? 'METER'
                : ctx.partId
                  ? 'PART'
                  : ctx.requestId
                    ? 'REQUEST'
                    : ctx.inspectionId
                      ? 'INSPECTION'
                      : null,
            entityId:
              ctx.workOrderId ??
              ctx.meter?.id ??
              ctx.partId ??
              ctx.requestId ??
              ctx.inspectionId ??
              null,
            message: [ctx.label, ...done, failed && `failed: ${failed}`]
              .filter(Boolean)
              .join(' · ')
              .slice(0, 1000),
          },
        }),
        prisma.automation.update({
          where: { id: rule.id },
          data: { runCount: { increment: 1 }, lastRunAt: new Date() },
        }),
      ])
      ran++
    }
    return ran
  } catch (err) {
    logger.error({ err, trigger }, 'automations failed')
    return 0
  }
}

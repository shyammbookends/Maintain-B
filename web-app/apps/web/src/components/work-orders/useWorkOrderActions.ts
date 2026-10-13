import type {
  AssignWorkOrderInput,
  CompleteWorkOrderInput,
  EvidenceStage,
  ManualTimeInput,
  MessageInput,
  RootCauseInput,
  StepAnswerInput,
  WorkOrderCostInput,
  WorkOrderDetail,
} from '@maintainx/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/toaster'
import { checklistApi } from '@/services/maintenance.service'
import { useApplyWorkOrder, workOrdersApi } from '@/services/work-orders.service'
import { isQueuedOffline, reportError } from '@/utils/errors'

export type WorkOrderDialog =
  | 'assign'
  | 'hold'
  | 'complete'
  | 'verify'
  | 'reject'
  | 'reopen'
  | 'cancel'
  | 'cost'
  | 'time'
  | 'reschedule'
  | null

/**
 * Runs work-order actions and keeps every screen in sync. Direct actions
 * (start, resume, unassign, publish) show their own errors; dialog actions
 * throw so the dialog can show the message inline.
 */
export function useWorkOrderActions(w: WorkOrderDetail | undefined) {
  const { t } = useTranslation()
  const apply = useApplyWorkOrder()
  const [dialog, setDialog] = useState<WorkOrderDialog>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const id = w?.id ?? ''

  const run = async (key: string, fn: () => Promise<WorkOrderDetail>, success: string) => {
    setBusy(key)
    try {
      await apply(await fn())
      toast.success(success)
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }
  const withApply = async (fn: () => Promise<WorkOrderDetail>, success: string) => {
    try {
      await apply(await fn())
    } catch (err) {
      // Offline: kept on the device and sent later. Close the dialog like a success,
      // otherwise a second tap queues the same change twice.
      if (isQueuedOffline(err)) {
        toast.info(t('offline.queued'))
        return
      }
      throw err
    }
    toast.success(success)
  }

  return {
    dialog,
    setDialog,
    busy,
    start: () => run('start', () => workOrdersApi.start(id), t('wo.started')),
    resume: () => run('resume', () => workOrdersApi.resume(id), t('wo.resumed')),
    unassign: () => run('unassign', () => workOrdersApi.unassign(id), t('wo.unassigned')),
    publish: () => run('publish', () => workOrdersApi.publish(id), t('wo.published')),
    assign: (v: AssignWorkOrderInput) =>
      withApply(() => workOrdersApi.assign(id, v), t('wo.assigned')),
    hold: (reason: string) => withApply(() => workOrdersApi.hold(id, { reason }), t('wo.onHold')),
    complete: (v: CompleteWorkOrderInput) =>
      withApply(
        () => workOrdersApi.complete(id, v),
        w?.completionCheck.verificationRequired === false ? t('wo.completedDone') : t('wo.completed'),
      ),
    verify: (note: string) => withApply(() => workOrdersApi.verify(id, { note }), t('wo.verified')),
    reject: (reason: string) =>
      withApply(() => workOrdersApi.reject(id, { reason }), t('wo.rejected')),
    reopen: (reason: string) =>
      withApply(() => workOrdersApi.reopen(id, { reason }), t('wo.reopened')),
    cancel: (reason: string) =>
      withApply(() => workOrdersApi.cancel(id, { reason }), t('wo.cancelled')),
    addCost: (v: WorkOrderCostInput) =>
      withApply(() => workOrdersApi.addCost(id, v), t('wo.costAdded')),
    removeCost: (costId: string) =>
      run(`cost:${costId}`, () => workOrdersApi.removeCost(id, costId), t('wo.costRemoved')),
    /** Posts a message; files go onto it once it exists. */
    message: async (input: MessageInput, files: File[] = []) => {
      const after = await workOrdersApi.message(id, input)
      const mine = after.messages.filter((m) => m.mine && m.body === input.body.trim()).at(-1)
      apply(mine && files.length ? await workOrdersApi.messageFiles(id, mine.id, files) : after)
    },
    rootCause: (v: RootCauseInput) =>
      withApply(() => workOrdersApi.rootCause(id, v), t('rca.saved')),
    upload: async (files: File[], stage?: EvidenceStage, caption?: string) =>
      apply(await workOrdersApi.upload(id, files, { stage, caption })),
    uploadStep: async (itemId: string, files: File[]) =>
      apply(await workOrdersApi.uploadStep(id, itemId, files)),
    addTime: (v: ManualTimeInput) =>
      withApply(() => workOrdersApi.addTime(id, v), t('wo.timeAdded')),
    reschedule: (scheduledStart: string) =>
      withApply(() => workOrdersApi.reschedule(id, { scheduledStart }), t('wo.rescheduled')),
    removeTime: (entryId: string) =>
      run(`time:${entryId}`, () => workOrdersApi.removeTime(id, entryId), t('wo.timeRemoved')),
    answer: async (itemId: string, input: StepAnswerInput) =>
      apply(await checklistApi.answer(id, itemId, input)),
  }
}

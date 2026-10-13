import type { WorkOrderDetail } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CompletionForm } from './CompletionForm'
import { AssignDialog, CostDialog, ReasonDialog, RescheduleDialog, TimeDialog } from './dialogs'
import type { useWorkOrderActions } from './useWorkOrderActions'

/** Every dialog a work-order screen can open; which one is open lives in `actions.dialog`. */
export function WorkOrderDialogs({
  workOrder: w,
  actions: a,
  large = false,
}: {
  workOrder: WorkOrderDetail
  actions: ReturnType<typeof useWorkOrderActions>
  /** Worker app: the report slides up from the bottom. */
  large?: boolean
}) {
  const { t } = useTranslation()
  const openFor = (d: NonNullable<typeof a.dialog>) => ({
    open: a.dialog === d,
    onOpenChange: (o: boolean) => a.setDialog(o ? d : null),
  })
  return (
    <>
      {w.actions.assign && (
        <AssignDialog {...openFor('assign')} workOrder={w} onSubmit={a.assign} />
      )}
      <ReasonDialog
        {...openFor('hold')}
        title={t('wo.holdTitle')}
        description={t('wo.holdBody')}
        label={t('wo.holdReason')}
        confirmLabel={t('wo.hold')}
        onSubmit={a.hold}
      />
      <Sheet {...openFor('complete')}>
        <SheetContent
          side={large ? 'bottom' : 'right'}
          className={large ? 'max-h-[92dvh]' : undefined}
        >
          <SheetHeader>
            <SheetTitle>
              {w.completionCheck.reportRequired ? t('completion.title') : t('completion.simpleTitle')}
            </SheetTitle>
            <SheetDescription>
              {w.completionCheck.reportRequired
                ? t('completion.body')
                : w.completionCheck.verificationRequired
                  ? t('completion.simpleBodyVerify')
                  : t('completion.simpleBody')}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {a.dialog === 'complete' && (
              <CompletionForm
                w={w}
                large={large}
                onCancel={() => a.setDialog(null)}
                onSubmit={async (v) => {
                  await a.complete(v)
                  a.setDialog(null)
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
      {w.actions.time && <TimeDialog {...openFor('time')} workOrder={w} onSubmit={a.addTime} />}
      {w.actions.reschedule && a.dialog === 'reschedule' && (
        <RescheduleDialog {...openFor('reschedule')} workOrder={w} onSubmit={a.reschedule} />
      )}
      <ReasonDialog
        {...openFor('verify')}
        title={t('wo.verifyTitle')}
        description={t('wo.verifyBody')}
        label={t('wo.verifyNote')}
        confirmLabel={t('wo.verify')}
        minLength={0}
        onSubmit={a.verify}
      />
      <ReasonDialog
        {...openFor('reject')}
        title={t('wo.rejectTitle')}
        description={t('wo.rejectBody')}
        label={t('wo.rejectReason')}
        confirmLabel={t('wo.rejectWork')}
        onSubmit={a.reject}
      />
      <ReasonDialog
        {...openFor('reopen')}
        title={t('wo.reopenTitle')}
        description={t('wo.reopenBody')}
        label={t('wo.reopenReason')}
        confirmLabel={t('wo.reopen')}
        onSubmit={a.reopen}
      />
      <ReasonDialog
        {...openFor('cancel')}
        title={t('wo.cancelTitle')}
        description={t('wo.cancelBody')}
        label={t('wo.cancelReason')}
        confirmLabel={t('wo.cancelWo')}
        tone="destructive"
        onSubmit={a.cancel}
      />
      {w.actions.costs && <CostDialog {...openFor('cost')} onSubmit={a.addCost} />}
    </>
  )
}

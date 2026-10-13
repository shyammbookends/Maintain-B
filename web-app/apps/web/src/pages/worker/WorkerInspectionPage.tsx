import type { InspectionDetail, StepAnswerInput } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { Checklist } from '@/components/checklists/Checklist'
import { checklistProgress } from '@/components/checklists/checklist-utils'
import { Callout } from '@/components/common/Callout'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState } from '@/components/common/ErrorState'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toaster'
import { BottomActionBar } from '@/components/worker/BottomActionBar'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { inspectionsApi, mxKeys, useInspection } from '@/services/maintenance.service'
import { reportError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

export function WorkerInspectionPage() {
  const { t } = useTranslation()
  const { inspectionId = '' } = useParams()
  const query = useInspection(inspectionId)
  if (query.isPending)
    return (
      <>
        <WorkerPageHeader title={t('nav.checklists')} backTo="/w/checklists" />
        <div className="grid gap-3 p-4" aria-busy="true">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </>
    )
  if (query.isError)
    return (
      <>
        <WorkerPageHeader title={t('nav.checklists')} backTo="/w/checklists" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  return <Runner ins={query.data} />
}

function Runner({ ins }: { ins: InspectionDetail }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [notes, setNotes] = useState(ins.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const progress = checklistProgress(ins.items)

  const apply = async (next: InspectionDetail) => {
    qc.setQueryData(mxKeys.inspection(next.id), next)
    await qc.invalidateQueries({ queryKey: ['inspections', 'list'] })
  }
  const answer = async (itemId: string, input: StepAnswerInput) =>
    apply(await inspectionsApi.answer(ins.id, itemId, input))
  const uploadStep = async (itemId: string, files: File[]) =>
    apply(await inspectionsApi.uploadStep(ins.id, itemId, files))

  async function submit() {
    setSubmitting(true)
    try {
      const done = await inspectionsApi.submit(ins.id, notes)
      await apply(done)
      await qc.invalidateQueries({ queryKey: ['work-orders'] })
      toast.success(
        done.failCount > 0
          ? t('inspections.submittedWithFails', { count: done.failCount })
          : t('inspections.submitted'),
      )
    } catch (err) {
      reportError(err, t)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <WorkerPageHeader
        title={ins.name}
        backTo="/w/checklists"
        actions={
          ins.can.submit ? (
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={t('inspections.discard')}
              onClick={() => setDiscarding(true)}
            >
              <Trash2 />
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 px-4 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-13 text-muted-foreground">
            <span className="tabular">{ins.code}</span> · {enumLabel(t, 'inspectionType', ins.type)}{' '}
            · {ins.restaurant.name}
          </p>
          <span className="text-13 text-muted-foreground tabular">
            {t('checklist.progress', { done: progress.answered, total: progress.total })}
          </span>
        </div>

        {ins.status === 'SUBMITTED' && (
          <Callout
            tone={ins.failCount > 0 ? 'warning' : 'success'}
            title={t('inspections.doneTitle')}
          >
            {t('inspections.summaryValue', {
              pass: ins.passCount,
              fail: ins.failCount,
              na: ins.naCount,
            })}
            {ins.failCount > 0 && ` ${t('inspections.followUpsCreated')}`}
          </Callout>
        )}

        <Checklist
          items={ins.items}
          editable={ins.can.answer}
          onAnswer={answer}
          onUpload={uploadStep}
          correctiveLinkBase={null}
        />

        {ins.can.submit ? (
          <div className="grid gap-1.5">
            <Label htmlFor="inspection-notes">
              {t('inspections.notes')}{' '}
              <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
            </Label>
            <Textarea
              id="inspection-notes"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        ) : (
          ins.notes && <p className="text-sm whitespace-pre-wrap">{ins.notes}</p>
        )}
      </div>

      {ins.can.submit && (
        <BottomActionBar
          hint={
            progress.requiredLeft > 0
              ? t('checklist.stepsLeft', { count: progress.requiredLeft })
              : undefined
          }
        >
          <Button
            size="xl"
            disabled={progress.requiredLeft > 0}
            loading={submitting}
            onClick={() => void submit()}
          >
            <Send aria-hidden /> {t('inspections.submit')}
          </Button>
        </BottomActionBar>
      )}

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        tone="destructive"
        title={t('inspections.discardTitle')}
        description={t('inspections.discardBody')}
        confirmLabel={t('inspections.discard')}
        onConfirm={async () => {
          try {
            await inspectionsApi.discard(ins.id)
            await qc.invalidateQueries({ queryKey: mxKeys.inspections })
            navigate('/w/checklists', { replace: true })
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

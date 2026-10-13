import { WORK_ORDER_ACTIVE_STATUSES, fullName, type WorkOrderDetail } from '@maintainx/shared'
import { CheckCircle2, Pause, Phone, Play, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { Checklist } from '@/components/checklists/Checklist'
import { checklistProgress } from '@/components/checklists/checklist-utils'
import { Callout } from '@/components/common/Callout'
import { ErrorState } from '@/components/common/ErrorState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BottomActionBar } from '@/components/worker/BottomActionBar'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { AttachmentGallery } from '@/components/work-orders/Attachments'
import { CompletionSummary } from '@/components/work-orders/CompletionSummary'
import { EvidencePanel } from '@/components/work-orders/EvidencePanel'
import { MessagesPanel } from '@/components/work-orders/Timeline'
import { WorkOrderDialogs } from '@/components/work-orders/WorkOrderDialogs'
import { WorkOrderParts } from '@/components/work-orders/WorkOrderParts'
import { useWorkOrderActions } from '@/components/work-orders/useWorkOrderActions'
import { useWorkOrder } from '@/services/work-orders.service'
import { cn } from '@/utils/cn'
import { LabelList } from '@/components/common/LabelChip'
import { DUE_TONE_CLASS, describeDue, formatDateTime, formatDuration } from '@/utils/format'
import { reporterName } from '@/utils/people'

/** One task: read it, start it, pause it, add photos and notes, complete it. */
export function WorkerTaskPage() {
  const { t } = useTranslation()
  const { taskId = '' } = useParams()
  const query = useWorkOrder(taskId)

  return query.isPending ? (
    <>
      <WorkerPageHeader title={t('nav.myTasks')} backTo="/w/tasks" />
      <div className="grid gap-3 p-4" aria-busy="true">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </>
  ) : query.isError ? (
    <>
      <WorkerPageHeader title={t('nav.myTasks')} backTo="/w/tasks" />
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        title={t('wo.taskNotFound')}
      />
    </>
  ) : (
    <Task w={query.data} />
  )
}

function Task({ w }: { w: WorkOrderDetail }) {
  const { t } = useTranslation()
  const a = useWorkOrderActions(w)
  const done = !(WORK_ORDER_ACTIVE_STATUSES as readonly string[]).includes(w.status)
  const due = w.dueDate && !done ? describeDue(w.dueDate, t) : null
  const progress = checklistProgress(w.checklist)
  const check = w.completionCheck
  const blockers =
    check.stepsLeft +
    Number(check.needsBeforePhoto) +
    Number(check.needsAfterPhoto) +
    check.subWorkOrdersOpen
  const where = [w.asset?.name, w.location?.name, w.restaurant.name].filter(Boolean).join(' · ')

  const primary = w.actions.start ? (
    <Button size="xl" loading={a.busy === 'start'} onClick={a.start}>
      <Play aria-hidden /> {t('wo.startTask')}
    </Button>
  ) : w.actions.resume ? (
    <Button size="xl" loading={a.busy === 'resume'} onClick={a.resume}>
      <Play aria-hidden /> {t('wo.resume')}
    </Button>
  ) : w.actions.complete ? (
    <>
      <Button variant="secondary" size="xl" onClick={() => a.setDialog('hold')}>
        <Pause aria-hidden /> {t('wo.hold')}
      </Button>
      <Button size="xl" onClick={() => a.setDialog('complete')}>
        <CheckCircle2 aria-hidden /> {t('wo.complete')}
      </Button>
    </>
  ) : null

  return (
    <>
      <WorkerPageHeader title={w.code} backTo="/w/tasks" />
      <div className="grid gap-5 px-4 py-4">
        <section className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="workOrderStatus" value={w.status} />
            {(w.priority === 'HIGH' || w.priority === 'CRITICAL') && (
              <StatusBadge kind="priority" value={w.priority} />
            )}
          </div>
          <h2 className="text-lg leading-snug font-semibold">{w.title}</h2>
          <LabelList labels={w.labels} />
          <p className="text-13 text-muted-foreground">
            {w.asset ? (
              <Link
                to={`/w/assets/${w.asset.id}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {where}
              </Link>
            ) : (
              where
            )}
          </p>
          {due && (
            <p className={cn('text-13 font-medium', DUE_TONE_CLASS[due.tone])}>{due.label}</p>
          )}
          {w.description && (
            <p className="text-sm whitespace-pre-wrap text-foreground/90">{w.description}</p>
          )}
          {(w.minutesWorked > 0 || w.timerRunning) && (
            <p className="flex items-center gap-1.5 text-13 text-muted-foreground">
              <Timer className="size-4" aria-hidden />
              <span className="tabular">
                {t('wo.timeWorkedValue', { time: formatDuration(w.minutesWorked) })}
              </span>
              {w.timerRunning && <span className="text-warning-fg">· {t('wo.timerRunning')}</span>}
            </p>
          )}
        </section>

        {w.status === 'ON_HOLD' && w.holdReason && (
          <Callout tone="warning" title={t('wo.onHoldBecause')}>
            {w.holdReason}
          </Callout>
        )}
        {w.status === 'REVIEW' && (
          <Callout tone="info" title={t('wo.sentForReview')}>
            {t('wo.sentForReviewBody')}
          </Callout>
        )}
        {w.status === 'REOPENED' && w.rejectionReason && (
          <Callout tone="danger" title={t('wo.reworkTitle')}>
            {w.rejectionReason}
          </Callout>
        )}
        {w.status === 'CANCELLED' && (
          <Callout tone="warning" title={t('wo.cancelledTitle')}>
            {w.cancelReason}
          </Callout>
        )}
        {w.scheduledStart && (w.status === 'SCHEDULED' || w.status === 'ASSIGNED') && (
          <Callout tone="info">
            {t('wo.plannedFor', { time: formatDateTime(w.scheduledStart) })}
          </Callout>
        )}
        {w.helpers.length > 0 && (
          <p className="text-13 text-muted-foreground">
            {t('wo.crew', {
              names: [w.assignedUser, ...w.helpers]
                .filter((p) => p !== null)
                .map((p) => fullName(p))
                .join(', '),
            })}
          </p>
        )}
        {(w.status === 'ASSIGNED' || w.status === 'SCHEDULED') &&
          w.assignedTeam &&
          !w.assignedUser && (
            <Callout tone="neutral">{t('wo.teamTaskHint', { team: w.assignedTeam.name })}</Callout>
          )}

        {w.sourceRequest && (
          <section className="grid gap-2 rounded-lg border p-3">
            <h3 className="text-sm font-semibold">
              {t('wo.reportedBy', { name: reporterName(t, w.sourceRequest) })}
            </h3>
            <p className="text-sm whitespace-pre-wrap">{w.sourceRequest.description}</p>
            <AttachmentGallery
              items={w.sourceRequest.attachments}
              className="grid grid-cols-3 gap-2"
            />
          </section>
        )}

        {w.checklist.length > 0 && (
          <section className="grid gap-3" aria-labelledby="task-checklist">
            <div className="flex items-baseline justify-between">
              <h3 id="task-checklist" className="text-sm font-semibold">
                {t('checklist.title')}
              </h3>
              <span className="text-13 text-muted-foreground tabular">
                {t('checklist.progress', { done: progress.answered, total: progress.total })}
              </span>
            </div>
            {!w.actions.checklist &&
              (WORK_ORDER_ACTIVE_STATUSES as readonly string[]).includes(w.status) && (
                <Callout tone="neutral">{t('checklist.startFirst')}</Callout>
              )}
            {w.actions.checklist && progress.failed > 0 && (
              <Callout tone="warning">
                {t('checklist.failedHint', { count: progress.failed })}
              </Callout>
            )}
            <Checklist
              items={w.checklist}
              editable={w.actions.checklist}
              onAnswer={a.answer}
              onUpload={a.uploadStep}
              correctiveLinkBase={null}
            />
          </section>
        )}

        {(w.parts.length > 0 || w.actions.parts || w.reservations.length > 0) && (
          <section className="grid gap-2" aria-labelledby="task-parts">
            <h3 id="task-parts" className="text-sm font-semibold">
              {t('woParts.title')}
            </h3>
            <WorkOrderParts w={w} large />
          </section>
        )}

        <section className="grid gap-2" aria-labelledby="task-photos">
          <h3 id="task-photos" className="text-sm font-semibold">
            {t('evidence.title')}
          </h3>
          <EvidencePanel w={w} upload={a.upload} large />
        </section>

        {w.completion && (
          <section className="grid gap-2 rounded-lg border p-3" aria-labelledby="task-report">
            <h3 id="task-report" className="text-sm font-semibold">
              {t('completion.reportTitle')}
            </h3>
            <CompletionSummary report={w.completion} />
          </section>
        )}

        {w.contacts.length > 0 && (
          <section className="grid gap-2" aria-labelledby="task-contacts">
            <h3 id="task-contacts" className="text-sm font-semibold">
              {t('wo.contacts')}
            </h3>
            <ul className="grid gap-2">
              {w.contacts.map((c) => (
                <li
                  key={`${c.role}-${c.name}`}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`wo.contactRole_${c.role}`)}
                    </span>
                  </span>
                  {c.phone && (
                    <Button asChild variant="secondary" size="sm">
                      <a href={`tel:${c.phone.replace(/\s/g, '')}`}>
                        <Phone aria-hidden /> {t('wo.call')}
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-2" aria-labelledby="task-notes">
          <h3 id="task-notes" className="text-sm font-semibold">
            {t('wo.messages')}
          </h3>
          <MessagesPanel
            messages={w.messages}
            canSend={w.actions.message}
            canInternal={w.actions.internalNotes}
            workOrderId={w.id}
            send={a.message}
          />
        </section>
      </div>

      {primary && (
        <BottomActionBar
          hint={
            w.actions.complete && blockers > 0
              ? t('completion.blockers', { count: blockers })
              : undefined
          }
        >
          {primary}
        </BottomActionBar>
      )}
      <WorkOrderDialogs workOrder={w} actions={a} large />
    </>
  )
}

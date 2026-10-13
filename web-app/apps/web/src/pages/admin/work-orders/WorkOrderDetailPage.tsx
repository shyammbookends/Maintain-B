import { fullName, type WorkOrderDetail } from '@maintainx/shared'
import {
  AlarmClock,
  Ban,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  ThumbsUp,
  Undo2,
  UserMinus,
  UserPlus,
  Printer,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { Checklist } from '@/components/checklists/Checklist'
import { checklistProgress } from '@/components/checklists/checklist-utils'
import { Callout } from '@/components/common/Callout'
import { DetailList } from '@/components/common/DetailList'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { AttachmentGallery } from '@/components/work-orders/Attachments'
import { CompletionSummary } from '@/components/work-orders/CompletionSummary'
import { EvidencePanel } from '@/components/work-orders/EvidencePanel'
import { CostPanel } from '@/components/work-orders/CostPanel'
import { RootCausePanel } from '@/components/work-orders/RootCausePanel'
import { HistoryList, MessagesPanel } from '@/components/work-orders/Timeline'
import { WorkOrderDialogs } from '@/components/work-orders/WorkOrderDialogs'
import { WorkOrderParts } from '@/components/work-orders/WorkOrderParts'
import { WorkOrderForm } from '@/components/work-orders/WorkOrderForm'
import { useWorkOrderActions } from '@/components/work-orders/useWorkOrderActions'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkOrder } from '@/services/work-orders.service'
import { formatDateTime, formatDuration } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { LabelList } from '@/components/common/LabelChip'
import { CustomFieldValues } from '@/components/common/CustomFieldInputs'
import { reporterName } from '@/utils/people'

export function WorkOrderDetailPage() {
  const { t } = useTranslation()
  const { workOrderId = '' } = useParams()
  const query = useWorkOrder(workOrderId)
  const back = { to: '/work-orders', label: t('wo.title') }

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title={t('wo.title')} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  }
  return <Detail w={query.data} back={back} />
}

function Detail({ w, back }: { w: WorkOrderDetail; back: { to: string; label: string } }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const navigate = useNavigate()
  const a = useWorkOrderActions(w)
  const [editing, setEditing] = useState(false)
  const [addingSub, setAddingSub] = useState(false)

  const buttons: Array<{
    key: string
    show: boolean
    label: string
    icon: LucideIcon
    onClick: () => void
    variant?: 'default' | 'secondary' | 'destructive'
  }> = [
    {
      key: 'publish',
      show: w.actions.publish,
      label: t('wo.publish'),
      icon: Send,
      onClick: a.publish,
      variant: 'default',
    },
    {
      key: 'verify',
      show: w.actions.verify,
      label: t('wo.verify'),
      icon: ThumbsUp,
      onClick: () => a.setDialog('verify'),
      variant: 'default',
    },
    {
      key: 'reject',
      show: w.actions.reject,
      label: t('wo.rejectWork'),
      icon: Undo2,
      onClick: () => a.setDialog('reject'),
    },
    {
      key: 'assign',
      show: w.actions.assign,
      label: w.assignedUser || w.assignedTeam ? t('wo.reassign') : t('wo.assign'),
      icon: UserPlus,
      onClick: () => a.setDialog('assign'),
      variant: w.status === 'OPEN' ? 'default' : 'secondary',
    },
    { key: 'start', show: w.actions.start, label: t('wo.start'), icon: Play, onClick: a.start },
    { key: 'resume', show: w.actions.resume, label: t('wo.resume'), icon: Play, onClick: a.resume },
    {
      key: 'complete',
      show: w.actions.complete,
      label: t('wo.complete'),
      icon: CheckCircle2,
      onClick: () => a.setDialog('complete'),
    },
    {
      key: 'hold',
      show: w.actions.hold,
      label: t('wo.hold'),
      icon: Pause,
      onClick: () => a.setDialog('hold'),
    },
    {
      key: 'reopen',
      show: w.actions.reopen,
      label: t('wo.reopen'),
      icon: RotateCcw,
      onClick: () => a.setDialog('reopen'),
    },
    {
      key: 'reschedule',
      show: w.actions.reschedule,
      label: t('wo.reschedule'),
      icon: CalendarClock,
      onClick: () => a.setDialog('reschedule'),
    },
    {
      key: 'unassign',
      show: w.actions.unassign,
      label: t('wo.unassign'),
      icon: UserMinus,
      onClick: a.unassign,
    },
    {
      key: 'edit',
      show: w.actions.edit,
      label: t('actions.edit'),
      icon: Pencil,
      onClick: () => setEditing(true),
    },
    {
      key: 'cancel',
      show: w.actions.cancel,
      label: t('wo.cancelWo'),
      icon: Ban,
      onClick: () => a.setDialog('cancel'),
      variant: 'destructive',
    },
  ]

  const assignee = w.assignedUser
    ? fullName(w.assignedUser)
    : w.assignedTeam
      ? t('wo.teamOption', { name: w.assignedTeam.name })
      : null
  const canAddSub = !w.parent && w.actions.edit && can('work_orders:create') && w.status !== 'DRAFT'

  return (
    <>
      <PageHeader
        back={back}
        title={w.title}
        meta={
          <>
            <span className="text-13 text-muted-foreground tabular">{w.code}</span>
            <StatusBadge kind="workOrderStatus" value={w.status} />
            {w.overdue && (
              <Badge tone="danger">
                <AlarmClock aria-hidden /> {t('wo.overdue')}
              </Badge>
            )}
            <StatusBadge kind="priority" value={w.priority} />
            <Badge tone="outline">{enumLabel(t, 'workOrderType', w.type)}</Badge>
            <LabelList labels={w.labels} />
            <Badge tone="outline">{enumLabel(t, 'workOrderCategory', w.category)}</Badge>
          </>
        }
        actions={
          <>
            {buttons
              .filter((b) => b.show)
              .map((b) => (
                <Button
                  key={b.key}
                  variant={b.variant ?? 'secondary'}
                  loading={a.busy === b.key}
                  onClick={b.onClick}
                >
                  <b.icon aria-hidden /> {b.label}
                </Button>
              ))}
            <Button variant="ghost" asChild>
              <Link to={`/work-orders/${w.id}/print`} target="_blank" rel="noreferrer">
                <Printer aria-hidden /> {t('print.open')}
              </Link>
            </Button>
          </>
        }
      />

      {w.status === 'DRAFT' && (
        <Callout tone="info" className="mb-4" title={t('wo.draftTitle')}>
          {t('wo.draftBody')}
        </Callout>
      )}
      {w.status === 'REVIEW' && w.actions.verify && (
        <Callout tone="info" className="mb-4" title={t('wo.reviewTitle')}>
          {t('wo.reviewBody')}
        </Callout>
      )}
      {w.status === 'REOPENED' && w.rejectionReason && (
        <Callout tone="danger" className="mb-4" title={t('wo.reworkTitle')}>
          {w.rejectionReason}
        </Callout>
      )}
      {w.status === 'ON_HOLD' && w.holdReason && (
        <Callout tone="warning" className="mb-4" title={t('wo.onHoldBecause')}>
          {w.holdReason}
        </Callout>
      )}
      {w.status === 'CANCELLED' && (
        <Callout tone="warning" className="mb-4" title={t('wo.cancelledTitle')}>
          {w.cancelReason}
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('wo.details')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              {w.description && <p className="mb-3 text-sm whitespace-pre-wrap">{w.description}</p>}
              <DetailList
                items={[
                  {
                    label: t('wo.parent'),
                    value: w.parent && (
                      <Link
                        to={`/work-orders/${w.parent.id}`}
                        className="text-primary hover:underline"
                      >
                        {w.parent.code} · {w.parent.title}
                      </Link>
                    ),
                    hidden: !w.parent,
                  },
                  { label: t('wo.fieldRestaurant'), value: w.restaurant.name },
                  { label: t('wo.fieldLocation'), value: w.location?.name },
                  {
                    label: t('wo.fieldAsset'),
                    value: w.asset && (
                      <Link to={`/assets/${w.asset.id}`} className="text-primary hover:underline">
                        {w.asset.name} · {w.asset.assetCode}
                      </Link>
                    ),
                  },
                  { label: t('wo.fieldAssignee'), value: assignee },
                  {
                    label: t('wo.fieldHelpers'),
                    value: w.helpers.map(fullName).join(', '),
                    hidden: w.helpers.length === 0,
                  },
                  {
                    label: t('wo.fieldSupervisor'),
                    value: w.supervisor ? fullName(w.supervisor) : t('wo.anySupervisor'),
                  },
                  {
                    label: t('wo.fieldVendor'),
                    value: w.vendor && (
                      <Link to={`/vendors/${w.vendor.id}`} className="text-primary hover:underline">
                        {w.vendor.name}
                      </Link>
                    ),
                    hidden: !w.vendor,
                  },
                  {
                    label: t('wo.fromSchedule'),
                    value: w.pmSchedule && (
                      <Link
                        to={`/maintenance/${w.pmSchedule.id}`}
                        className="text-primary hover:underline"
                      >
                        {w.pmSchedule.name}
                      </Link>
                    ),
                    hidden: !w.pmSchedule,
                  },
                  {
                    label: t('wo.fieldScheduledStart'),
                    value: w.scheduledStart && formatDateTime(w.scheduledStart),
                    hidden: !w.scheduledStart,
                  },
                  { label: t('wo.fieldDue'), value: w.dueDate && formatDateTime(w.dueDate) },
                  {
                    label: t('repeat.label'),
                    value: w.repeat && (
                      <span className="grid gap-0.5">
                        <span>
                          {t('repeat.summary', {
                            count: w.repeat.every,
                            unit: enumLabel(
                              t,
                              w.repeat.every === 1 ? 'repeatUnit' : 'repeatUnitPlural',
                              w.repeat.unit,
                            ),
                            basis: enumLabel(t, 'repeatBasis', w.repeat.basis),
                          })}
                        </span>
                        {w.repeatedBy && (
                          <Link
                            to={`/work-orders/${w.repeatedBy.id}`}
                            className="text-13 text-primary hover:underline"
                          >
                            {t('repeat.next', { code: w.repeatedBy.code })}
                          </Link>
                        )}
                      </span>
                    ),
                    hidden: !w.repeat && !w.repeatedFrom,
                  },
                  {
                    label: t('repeat.from'),
                    value: w.repeatedFrom && (
                      <Link
                        to={`/work-orders/${w.repeatedFrom.id}`}
                        className="text-primary hover:underline"
                      >
                        {w.repeatedFrom.code}
                      </Link>
                    ),
                    hidden: !w.repeatedFrom,
                  },
                  {
                    label: t('wo.fieldEstimate'),
                    value: w.estimatedMinutes && formatDuration(w.estimatedMinutes),
                  },
                  {
                    label: t('wo.timeWorked'),
                    value: (
                      <span className="tabular">
                        {formatDuration(w.minutesWorked)}
                        {w.timerRunning && (
                          <span className="ml-2 text-13 text-warning-fg">
                            {t('wo.timerRunning')}
                          </span>
                        )}
                      </span>
                    ),
                  },
                  {
                    label: t('wo.createdBy'),
                    value: `${fullName(w.createdBy)} · ${formatDateTime(w.createdAt)}`,
                  },
                  {
                    label: t('wo.completedAt'),
                    value: w.completedAt && formatDateTime(w.completedAt),
                    hidden: !w.completedAt,
                  },
                  {
                    label: t('wo.verifiedBy'),
                    value:
                      w.verifiedBy &&
                      `${fullName(w.verifiedBy)} · ${formatDateTime(w.verifiedAt!)}`,
                    hidden: !w.verifiedBy,
                  },
                  {
                    label: t('wo.reopenCount'),
                    value: w.reopenCount,
                    hidden: w.reopenCount === 0,
                  },
                ]}
              />
              <div className="mt-3">
                <CustomFieldValues entity="WORK_ORDER" values={w.customFields} />
              </div>
              {w.completionNotes && (
                <div className="mt-3 rounded-md bg-muted px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('wo.completionNotes')}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{w.completionNotes}</p>
                </div>
              )}
            </PanelBody>
          </Panel>

          {(w.children.length > 0 || canAddSub) && (
            <Panel>
              <PanelHeader className="flex items-center justify-between gap-2">
                <PanelTitle className="flex items-center gap-2">
                  <GitBranch className="size-4 text-muted-foreground" aria-hidden />
                  {t('wo.subWorkOrders')}
                  {w.subProgress.total > 0 && (
                    <span className="text-13 font-normal text-muted-foreground tabular">
                      {t('wo.subProgress', w.subProgress)}
                    </span>
                  )}
                </PanelTitle>
                {canAddSub && (
                  <Button size="sm" variant="secondary" onClick={() => setAddingSub(true)}>
                    <Plus aria-hidden /> {t('wo.addSub')}
                  </Button>
                )}
              </PanelHeader>
              <PanelBody>
                {w.subProgress.total > 0 && (
                  <div
                    className="mb-3 h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={w.subProgress.total}
                    aria-valuenow={w.subProgress.done}
                    aria-label={t('wo.subProgress', w.subProgress)}
                  >
                    <div
                      className="h-full rounded-full bg-success transition-[width] duration-(--duration-slow)"
                      style={{ width: `${(w.subProgress.done / w.subProgress.total) * 100}%` }}
                    />
                  </div>
                )}
                {w.children.length === 0 ? (
                  <p className="text-13 text-muted-foreground">{t('wo.noSubs')}</p>
                ) : (
                  <ul className="divide-y">
                    {w.children.map((c) => (
                      <li key={c.id}>
                        <Link
                          to={`/work-orders/${c.id}`}
                          className="flex items-center gap-3 py-2 text-sm hover:text-primary"
                        >
                          <span className="text-13 text-muted-foreground tabular">{c.code}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                          {c.assignedUser && (
                            <span className="hidden text-13 text-muted-foreground sm:inline">
                              {fullName(c.assignedUser)}
                            </span>
                          )}
                          <StatusBadge kind="workOrderStatus" value={c.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          )}

          {w.checklist.length > 0 && (
            <Panel>
              <PanelHeader className="flex items-center justify-between gap-2">
                <PanelTitle>
                  {w.procedure
                    ? t('checklist.titleWithProcedure', { name: w.procedure.name })
                    : t('checklist.title')}
                </PanelTitle>
                <span className="text-13 text-muted-foreground tabular">
                  {t('checklist.progress', {
                    done: checklistProgress(w.checklist).answered,
                    total: checklistProgress(w.checklist).total,
                  })}
                </span>
              </PanelHeader>
              <PanelBody>
                <Checklist
                  items={w.checklist}
                  editable={w.actions.checklist}
                  onAnswer={a.answer}
                  onUpload={a.uploadStep}
                />
              </PanelBody>
            </Panel>
          )}

          {(w.parts.length > 0 ||
            w.actions.parts ||
            w.actions.reserve ||
            w.reservations.length > 0) && (
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('woParts.title')}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <WorkOrderParts w={w} />
              </PanelBody>
            </Panel>
          )}

          {w.sourceRequest && (
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('wo.fromRequest', { code: w.sourceRequest.code })}</PanelTitle>
              </PanelHeader>
              <PanelBody className="grid gap-3">
                <p className="text-13 text-muted-foreground">
                  {t('wo.reportedBy', { name: reporterName(t, w.sourceRequest) })}
                </p>
                <p className="text-sm whitespace-pre-wrap">{w.sourceRequest.description}</p>
                <AttachmentGallery items={w.sourceRequest.attachments} />
              </PanelBody>
            </Panel>
          )}

          <Panel>
            <PanelHeader>
              <PanelTitle>{t('evidence.title')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <EvidencePanel w={w} upload={a.upload} />
            </PanelBody>
          </Panel>

          {w.completion && (
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('completion.reportTitle')}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <CompletionSummary report={w.completion} />
              </PanelBody>
            </Panel>
          )}
        </div>

        <div className="grid content-start gap-4">
          <CostPanel w={w} actions={a} />
          <RootCausePanel w={w} save={a.rootCause} />
          <Panel>
            <PanelHeader className="flex items-center justify-between gap-2">
              <PanelTitle>{t('wo.timeLog')}</PanelTitle>
              {w.actions.time && (
                <Button size="sm" variant="secondary" onClick={() => a.setDialog('time')}>
                  <Plus aria-hidden /> {t('wo.addTime')}
                </Button>
              )}
            </PanelHeader>
            <PanelBody>
              {w.timeEntries.length === 0 ? (
                <p className="text-13 text-muted-foreground">{t('wo.noTime')}</p>
              ) : (
                <ul className="divide-y text-sm">
                  {w.timeEntries.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{fullName(e.user)}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatDateTime(e.startedAt)}
                          {e.manual && ` · ${t('wo.timeManual')}`}
                          {e.note && ` · ${e.note}`}
                        </span>
                      </span>
                      <span className="font-medium tabular">
                        {e.minutes === null ? t('wo.timerRunning') : formatDuration(e.minutes)}
                      </span>
                      {e.manual && w.actions.time && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('wo.removeTime')}
                          loading={a.busy === `time:${e.id}`}
                          onClick={() => a.removeTime(e.id)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('wo.messages')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <MessagesPanel
                messages={w.messages}
                canSend={w.actions.message}
                canInternal={w.actions.internalNotes}
                workOrderId={w.id}
                send={a.message}
              />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('wo.history')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <HistoryList events={w.history} />
            </PanelBody>
          </Panel>
        </div>
      </div>

      <WorkOrderDialogs workOrder={w} actions={a} />

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('wo.editTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing && (
              <WorkOrderForm
                workOrder={w}
                onCancel={() => setEditing(false)}
                onDone={() => setEditing(false)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet open={addingSub} onOpenChange={setAddingSub}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('wo.addSub')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {addingSub && (
              <WorkOrderForm
                prefill={{
                  parent: { id: w.id, code: w.code, title: w.title },
                  restaurantId: w.restaurant.id,
                  locationId: w.location?.id ?? null,
                  category: w.category,
                  priority: w.priority,
                  type: w.type,
                }}
                onCancel={() => setAddingSub(false)}
                onDone={(sub) => {
                  setAddingSub(false)
                  navigate(`/work-orders/${sub.id}`)
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}

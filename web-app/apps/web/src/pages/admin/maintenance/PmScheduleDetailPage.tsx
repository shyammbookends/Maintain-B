import { fullName, type PmScheduleDetail } from '@maintainx/shared'
import { CalendarPlus, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { Can } from '@/components/common/Can'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { DetailList } from '@/components/common/DetailList'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { PmScheduleForm } from '@/components/maintenance/PmScheduleForm'
import { describeSchedule, meterNextDue, meterValue } from '@/components/maintenance/schedule-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation } from '@/hooks/useAdminQueries'
import { mxKeys, pmApi, usePmSchedule } from '@/services/maintenance.service'
import { workKeys } from '@/services/work-orders.service'
import { reportError } from '@/utils/errors'
import { formatDate, formatDateTime, formatDuration } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { ComplianceText } from './MaintenancePage'

export function PmScheduleDetailPage() {
  const { t } = useTranslation()
  const { scheduleId = '' } = useParams()
  const query = usePmSchedule(scheduleId)
  const back = { to: '/maintenance', label: t('pm.title') }

  if (query.isPending)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  if (query.isError)
    return (
      <>
        <PageHeader title={t('pm.title')} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  return <Detail s={query.data} back={back} />
}

/** Meter schedules: where the meter is now and the reading that creates the next job. */
function MeterStatus({ s }: { s: PmScheduleDetail }) {
  const { t } = useTranslation()
  const unit = s.meter?.unit ?? ''
  const next = meterNextDue(t, s)
  return (
    <div className="grid gap-2 text-sm">
      {s.active && next ? (
        <p className="flex items-center justify-between gap-2">
          <span className="font-medium tabular">{next}</span>
          <Badge tone="info">{t('pm.next')}</Badge>
        </p>
      ) : (
        <p className="text-13 text-muted-foreground">
          {!s.active && s.nextDueReading !== null ? t('pm.pausedHint') : t('pm.meterDone')}
        </p>
      )}
      <p className="text-13 text-muted-foreground tabular">
        {s.meter?.currentValue != null
          ? t('pm.currentReading', { value: meterValue(s.meter.currentValue), unit })
          : t('pm.noReadingYet')}
      </p>
      {s.lastTriggeredReading !== null && (
        <p className="text-13 text-muted-foreground tabular">
          {t('pm.lastTriggered', { value: meterValue(s.lastTriggeredReading), unit })}
        </p>
      )}
    </div>
  )
}

function Detail({ s, back }: { s: PmScheduleDetail; back: { to: string; label: string } }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const invalidate = [mxKeys.pm, workKeys.workOrders, ['dashboard']] as const
  const setActive = useInvalidatingMutation(
    (active: boolean) => pmApi.setActive(s.id, active),
    invalidate,
  )
  const generate = useInvalidatingMutation(() => pmApi.generate(s.id), invalidate)
  const meterBased = s.triggerType === 'METER'
  const archive = useInvalidatingMutation(() => pmApi.archive(s.id), invalidate)

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn()
      toast.success(success)
    } catch (err) {
      reportError(err, t)
    }
  }

  return (
    <>
      <PageHeader
        back={back}
        title={s.name}
        meta={
          <>
            {s.active ? (
              <Badge tone="success" dot>
                {t('pm.active')}
              </Badge>
            ) : (
              <Badge tone="outline">{t('pm.paused')}</Badge>
            )}
            <span className="text-13 text-muted-foreground">{describeSchedule(t, s)}</span>
          </>
        }
        actions={
          <>
            <Can permission="work_orders:create">
              {s.active && s.can.edit && (
                <Button
                  loading={generate.isPending}
                  onClick={() => void run(() => generate.mutateAsync(undefined), t('pm.generated'))}
                >
                  <CalendarPlus aria-hidden /> {t('pm.generateNow')}
                </Button>
              )}
            </Can>
            {s.can.edit && (
              <>
                <Button
                  variant="secondary"
                  loading={setActive.isPending}
                  onClick={() =>
                    void run(
                      () => setActive.mutateAsync(!s.active),
                      s.active ? t('pm.pausedToast') : t('pm.resumedToast'),
                    )
                  }
                >
                  {s.active ? <Pause aria-hidden /> : <Play aria-hidden />}
                  {s.active ? t('pm.pause') : t('pm.resume')}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden /> {t('actions.edit')}
                </Button>
              </>
            )}
            {s.can.delete && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('pm.archive')}
                onClick={() => setArchiving(true)}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('wo.details')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              {s.description && <p className="mb-3 text-sm whitespace-pre-wrap">{s.description}</p>}
              <DetailList
                items={[
                  { label: t('wo.fieldRestaurant'), value: s.restaurant.name },
                  {
                    label: t('wo.fieldAsset'),
                    value: s.asset && (
                      <Link to={`/assets/${s.asset.id}`} className="text-primary hover:underline">
                        {s.asset.name} · {s.asset.assetCode}
                      </Link>
                    ),
                  },
                  {
                    label: t('wo.fieldProcedure'),
                    value: s.procedure && (
                      <Link
                        to={`/procedures/${s.procedure.id}`}
                        className="text-primary hover:underline"
                      >
                        {s.procedure.name}
                      </Link>
                    ),
                  },
                  {
                    label: t('pm.fieldAssignee'),
                    value: s.assignedUser
                      ? fullName(s.assignedUser)
                      : s.assignedTeam
                        ? t('wo.teamOption', { name: s.assignedTeam.name })
                        : t('wo.notAssigned'),
                  },
                  {
                    label: t('wo.fieldCategory'),
                    value: enumLabel(t, 'workOrderCategory', s.category),
                  },
                  {
                    label: t('wo.fieldPriority'),
                    value: <StatusBadge kind="priority" value={s.priority} />,
                  },
                  {
                    label: t('wo.fieldEstimate'),
                    value: s.estimatedMinutes && formatDuration(s.estimatedMinutes),
                  },
                  ...(meterBased
                    ? [
                        {
                          label: t('pm.fieldMeter'),
                          value: s.meter && `${s.meter.name} (${s.meter.unit})`,
                        },
                      ]
                    : [
                        {
                          label: t('pm.fieldLead'),
                          value: t('pm.leadValue', { count: s.leadTimeDays }),
                        },
                        {
                          label: t('pm.runs'),
                          value: s.endDate
                            ? t('pm.runsBetween', {
                                from: formatDate(`${s.startDate}T00:00:00`),
                                to: formatDate(`${s.endDate}T00:00:00`),
                              })
                            : t('pm.runsFrom', { from: formatDate(`${s.startDate}T00:00:00`) }),
                        },
                      ]),
                  { label: t('pm.colCompliance'), value: <ComplianceText value={s.compliance} /> },
                ]}
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle>{t('pm.recent')}</PanelTitle>
            </PanelHeader>
            {s.recentWorkOrders.length === 0 ? (
              <PanelBody>
                <p className="text-13 text-muted-foreground">{t('pm.recentEmpty')}</p>
              </PanelBody>
            ) : (
              <ul className="divide-y">
                {s.recentWorkOrders.map((w) => (
                  <li key={w.id}>
                    <Link
                      to={`/work-orders/${w.id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="text-13 font-medium tabular">{w.code}</span>
                      <StatusBadge kind="workOrderStatus" value={w.status} />
                      <span className="text-13 text-muted-foreground">
                        {w.dueDate ? formatDateTime(w.dueDate) : '—'}
                      </span>
                      {w.onTime !== null && (
                        <span
                          className={`ml-auto text-xs font-medium ${w.onTime ? 'text-success-fg' : 'text-danger-fg'}`}
                        >
                          {w.onTime ? t('pm.onTime') : t('pm.late')}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel className="content-start">
          <PanelHeader>
            <PanelTitle>{t('pm.upcoming')}</PanelTitle>
          </PanelHeader>
          <PanelBody>
            {meterBased ? (
              <MeterStatus s={s} />
            ) : s.upcoming.length === 0 ? (
              <p className="text-13 text-muted-foreground">
                {s.active ? t('pm.ended') : t('pm.pausedHint')}
              </p>
            ) : (
              <ol className="grid gap-2">
                {s.upcoming.map((d, i) => (
                  <li key={d} className="flex items-center justify-between text-sm">
                    <span className="tabular">{formatDate(`${d}T00:00:00`)}</span>
                    {i === 0 && <Badge tone="info">{t('pm.next')}</Badge>}
                  </li>
                ))}
              </ol>
            )}
            {s.lastGeneratedAt && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('pm.lastGenerated', { time: formatDateTime(s.lastGeneratedAt) })}
              </p>
            )}
          </PanelBody>
        </Panel>
      </div>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('pm.editTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing && (
              <PmScheduleForm
                schedule={s}
                onCancel={() => setEditing(false)}
                onDone={() => setEditing(false)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        tone="destructive"
        title={t('pm.archiveTitle', { name: s.name })}
        description={t('pm.archiveBody')}
        confirmLabel={t('pm.archive')}
        onConfirm={async () => {
          try {
            await archive.mutateAsync(undefined)
            toast.success(t('pm.archived'))
            navigate('/maintenance', { replace: true })
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

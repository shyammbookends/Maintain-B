import type { InspectionTemplateDto } from '@maintainx/shared'
import { ChevronRight, ClipboardCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import {
  inspectionsApi,
  useInspectionTemplates,
  useInspections,
} from '@/services/maintenance.service'
import { useWorkerRestaurants } from '@/services/worker.service'
import { reportError } from '@/utils/errors'
import { formatRelative } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { TaskListSkeleton } from './WorkerTaskList'

/** Opening / closing / safety checklists the worker can run, plus their own recent runs. */
export function WorkerChecklistsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const restaurants = useWorkerRestaurants()
  const [picked, setPicked] = useState<string>('')
  const restaurantId = picked || restaurants.data?.[0]?.id || ''
  const templates = useInspectionTemplates({ restaurantId, active: 'true' }, !!restaurantId)
  const mine = useInspections({ mine: '1', pageSize: 10 })
  const [starting, setStarting] = useState<string | null>(null)

  async function start(tp: InspectionTemplateDto) {
    setStarting(tp.id)
    try {
      const ins = await inspectionsApi.start({ templateId: tp.id, restaurantId, assetId: '' })
      navigate(`/w/inspections/${ins.id}`)
    } catch (err) {
      reportError(err, t)
    } finally {
      setStarting(null)
    }
  }

  const running = mine.data?.data.filter((i) => i.status === 'IN_PROGRESS') ?? []
  const done = mine.data?.data.filter((i) => i.status === 'SUBMITTED') ?? []

  return (
    <>
      <WorkerPageHeader title={t('nav.checklists')} backTo="/w/more" />
      <div className="grid gap-5 px-4 py-4">
        {(restaurants.data?.length ?? 0) > 1 && (
          <div className="grid gap-1.5">
            <Label htmlFor="checklist-restaurant">{t('report.where')}</Label>
            <Select value={restaurantId} onValueChange={setPicked}>
              <SelectTrigger id="checklist-restaurant" className="h-12 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {restaurants.data!.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {running.length > 0 && (
          <section className="grid gap-2" aria-labelledby="running">
            <h2 id="running" className="text-sm font-semibold">
              {t('inspections.continue')}
            </h2>
            <ul className="grid gap-2">
              {running.map((i) => (
                <li key={i.id}>
                  <Link
                    to={`/w/inspections/${i.id}`}
                    className="flex items-center gap-3 rounded-lg border border-warning/50 px-4 py-3 active:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{i.name}</span>
                      <span className="block text-13 text-muted-foreground">
                        {i.restaurant.name} · {formatRelative(i.startedAt)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-2" aria-labelledby="start-new">
          <h2 id="start-new" className="text-sm font-semibold">
            {t('inspections.startNew')}
          </h2>
          {templates.isError ? (
            <ErrorState error={templates.error} onRetry={() => void templates.refetch()} compact />
          ) : !templates.data ? (
            <TaskListSkeleton count={2} />
          ) : templates.data.length === 0 ? (
            <div className="rounded-lg border">
              <EmptyState
                compact
                icon={ClipboardCheck}
                title={t('inspections.noTemplates')}
                description={t('inspections.noTemplatesBody')}
              />
            </div>
          ) : (
            <ul className="grid gap-2">
              {templates.data.map((tp) => (
                <li key={tp.id}>
                  <button
                    type="button"
                    disabled={!!starting}
                    onClick={() => void start(tp)}
                    className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left active:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{tp.name}</span>
                      <span className="block text-13 text-muted-foreground">
                        {enumLabel(t, 'inspectionType', tp.type)} ·{' '}
                        {t('procedures.stepCount', { count: tp.procedure.stepCount })}
                      </span>
                    </span>
                    {starting === tp.id ? (
                      <Spinner className="size-4" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {done.length > 0 && (
          <section className="grid gap-2" aria-labelledby="recent">
            <h2 id="recent" className="text-sm font-semibold">
              {t('inspections.recentMine')}
            </h2>
            <ul className="grid gap-2">
              {done.map((i) => (
                <li key={i.id}>
                  <Link
                    to={`/w/inspections/${i.id}`}
                    className="flex items-center gap-3 rounded-lg border px-4 py-3 active:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{i.name}</span>
                      <span className="block text-13 text-muted-foreground">
                        {formatRelative(i.submittedAt ?? i.startedAt)}
                      </span>
                    </span>
                    {i.failCount > 0 ? (
                      <StatusBadge kind="stepResult" value="FAIL" />
                    ) : (
                      <StatusBadge kind="stepResult" value="PASS" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {mine.isPending && <TaskListSkeleton count={1} />}
      </div>
    </>
  )
}

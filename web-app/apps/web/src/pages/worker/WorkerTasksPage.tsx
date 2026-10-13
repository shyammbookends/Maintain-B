import { PRIORITY, WORKER_TASK_VIEWS, type WorkerTaskView } from '@maintainx/shared'
import { AlarmClock, CalendarCheck, CheckCheck, History, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { FilterSelect } from '@/components/tables'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import {
  useWorkerRestaurants,
  useWorkerTasks,
  type WorkerTaskFilters,
} from '@/services/worker.service'
import { cn } from '@/utils/cn'
import { enumLabel } from '@/utils/i18n'
import { TaskListSkeleton, WorkerTaskList } from './WorkerTaskList'

function TaskView({ view, filters }: { view: WorkerTaskView; filters: WorkerTaskFilters }) {
  const { t } = useTranslation()
  const query = useWorkerTasks(view, filters)

  if (query.isPending) return <TaskListSkeleton />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />

  const tasks = query.data.pages.flatMap((p) => p.data)
  if (tasks.length === 0) {
    const empty = {
      today: { icon: CheckCheck, title: t('worker.allCaughtUp'), body: t('worker.noTasksToday') },
      upcoming: {
        icon: CalendarCheck,
        title: t('worker.emptyUpcoming'),
        body: t('worker.emptyUpcomingBody'),
      },
      overdue: { icon: AlarmClock, title: t('worker.emptyOverdue'), body: undefined },
      done: { icon: History, title: t('worker.emptyDone'), body: undefined },
    }[view]
    return <EmptyState icon={empty.icon} title={empty.title} description={empty.body} />
  }

  return (
    <div className="grid gap-3">
      <WorkerTaskList tasks={tasks} />
      {query.hasNextPage && (
        <Button
          variant="secondary"
          size="lg"
          onClick={() => void query.fetchNextPage()}
          loading={query.isFetchingNextPage}
        >
          {t('worker.loadMore')}
        </Button>
      )}
    </div>
  )
}

/** My Work: today / upcoming / overdue / done, narrowed by priority, restaurant or PM. */
export function WorkerTasksPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const restaurants = useWorkerRestaurants()
  const raw = params.get('view')
  const view: WorkerTaskView = WORKER_TASK_VIEWS.includes(raw as WorkerTaskView)
    ? (raw as WorkerTaskView)
    : 'today'
  const filters: WorkerTaskFilters = {
    priority: params.get('priority') ?? undefined,
    restaurantId: params.get('restaurantId') ?? undefined,
    pm: params.get('pm') === '1' ? '1' : undefined,
  }
  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const labels: Record<WorkerTaskView, string> = {
    today: t('worker.tabToday'),
    upcoming: t('worker.tabUpcoming'),
    overdue: t('worker.tabOverdue'),
    done: t('worker.tabDone'),
  }

  return (
    <>
      <WorkerPageHeader title={t('nav.myTasks')} />
      <Tabs
        value={view}
        onValueChange={(v) => setParam('view', v === 'today' ? undefined : v)}
        className="px-4 pt-2"
      >
        <TabsList className="w-full justify-start gap-4 overflow-x-auto">
          {WORKER_TASK_VIEWS.map((v) => (
            <TabsTrigger key={v} value={v} className="h-11 text-base">
              {labels[v]}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex flex-wrap gap-2 pt-3" role="group" aria-label={t('worker.filters')}>
          <FilterSelect
            label={t('wo.colPriority')}
            value={filters.priority}
            onChange={(v) => setParam('priority', v)}
            options={PRIORITY.map((p) => ({ value: p, label: enumLabel(t, 'priority', p) }))}
          />
          {(restaurants.data?.length ?? 0) > 1 && (
            <FilterSelect
              label={t('wo.colRestaurant')}
              value={filters.restaurantId}
              onChange={(v) => setParam('restaurantId', v)}
              options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
            />
          )}
          <button
            type="button"
            aria-pressed={filters.pm === '1'}
            onClick={() => setParam('pm', filters.pm ? undefined : '1')}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors',
              filters.pm ? 'border-primary bg-info-soft text-info-fg' : 'hover:bg-muted/60',
            )}
          >
            <Wrench className="size-4" aria-hidden /> {t('worker.pmOnly')}
          </button>
        </div>
        {WORKER_TASK_VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="pb-4">
            {v === view && <TaskView view={v} filters={filters} />}
          </TabsContent>
        ))}
      </Tabs>
    </>
  )
}

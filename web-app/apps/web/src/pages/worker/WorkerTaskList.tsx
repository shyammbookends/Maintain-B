import type { WorkerTask } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { TaskCard } from '@/components/worker/TaskCard'

/** Task cards for the worker app; each opens the task page. */
export function WorkerTaskList({ tasks, now }: { tasks: WorkerTask[]; now?: Date }) {
  const { t } = useTranslation()
  return (
    <ul className="stagger grid gap-2.5 md:grid-cols-2">
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskCard
            to={`/w/tasks/${task.id}`}
            code={task.code}
            title={task.title}
            restaurant={task.restaurant.name}
            location={task.location?.name}
            asset={task.asset?.name}
            priority={task.priority}
            status={task.status}
            dueDate={task.dueDate}
            note={task.team ? t('worker.viaTeam', { team: task.team.name }) : undefined}
            now={now}
          />
        </li>
      ))}
    </ul>
  )
}

export function TaskListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-2" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="grid gap-2 rounded-lg border p-4">
          <div className="flex justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

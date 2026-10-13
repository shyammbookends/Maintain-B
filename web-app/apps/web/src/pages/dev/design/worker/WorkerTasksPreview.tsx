import { CheckCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/common/EmptyState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TaskCard } from '@/components/worker/TaskCard'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { PREVIEW_TASKS, dueFromNow } from './preview-data'

export function WorkerTasksPreview() {
  const { t } = useTranslation()
  const now = new Date()

  return (
    <>
      <WorkerPageHeader title={t('nav.myTasks')} />
      <Tabs defaultValue="today" className="px-4 pt-2">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="done">Done</TabsTrigger>
        </TabsList>
        <TabsContent value="today" className="grid gap-2 pb-4">
          {PREVIEW_TASKS.slice(0, 2).map((task) => (
            <TaskCard
              key={task.id}
              to={`/design/worker/tasks/${task.id}`}
              code={task.code}
              title={task.title}
              restaurant={task.restaurant}
              location={task.location}
              asset={task.asset}
              priority={task.priority}
              status={task.status}
              dueDate={dueFromNow(task.dueInHours, now)}
              now={now}
            />
          ))}
        </TabsContent>
        <TabsContent value="upcoming" className="grid gap-2 pb-4">
          {PREVIEW_TASKS.slice(2).map((task) => (
            <TaskCard
              key={task.id}
              to={`/design/worker/tasks/${task.id}`}
              code={task.code}
              title={task.title}
              restaurant={task.restaurant}
              location={task.location}
              asset={task.asset}
              priority={task.priority}
              status={task.status}
              dueDate={dueFromNow(task.dueInHours, now)}
              now={now}
            />
          ))}
        </TabsContent>
        <TabsContent value="done">
          <EmptyState
            icon={CheckCheck}
            title={t('empty.allCaughtUp')}
            description={t('empty.noTasksToday')}
          />
        </TabsContent>
      </Tabs>
    </>
  )
}

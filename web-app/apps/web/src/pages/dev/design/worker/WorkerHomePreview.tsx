import { ArrowLeft, Megaphone } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TaskCard } from '@/components/worker/TaskCard'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { PREVIEW_TASKS, dueFromNow } from './preview-data'

export function WorkerHomePreview() {
  const now = new Date()
  const overdue = PREVIEW_TASKS.filter((t) => t.dueInHours < 0).length

  return (
    <>
      <WorkerPageHeader
        title="Good morning, Ramesh"
        actions={
          <Link
            to="/design"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-13 text-muted-foreground hover:bg-accent"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Gallery
          </Link>
        }
      />
      <div className="grid gap-5 px-4 py-4">
        <dl className="grid grid-cols-3 divide-x rounded-lg border">
          <div className="px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">Today</dt>
            <dd className="text-xl font-semibold tabular">{PREVIEW_TASKS.length}</dd>
          </div>
          <div className="px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">Overdue</dt>
            <dd className="text-xl font-semibold text-danger-fg tabular">{overdue}</dd>
          </div>
          <div className="px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">Done</dt>
            <dd className="text-xl font-semibold tabular">4</dd>
          </div>
        </dl>

        <Button size="xl" variant="secondary" className="w-full">
          <Megaphone /> Report a problem
        </Button>

        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">Next up</h2>
          {PREVIEW_TASKS.map((task) => (
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
        </section>
      </div>
    </>
  )
}

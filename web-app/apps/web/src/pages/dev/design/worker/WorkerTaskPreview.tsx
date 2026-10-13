import type { StepResult } from '@maintainx/shared'
import { Camera, Play } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { Callout } from '@/components/common/Callout'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toaster'
import { BottomActionBar } from '@/components/worker/BottomActionBar'
import { ResultToggle } from '@/components/worker/ResultToggle'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { cn } from '@/utils/cn'
import { DUE_TONE_CLASS, describeDue } from '@/utils/format'
import { PREVIEW_TASKS, dueFromNow } from './preview-data'

/** Gallery: the worker "open task → start → checklist → complete" screen, with local state only. */
export function WorkerTaskPreview() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { taskId } = useParams()
  const task = PREVIEW_TASKS.find((x) => x.id === taskId) ?? PREVIEW_TASKS[0]!

  const [started, setStarted] = useState(task.status === 'IN_PROGRESS')
  const [results, setResults] = useState<Record<number, StepResult>>({})
  const [completing, setCompleting] = useState(false)

  const answered = Object.keys(results).length
  const failed = Object.values(results).filter((r) => r === 'FAIL').length
  const allAnswered = answered === task.steps.length
  const due = describeDue(dueFromNow(task.dueInHours), t)

  return (
    <>
      <WorkerPageHeader title={task.code} backTo="/design/worker/tasks" />

      <div className="grid gap-5 px-4 py-4">
        <section className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="workOrderStatus" value={started ? 'IN_PROGRESS' : task.status} />
            <StatusBadge kind="priority" value={task.priority} />
          </div>
          <h2 className="text-lg leading-snug font-semibold">{task.title}</h2>
          <p className="text-13 text-muted-foreground">
            {task.asset} · {task.location} · {task.restaurant}
          </p>
          <p className={cn('text-13 font-medium', DUE_TONE_CLASS[due.tone])}>{due.label}</p>
          <p className="text-sm text-foreground/90">{task.description}</p>
        </section>

        {started ? (
          <>
            <section className="grid gap-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Checklist</h3>
                <span className="text-13 text-muted-foreground tabular">
                  {answered}/{task.steps.length}
                </span>
              </div>
              <ol className="grid gap-4">
                {task.steps.map((step, i) => (
                  <li key={step} className="grid gap-2">
                    <p id={`step-${i}`} className="text-sm font-medium">
                      {i + 1}. {step}
                    </p>
                    <ResultToggle
                      labelledBy={`step-${i}`}
                      value={results[i]}
                      onChange={(v) => setResults((prev) => ({ ...prev, [i]: v }))}
                    />
                  </li>
                ))}
              </ol>
              {failed > 0 && (
                <Callout tone="warning" title={`${failed} step${failed > 1 ? 's' : ''} failed`}>
                  A corrective work order will be suggested when you complete this task.
                </Callout>
              )}
            </section>

            <section className="grid gap-2">
              <Label htmlFor="task-notes">Notes</Label>
              <Textarea id="task-notes" rows={3} placeholder="What did you find and fix?" />
              <Button variant="secondary" size="lg" className="justify-start">
                <Camera /> Add photo
              </Button>
            </section>
          </>
        ) : (
          <Callout tone="neutral">Start the task to open its checklist and log your time.</Callout>
        )}
      </div>

      <BottomActionBar
        hint={
          started && !allAnswered
            ? `${task.steps.length - answered} checklist steps left`
            : undefined
        }
      >
        {started ? (
          <Button
            size="xl"
            disabled={!allAnswered}
            loading={completing}
            onClick={() => {
              setCompleting(true)
              setTimeout(() => {
                toast.success('Task completed — sent for review')
                navigate('/design/worker/tasks')
              }, 800)
            }}
          >
            Complete task
          </Button>
        ) : (
          <Button size="xl" onClick={() => setStarted(true)}>
            <Play /> Start task
          </Button>
        )}
      </BottomActionBar>
    </>
  )
}

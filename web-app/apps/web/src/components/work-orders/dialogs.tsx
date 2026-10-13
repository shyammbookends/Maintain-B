import {
  WORK_ORDER_COST_TYPE,
  fullName,
  type AssigneeWorkload,
  type AssignWorkOrderInput,
  type ManualTimeInput,
  type WorkOrderCostInput,
  type WorkOrderDetail,
} from '@maintainx/shared'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import {
  Form,
  FormActions,
  FormRootError,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { CheckboxListField } from '@/components/forms/CheckboxListField'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/AuthContext'
import { useTeams } from '@/hooks/useAdminQueries'
import { useVendorOptions } from '@/services/purchasing.service'
import { useAssigneeWorkload } from '@/services/work-orders.service'
import { cn } from '@/utils/cn'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'
import { NONE } from './WorkOrderForm'

interface DialogBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * One text box and a confirm button: hold reason, reopen reason, rejection
 * reason, closing note. `minLength` 0 makes the text optional.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  confirmLabel,
  minLength = 3,
  tone = 'default',
  onSubmit,
}: DialogBaseProps & {
  title: string
  description?: ReactNode
  label: string
  confirmLabel: string
  minLength?: number
  tone?: 'default' | 'destructive'
  onSubmit: (text: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const form = useZodForm(z.object({ text: z.string().trim().min(minLength).max(500) }), {
    defaultValues: { text: '' },
  })
  const { errors, isSubmitting } = form.formState
  const submit = form.handleSubmit(async ({ text }) => {
    try {
      await onSubmit(text)
      form.reset({ text: '' })
      onOpenChange(false)
    } catch (err) {
      form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <TextareaField
              control={form.control}
              name="text"
              label={label}
              required={minLength > 0}
              optional={minLength === 0}
              rows={3}
              maxLength={500}
            />
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button
                type="submit"
                variant={tone === 'destructive' ? 'destructive' : 'default'}
                loading={isSubmitting}
              >
                {confirmLabel}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Pick a person (or a team) from the work order's restaurant, seeing how busy
 * everyone is, plus extra technicians and a planned start.
 */
export function AssignDialog({
  open,
  onOpenChange,
  workOrder,
  onSubmit,
}: DialogBaseProps & {
  workOrder: WorkOrderDetail
  onSubmit: (v: AssignWorkOrderInput) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const workload = useAssigneeWorkload(workOrder.restaurant.id, open)
  const teams = useTeams()
  const ready = workload.data && teams.data
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('wo.assignTitle')}</DialogTitle>
          <DialogDescription>
            {workOrder.code} · {workOrder.restaurant.name}
          </DialogDescription>
        </DialogHeader>
        {ready ? (
          <AssignFormInner
            workOrder={workOrder}
            people={workload.data}
            teams={teams.data.filter(
              (tm) => !tm.restaurant || tm.restaurant.id === workOrder.restaurant.id,
            )}
            onCancel={() => onOpenChange(false)}
            onSubmit={async (v) => {
              await onSubmit(v)
              onOpenChange(false)
            }}
          />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </DialogContent>
    </Dialog>
  )
}

const assignForm = z.object({
  assignee: z.string().min(1, 'validation.assigneeRequired'),
  helperIds: z.array(z.string()),
  scheduledStart: z.string(),
})

const pad = (n: number) => String(n).padStart(2, '0')
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function AssignFormInner({
  workOrder: w,
  people,
  teams,
  onCancel,
  onSubmit,
}: {
  workOrder: WorkOrderDetail
  people: AssigneeWorkload[]
  teams: Array<{ id: string; name: string }>
  onCancel: () => void
  onSubmit: (v: AssignWorkOrderInput) => Promise<void>
}) {
  const { t } = useTranslation()
  const initial = w.assignedUser
    ? `user:${w.assignedUser.id}`
    : w.assignedTeam
      ? `team:${w.assignedTeam.id}`
      : ''
  const options = [
    ...people.map((p) => ({
      value: `user:${p.user.id}`,
      label: `${fullName(p.user)} · ${t('wo.workloadShort', {
        open: p.openCount,
        overdue: p.overdueCount,
      })}`,
    })),
    ...teams.map((tm) => ({
      value: `team:${tm.id}`,
      label: t('wo.teamOption', { name: tm.name }),
    })),
  ]
  const form = useZodForm(assignForm, {
    defaultValues: {
      assignee: options.some((o) => o.value === initial) ? initial : '',
      helperIds: w.helpers.map((h) => h.id).filter((id) => people.some((p) => p.user.id === id)),
      scheduledStart: toLocalInput(w.scheduledStart),
    },
  })
  const { errors, isSubmitting } = form.formState
  const assignee = form.watch('assignee')
  const userId = assignee.startsWith('user:') ? assignee.slice(5) : ''
  const settles =
    w.status === 'OPEN' ||
    w.status === 'ASSIGNED' ||
    w.status === 'SCHEDULED' ||
    w.status === 'DRAFT'

  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit({
        assignedUserId: userId,
        assignedTeamId: v.assignee.startsWith('team:') ? v.assignee.slice(5) : '',
        helperIds: v.helperIds.filter((h) => h !== userId),
        scheduledStart: v.scheduledStart ? new Date(v.scheduledStart).toISOString() : '',
      })
    } catch (err) {
      if (!applyServerErrors(form, err, { assignedUserId: 'assignee', assignedTeamId: 'assignee' }))
        form.setError('root', { message: describeError(err, t) })
    }
  })
  const leastBusy = [...people].sort((a, b) => a.openCount - b.openCount)[0]

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        {people.length > 0 && (
          <div className="rounded-lg border">
            <p className="border-b px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('wo.workloadTitle')}
            </p>
            <ul className="max-h-48 divide-y overflow-y-auto">
              {people.map((p) => {
                const selected = userId === p.user.id
                return (
                  <li key={p.user.id}>
                    <button
                      type="button"
                      onClick={() => form.setValue('assignee', `user:${p.user.id}`)}
                      aria-pressed={selected}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60',
                        selected && 'bg-info-soft',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{fullName(p.user)}</span>
                        {p.teams.length > 0 && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.teams.map((tm) => tm.name).join(', ')}
                          </span>
                        )}
                      </span>
                      <WorkloadMeter open={p.openCount} />
                      <span className="w-28 text-right text-xs text-muted-foreground tabular">
                        {t('wo.workloadShort', { open: p.openCount, overdue: p.overdueCount })}
                      </span>
                      {leastBusy?.user.id === p.user.id && people.length > 1 && (
                        <Badge tone="success">{t('wo.leastBusy')}</Badge>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <SelectField
          control={form.control}
          name="assignee"
          label={t('wo.fieldAssignee')}
          required
          placeholder={t('validation.selectOption')}
          description={t('wo.assigneeHint')}
          options={options}
        />
        {people.length > 1 && (
          <CheckboxListField
            control={form.control}
            name="helperIds"
            label={t('wo.fieldHelpers')}
            description={t('wo.helpersHint')}
            options={people
              .filter((p) => p.user.id !== userId)
              .map((p) => ({ value: p.user.id, label: fullName(p.user) }))}
          />
        )}
        {settles && (
          <TextField
            control={form.control}
            name="scheduledStart"
            type="datetime-local"
            label={t('wo.fieldScheduledStart')}
            description={t('wo.scheduledHint')}
            optional
          />
        )}
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('wo.assign')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

/** Five little bars: how much open work someone already has. */
function WorkloadMeter({ open }: { open: number }) {
  const level = Math.min(5, open)
  return (
    <span aria-hidden className="flex items-end gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            'w-1 rounded-sm',
            i <= level
              ? level >= 4
                ? 'bg-danger'
                : level >= 2
                  ? 'bg-warning'
                  : 'bg-success'
              : 'bg-muted',
          )}
          style={{ height: 4 + i * 2 }}
        />
      ))}
    </span>
  )
}

const costForm = z.object({
  type: z.enum(WORK_ORDER_COST_TYPE),
  description: z.string().trim().min(2).max(200),
  amount: z.number({ error: 'validation.required' }).positive().max(10_000_000),
  vendorId: z.string(),
})

/** Records a cost that isn't a part or logged time: vendor bill, materials, travel. */
export function CostDialog({
  open,
  onOpenChange,
  onSubmit,
}: DialogBaseProps & { onSubmit: (v: WorkOrderCostInput) => Promise<unknown> }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const vendors = useVendorOptions(undefined, open && can('vendors:view'))
  const form = useZodForm(costForm, {
    defaultValues: { type: 'VENDOR', description: '', amount: undefined, vendorId: NONE },
  })
  const { errors, isSubmitting } = form.formState
  const type = form.watch('type')
  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit({
        type: v.type,
        description: v.description,
        amount: Math.round(v.amount * 100) / 100,
        vendorId: v.vendorId === NONE ? '' : v.vendorId,
      })
      form.reset()
      onOpenChange(false)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wo.addCost')}</DialogTitle>
          <DialogDescription>{t('wo.costBody')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="type"
                label={t('wo.costType')}
                required
                options={WORK_ORDER_COST_TYPE.map((c) => ({
                  value: c,
                  label: enumLabel(t, 'workOrderCostType', c),
                }))}
              />
              <NumberField
                control={form.control}
                name="amount"
                label={t('wo.costAmount')}
                required
                min={0.01}
                step={0.01}
                suffix="₹"
              />
            </div>
            <TextField
              control={form.control}
              name="description"
              label={t('wo.costDescription')}
              placeholder={t('wo.costPlaceholder')}
              required
            />
            {type === 'VENDOR' && can('vendors:view') && (
              <SelectField
                control={form.control}
                name="vendorId"
                label={t('wo.fieldVendor')}
                options={[
                  { value: NONE, label: t('wo.noVendor') },
                  ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })),
                ]}
              />
            )}
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('wo.addCost')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

const timeForm = z.object({
  userId: z.string().min(1, 'validation.selectOption'),
  minutes: z.number({ error: 'validation.required' }).int().min(1).max(1440),
  startedAt: z.string().min(1, 'validation.required'),
  note: z.string().trim().min(3).max(300),
})

/** A manager records time by hand (forgotten timer, work done without the app). */
export function TimeDialog({
  open,
  onOpenChange,
  workOrder,
  onSubmit,
}: DialogBaseProps & {
  workOrder: WorkOrderDetail
  onSubmit: (v: ManualTimeInput) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const people = [
    ...(workOrder.assignedUser ? [workOrder.assignedUser] : []),
    ...workOrder.helpers.filter((h) => h.id !== workOrder.assignedUser?.id),
  ]
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date(Date.now() - 60 * 60_000)
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  const form = useZodForm(timeForm, {
    defaultValues: {
      userId: people[0]?.id ?? '',
      minutes: undefined,
      startedAt: local,
      note: '',
    },
  })
  const { errors, isSubmitting } = form.formState
  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit({
        userId: v.userId,
        minutes: v.minutes,
        startedAt: new Date(v.startedAt).toISOString(),
        note: v.note,
      })
      form.reset()
      onOpenChange(false)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wo.addTime')}</DialogTitle>
          <DialogDescription>{t('wo.addTimeBody')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <SelectField
              control={form.control}
              name="userId"
              label={t('wo.timeWho')}
              required
              placeholder={t('validation.selectOption')}
              options={people.map((p) => ({ value: p.id, label: fullName(p) }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                control={form.control}
                name="minutes"
                label={t('wo.timeMinutes')}
                required
                min={1}
                step={5}
                suffix={t('wo.minutes')}
              />
              <TextField
                control={form.control}
                name="startedAt"
                type="datetime-local"
                label={t('wo.timeWhen')}
                required
              />
            </div>
            <TextField control={form.control} name="note" label={t('wo.timeNote')} required />
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('wo.addTime')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/** Pick a new planned start (the keyboard-friendly way to move a job on the calendar). */
export function RescheduleDialog({
  open,
  onOpenChange,
  workOrder,
  onSubmit,
}: DialogBaseProps & {
  workOrder: WorkOrderDetail
  onSubmit: (scheduledStart: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date(workOrder.scheduledStart ?? workOrder.dueDate ?? Date.now() + 86_400_000)
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  const form = useZodForm(z.object({ at: z.string().min(1, 'validation.required') }), {
    defaultValues: { at: local },
  })
  const { errors, isSubmitting } = form.formState
  const submit = form.handleSubmit(async ({ at }) => {
    try {
      await onSubmit(new Date(at).toISOString())
      onOpenChange(false)
    } catch (err) {
      form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wo.rescheduleTitle')}</DialogTitle>
          <DialogDescription>{t('wo.rescheduleBody')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <TextField
              control={form.control}
              name="at"
              type="datetime-local"
              label={t('wo.fieldScheduledStart')}
              required
            />
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('wo.reschedule')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

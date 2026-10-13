import {
  REPORT_FORMAT,
  REPORT_FREQUENCY,
  fullName,
  type ReportFilters,
  type ReportKey,
  type ReportScheduleDto,
  type ReportScheduleInput,
  type RestaurantDto,
} from '@maintainx/shared'
import { CalendarClock, Mail, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { CheckboxListField } from '@/components/forms/CheckboxListField'
import {
  Form,
  FormActions,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormRootError,
  NumberField,
  SelectField,
  SwitchField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { weekdayNames } from '@/components/maintenance/schedule-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation, useRestaurants, useUserOptions } from '@/hooks/useAdminQueries'
import { platformKeys, reportSchedulesApi, useReportSchedules } from '@/services/platform.service'
import { describeError, reportError } from '@/utils/errors'
import { formatDateTime } from '@/utils/format'
import { looseT } from '@/utils/i18n'
import { describeReportSchedule, runStatusLabel } from './schedule-text'

/*
 * "Email this report every Monday at 08:00": schedules for one report (in a
 * sheet on the report page) and an overview of all of them (reports page).
 */

const ALL = '__all__'

function ScheduleSummary({ s, showReport }: { s: ReportScheduleDto; showReport?: boolean }) {
  const { t } = useTranslation()
  const count = s.recipientUsers.length + s.recipientEmails.length
  return (
    <div className="min-w-0 flex-1">
      {showReport && (
        <Link
          to={`/reports/${s.reportKey}`}
          className="block text-sm font-medium text-primary hover:underline"
        >
          {looseT(t)(`reports.name.${s.reportKey}`)}
        </Link>
      )}
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {describeReportSchedule(t, s)}
        <Badge tone="outline">{s.format}</Badge>
        {!s.active && <Badge tone="outline">{t('reportSchedules.paused')}</Badge>}
      </p>
      <p className="text-13 text-muted-foreground">
        {s.restaurant?.name ?? t('reportSchedules.allRestaurants')} ·{' '}
        {t('reportSchedules.recipientCount', { count })}
      </p>
      <p className="text-xs text-muted-foreground">
        {s.active && t('reportSchedules.nextRun', { time: formatDateTime(s.nextRunAt) })}
        {s.active && s.lastRun && ' · '}
        {s.lastRun &&
          t('reportSchedules.lastRun', {
            status: runStatusLabel(t, s.lastRun.status),
            time: formatDateTime(s.lastRun.createdAt),
          })}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- form

const formSchema = z.object({
  restaurantId: z.string(),
  frequency: z.enum(REPORT_FREQUENCY),
  dayOfWeek: z.string(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'validation.invalidValue'),
  format: z.enum(REPORT_FORMAT),
  recipientUserIds: z.array(z.string()),
  emails: z.string().max(2000),
  active: z.boolean(),
})

const splitEmails = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)

function ScheduleForm({
  reportKey,
  schedule,
  restaurantId,
  filters,
  restaurants,
  onDone,
  onCancel,
}: {
  reportKey: ReportKey
  schedule: ReportScheduleDto | null
  restaurantId?: string
  filters: ReportFilters
  restaurants: RestaurantDto[]
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(formSchema, {
    defaultValues: schedule
      ? {
          restaurantId: schedule.restaurant?.id ?? ALL,
          frequency: schedule.frequency,
          dayOfWeek: String(schedule.dayOfWeek ?? 1),
          dayOfMonth: schedule.dayOfMonth ?? 1,
          timeOfDay: schedule.timeOfDay,
          format: schedule.format,
          recipientUserIds: schedule.recipientUsers.map((u) => u.id),
          emails: schedule.recipientEmails.join(', '),
          active: schedule.active,
        }
      : {
          restaurantId: restaurantId ?? (restaurants.length === 1 ? restaurants[0]!.id : ALL),
          frequency: 'WEEKLY',
          dayOfWeek: '1',
          dayOfMonth: 1,
          timeOfDay: '08:00',
          format: 'PDF',
          recipientUserIds: [],
          emails: '',
          active: true,
        },
  })
  const frequency = form.watch('frequency')
  const chosenRestaurant = form.watch('restaurantId')
  // Only people who can see reports may receive them (the server checks this too).
  const people = useUserOptions(
    chosenRestaurant === ALL ? undefined : chosenRestaurant,
    true,
    'reports:view',
  )
  const save = useInvalidatingMutation(
    (input: ReportScheduleInput) =>
      schedule ? reportSchedulesApi.update(schedule.id, input) : reportSchedulesApi.create(input),
    [platformKeys.reportSchedules],
  )
  const { errors, isSubmitting } = form.formState
  const days = weekdayNames('long')

  const onSubmit = form.handleSubmit(async (v) => {
    const input: ReportScheduleInput = {
      reportKey,
      restaurantId: v.restaurantId === ALL ? '' : v.restaurantId,
      filters: schedule?.filters ?? filters,
      frequency: v.frequency,
      timeOfDay: v.timeOfDay,
      dayOfWeek: v.frequency === 'WEEKLY' ? Number(v.dayOfWeek) : undefined,
      dayOfMonth: v.frequency === 'MONTHLY' ? v.dayOfMonth : undefined,
      format: v.format,
      recipientUserIds: v.recipientUserIds,
      recipientEmails: splitEmails(v.emails),
      active: v.active,
    }
    try {
      await save.mutateAsync(input)
      toast.success(t('reportSchedules.saved'))
      onDone()
    } catch (err) {
      const emailError = Object.keys(
        (err as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {},
      ).find((k) => k.startsWith('recipientEmails.'))
      if (
        !applyServerErrors(form, err, {
          recipientEmails: 'emails',
          ...(emailError ? { [emailError]: 'emails' } : {}),
        })
      )
        form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <SelectField
          control={form.control}
          name="restaurantId"
          label={t('wo.fieldRestaurant')}
          options={[
            { value: ALL, label: t('reportSchedules.allRestaurants') },
            ...restaurants.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="frequency"
            label={t('reportSchedules.frequency')}
            options={REPORT_FREQUENCY.map((f) => ({
              value: f,
              label: looseT(t)(`reportSchedules.freq_${f}`),
            }))}
          />
          {frequency === 'WEEKLY' && (
            <SelectField
              control={form.control}
              name="dayOfWeek"
              label={t('reportSchedules.dayOfWeek')}
              options={days.map((d, i) => ({ value: String(i), label: d }))}
            />
          )}
          {frequency === 'MONTHLY' && (
            <NumberField
              control={form.control}
              name="dayOfMonth"
              label={t('reportSchedules.dayOfMonth')}
              min={1}
              max={28}
            />
          )}
          <FormField
            control={form.control}
            name="timeOfDay"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('reportSchedules.time')}</FormLabel>
                <FormControl>
                  <Input
                    type="time"
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    className="tabular"
                  />
                </FormControl>
                <FormDescription>{t('reportSchedules.timeHint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <SelectField
            control={form.control}
            name="format"
            label={t('reportSchedules.format')}
            options={REPORT_FORMAT.map((f) => ({ value: f, label: f }))}
          />
        </div>
        <p className="text-13 text-muted-foreground">{t('reportSchedules.periodHint')}</p>
        <CheckboxListField
          control={form.control}
          name="recipientUserIds"
          label={t('reportSchedules.people')}
          description={t('reportSchedules.peopleHint')}
          options={(people.data ?? []).map((u) => ({
            value: u.id,
            label: fullName(u),
            description: u.role ?? undefined,
          }))}
          emptyMessage={t('reportSchedules.noPeople')}
        />
        <TextareaField
          control={form.control}
          name="emails"
          label={t('reportSchedules.emails')}
          description={t('reportSchedules.emailsHint')}
          rows={2}
        />
        <SwitchField control={form.control} name="active" label={t('reportSchedules.active')} />
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('actions.saveChanges')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

// ---------------------------------------------------------------- sheet

/** The "Schedule" sheet on a report page: its schedules, and a form to add or edit one. */
export function ReportScheduleSheet({
  reportKey,
  restaurantId,
  filters,
  open,
  onOpenChange,
}: {
  reportKey: ReportKey
  restaurantId?: string
  filters: ReportFilters
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const list = useReportSchedules(reportKey, open)
  const restaurants = useRestaurants()
  const [editing, setEditing] = useState<ReportScheduleDto | 'new' | null>(null)
  const [removing, setRemoving] = useState<ReportScheduleDto | null>(null)
  const archive = useInvalidatingMutation(
    (id: string) => reportSchedulesApi.archive(id),
    [platformKeys.reportSchedules],
  )

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o) setEditing(null)
          onOpenChange(o)
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {editing === 'new'
                ? t('reportSchedules.newTitle')
                : editing
                  ? t('reportSchedules.editTitle')
                  : t('reportSchedules.title')}
            </SheetTitle>
            <SheetDescription>{t('reportSchedules.description')}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {editing ? (
              restaurants.data ? (
                <ScheduleForm
                  reportKey={reportKey}
                  schedule={editing === 'new' ? null : editing}
                  restaurantId={restaurantId}
                  filters={filters}
                  restaurants={restaurants.data}
                  onDone={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <Skeleton className="h-40 w-full" />
              )
            ) : (
              <div className="grid gap-3">
                {list.isPending ? (
                  <Skeleton className="h-20 w-full" />
                ) : list.isError ? (
                  <p className="text-13 text-danger-fg">{describeError(list.error, t)}</p>
                ) : list.data.length === 0 ? (
                  <p className="text-13 text-muted-foreground">{t('reportSchedules.empty')}</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {list.data.map((s) => (
                      <li key={s.id} className="flex items-start gap-2 px-3 py-2.5">
                        <ScheduleSummary s={s} />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('reportSchedules.edit')}
                          onClick={() => setEditing(s)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('reportSchedules.delete')}
                          onClick={() => setRemoving(s)}
                        >
                          <Trash2 />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  <Button onClick={() => setEditing('new')}>
                    <Plus aria-hidden /> {t('reportSchedules.new')}
                  </Button>
                </div>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        tone="destructive"
        title={t('reportSchedules.deleteTitle')}
        description={t('reportSchedules.deleteBody')}
        confirmLabel={t('reportSchedules.delete')}
        onConfirm={async () => {
          try {
            await archive.mutateAsync(removing!.id)
            toast.success(t('reportSchedules.deleted'))
            setRemoving(null)
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

/** Overview on the reports page: every scheduled email the user can see. */
export function ScheduledReportsPanel() {
  const { t } = useTranslation()
  const list = useReportSchedules()
  if (!list.data || list.data.length === 0) return null
  return (
    <Panel className="mb-4">
      <PanelHeader>
        <PanelTitle>
          <span className="inline-flex items-center gap-2">
            <Mail className="size-4 text-muted-foreground" aria-hidden />
            {t('reportSchedules.overviewTitle')}
          </span>
        </PanelTitle>
      </PanelHeader>
      <ul className="divide-y">
        {list.data.map((s) => (
          <li key={s.id} className="flex items-start gap-3 px-4 py-3">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <ScheduleSummary s={s} showReport />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

import {
  ASSET_STATUS,
  FINAL_CONDITION,
  type AssetStatus,
  type CompleteWorkOrderInput,
  type FinalCondition,
  type WorkOrderDetail,
} from '@maintainx/shared'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import {
  CheckboxField,
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
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/utils/cn'
import { describeError } from '@/utils/errors'
import { formatDuration } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { NONE } from './WorkOrderForm'

const schema = z.object({
  problemFound: z.string().trim().min(3).max(2000),
  rootCause: z.string().trim().max(2000),
  workPerformed: z.string().trim().min(3).max(5000),
  newPartsInstalled: z.string().trim().max(1000),
  oldPartsRemoved: z.string().trim().max(1000),
  quantityRepaired: z.number().int().min(0).max(10_000).optional(),
  quantityReplaced: z.number().int().min(0).max(10_000).optional(),
  additionalMaterials: z.string().trim().max(1000),
  additionalIssue: z.string().trim().max(2000),
  recommendation: z.string().trim().max(2000),
  finalCondition: z.string().min(1, 'validation.selectOption'),
  noPartsUsed: z.boolean(),
  assetStatus: z.string(),
  confirmed: z.boolean().refine((v) => v, 'validation.confirmRequired'),
})

/** Sensible asset status for each final condition (the technician can change it). */
const ASSET_FOR: Record<FinalCondition, AssetStatus> = {
  FULLY_WORKING: 'OPERATIONAL',
  WORKING_WITH_LIMITATIONS: 'WARNING',
  NOT_WORKING: 'BROKEN',
  NEEDS_REPLACEMENT: 'BROKEN',
}

/**
 * The repair report handed in with the job: what was found, why, what was
 * done, parts in and out, and the state it was left in. Shows what is still
 * missing (photos, checklist, sub jobs) before it can be sent.
 */
interface CompletionFormProps {
  w: WorkOrderDetail
  onSubmit: (v: CompleteWorkOrderInput) => Promise<unknown>
  onCancel: () => void
  large?: boolean
}

export function CompletionForm(props: CompletionFormProps) {
  // The workflow decides: one-tap completion (default) or the full repair report.
  return props.w.completionCheck.reportRequired ? (
    <RepairReportForm {...props} />
  ) : (
    <QuickCompletionForm {...props} />
  )
}

/** Blockers that apply in both forms: photos the workflow asks for, steps, sub jobs. */
function useBlockers(w: WorkOrderDetail) {
  const { t } = useTranslation()
  const check = w.completionCheck
  return [
    { ok: !check.needsBeforePhoto, label: t('completion.needBefore') },
    { ok: !check.needsAfterPhoto, label: t('completion.needAfter') },
    { ok: check.stepsLeft === 0, label: t('checklist.stepsLeft', { count: check.stepsLeft }) },
    {
      ok: check.subWorkOrdersOpen === 0,
      label: t('completion.subOpen', { count: check.subWorkOrdersOpen }),
    },
  ]
}

function BlockerList({ items, w }: { items: Array<{ ok: boolean; label: string }>; w: WorkOrderDetail }) {
  const { t } = useTranslation()
  return (
    <ul className="grid gap-1.5 rounded-lg border p-3" aria-label={t('completion.checklist')}>
      {items.map((b) => (
        <li
          key={b.label}
          className={cn('flex items-center gap-2 text-sm', !b.ok && 'font-medium text-warning-fg')}
        >
          {b.ok ? (
            <CheckCircle2 className="size-4 text-success" aria-hidden />
          ) : (
            <CircleAlert className="size-4" aria-hidden />
          )}
          <span>{b.label}</span>
          <span className="sr-only">{b.ok ? t('completion.done') : t('completion.todo')}</span>
        </li>
      ))}
      <li className="mt-1 text-xs text-muted-foreground">
        {t('completion.labour', { time: formatDuration(w.minutesWorked) })}
      </li>
    </ul>
  )
}

const quickSchema = z.object({
  notes: z.string().trim().max(5000),
  assetStatus: z.string(),
})

/** MaintainX-style: an optional note, then done. Only real blockers are listed. */
/** Asset conditions to offer: taking an asset out of service needs assets:edit (the server checks too). */
function useCompletionStatuses() {
  const { can } = useAuth()
  return ASSET_STATUS.filter((s) => s !== 'RETIRED' && (s !== 'INACTIVE' || can('assets:edit')))
}

function QuickCompletionForm({ w, onSubmit, onCancel, large = false }: CompletionFormProps) {
  const { t } = useTranslation()
  const statuses = useCompletionStatuses()
  const form = useZodForm(quickSchema, {
    defaultValues: { notes: '', assetStatus: w.asset ? 'OPERATIONAL' : NONE },
  })
  const { errors, isSubmitting } = form.formState
  const blockers = useBlockers(w).filter((b) => !b.ok)
  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit({
        notes: v.notes || undefined,
        noPartsUsed: w.parts.length === 0,
        assetStatus: v.assetStatus === NONE ? '' : (v.assetStatus as AssetStatus),
      })
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="grid gap-5">
        <FormRootError message={errors.root?.message} />
        {blockers.length > 0 && <BlockerList items={blockers} w={w} />}
        <TextareaField
          control={form.control}
          name="notes"
          label={t('completion.notes')}
          placeholder={t('completion.notesHint')}
          optional
          rows={3}
        />
        {w.parts.length > 0 && (
          <p className="rounded-md bg-muted px-3 py-2 text-13">
            {t('completion.partsRecorded', {
              list: w.parts.map((p) => `${p.qtyUsed} ${p.part.unit} ${p.part.name}`).join(', '),
            })}
          </p>
        )}
        {w.asset && (
          <SelectField
            control={form.control}
            name="assetStatus"
            label={t('wo.assetAfter', { name: w.asset.name })}
            options={[
              { value: NONE, label: t('wo.assetUnchanged') },
              ...statuses.map((s) => ({
                value: s,
                label: enumLabel(t, 'assetStatus', s),
              })),
            ]}
          />
        )}
        <FormActions>
          <Button
            variant="secondary"
            size={large ? 'xl' : 'default'}
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            type="submit"
            size={large ? 'xl' : 'default'}
            loading={isSubmitting}
            disabled={blockers.length > 0}
          >
            <CheckCircle2 aria-hidden />{' '}
            {w.completionCheck.verificationRequired ? t('completion.submit') : t('completion.markDone')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

/** The full repair report (workflow setting "Require a repair report"). */
function RepairReportForm({ w, onSubmit, onCancel, large = false }: CompletionFormProps) {
  const { t } = useTranslation()
  const statuses = useCompletionStatuses()
  const prev = w.completion
  const form = useZodForm(schema, {
    defaultValues: {
      problemFound: prev?.problemFound ?? '',
      rootCause: prev?.rootCause ?? '',
      workPerformed: prev?.workPerformed ?? '',
      newPartsInstalled: prev?.newPartsInstalled ?? '',
      oldPartsRemoved: prev?.oldPartsRemoved ?? '',
      quantityRepaired: prev?.quantityRepaired ?? undefined,
      quantityReplaced: prev?.quantityReplaced ?? undefined,
      additionalMaterials: prev?.additionalMaterials ?? '',
      additionalIssue: prev?.additionalIssue ?? '',
      recommendation: prev?.recommendation ?? '',
      finalCondition: prev?.finalCondition ?? '',
      noPartsUsed: w.parts.length === 0 && (prev?.noPartsUsed ?? false),
      assetStatus: w.asset ? 'OPERATIONAL' : NONE,
      confirmed: false,
    },
  })
  const { errors, isSubmitting } = form.formState
  const noParts = form.watch('noPartsUsed')
  const finalCondition = form.watch('finalCondition')
  // Suggest the matching asset status; the technician can still change it.
  useEffect(() => {
    if (w.asset && finalCondition in ASSET_FOR)
      form.setValue('assetStatus', ASSET_FOR[finalCondition as FinalCondition])
  }, [finalCondition, w.asset, form])
  const blockers = [
    ...useBlockers(w),
    { ok: w.parts.length > 0 || noParts, label: t('completion.partsInfo') },
  ]
  const ready = blockers.every((b) => b.ok)

  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit({
        problemFound: v.problemFound,
        rootCause: v.rootCause,
        workPerformed: v.workPerformed,
        newPartsInstalled: v.newPartsInstalled,
        oldPartsRemoved: v.oldPartsRemoved,
        quantityRepaired: v.quantityRepaired,
        quantityReplaced: v.quantityReplaced,
        additionalMaterials: v.additionalMaterials,
        additionalIssue: v.additionalIssue,
        recommendation: v.recommendation,
        finalCondition: v.finalCondition as FinalCondition,
        noPartsUsed: w.parts.length === 0 && v.noPartsUsed,
        confirmed: true,
        assetStatus: v.assetStatus === NONE ? '' : (v.assetStatus as AssetStatus),
      })
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="grid gap-5">
        <FormRootError message={errors.root?.message} />
        <BlockerList items={blockers} w={w} />

        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-semibold">{t('completion.sectionFindings')}</legend>
          <TextareaField
            control={form.control}
            name="problemFound"
            label={t('completion.problemFound')}
            placeholder={t('completion.problemFoundHint')}
            required
            rows={2}
          />
          <TextareaField
            control={form.control}
            name="rootCause"
            label={t('completion.rootCause')}
            placeholder={t('completion.rootCauseHint')}
            optional
            rows={2}
          />
          <TextareaField
            control={form.control}
            name="workPerformed"
            label={t('completion.workPerformed')}
            placeholder={t('completion.workPerformedHint')}
            required
            rows={3}
          />
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-semibold">{t('completion.sectionParts')}</legend>
          {w.parts.length > 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-13">
              {t('completion.partsRecorded', {
                list: w.parts.map((p) => `${p.qtyUsed} ${p.part.unit} ${p.part.name}`).join(', '),
              })}
            </p>
          ) : (
            <CheckboxField
              control={form.control}
              name="noPartsUsed"
              label={t('completion.noPartsUsed')}
              description={t('completion.noPartsUsedHint')}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="newPartsInstalled"
              label={t('completion.newPartsInstalled')}
              optional
            />
            <TextField
              control={form.control}
              name="oldPartsRemoved"
              label={t('completion.oldPartsRemoved')}
              optional
            />
            <NumberField
              control={form.control}
              name="quantityRepaired"
              label={t('completion.quantityRepaired')}
              min={0}
              step={1}
            />
            <NumberField
              control={form.control}
              name="quantityReplaced"
              label={t('completion.quantityReplaced')}
              min={0}
              step={1}
            />
          </div>
          <TextField
            control={form.control}
            name="additionalMaterials"
            label={t('completion.additionalMaterials')}
            optional
          />
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-semibold">{t('completion.sectionResult')}</legend>
          <SelectField
            control={form.control}
            name="finalCondition"
            label={t('completion.finalCondition')}
            required
            placeholder={t('validation.selectOption')}
            options={FINAL_CONDITION.map((c) => ({
              value: c,
              label: enumLabel(t, 'finalCondition', c),
            }))}
          />
          {w.asset && (
            <SelectField
              control={form.control}
              name="assetStatus"
              label={t('wo.assetAfter', { name: w.asset.name })}
              options={[
                { value: NONE, label: t('wo.assetUnchanged') },
                ...statuses.map((s) => ({
                  value: s,
                  label: enumLabel(t, 'assetStatus', s),
                })),
              ]}
            />
          )}
          <TextareaField
            control={form.control}
            name="additionalIssue"
            label={t('completion.additionalIssue')}
            optional
            rows={2}
          />
          <TextareaField
            control={form.control}
            name="recommendation"
            label={t('completion.recommendation')}
            optional
            rows={2}
          />
        </fieldset>

        <CheckboxField
          control={form.control}
          name="confirmed"
          label={t('completion.confirm')}
          className="rounded-lg border p-3"
        />

        <FormActions>
          <Button
            variant="secondary"
            size={large ? 'xl' : 'default'}
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            type="submit"
            size={large ? 'xl' : 'default'}
            loading={isSubmitting}
            disabled={!ready}
          >
            <CheckCircle2 aria-hidden />{' '}
            {w.completionCheck.verificationRequired ? t('completion.submit') : t('completion.markDone')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

import {
  STEP_INPUT_TYPE,
  WORK_ORDER_CATEGORY,
  procedureSchema,
  type ProcedureDetail,
  type ProcedureInput,
  type StepCondition,
} from '@maintainx/shared'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useFieldArray } from 'react-hook-form'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { z } from 'zod'
import { rangeLabel } from '@/components/checklists/checklist-utils'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import {
  Form,
  FormActions,
  FormRootError,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useCurrentUser } from '@/contexts/AuthContext'
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import { mxKeys, proceduresApi, useProcedure } from '@/services/maintenance.service'
import { describeError, reportError } from '@/utils/errors'
import { enumLabel, translateValidationMessage } from '@/utils/i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ALL = '__all__'
const NO_CATEGORY = '__none__'

/** Selects can't hold '': ALL / NO_CATEGORY stand in for "every restaurant" / "no category". */
const formSchema = procedureSchema.extend({
  restaurantId: z.string().min(1, 'validation.selectOption'),
  category: z.string(),
})
type Values = z.infer<typeof formSchema>

const blankStep = (): Values['steps'][number] => ({
  title: '',
  instruction: '',
  inputType: 'PASS_FAIL_NA',
  unit: '',
  minValue: undefined,
  maxValue: undefined,
  required: true,
  options: [],
  requirePhoto: false,
  showIf: null,
})

export function ProcedureEditorPage() {
  const { t } = useTranslation()
  const { procedureId } = useParams()
  const query = useProcedure(procedureId)
  const restaurants = useRestaurants()
  const back = { to: '/procedures', label: t('procedures.title') }

  if ((procedureId && query.isPending) || !restaurants.data)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  if (procedureId && query.isError)
    return (
      <>
        <PageHeader title={t('procedures.title')} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  const p = procedureId ? query.data! : null
  if (p && !p.can.edit) return <ProcedureView p={p} back={back} />
  return <Editor p={p} back={back} restaurants={restaurants.data} />
}

function ProcedureView({ p, back }: { p: ProcedureDetail; back: { to: string; label: string } }) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader
        back={back}
        title={p.name}
        meta={
          <>
            <Badge tone="outline">v{p.version}</Badge>
            <span className="text-13 text-muted-foreground">
              {p.restaurant?.name ?? t('procedures.allRestaurants')}
            </span>
          </>
        }
      />
      {p.description && <p className="mb-4 text-sm whitespace-pre-wrap">{p.description}</p>}
      <Panel>
        <ol className="divide-y">
          {p.steps.map((s) =>
            s.inputType === 'SECTION' ? (
              <li key={s.id} className="bg-muted/50 px-4 py-2">
                <p className="text-13 font-semibold tracking-wide text-muted-foreground uppercase">
                  {s.position}. {s.title}
                </p>
              </li>
            ) : (
            <li key={s.id} className="grid gap-0.5 px-4 py-3">
              <p className="text-sm font-medium">
                {s.position}. {s.title}
                {!s.required && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({t('common.optional')})
                  </span>
                )}
              </p>
              <p className="text-13 text-muted-foreground">
                {enumLabel(t, 'stepInputType', s.inputType)}
                {s.inputType === 'NUMBER' && rangeLabel(s, t) && ` · ${rangeLabel(s, t)}`}
                {s.inputType === 'MULTIPLE_CHOICE' && ` · ${s.options.join(' / ')}`}
                {s.requirePhoto && ` · ${t('checklist.photoRequired')}`}
              </p>
              {s.instruction && <p className="text-13">{s.instruction}</p>}
              {s.showIf && (
                <p className="text-xs text-muted-foreground">
                  {t('procedures.showIfSummary', {
                    step: s.showIf.step,
                    answer: conditionAnswerLabel(t, s.showIf.answer),
                  })}
                </p>
              )}
            </li>
            ),
          )}
        </ol>
      </Panel>
    </>
  )
}

function Editor({
  p,
  back,
  restaurants,
}: {
  p: ProcedureDetail | null
  back: { to: string; label: string }
  restaurants: Array<{ id: string; name: string }>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const [archiving, setArchiving] = useState(false)

  const form = useZodForm(formSchema, {
    defaultValues: p
      ? {
          name: p.name,
          description: p.description ?? '',
          category: p.category ?? NO_CATEGORY,
          restaurantId: p.restaurant?.id ?? ALL,
          steps: p.steps.map((s) => ({
            title: s.title,
            instruction: s.instruction ?? '',
            inputType: s.inputType,
            unit: s.unit ?? '',
            minValue: s.minValue ?? undefined,
            maxValue: s.maxValue ?? undefined,
            required: s.required,
            options: s.options,
            requirePhoto: s.requirePhoto,
            showIf: s.showIf,
          })),
        }
      : {
          name: '',
          description: '',
          category: NO_CATEGORY,
          restaurantId: user.isSuperAdmin ? ALL : (restaurants[0]?.id ?? ''),
          steps: [blankStep()],
        },
  })
  const steps = useFieldArray({ control: form.control, name: 'steps' })
  const types = form.watch('steps').map((s) => s.inputType)

  const save = useInvalidatingMutation(
    (input: ProcedureInput) =>
      p ? proceduresApi.update(p.id, input) : proceduresApi.create(input),
    [mxKeys.procedures, mxKeys.templates],
  )
  const archive = useInvalidatingMutation(() => proceduresApi.archive(p!.id), [mxKeys.procedures])
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const saved = await save.mutateAsync({
        ...v,
        restaurantId: v.restaurantId === ALL ? '' : v.restaurantId,
        category: v.category === NO_CATEGORY ? '' : (v.category as ProcedureInput['category']),
      })
      toast.success(p ? t('procedures.saved') : t('procedures.created'))
      if (!p) navigate(`/procedures/${saved.id}`, { replace: true })
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <>
      <PageHeader
        back={back}
        title={p ? p.name : t('procedures.new')}
        meta={p ? <Badge tone="outline">v{p.version}</Badge> : undefined}
        actions={
          p?.can.delete ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('procedures.archive')}
              onClick={() => setArchiving(true)}
            >
              <Trash2 />
            </Button>
          ) : undefined
        }
      />
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="grid max-w-3xl gap-4">
          <FormRootError
            message={errors.root?.message ?? errors.steps?.root?.message ?? errors.steps?.message}
          />
          <Panel>
            <PanelBody className="grid gap-4">
              <TextField
                control={form.control}
                name="name"
                label={t('procedures.name')}
                placeholder={t('procedures.namePlaceholder')}
                required
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  control={form.control}
                  name="restaurantId"
                  label={t('wo.fieldRestaurant')}
                  required
                  options={[
                    ...(user.isSuperAdmin
                      ? [{ value: ALL, label: t('procedures.allRestaurants') }]
                      : []),
                    ...restaurants.map((r) => ({ value: r.id, label: r.name })),
                  ]}
                />
                <SelectField
                  control={form.control}
                  name="category"
                  label={t('wo.fieldCategory')}
                  options={[
                    { value: NO_CATEGORY, label: t('procedures.noCategory') },
                    ...WORK_ORDER_CATEGORY.map((c) => ({
                      value: c,
                      label: enumLabel(t, 'workOrderCategory', c),
                    })),
                  ]}
                />
              </div>
              <TextareaField
                control={form.control}
                name="description"
                label={t('wo.fieldDescription')}
                optional
                rows={2}
              />
              {p && <p className="text-xs text-muted-foreground">{t('procedures.versionHint')}</p>}
            </PanelBody>
          </Panel>

          <h2 className="text-sm font-semibold">{t('procedures.steps')}</h2>
          <ol className="grid gap-3">
            {steps.fields.map((field, i) => (
              <li key={field.id}>
                <Panel>
                  <PanelBody className="grid gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tabular">{i + 1}.</span>
                      <span className="flex-1" />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('procedures.moveUp', { n: i + 1 })}
                        disabled={i === 0}
                        onClick={() => steps.move(i, i - 1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('procedures.moveDown', { n: i + 1 })}
                        disabled={i === steps.fields.length - 1}
                        onClick={() => steps.move(i, i + 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('procedures.removeStep', { n: i + 1 })}
                        disabled={steps.fields.length === 1}
                        onClick={() => steps.remove(i)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                      <TextField
                        control={form.control}
                        name={`steps.${i}.title`}
                        label={t('procedures.stepTitle')}
                        placeholder={t('procedures.stepPlaceholder')}
                        required
                      />
                      <SelectField
                        control={form.control}
                        name={`steps.${i}.inputType`}
                        label={t('procedures.stepType')}
                        options={STEP_INPUT_TYPE.map((x) => ({
                          value: x,
                          label: enumLabel(t, 'stepInputType', x),
                        }))}
                      />
                    </div>
                    {types[i] === 'NUMBER' && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <NumberField
                          control={form.control}
                          name={`steps.${i}.minValue`}
                          label={t('procedures.min')}
                          step={0.1}
                        />
                        <NumberField
                          control={form.control}
                          name={`steps.${i}.maxValue`}
                          label={t('procedures.max')}
                          step={0.1}
                        />
                        <TextField
                          control={form.control}
                          name={`steps.${i}.unit`}
                          label={t('procedures.unit')}
                          placeholder="°C"
                        />
                      </div>
                    )}
                    {types[i] === 'NUMBER' && (
                      <p className="-mt-1 text-xs text-muted-foreground">
                        {t('procedures.rangeHint')}
                      </p>
                    )}
                    {types[i] === 'MULTIPLE_CHOICE' && (
                      <OptionsEditor
                        value={form.watch(`steps.${i}.options`) ?? []}
                        onChange={(next) =>
                          form.setValue(`steps.${i}.options`, next, { shouldValidate: true })
                        }
                        error={errors.steps?.[i]?.options?.message}
                      />
                    )}
                    <TextField
                      control={form.control}
                      name={`steps.${i}.instruction`}
                      label={t('procedures.instruction')}
                      optional
                    />
                    {types[i] !== 'SECTION' && i > 0 && (
                      <ConditionPicker
                        index={i}
                        steps={form.watch('steps')}
                        value={form.watch(`steps.${i}.showIf`) ?? null}
                        onChange={(next) =>
                          form.setValue(`steps.${i}.showIf`, next, { shouldValidate: true })
                        }
                        error={errors.steps?.[i]?.showIf?.message}
                      />
                    )}
                    {types[i] !== 'SECTION' && (
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      <SwitchField
                        control={form.control}
                        name={`steps.${i}.required`}
                        label={t('procedures.required')}
                      />
                      {types[i] !== 'PHOTO' && types[i] !== 'SIGNATURE' && (
                        <SwitchField
                          control={form.control}
                          name={`steps.${i}.requirePhoto`}
                          label={t('procedures.requirePhoto')}
                        />
                      )}
                    </div>
                    )}
                  </PanelBody>
                </Panel>
              </li>
            ))}
          </ol>
          <Button
            variant="secondary"
            className="justify-self-start"
            disabled={steps.fields.length >= 100}
            onClick={() => steps.append(blankStep())}
          >
            <Plus aria-hidden /> {t('procedures.addStep')}
          </Button>
          <FormActions>
            <Button
              variant="secondary"
              onClick={() => navigate('/procedures')}
              disabled={isSubmitting}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {p ? t('actions.saveChanges') : t('actions.create')}
            </Button>
          </FormActions>
        </form>
      </Form>

      {p && (
        <ConfirmDialog
          open={archiving}
          onOpenChange={setArchiving}
          tone="destructive"
          title={t('procedures.archiveTitle', { name: p.name })}
          description={t('procedures.archiveBody')}
          confirmLabel={t('procedures.archive')}
          onConfirm={async () => {
            try {
              await archive.mutateAsync(undefined)
              toast.success(t('procedures.archived'))
              navigate('/procedures', { replace: true })
            } catch (err) {
              reportError(err, t)
              throw err
            }
          }}
        />
      )}
    </>
  )
}

/** Answers a condition can wait for, by the earlier step's type. */
function conditionAnswers(
  step: Values['steps'][number],
  t: TFunction,
): Array<{ value: string; label: string }> {
  switch (step.inputType) {
    case 'PASS_FAIL_NA':
      return (['PASS', 'FAIL', 'NA'] as const).map((r) => ({
        value: r,
        label: enumLabel(t, 'stepResult', r),
      }))
    case 'NUMBER':
      return [
        { value: 'PASS', label: t('procedures.answerInRange') },
        { value: 'FAIL', label: t('procedures.answerOutOfRange') },
      ]
    case 'MULTIPLE_CHOICE':
      return (step.options ?? []).filter(Boolean).map((o) => ({ value: o, label: o }))
    case 'CHECKBOX':
      return [{ value: 'PASS', label: t('procedures.answerTicked') }]
    case 'SECTION':
      return []
    default:
      return [{ value: 'PASS', label: t('procedures.answerDone') }]
  }
}

function conditionAnswerLabel(t: TFunction, answer: string) {
  return answer === 'PASS' || answer === 'FAIL' || answer === 'NA'
    ? enumLabel(t, 'stepResult', answer)
    : answer
}

const NO_CONDITION = '__always__'

/** "Show this step only if step 2 is Fail" — earlier, answerable steps only. */
function ConditionPicker({
  index,
  steps,
  value,
  onChange,
  error,
}: {
  index: number
  steps: Values['steps']
  value: StepCondition | null
  onChange: (next: StepCondition | null) => void
  error?: string
}) {
  const { t } = useTranslation()
  const earlier = steps
    .slice(0, index)
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ s }) => s.inputType !== 'SECTION')
  const target = value ? steps[value.step - 1] : undefined
  const answers = target ? conditionAnswers(target, t) : []
  if (earlier.length === 0) return null
  return (
    <div className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`cond-step-${index}`}>{t('procedures.showIf')}</Label>
        <Select
          value={value ? String(value.step) : NO_CONDITION}
          onValueChange={(v) => {
            if (v === NO_CONDITION) return onChange(null)
            const step = Number(v)
            const first = conditionAnswers(steps[step - 1]!, t)[0]
            onChange({ step, answer: first?.value ?? 'PASS' })
          }}
        >
          <SelectTrigger id={`cond-step-${index}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CONDITION}>{t('procedures.showAlways')}</SelectItem>
            {earlier.map(({ s, n }) => (
              <SelectItem key={n} value={String(n)}>
                {t('procedures.ifStep', { n, title: s.title || '…' })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {value && (
        <div className="grid gap-1.5">
          <Label htmlFor={`cond-answer-${index}`}>{t('procedures.isAnswered')}</Label>
          <Select
            value={value.answer}
            onValueChange={(answer) => onChange({ step: value.step, answer })}
          >
            <SelectTrigger id={`cond-answer-${index}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {answers.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {error && (
        <p className="text-13 text-danger-fg sm:col-span-2">{t('procedures.conditionInvalid')}</p>
      )}
    </div>
  )
}

/** Answers for a multiple-choice step, added one at a time (2–10). */
function OptionsEditor({
  value,
  onChange,
  error,
}: {
  value: string[]
  onChange: (next: string[]) => void
  error?: string
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || value.some((o) => o.toLowerCase() === v.toLowerCase()) || value.length >= 10) return
    onChange([...value, v])
    setDraft('')
  }
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{t('procedures.options')}</p>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((o) => (
            <li
              key={o}
              className="flex items-center gap-1 rounded-full border bg-muted/50 py-1 pr-1 pl-3 text-sm"
            >
              {o}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('procedures.removeOption', { option: o })}
                onClick={() => onChange(value.filter((x) => x !== o))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          maxLength={80}
          aria-label={t('procedures.newOption')}
          placeholder={t('procedures.optionPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button variant="secondary" onClick={add} disabled={!draft.trim()}>
          <Plus aria-hidden /> {t('procedures.addOption')}
        </Button>
      </div>
      {error && (
        <p className="text-13 text-danger-fg" role="alert">
          {translateValidationMessage(t, error)}
        </p>
      )}
    </div>
  )
}

import {
  AUTOMATION_TRIGGER,
  METER_OPERATORS,
  NOTIFY_RECIPIENTS,
  PRIORITY,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_TRIGGERS,
  WORK_ORDER_TYPE,
  fullName,
  type AutomationAction,
  type AutomationActionType,
  type AutomationConditions,
  type AutomationDto,
  type AutomationInput,
  type AutomationTrigger,
} from '@maintainx/shared'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckboxList } from '@/components/common/CheckboxList'
import { FormRootError } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentUser } from '@/contexts/AuthContext'
import { useRestaurants, useTeams, useUserOptions } from '@/hooks/useAdminQueries'
import { useAssets } from '@/services/assets.service'
import { automationsApi, useMeterOptions } from '@/services/automations.service'
import { useProcedures } from '@/services/maintenance.service'
import { ApiError } from '@/services/http'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

const ALL = '__all__'
const NONE = '__none__'

function blankAction(type: AutomationActionType): AutomationAction {
  switch (type) {
    case 'NOTIFY':
      return { type, recipients: 'MANAGERS', message: '' }
    case 'CREATE_WORK_ORDER':
      return {
        type,
        title: '',
        priority: 'MEDIUM',
        category: 'OTHER',
        workType: 'PREVENTIVE',
      }
    case 'SET_PRIORITY':
      return { type, priority: 'HIGH' }
    case 'ASSIGN':
      return { type }
  }
}

/** Field wrapper with a label and the server's message for that path. */
function Field({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p className="text-13 text-danger-fg" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function Choice({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** IF <trigger> AND <conditions> THEN <actions>. */
export function AutomationEditor({
  rule,
  onDone,
  onCancel,
}: {
  rule: AutomationDto | null
  onDone: (r: AutomationDto) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const restaurants = useRestaurants()
  const list = restaurants.data ?? []
  const [name, setName] = useState(rule?.name ?? '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [trigger, setTrigger] = useState<AutomationTrigger>(rule?.trigger ?? 'WORK_ORDER_CREATED')
  const [restaurantId, setRestaurantId] = useState(
    rule?.restaurant?.id ?? (user.isSuperAdmin ? ALL : (list[0]?.id ?? '')),
  )
  // The restaurant list can arrive after the form opens: pick the first one then.
  useEffect(() => {
    if (!restaurantId && restaurants.data?.length) setRestaurantId(restaurants.data[0]!.id)
  }, [restaurantId, restaurants.data])
  const top = useRef<HTMLDivElement>(null)
  const [conditions, setConditions] = useState<AutomationConditions>(rule?.conditions ?? {})
  const [actions, setActions] = useState<AutomationAction[]>(
    rule?.actions ?? [blankAction('NOTIFY')],
  )
  const [active, setActive] = useState(rule?.active ?? true)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [rootError, setRootError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const rid = restaurantId && restaurantId !== ALL ? restaurantId : undefined
  const people = useUserOptions(rid)
  const teams = useTeams()
  const procedures = useProcedures({}, true)
  const assets = useAssets({ restaurantId: rid, pageSize: 100, sort: 'name:asc' })
  const meters = useMeterOptions(rid, trigger === 'METER_READING')
  const onWorkOrder = WORK_ORDER_TRIGGERS.includes(trigger)
  const err = (path: string) => errors[path]?.map((k) => t(k as 'validation.required')).join(' ')

  const setCond = (patch: Partial<AutomationConditions>) =>
    setConditions((c) => {
      const next = { ...c, ...patch }
      for (const k of Object.keys(next) as Array<keyof AutomationConditions>)
        if (next[k] === undefined || (Array.isArray(next[k]) && !(next[k] as unknown[]).length))
          delete next[k]
      return next
    })
  const setAction = (i: number, patch: Partial<AutomationAction>) =>
    setActions((xs) => xs.map((a, j) => (j === i ? ({ ...a, ...patch } as AutomationAction) : a)))

  async function save() {
    setBusy(true)
    setErrors({})
    setRootError(undefined)
    const input: AutomationInput = {
      name,
      description,
      trigger,
      restaurantId: restaurantId === ALL ? '' : restaurantId,
      conditions:
        trigger === 'METER_READING'
          ? conditions
          : { ...conditions, meterId: undefined, meterOperator: undefined, meterValue: undefined },
      actions,
      active,
    }
    try {
      onDone(
        rule ? await automationsApi.update(rule.id, input) : await automationsApi.create(input),
      )
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors)
      setRootError(describeError(e, t))
      top.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    } finally {
      setBusy(false)
    }
  }

  const options = <T extends string>(values: readonly T[], kind: Parameters<typeof enumLabel>[1]) =>
    values.map((v) => ({ value: v, label: enumLabel(t, kind, v) }))
  const personOptions = (people.data ?? []).map((u) => ({ value: u.id, label: fullName(u) }))
  const teamOptions = (teams.data ?? []).map((x) => ({ value: x.id, label: x.name }))

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div ref={top}>
        <FormRootError message={rootError} />
      </div>
      <Field id="auto-name" label={t('automations.name')} error={err('name')}>
        <Input
          id="auto-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('automations.namePlaceholder')}
        />
      </Field>
      <Field id="auto-desc" label={t('automations.description')}>
        <Textarea
          id="auto-desc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="auto-restaurant" label={t('wo.fieldRestaurant')} error={err('restaurantId')}>
          <Choice
            id="auto-restaurant"
            value={restaurantId}
            onChange={setRestaurantId}
            placeholder={t('validation.selectOption')}
            options={[
              ...(user.isSuperAdmin
                ? [{ value: ALL, label: t('automations.allRestaurants') }]
                : []),
              ...list.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
        </Field>
        <Field id="auto-active" label={t('automations.active')}>
          <Switch id="auto-active" checked={active} onCheckedChange={setActive} />
        </Field>
      </div>

      <fieldset className="grid gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-semibold">{t('automations.if')}</legend>
        <Field id="auto-trigger" label={t('automations.trigger')}>
          <Choice
            id="auto-trigger"
            value={trigger}
            onChange={(v) => setTrigger(v as AutomationTrigger)}
            options={options(AUTOMATION_TRIGGER, 'automationTrigger')}
          />
        </Field>
        {trigger === 'METER_READING' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                id="auto-meter"
                label={t('automations.meter')}
                error={err('conditions.meterId')}
              >
                <Choice
                  id="auto-meter"
                  value={conditions.meterId ?? ''}
                  onChange={(v) => setCond({ meterId: v })}
                  placeholder={t('validation.selectOption')}
                  options={(meters.data ?? []).map((m) => ({
                    value: m.id,
                    label: `${m.asset.name} · ${m.name} (${m.unit})`,
                  }))}
                />
              </Field>
            </div>
            <Field id="auto-op" label={t('automations.when')}>
              <Choice
                id="auto-op"
                value={conditions.meterOperator ?? ''}
                onChange={(v) =>
                  setCond({ meterOperator: v as AutomationConditions['meterOperator'] })
                }
                placeholder={t('validation.selectOption')}
                options={METER_OPERATORS.map((o) => ({
                  value: o,
                  label: t(`automations.op_${o}`),
                }))}
              />
            </Field>
            <Field
              id="auto-value"
              label={t('automations.value')}
              error={err('conditions.meterValue')}
            >
              <Input
                id="auto-value"
                type="number"
                inputMode="decimal"
                value={conditions.meterValue ?? ''}
                onChange={(e) =>
                  setCond({
                    meterValue: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>
        ) : (
          (onWorkOrder || trigger === 'REQUEST_CREATED') && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="auto-prio" label={t('automations.onlyPriorities')}>
                <CheckboxList
                  options={options(PRIORITY, 'priority')}
                  value={conditions.priorities ?? []}
                  onChange={(v) => setCond({ priorities: v as AutomationConditions['priorities'] })}
                />
              </Field>
              <Field id="auto-cat" label={t('automations.onlyCategories')}>
                <CheckboxList
                  searchable
                  options={options(WORK_ORDER_CATEGORY, 'workOrderCategory')}
                  value={conditions.categories ?? []}
                  onChange={(v) => setCond({ categories: v as AutomationConditions['categories'] })}
                />
              </Field>
              {onWorkOrder && (
                <Field id="auto-type" label={t('automations.onlyTypes')}>
                  <CheckboxList
                    options={options(WORK_ORDER_TYPE, 'workOrderType')}
                    value={conditions.types ?? []}
                    onChange={(v) => setCond({ types: v as AutomationConditions['types'] })}
                  />
                </Field>
              )}
            </div>
          )
        )}
        {trigger !== 'METER_READING' && trigger !== 'LOW_STOCK' && (
          <Field
            id="auto-asset"
            label={t('automations.onlyAsset')}
            error={err('conditions.assetId')}
          >
            <Choice
              id="auto-asset"
              value={conditions.assetId ?? NONE}
              onChange={(v) => setCond({ assetId: v === NONE ? undefined : v })}
              options={[
                { value: NONE, label: t('automations.anyAsset') },
                ...(assets.data?.data ?? []).map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </Field>
        )}
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-semibold">{t('automations.then')}</legend>
        {err('actions') && <p className="text-13 text-danger-fg">{err('actions')}</p>}
        {actions.map((a, i) => (
          <div key={i} className="grid gap-3 rounded-md bg-muted/40 p-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  id={`act-${i}`}
                  label={t('automations.action')}
                  error={err(`actions.${i}.type`)}
                >
                  <Choice
                    id={`act-${i}`}
                    value={a.type}
                    onChange={(v) =>
                      setActions((xs) =>
                        xs.map((x, j) => (j === i ? blankAction(v as AutomationActionType) : x)),
                      )
                    }
                    options={(['NOTIFY', 'CREATE_WORK_ORDER', 'SET_PRIORITY', 'ASSIGN'] as const)
                      .filter((x) => onWorkOrder || (x !== 'SET_PRIORITY' && x !== 'ASSIGN'))
                      .map((x) => ({ value: x, label: t(`automations.action_${x}`) }))}
                  />
                </Field>
              </div>
              {actions.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('automations.removeAction')}
                  onClick={() => setActions((xs) => xs.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            {a.type === 'NOTIFY' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id={`act-${i}-to`}
                  label={t('automations.recipients')}
                  error={err(`actions.${i}.recipients`)}
                >
                  <Choice
                    id={`act-${i}-to`}
                    value={a.recipients}
                    onChange={(v) =>
                      setAction(i, { recipients: v as (typeof NOTIFY_RECIPIENTS)[number] })
                    }
                    options={NOTIFY_RECIPIENTS.filter((r) => onWorkOrder || r !== 'ASSIGNEE').map(
                      (r) => ({ value: r, label: t(`automations.to_${r}`) }),
                    )}
                  />
                </Field>
                {a.recipients === 'USER' && (
                  <Field
                    id={`act-${i}-user`}
                    label={t('automations.person')}
                    error={err(`actions.${i}.userId`)}
                  >
                    <Choice
                      id={`act-${i}-user`}
                      value={a.userId ?? ''}
                      onChange={(v) => setAction(i, { userId: v })}
                      placeholder={t('validation.selectOption')}
                      options={personOptions}
                    />
                  </Field>
                )}
                <div className="sm:col-span-2">
                  <Field id={`act-${i}-msg`} label={t('automations.message')}>
                    <Input
                      id={`act-${i}-msg`}
                      value={a.message}
                      onChange={(e) => setAction(i, { message: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            )}
            {a.type === 'CREATE_WORK_ORDER' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field
                    id={`act-${i}-title`}
                    label={t('automations.woTitle')}
                    error={err(`actions.${i}.title`)}
                  >
                    <Input
                      id={`act-${i}-title`}
                      value={a.title}
                      onChange={(e) => setAction(i, { title: e.target.value })}
                    />
                  </Field>
                </div>
                <Field id={`act-${i}-wt`} label={t('wo.fieldType')}>
                  <Choice
                    id={`act-${i}-wt`}
                    value={a.workType}
                    onChange={(v) => setAction(i, { workType: v as typeof a.workType })}
                    options={options(WORK_ORDER_TYPE, 'workOrderType')}
                  />
                </Field>
                <Field id={`act-${i}-p`} label={t('wo.fieldPriority')}>
                  <Choice
                    id={`act-${i}-p`}
                    value={a.priority}
                    onChange={(v) => setAction(i, { priority: v as typeof a.priority })}
                    options={options(PRIORITY, 'priority')}
                  />
                </Field>
                <Field id={`act-${i}-c`} label={t('wo.fieldCategory')}>
                  <Choice
                    id={`act-${i}-c`}
                    value={a.category}
                    onChange={(v) => setAction(i, { category: v as typeof a.category })}
                    options={options(WORK_ORDER_CATEGORY, 'workOrderCategory')}
                  />
                </Field>
                <Field id={`act-${i}-due`} label={t('automations.dueInHours')}>
                  <Input
                    id={`act-${i}-due`}
                    type="number"
                    min={1}
                    value={a.dueInHours ?? ''}
                    onChange={(e) =>
                      setAction(i, {
                        dueInHours: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  id={`act-${i}-u`}
                  label={t('automations.assignTo')}
                  error={err(`actions.${i}.assignedUserId`)}
                >
                  <Choice
                    id={`act-${i}-u`}
                    value={a.assignedUserId ?? NONE}
                    onChange={(v) =>
                      setAction(i, {
                        assignedUserId: v === NONE ? undefined : v,
                        assignedTeamId: undefined,
                      })
                    }
                    options={[{ value: NONE, label: t('automations.nobody') }, ...personOptions]}
                  />
                </Field>
                <Field id={`act-${i}-t`} label={t('automations.orTeam')}>
                  <Choice
                    id={`act-${i}-t`}
                    value={a.assignedTeamId ?? NONE}
                    onChange={(v) =>
                      setAction(i, {
                        assignedTeamId: v === NONE ? undefined : v,
                        assignedUserId: undefined,
                      })
                    }
                    options={[{ value: NONE, label: t('automations.noTeam') }, ...teamOptions]}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field id={`act-${i}-proc`} label={t('automations.procedure')}>
                    <Choice
                      id={`act-${i}-proc`}
                      value={a.procedureId ?? NONE}
                      onChange={(v) => setAction(i, { procedureId: v === NONE ? undefined : v })}
                      options={[
                        { value: NONE, label: t('automations.noProcedure') },
                        ...(procedures.data ?? []).map((p) => ({ value: p.id, label: p.name })),
                      ]}
                    />
                  </Field>
                </div>
              </div>
            )}
            {a.type === 'SET_PRIORITY' && (
              <Field id={`act-${i}-sp`} label={t('wo.fieldPriority')}>
                <Choice
                  id={`act-${i}-sp`}
                  value={a.priority}
                  onChange={(v) => setAction(i, { priority: v as typeof a.priority })}
                  options={options(PRIORITY, 'priority')}
                />
              </Field>
            )}
            {a.type === 'ASSIGN' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id={`act-${i}-au`}
                  label={t('automations.assignTo')}
                  error={err(`actions.${i}.userId`)}
                >
                  <Choice
                    id={`act-${i}-au`}
                    value={a.userId ?? NONE}
                    onChange={(v) =>
                      setAction(i, { userId: v === NONE ? undefined : v, teamId: undefined })
                    }
                    options={[{ value: NONE, label: t('automations.nobody') }, ...personOptions]}
                  />
                </Field>
                <Field id={`act-${i}-at`} label={t('automations.orTeam')}>
                  <Choice
                    id={`act-${i}-at`}
                    value={a.teamId ?? NONE}
                    onChange={(v) =>
                      setAction(i, { teamId: v === NONE ? undefined : v, userId: undefined })
                    }
                    options={[{ value: NONE, label: t('automations.noTeam') }, ...teamOptions]}
                  />
                </Field>
              </div>
            )}
          </div>
        ))}
        {actions.length < 5 && (
          <Button
            variant="secondary"
            size="sm"
            className="justify-self-start"
            onClick={() => setActions((xs) => [...xs, blankAction('NOTIFY')])}
          >
            <Plus aria-hidden /> {t('automations.addAction')}
          </Button>
        )}
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('actions.cancel')}
        </Button>
        <Button type="submit" loading={busy}>
          {t('actions.save')}
        </Button>
      </div>
    </form>
  )
}

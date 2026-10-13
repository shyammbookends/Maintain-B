import {
  PRIORITY,
  REPEAT_BASIS,
  REPEAT_UNIT,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_TYPE,
  createWorkOrderSchema,
  type CreateWorkOrderInput,
  type Priority,
  type RepeatUnit,
  type RestaurantDto,
  type UpdateWorkOrderInput,
  type WorkOrderCategory,
  type WorkOrderDetail,
  type WorkOrderType,
} from '@maintainx/shared'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { MoreOptions } from '@/components/common/MoreOptions'
import { CustomFieldInputs } from '@/components/common/CustomFieldInputs'
import {
  customFieldsFormSchema,
  fromCustomForm,
  useCustomFieldDefaults,
} from '@/components/common/custom-fields'
import { useCustomFields, useLabels } from '@/services/customization.service'
import {
  DateField,
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
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/contexts/AuthContext'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { useRestaurants, useTeams, useUserOptions } from '@/hooks/useAdminQueries'
import { assetMissingFrom, useAssets, useLocations } from '@/services/assets.service'
import { useProcedures } from '@/services/maintenance.service'
import { useVendorOptions } from '@/services/purchasing.service'
import { useApplyWorkOrder, workOrdersApi } from '@/services/work-orders.service'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

/** Radix Select can't hold ''; this stands for "none". */
export const NONE = '__none__'

const formSchema = createWorkOrderSchema
  .omit({
    locationId: true,
    assetId: true,
    dueDate: true,
    scheduledStart: true,
    assignedUserId: true,
    assignedTeamId: true,
    helperIds: true,
    vendorId: true,
    supervisorId: true,
    parentId: true,
    requestId: true,
    procedureId: true,
    asDraft: true,
    type: true,
    repeat: true,
    customFields: true,
    labelIds: true,
  })
  .extend({
    type: z.string(),
    procedureId: z.string(),
    locationId: z.string(),
    assetId: z.string(),
    /** 'YYYY-MM-DD' or ''. Due at the end of that day. */
    dueDate: z.string(),
    /** 'YYYY-MM-DDTHH:mm' (local) or ''. */
    scheduledStart: z.string(),
    /** NONE, 'user:<id>' or 'team:<id>'. */
    assignee: z.string(),
    helperIds: z.array(z.string()),
    vendorId: z.string(),
    supervisorId: z.string(),
    /** NONE or DAY / WEEK / MONTH. */
    repeatUnit: z.string(),
    repeatEvery: z.number().int().min(1).max(365).optional(),
    repeatBasis: z.enum(REPEAT_BASIS),
    customFields: customFieldsFormSchema,
    labelIds: z.array(z.string()),
  })

/** Values to start a new work order from (a request, an asset page, a parent job…). */
export interface WorkOrderPrefill {
  title?: string
  description?: string
  category?: WorkOrderCategory
  priority?: Priority
  type?: WorkOrderType
  restaurantId?: string
  locationId?: string | null
  assetId?: string | null
  requestId?: string
  procedureId?: string
  /** Creates a sub work order of this job. */
  parent?: { id: string; code: string; title: string }
}

const pad = (n: number) => String(n).padStart(2, '0')
const toDateInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const toDateTimeInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${toDateInput(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** End of the chosen day, local time, as ISO with offset. */
const toDueIso = (day: string) => (day ? new Date(`${day}T23:59:00`).toISOString() : '')
const toIso = (local: string) => (local ? new Date(local).toISOString() : '')
const orBlank = (v: string) => (v === NONE ? '' : v)

interface WorkOrderFormProps {
  workOrder?: WorkOrderDetail | null
  prefill?: WorkOrderPrefill
  onDone: (w: WorkOrderDetail) => void
  onCancel: () => void
}

/** Waits for restaurants so selects receive values with their options present. */
export function WorkOrderForm(props: WorkOrderFormProps) {
  const restaurants = useRestaurants()
  if (!restaurants.data) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }
  return <WorkOrderFormInner {...props} restaurants={restaurants.data} />
}

function WorkOrderFormInner({
  workOrder,
  prefill = {},
  onDone,
  onCancel,
  restaurants,
}: WorkOrderFormProps & { restaurants: RestaurantDto[] }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const scope = useRestaurantScope()
  const apply = useApplyWorkOrder()
  const editing = !!workOrder
  const canAssign = !editing && can('work_orders:assign')
  const draftRef = useRef(false)

  const form = useZodForm(formSchema, {
    defaultValues: workOrder
      ? {
          title: workOrder.title,
          description: workOrder.description ?? '',
          category: workOrder.category,
          priority: workOrder.priority,
          type: workOrder.type,
          restaurantId: workOrder.restaurant.id,
          locationId: workOrder.location?.id ?? NONE,
          assetId: workOrder.asset?.id ?? NONE,
          dueDate: toDateInput(workOrder.dueDate),
          scheduledStart: toDateTimeInput(workOrder.scheduledStart),
          estimatedMinutes: workOrder.estimatedMinutes ?? undefined,
          assignee: NONE,
          helperIds: [],
          vendorId: workOrder.vendor?.id ?? NONE,
          supervisorId: workOrder.supervisor?.id ?? NONE,
          procedureId: NONE,
          repeatUnit: workOrder.repeat?.unit ?? NONE,
          repeatEvery: workOrder.repeat?.every ?? 1,
          repeatBasis: workOrder.repeat?.basis ?? 'SCHEDULE',
          customFields: workOrder.customFields,
          labelIds: workOrder.labels.map((l) => l.id),
        }
      : {
          title: prefill.title ?? '',
          description: prefill.description ?? '',
          category: prefill.category ?? 'OTHER',
          priority: prefill.priority ?? 'MEDIUM',
          type: prefill.type ?? 'REACTIVE',
          restaurantId:
            prefill.restaurantId ??
            scope.restaurantId ??
            (restaurants.length === 1 ? restaurants[0]!.id : ''),
          locationId: prefill.locationId ?? NONE,
          assetId: prefill.assetId ?? NONE,
          dueDate: '',
          scheduledStart: '',
          estimatedMinutes: undefined,
          assignee: NONE,
          helperIds: [],
          vendorId: NONE,
          supervisorId: NONE,
          procedureId: prefill.procedureId ?? NONE,
          repeatUnit: NONE,
          repeatEvery: 1,
          repeatBasis: 'SCHEDULE',
          customFields: {},
          labelIds: [],
        },
  })
  const customFields = useCustomFields('WORK_ORDER')
  const labels = useLabels()
  useCustomFieldDefaults(form, customFields.data)
  const restaurantId = form.watch('restaurantId')
  const assignee = form.watch('assignee')
  const repeatUnit = form.watch('repeatUnit')
  const locations = useLocations(restaurantId || undefined, !!restaurantId)
  const assets = useAssets({ restaurantId, pageSize: 100, sort: 'name:asc' }, !!restaurantId)
  const users = useUserOptions(
    restaurantId || undefined,
    canAssign && !!restaurantId,
    'work_orders:complete',
  )
  const supervisors = useUserOptions(
    restaurantId || undefined,
    !!restaurantId && can('work_orders:assign'),
    'work_orders:approve',
  )
  const vendors = useVendorOptions(undefined, can('vendors:view'))
  const teams = useTeams()
  const procedures = useProcedures(
    { restaurantId },
    !editing && !!restaurantId && can('procedures:view'),
  )

  // Options from another restaurant aren't valid after switching restaurants.
  useEffect(() => {
    const loc = form.getValues('locationId')
    if (loc !== NONE && locations.data && !locations.data.some((l) => l.id === loc))
      form.setValue('locationId', NONE)
  }, [locations.data, form])
  // Assets belong to one restaurant: picking another restaurant clears it.
  const assetRestaurant = useRef(restaurantId)
  useEffect(() => {
    if (assetRestaurant.current === restaurantId) return
    assetRestaurant.current = restaurantId
    form.setValue('assetId', NONE)
  }, [restaurantId, form])
  useEffect(() => {
    const a = form.getValues('assetId')
    if (a !== NONE && assets.data && assetMissingFrom(assets.data, a))
      form.setValue('assetId', NONE)
  }, [assets.data, form])
  // The job's own asset may be beyond the first 100 loaded: still show its name.
  const knownAsset =
    workOrder?.asset && workOrder.restaurant.id === restaurantId ? workOrder.asset : null
  const assetOptions = [
    ...(assets.data?.data ?? []),
    ...(knownAsset && !assets.data?.data.some((x) => x.id === knownAsset.id) ? [knownAsset] : []),
  ]
  useEffect(() => {
    const p = form.getValues('procedureId')
    if (p !== NONE && procedures.data && !procedures.data.some((x) => x.id === p))
      form.setValue('procedureId', NONE)
  }, [procedures.data, form])
  useEffect(() => {
    if (!users.data) return
    const v = form.getValues('assignee')
    if (v.startsWith('user:') && !users.data.some((u) => `user:${u.id}` === v))
      form.setValue('assignee', NONE)
    const helpers = form.getValues('helperIds')
    const valid = helpers.filter((h) => users.data.some((u) => u.id === h))
    if (valid.length !== helpers.length) form.setValue('helperIds', valid)
  }, [users.data, form])
  useEffect(() => {
    const v = form.getValues('supervisorId')
    if (v !== NONE && supervisors.data && !supervisors.data.some((u) => u.id === v))
      form.setValue('supervisorId', NONE)
  }, [supervisors.data, form])

  const teamOptions = canAssign
    ? (teams.data ?? []).filter((tm) => !tm.restaurant || tm.restaurant.id === restaurantId)
    : []
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    const base = {
      title: v.title,
      description: v.description,
      category: v.category,
      priority: v.priority,
      restaurantId: v.restaurantId,
      locationId: orBlank(v.locationId),
      assetId: orBlank(v.assetId),
      dueDate: toDueIso(v.dueDate),
      estimatedMinutes: v.estimatedMinutes,
      scheduledStart: toIso(v.scheduledStart),
      ...(can('vendors:view') ? { vendorId: orBlank(v.vendorId) } : {}),
      ...(can('work_orders:assign') ? { supervisorId: orBlank(v.supervisorId) } : {}),
      repeat:
        v.repeatUnit === NONE
          ? null
          : {
              every: v.repeatEvery ?? 1,
              unit: v.repeatUnit as RepeatUnit,
              basis: v.repeatBasis,
            },
      ...(customFields.data
        ? { customFields: fromCustomForm(customFields.data, v.customFields) }
        : {}),
      ...(labels.data
        ? { labelIds: v.labelIds.filter((id) => labels.data.some((l) => l.id === id)) }
        : {}),
    } satisfies UpdateWorkOrderInput
    try {
      let saved: WorkOrderDetail
      if (workOrder) {
        saved = await workOrdersApi.update(workOrder.id, base)
      } else {
        const userId = v.assignee.startsWith('user:') ? v.assignee.slice(5) : ''
        const input: CreateWorkOrderInput = {
          ...base,
          type: v.type as WorkOrderType,
          assignedUserId: userId,
          assignedTeamId: v.assignee.startsWith('team:') ? v.assignee.slice(5) : '',
          helperIds: canAssign ? v.helperIds.filter((h) => h !== userId) : undefined,
          parentId: prefill.parent?.id ?? '',
          requestId: prefill.requestId ?? '',
          procedureId: orBlank(v.procedureId),
          asDraft: draftRef.current,
        }
        saved = await workOrdersApi.create(input)
      }
      await apply(saved)
      toast.success(
        editing
          ? t('wo.saved')
          : draftRef.current
            ? t('wo.draftSaved', { code: saved.code })
            : t('wo.created', { code: saved.code }),
      )
      onDone(saved)
    } catch (err) {
      if (
        !applyServerErrors(form, err, {
          assignedUserId: 'assignee',
          assignedTeamId: 'assignee',
        })
      )
        form.setError('root', { message: describeError(err, t) })
    }
  })

  const assigneeId = assignee.startsWith('user:') ? assignee.slice(5) : ''

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        {prefill.parent && (
          <p className="rounded-md bg-muted px-3 py-2 text-13">
            {t('wo.subOf', { code: prefill.parent.code, title: prefill.parent.title })}
          </p>
        )}
        <TextField control={form.control} name="title" label={t('wo.fieldTitle')} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="category"
            label={t('wo.fieldCategory')}
            required
            options={WORK_ORDER_CATEGORY.map((c) => ({
              value: c,
              label: enumLabel(t, 'workOrderCategory', c),
            }))}
          />
          <SelectField
            control={form.control}
            name="priority"
            label={t('wo.fieldPriority')}
            required
            options={PRIORITY.map((p) => ({ value: p, label: enumLabel(t, 'priority', p) }))}
          />
        </div>
        <SelectField
          control={form.control}
          name="restaurantId"
          label={t('wo.fieldRestaurant')}
          required
          disabled={
            !!prefill.requestId ||
            !!prefill.parent ||
            (editing && (workOrder.assignedUser !== null || workOrder.helpers.length > 0))
          }
          placeholder={t('validation.selectOption')}
          options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="assetId"
            label={t('wo.fieldAsset')}
            disabled={!restaurantId}
            options={[
              { value: NONE, label: t('wo.noAsset') },
              ...assetOptions.map((a) => ({
                value: a.id,
                label: `${a.name} · ${a.assetCode}`,
              })),
            ]}
          />
          <SelectField
            control={form.control}
            name="locationId"
            label={t('wo.fieldLocation')}
            disabled={!restaurantId}
            options={[
              { value: NONE, label: t('assets.noLocation') },
              ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        </div>
        {canAssign && (
          <SelectField
            control={form.control}
            name="assignee"
            label={t('wo.fieldAssignee')}
            disabled={!restaurantId}
            description={t('wo.assigneeHint')}
            options={[
              { value: NONE, label: t('wo.notAssigned') },
              ...(users.data ?? []).map((u) => ({
                value: `user:${u.id}`,
                label: `${u.firstName} ${u.lastName}${u.role ? ` · ${u.role}` : ''}`,
              })),
              ...teamOptions.map((tm) => ({
                value: `team:${tm.id}`,
                label: t('wo.teamOption', { name: tm.name }),
              })),
            ]}
          />
        )}
        <DateField control={form.control} name="dueDate" label={t('wo.fieldDue')} optional />
        <TextareaField
          control={form.control}
          name="description"
          label={t('wo.fieldDescription')}
          optional
          rows={4}
        />
        {/* Required custom fields stay in view; everything optional folds away. */}
        <CustomFieldInputs
          entity="WORK_ORDER"
          control={form.control}
          fields={customFields.data?.filter((f) => f.required)}
        />
        <MoreOptions
          forceOpen={
            editing ||
            !!prefill.procedureId ||
            !!errors.estimatedMinutes ||
            !!errors.scheduledStart ||
            !!errors.repeatEvery ||
            !!errors.customFields
          }
        >
          <div className="grid gap-4">
            <SelectField
              control={form.control}
              name="type"
              label={t('wo.fieldType')}
              disabled={editing}
              options={WORK_ORDER_TYPE.map((v) => ({
                value: v,
                label: enumLabel(t, 'workOrderType', v),
              }))}
            />
            <TextField
              control={form.control}
              name="scheduledStart"
              type="datetime-local"
              label={t('wo.fieldScheduledStart')}
              description={t('wo.scheduledHint')}
              optional
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                control={form.control}
                name="repeatUnit"
                label={t('repeat.label')}
                options={[
                  { value: NONE, label: t('repeat.never') },
                  ...REPEAT_UNIT.map((u) => ({ value: u, label: enumLabel(t, 'repeatUnit', u) })),
                ]}
              />
              {repeatUnit !== NONE && (
                <>
                  <NumberField
                    control={form.control}
                    name="repeatEvery"
                    label={t('repeat.every')}
                    min={1}
                    max={365}
                    step={1}
                    suffix={enumLabel(t, 'repeatUnitPlural', repeatUnit)}
                  />
                  <SelectField
                    control={form.control}
                    name="repeatBasis"
                    label={t('repeat.basis')}
                    options={REPEAT_BASIS.map((b) => ({
                      value: b,
                      label: enumLabel(t, 'repeatBasis', b),
                    }))}
                  />
                </>
              )}
            </div>
            {repeatUnit !== NONE && (
              <p className="-mt-2 text-xs text-muted-foreground">{t('repeat.hint')}</p>
            )}
            {!editing && (procedures.data?.length ?? 0) > 0 && (
              <SelectField
                control={form.control}
                name="procedureId"
                label={t('wo.fieldProcedure')}
                description={t('wo.procedureHint')}
                options={[
                  { value: NONE, label: t('wo.noProcedure') },
                  ...(procedures.data ?? []).map((p) => ({
                    value: p.id,
                    label: t('wo.procedureOption', { name: p.name, count: p.stepCount }),
                  })),
                ]}
              />
            )}
            {(labels.data?.length ?? 0) > 0 && (
              <CheckboxListField
                control={form.control}
                name="labelIds"
                label={t('labels.title')}
                options={(labels.data ?? []).map((l) => ({ value: l.id, label: l.name }))}
              />
            )}
            <CustomFieldInputs
              entity="WORK_ORDER"
              control={form.control}
              fields={customFields.data?.filter((f) => !f.required)}
            />
            <NumberField
              control={form.control}
              name="estimatedMinutes"
              label={t('wo.fieldEstimate')}
              min={5}
              step={5}
              suffix={t('wo.minutes')}
            />
            {can('work_orders:assign') && (
              <SelectField
                control={form.control}
                name="supervisorId"
                label={t('wo.fieldSupervisor')}
                description={t('wo.supervisorHint')}
                disabled={!restaurantId}
                options={[
                  { value: NONE, label: t('wo.anySupervisor') },
                  ...(supervisors.data ?? []).map((u) => ({
                    value: u.id,
                    label: `${u.firstName} ${u.lastName}${u.role ? ` · ${u.role}` : ''}`,
                  })),
                ]}
              />
            )}
            {can('vendors:view') && (
              <SelectField
                control={form.control}
                name="vendorId"
                label={t('wo.fieldVendor')}
                description={t('wo.vendorHint')}
                options={[
                  { value: NONE, label: t('wo.noVendor') },
                  ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })),
                ]}
              />
            )}
            {canAssign && (users.data?.length ?? 0) > 1 && (
              <CheckboxListField
                control={form.control}
                name="helperIds"
                label={t('wo.fieldHelpers')}
                description={t('wo.helpersHint')}
                options={(users.data ?? [])
                  .filter((u) => u.id !== assigneeId)
                  .map((u) => ({
                    value: u.id,
                    label: `${u.firstName} ${u.lastName}`,
                    description: u.role ?? undefined,
                  }))}
              />
            )}
          </div>
        </MoreOptions>
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          {!editing && (
            <Button
              type="submit"
              variant="secondary"
              loading={isSubmitting && draftRef.current}
              disabled={isSubmitting}
              onClick={() => (draftRef.current = true)}
            >
              {t('wo.saveDraft')}
            </Button>
          )}
          <Button
            type="submit"
            loading={isSubmitting && !draftRef.current}
            disabled={isSubmitting}
            onClick={() => (draftRef.current = false)}
          >
            {editing ? t('actions.saveChanges') : t('wo.create')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

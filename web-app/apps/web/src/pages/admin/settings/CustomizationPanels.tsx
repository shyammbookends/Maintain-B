import {
  CUSTOM_FIELD_ENTITY,
  CUSTOM_FIELD_TYPE,
  LABEL_COLORS,
  customFieldSchema,
  labelSchema,
  type CustomFieldDto,
  type CustomFieldEntity,
  type LabelColor,
  type LabelWithUsage,
} from '@maintainx/shared'
import { ArrowDown, ArrowUp, Pencil, Plus, Tag, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LabelChip } from '@/components/common/LabelChip'
import { LABEL_SWATCH_CLASS } from '@/components/common/label-colors'
import {
  Form,
  FormActions,
  FormRootError,
  SelectField,
  SwitchField,
  TextField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/contexts/AuthContext'
import { useCustomFields, useCustomizationApi, useLabels } from '@/services/customization.service'
import { cn } from '@/utils/cn'
import { describeError, reportError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

// ---------------------------------------------------------------- custom fields

/** Extra fields on work orders and assets, one panel per kind. */
export function CustomFieldsPanels() {
  return (
    <div className="grid max-w-3xl gap-4">
      {CUSTOM_FIELD_ENTITY.map((entity) => (
        <FieldsPanel key={entity} entity={entity} />
      ))}
    </div>
  )
}

function FieldsPanel({ entity }: { entity: CustomFieldEntity }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const editable = can('settings:edit')
  const query = useCustomFields(entity)
  const api = useCustomizationApi()
  const [editing, setEditing] = useState<CustomFieldDto | 'new' | null>(null)
  const [removing, setRemoving] = useState<CustomFieldDto | null>(null)
  const fields = query.data ?? []

  async function move(i: number, dir: -1 | 1) {
    const ids = fields.map((f) => f.id)
    ;[ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!]
    try {
      await api.reorderFields(entity, ids)
    } catch (err) {
      reportError(err, t)
    }
  }

  return (
    <Panel>
      <PanelHeader className="flex items-center justify-between gap-2">
        <PanelTitle>{t(`custom.entity_${entity}`)}</PanelTitle>
        {editable && (
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('custom.addField')}
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        {query.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : fields.length === 0 ? (
          <p className="text-13 text-muted-foreground">{t('custom.noFields')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {fields.map((f, i) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {f.label}
                    {f.required && <span className="ml-1 text-danger-fg">*</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {enumLabel(t, 'customFieldType', f.type)}
                    {f.type === 'SELECT' && ` · ${f.options.join(' / ')}`}
                  </span>
                </span>
                {editable && (
                  <span className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('procedures.moveUp', { n: i + 1 })}
                      disabled={i === 0}
                      onClick={() => void move(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('procedures.moveDown', { n: i + 1 })}
                      disabled={i === fields.length - 1}
                      onClick={() => void move(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('custom.editNamed', { name: f.label })}
                      onClick={() => setEditing(f)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('custom.removeNamed', { name: f.label })}
                      onClick={() => setRemoving(f)}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? t('custom.addField') : t('custom.editField')}</DialogTitle>
            <DialogDescription>{t(`custom.entity_${entity}`)}</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <FieldForm
              entity={entity}
              field={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        tone="destructive"
        title={t('custom.removeTitle', { name: removing?.label ?? '' })}
        description={t('custom.removeBody')}
        confirmLabel={t('custom.remove')}
        onConfirm={async () => {
          try {
            await api.removeField(removing!.id, entity)
            toast.success(t('custom.removed'))
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </Panel>
  )
}

const fieldForm = z.object({
  label: z.string().trim().min(2).max(60),
  type: z.enum(CUSTOM_FIELD_TYPE),
  required: z.boolean(),
})

function FieldForm({
  entity,
  field,
  onDone,
}: {
  entity: CustomFieldEntity
  field: CustomFieldDto | null
  onDone: () => void
}) {
  const { t } = useTranslation()
  const api = useCustomizationApi()
  const [options, setOptions] = useState<string[]>(field?.options ?? [])
  const [draft, setDraft] = useState('')
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const form = useZodForm(fieldForm, {
    defaultValues: {
      label: field?.label ?? '',
      type: field?.type ?? 'TEXT',
      required: field?.required ?? false,
    },
  })
  const type = form.watch('type')
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    const input = { ...v, entity, options: v.type === 'SELECT' ? options : [] }
    const checked = customFieldSchema.safeParse(input)
    if (!checked.success) {
      const issue = checked.error.issues.find((i) => i.path[0] === 'options')
      if (issue) return setOptionsError(issue.message)
    }
    try {
      if (field) await api.updateField(field.id, input)
      else await api.createField(input)
      toast.success(field ? t('custom.fieldSaved') : t('custom.fieldAdded'))
      onDone()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  function addOption() {
    const v = draft.trim()
    if (!v || options.some((o) => o.toLowerCase() === v.toLowerCase())) return
    setOptions((o) => [...o, v].slice(0, 20))
    setDraft('')
    setOptionsError(null)
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField control={form.control} name="label" label={t('custom.label')} required />
        <SelectField
          control={form.control}
          name="type"
          label={t('custom.type')}
          disabled={!!field}
          description={field ? t('custom.typeFixed') : undefined}
          options={CUSTOM_FIELD_TYPE.map((x) => ({ value: x, label: enumLabel(t, 'customFieldType', x) }))}
        />
        {type === 'SELECT' && (
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t('custom.choices')}</span>
            {options.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {options.map((o) => (
                  <li key={o}>
                    <Badge tone="outline" className="gap-1 pr-1">
                      {o}
                      <button
                        type="button"
                        aria-label={t('custom.removeChoice', { name: o })}
                        onClick={() => setOptions((list) => list.filter((x) => x !== o))}
                        className="rounded p-0.5 hover:bg-muted"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                value={draft}
                aria-label={t('custom.newChoice')}
                placeholder={t('custom.newChoice')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addOption()
                  }
                }}
              />
              <Button variant="secondary" onClick={addOption}>
                {t('actions.add')}
              </Button>
            </div>
            {optionsError && (
              <p className="text-13 text-danger-fg">{t('validation.optionsRequired')}</p>
            )}
          </div>
        )}
        <SwitchField
          control={form.control}
          name="required"
          label={t('custom.required')}
          description={t('custom.requiredHint')}
        />
        <FormActions>
          <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('actions.save')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

// ---------------------------------------------------------------- labels

/** Labels (custom categories) for work orders: name and colour. */
export function LabelsPanel() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const editable = can('settings:edit')
  const query = useLabels()
  const api = useCustomizationApi()
  const [editing, setEditing] = useState<LabelWithUsage | 'new' | null>(null)
  const [removing, setRemoving] = useState<LabelWithUsage | null>(null)

  return (
    <Panel className="max-w-3xl">
      <PanelHeader className="flex items-center justify-between gap-2">
        <PanelTitle>{t('labels.title')}</PanelTitle>
        {editable && (
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('labels.add')}
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        <p className="mb-3 text-13 text-muted-foreground">{t('labels.hint')}</p>
        {query.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <EmptyState icon={Tag} title={t('labels.none')} />
        ) : (
          <ul className="divide-y rounded-md border">
            {query.data.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                <LabelChip label={l} />
                <span className="flex-1 text-xs text-muted-foreground">
                  {t('labels.usage', { count: l.workOrders })}
                </span>
                {editable && (
                  <span className="flex shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('custom.editNamed', { name: l.name })}
                      onClick={() => setEditing(l)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('custom.removeNamed', { name: l.name })}
                      onClick={() => setRemoving(l)}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? t('labels.add') : t('labels.edit')}</DialogTitle>
            <DialogDescription>{t('labels.hint')}</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <LabelForm label={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        tone="destructive"
        title={t('labels.removeTitle', { name: removing?.name ?? '' })}
        description={t('labels.removeBody', { count: removing?.workOrders ?? 0 })}
        confirmLabel={t('custom.remove')}
        onConfirm={async () => {
          try {
            await api.removeLabel(removing!.id)
            toast.success(t('labels.removed'))
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </Panel>
  )
}

function LabelForm({ label, onDone }: { label: LabelWithUsage | null; onDone: () => void }) {
  const { t } = useTranslation()
  const api = useCustomizationApi()
  const form = useZodForm(labelSchema, {
    defaultValues: { name: label?.name ?? '', color: label?.color ?? 'blue' },
  })
  const color = form.watch('color')
  const name = form.watch('name')
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (label) await api.updateLabel(label.id, v)
      else await api.createLabel(v)
      toast.success(t('labels.saved'))
      onDone()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField control={form.control} name="name" label={t('labels.name')} required />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('labels.color')}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('labels.color')}>
            {LABEL_COLORS.map((c: LabelColor) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={t(`labels.color_${c}`)}
                onClick={() => form.setValue('color', c)}
                className={cn(
                  'size-8 rounded-full ring-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
                  LABEL_SWATCH_CLASS[c],
                  color === c && 'ring-2 ring-foreground',
                )}
              />
            ))}
          </div>
        </fieldset>
        {name.trim().length >= 2 && (
          <p className="text-13 text-muted-foreground">
            {t('labels.preview')} <LabelChip label={{ id: 'preview', name: name.trim(), color }} />
          </p>
        )}
        <FormActions>
          <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('actions.save')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

import {
  INSPECTION_TYPE,
  inspectionTemplateSchema,
  type InspectionTemplateDto,
  type InspectionTemplateInput,
  type ProcedureListItem,
} from '@maintainx/shared'
import { ClipboardCheck, ListChecks, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Can } from '@/components/common/Can'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
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
import { Panel } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toaster'
import { useAuth, useCurrentUser } from '@/contexts/AuthContext'
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import {
  mxKeys,
  templatesApi,
  useInspectionTemplates,
  useProcedures,
} from '@/services/maintenance.service'
import { describeError, reportError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'
import { ProcedureLibraryButton } from './ProcedureLibrary'

const ALL = '__all__'
/** Like the API schema, but the restaurant select uses ALL for "every restaurant". */
const templateFormSchema = inspectionTemplateSchema.extend({
  restaurantId: z.string().min(1, 'validation.selectOption'),
})

export function ProceduresPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'templates' ? 'templates' : 'procedures'

  return (
    <>
      <PageHeader
        title={t('procedures.title')}
        description={t('procedures.subtitle')}
        actions={
          tab === 'procedures' ? (
            <Can permission="procedures:create">
              <ProcedureLibraryButton />
              <Button asChild>
                <Link to="/procedures/new">
                  <Plus aria-hidden /> {t('procedures.new')}
                </Link>
              </Button>
            </Can>
          ) : undefined
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'templates' ? { tab: v } : {}, { replace: true })}
      >
        <TabsList aria-label={t('procedures.title')} className="mb-3">
          <TabsTrigger value="procedures">{t('procedures.tabProcedures')}</TabsTrigger>
          <TabsTrigger value="templates">{t('procedures.tabTemplates')}</TabsTrigger>
        </TabsList>
        <TabsContent value="procedures">
          <ProcedureList />
        </TabsContent>
        <TabsContent value="templates">
          <TemplateList />
        </TabsContent>
      </Tabs>
    </>
  )
}

function ProcedureList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const query = useProcedures()
  if (query.isPending) return <Skeleton className="h-48 w-full" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (query.data.length === 0)
    return (
      <Panel>
        <EmptyState
          icon={ListChecks}
          title={t('procedures.emptyTitle')}
          description={t('procedures.emptyBody')}
          action={
            <Can permission="procedures:create">
              <Button size="sm" onClick={() => navigate('/procedures/new')}>
                <Plus aria-hidden /> {t('procedures.new')}
              </Button>
            </Can>
          }
        />
      </Panel>
    )
  return (
    <Panel>
      <ul className="divide-y">
        {query.data.map((p: ProcedureListItem) => (
          <li key={p.id}>
            <Link
              to={`/procedures/${p.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="block text-13 text-muted-foreground">
                  {t('procedures.stepCount', { count: p.stepCount })}
                  {p.category && ` · ${enumLabel(t, 'workOrderCategory', p.category)}`}
                  {` · ${p.restaurant?.name ?? t('procedures.allRestaurants')}`}
                </span>
              </span>
              {(p.usedBy.schedules > 0 || p.usedBy.templates > 0) && (
                <span className="text-xs text-muted-foreground">
                  {t('procedures.usedBy', {
                    schedules: p.usedBy.schedules,
                    templates: p.usedBy.templates,
                  })}
                </span>
              )}
              <Badge tone="outline">v{p.version}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function TemplateList() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const query = useInspectionTemplates()
  const [editing, setEditing] = useState<InspectionTemplateDto | 'new' | null>(null)
  const [archiving, setArchiving] = useState<InspectionTemplateDto | null>(null)
  const archive = useInvalidatingMutation(
    (id: string) => templatesApi.archive(id),
    [mxKeys.templates],
  )

  return (
    <>
      <div className="mb-3 flex justify-end">
        {can('procedures:create') && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('templates.new')}
          </Button>
        )}
      </div>
      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <Panel>
          <EmptyState
            icon={ClipboardCheck}
            title={t('templates.emptyTitle')}
            description={t('templates.emptyBody')}
          />
        </Panel>
      ) : (
        <Panel>
          <ul className="divide-y">
            {query.data.map((tp) => (
              <li key={tp.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{tp.name}</span>
                  <span className="block text-13 text-muted-foreground">
                    {enumLabel(t, 'inspectionType', tp.type)} · {tp.procedure.name} ·{' '}
                    {t('procedures.stepCount', { count: tp.procedure.stepCount })} ·{' '}
                    {tp.restaurant?.name ?? t('procedures.allRestaurants')}
                  </span>
                </span>
                {!tp.active && <Badge tone="outline">{t('templates.inactive')}</Badge>}
                {can('procedures:edit') && (
                  <Button variant="secondary" size="sm" onClick={() => setEditing(tp)}>
                    {t('actions.edit')}
                  </Button>
                )}
                {can('procedures:delete') && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('templates.archiveNamed', { name: tp.name })}
                    onClick={() => setArchiving(tp)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{editing === 'new' ? t('templates.new') : t('templates.edit')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing && (
              <TemplateForm
                template={editing === 'new' ? null : editing}
                onDone={() => setEditing(null)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        tone="destructive"
        title={t('templates.archiveTitle', { name: archiving?.name ?? '' })}
        description={t('templates.archiveBody')}
        confirmLabel={t('actions.archive')}
        onConfirm={async () => {
          try {
            await archive.mutateAsync(archiving!.id)
            toast.success(t('templates.archived'))
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

function TemplateForm({
  template,
  onDone,
}: {
  template: InspectionTemplateDto | null
  onDone: () => void
}) {
  const restaurants = useRestaurants()
  const procedures = useProcedures()
  if (!restaurants.data || !procedures.data) return <Skeleton className="h-40 w-full" />
  return (
    <TemplateFormInner
      template={template}
      onDone={onDone}
      restaurants={restaurants.data}
      procedures={procedures.data}
    />
  )
}

function TemplateFormInner({
  template,
  onDone,
  restaurants,
  procedures,
}: {
  template: InspectionTemplateDto | null
  onDone: () => void
  restaurants: Array<{ id: string; name: string }>
  procedures: ProcedureListItem[]
}) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const form = useZodForm(templateFormSchema, {
    defaultValues: template
      ? {
          name: template.name,
          type: template.type,
          procedureId: template.procedure.id,
          restaurantId: template.restaurant?.id ?? ALL,
          active: template.active,
        }
      : {
          name: '',
          type: 'OPENING',
          procedureId: '',
          restaurantId: user.isSuperAdmin ? ALL : (restaurants[0]?.id ?? ''),
          active: true,
        },
  })
  const restaurantId = form.watch('restaurantId')
  const usable = procedures.filter(
    (p) => !p.restaurant || (restaurantId !== ALL && p.restaurant.id === restaurantId),
  )
  const save = useInvalidatingMutation(
    (input: InspectionTemplateInput) =>
      template ? templatesApi.update(template.id, input) : templatesApi.create(input),
    [mxKeys.templates, mxKeys.procedures],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({ ...v, restaurantId: v.restaurantId === ALL ? '' : v.restaurantId })
      toast.success(t('templates.saved'))
      onDone()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField control={form.control} name="name" label={t('templates.name')} required />
        <SelectField
          control={form.control}
          name="type"
          label={t('templates.type')}
          required
          options={INSPECTION_TYPE.map((x) => ({
            value: x,
            label: enumLabel(t, 'inspectionType', x),
          }))}
        />
        <SelectField
          control={form.control}
          name="restaurantId"
          label={t('wo.fieldRestaurant')}
          required
          options={[
            ...(user.isSuperAdmin ? [{ value: ALL, label: t('procedures.allRestaurants') }] : []),
            ...restaurants.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
        <SelectField
          control={form.control}
          name="procedureId"
          label={t('wo.fieldProcedure')}
          required
          placeholder={t('validation.selectOption')}
          description={
            usable.length === 0 ? t('templates.noProcedures') : t('templates.procedureHint')
          }
          options={usable.map((p) => ({
            value: p.id,
            label: t('wo.procedureOption', { name: p.name, count: p.stepCount }),
          }))}
        />
        <SwitchField
          control={form.control}
          name="active"
          label={t('templates.active')}
          description={t('templates.activeHint')}
        />
        <FormActions>
          <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {template ? t('actions.saveChanges') : t('actions.create')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

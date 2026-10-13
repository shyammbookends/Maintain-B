import {
  DEFAULT_WORKFLOW,
  STRICT_WORKFLOW,
  workflowSettingsSchema,
  type WorkflowSettings,
} from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import {
  Form,
  FormActions,
  FormRootError,
  SwitchField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/contexts/AuthContext'
import { WORKFLOW_KEY, useWorkflowQuery } from '@/contexts/WorkflowContext'
import { http } from '@/services/http'
import { describeError } from '@/utils/errors'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSearchParams } from 'react-router'
import { CustomFieldsPanels, LabelsPanel } from './CustomizationPanels'
import { IntegrationsPanels } from './IntegrationsPanels'

const TABS = ['workflow', 'fields', 'labels', 'integrations'] as const

/** How strict the work order flow is: simple (MaintainX) by default, every rule a switch. */
export function SettingsPage() {
  const { t } = useTranslation()
  const query = useWorkflowQuery()
  const [params, setParams] = useSearchParams()
  // API keys and webhooks are for people who may change settings.
  const canEdit = useAuth().can('settings:edit')
  const tab = TABS.find((x) => x === params.get('tab')) ?? 'workflow'
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'workflow' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList aria-label={t('settings.title')} className="mb-3">
          <TabsTrigger value="workflow">{t('settings.tabWorkflow')}</TabsTrigger>
          <TabsTrigger value="fields">{t('settings.tabFields')}</TabsTrigger>
          <TabsTrigger value="labels">{t('settings.tabLabels')}</TabsTrigger>
          {canEdit && (
            <TabsTrigger value="integrations">{t('settings.tabIntegrations')}</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="workflow">
          {query.isPending ? (
            <Skeleton className="h-96 w-full max-w-3xl" />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <WorkflowForm settings={query.data} />
          )}
        </TabsContent>
        <TabsContent value="fields">{tab === 'fields' && <CustomFieldsPanels />}</TabsContent>
        <TabsContent value="labels">{tab === 'labels' && <LabelsPanel />}</TabsContent>
        <TabsContent value="integrations">
          {tab === 'integrations' && canEdit && <IntegrationsPanels />}
        </TabsContent>
      </Tabs>
    </>
  )
}

const SWITCHES = {
  completion: ['requireBeforePhoto', 'requireAfterPhoto', 'requireRepairReport', 'requireVerification'],
  display: ['simpleStatuses', 'showReservations', 'showCycleCounts'],
  portal: ['requestPortal'],
} as const satisfies Record<string, ReadonlyArray<keyof WorkflowSettings>>

function WorkflowForm({ settings }: { settings: WorkflowSettings }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const qc = useQueryClient()
  const editable = can('settings:edit')
  const form = useZodForm(workflowSettingsSchema, { defaultValues: settings })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const next = await http.put<{ data: WorkflowSettings }>('/settings/workflow', v)
      qc.setQueryData(WORKFLOW_KEY, next.data)
      // A job's allowed actions and completion rules follow these switches.
      void qc.invalidateQueries({ queryKey: ['work-orders'] })
      void qc.invalidateQueries({ queryKey: ['me'] })
      form.reset(next.data)
      toast.success(t('settings.saved'))
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  const preset = (p: WorkflowSettings) =>
    (Object.keys(p) as Array<keyof WorkflowSettings>).forEach((k) =>
      form.setValue(k, p[k], { shouldDirty: true }),
    )

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid max-w-3xl gap-4">
        <FormRootError message={errors.root?.message} />
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => preset(DEFAULT_WORKFLOW)}>
              {t('settings.presetSimple')}
            </Button>
            <Button variant="secondary" onClick={() => preset(STRICT_WORKFLOW)}>
              {t('settings.presetStrict')}
            </Button>
          </div>
        )}
        {(Object.keys(SWITCHES) as Array<keyof typeof SWITCHES>).map((group) => (
          <Panel key={group}>
            <PanelHeader>
              <PanelTitle>{t(`settings.group_${group}`)}</PanelTitle>
            </PanelHeader>
            <PanelBody className="grid gap-3">
              {SWITCHES[group].map((name) => (
                <SwitchField
                  key={name}
                  control={form.control}
                  name={name}
                  label={t(`settings.${name}`)}
                  description={t(`settings.${name}Hint`)}
                  disabled={!editable}
                />
              ))}
            </PanelBody>
          </Panel>
        ))}
        {editable && (
          <FormActions>
            <Button type="submit" loading={isSubmitting}>
              {t('actions.save')}
            </Button>
          </FormActions>
        )}
      </form>
    </Form>
  )
}

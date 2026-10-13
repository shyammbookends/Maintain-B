import {
  FAILURE_CATEGORY,
  fullName,
  rootCauseSchema,
  type RootCauseInput,
  type WorkOrderDetail,
} from '@maintainx/shared'
import { Pencil, SearchCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DetailList } from '@/components/common/DetailList'
import {
  Form,
  FormActions,
  FormRootError,
  SelectField,
  TextareaField,
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
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { describeError } from '@/utils/errors'
import { formatDateTime } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

/**
 * Root cause analysis: what failed, why, and what stops it happening again.
 * Shown once there is something to analyse (the job has started).
 */
export function RootCausePanel({
  w,
  save,
}: {
  w: WorkOrderDetail
  save: (v: RootCauseInput) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const r = w.rootCause
  if (!r && !w.actions.rca) return null
  return (
    <Panel>
      <PanelHeader className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle>{t('rca.title')}</PanelTitle>
        {w.actions.rca && (
          <Button size="sm" variant={r ? 'ghost' : 'secondary'} onClick={() => setEditing(true)}>
            {r ? <Pencil aria-hidden /> : <SearchCheck aria-hidden />}
            {r ? t('actions.edit') : t('rca.record')}
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        {r ? (
          <>
            <Badge tone="outline" className="mb-2">
              {enumLabel(t, 'failureCategory', r.category)}
            </Badge>
            <DetailList
              items={[
                { label: t('rca.failure'), value: r.failure },
                { label: t('rca.cause'), value: r.cause },
                { label: t('rca.rootCause'), value: r.rootCause },
                { label: t('rca.corrective'), value: r.correctiveAction },
                { label: t('rca.preventive'), value: r.preventiveAction },
              ]}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {fullName(r.createdBy)} · {formatDateTime(r.updatedAt)}
            </p>
          </>
        ) : (
          <p className="text-13 text-muted-foreground">{t('rca.empty')}</p>
        )}
      </PanelBody>
      {editing && <RootCauseDialog w={w} save={save} onClose={() => setEditing(false)} />}
    </Panel>
  )
}

function RootCauseDialog({
  w,
  save,
  onClose,
}: {
  w: WorkOrderDetail
  save: (v: RootCauseInput) => Promise<unknown>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const r = w.rootCause
  const form = useZodForm(rootCauseSchema, {
    defaultValues: {
      failure: r?.failure ?? w.completion?.problemFound ?? w.title,
      cause: r?.cause ?? '',
      rootCause: r?.rootCause ?? w.completion?.rootCause ?? '',
      category: r?.category ?? 'UNKNOWN',
      correctiveAction: r?.correctiveAction ?? w.completion?.workPerformed ?? '',
      preventiveAction: r?.preventiveAction ?? w.completion?.recommendation ?? '',
    },
  })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save(v)
      onClose()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('rca.title')}</DialogTitle>
          <DialogDescription>
            {w.code} · {w.title}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <TextareaField
              control={form.control}
              name="failure"
              label={t('rca.failure')}
              required
              rows={2}
            />
            <SelectField
              control={form.control}
              name="category"
              label={t('rca.category')}
              required
              options={FAILURE_CATEGORY.map((c) => ({
                value: c,
                label: enumLabel(t, 'failureCategory', c),
              }))}
            />
            <TextareaField
              control={form.control}
              name="cause"
              label={t('rca.cause')}
              optional
              rows={2}
            />
            <TextareaField
              control={form.control}
              name="rootCause"
              label={t('rca.rootCause')}
              description={t('rca.rootCauseHint')}
              required
              rows={2}
            />
            <TextareaField
              control={form.control}
              name="correctiveAction"
              label={t('rca.corrective')}
              optional
              rows={2}
            />
            <TextareaField
              control={form.control}
              name="preventiveAction"
              label={t('rca.preventive')}
              description={t('rca.preventiveHint')}
              optional
              rows={2}
            />
            <FormActions>
              <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('actions.save')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

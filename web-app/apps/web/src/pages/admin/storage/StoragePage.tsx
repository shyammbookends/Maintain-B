import { storagePolicySchema, type StorageUsage } from '@maintainx/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, HardDrive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Can } from '@/components/common/Can'
import { Callout } from '@/components/common/Callout'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import {
  Form,
  FormActions,
  FormRootError,
  NumberField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { http } from '@/services/http'
import { describeError } from '@/utils/errors'
import { formatNumber } from '@/utils/format'
import { cn } from '@/utils/cn'

const KEY = ['storage'] as const

function bytes(n: number) {
  if (n < 1024 * 1024) return `${formatNumber(Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${formatNumber(Math.round((n / 1024 / 1024) * 10) / 10)} MB`
  return `${formatNumber(Math.round((n / 1024 / 1024 / 1024) * 100) / 100)} GB`
}

/** One meter: used / limit with a status colour and the numbers in words. */
function Meter({
  label,
  used,
  limit,
  icon: Icon,
}: {
  label: string
  used: number
  limit: number
  icon: typeof Database
}) {
  const { t } = useTranslation()
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const tone = pct >= 95 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-primary'
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Icon className="size-4 text-muted-foreground" aria-hidden /> {label}
        </span>
        <span className="tabular text-muted-foreground">
          {t('storage.usedOf', { used: bytes(used), limit: bytes(limit), pct })}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full', tone)}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
    </div>
  )
}

/** How much space files and the database use, and how long files are kept. */
export function StoragePage() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      http.get<{ data: StorageUsage }>('/storage', { signal }).then((r) => r.data),
  })
  const u = query.data
  return (
    <>
      <PageHeader title={t('storage.title')} description={t('storage.subtitle')} />
      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="content-start">
            <PanelHeader>
              <PanelTitle>{t('storage.usage')}</PanelTitle>
            </PanelHeader>
            <PanelBody className="grid gap-5">
              {u!.driver !== 'supabase' && (
                <Callout tone="warning">{t('storage.notSupabase')}</Callout>
              )}
              <Meter
                label={t('storage.files')}
                used={u!.files.total}
                limit={u!.fileQuotaBytes}
                icon={HardDrive}
              />
              <Meter
                label={t('storage.database')}
                used={u!.databaseBytes}
                limit={u!.databaseQuotaBytes}
                icon={Database}
              />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {(['photos', 'videos', 'audio', 'documents'] as const).map((k) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{t(`storage.kind_${k}`)}</dt>
                    <dd className="tabular">
                      {formatNumber(u!.counts[k])} · {bytes(u!.files[k])}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs text-muted-foreground">{t('storage.growth')}</dt>
                  <dd className="tabular">
                    {t('storage.perDay', { size: bytes(u!.dailyGrowthBytes) })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('storage.fullIn')}</dt>
                  <dd className="tabular">
                    {u!.daysUntilFull === null
                      ? '—'
                      : t('storage.days', { count: u!.daysUntilFull })}
                  </dd>
                </div>
              </dl>
            </PanelBody>
          </Panel>
          <PolicyPanel usage={u!} />
        </div>
      )}
    </>
  )
}

function PolicyPanel({ usage }: { usage: StorageUsage }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const form = useZodForm(storagePolicySchema, { defaultValues: usage.policy })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const next = await http.put<{ data: StorageUsage }>('/storage/policy', v)
      qc.setQueryData(KEY, next.data)
      toast.success(t('storage.saved'))
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Panel className="content-start">
      <PanelHeader>
        <PanelTitle>{t('storage.policy')}</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <p className="mb-4 text-13 text-muted-foreground">{t('storage.policyHint')}</p>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <NumberField
              control={form.control}
              name="compactPhotosAfterDays"
              label={t('storage.compactAfter')}
              description={t('storage.compactHint')}
              min={30}
              step={1}
              suffix={t('storage.daysUnit')}
            />
            <NumberField
              control={form.control}
              name="keepVideosDays"
              label={t('storage.keepVideos')}
              description={t('storage.keepVideosHint')}
              min={30}
              step={1}
              suffix={t('storage.daysUnit')}
            />
            <NumberField
              control={form.control}
              name="keepFilesYears"
              label={t('storage.keepFiles')}
              description={t('storage.keepFilesHint')}
              min={1}
              step={1}
              suffix={t('storage.yearsUnit')}
            />
            <Can permission="settings:edit">
              <FormActions>
                <Button type="submit" loading={isSubmitting}>
                  {t('actions.save')}
                </Button>
              </FormActions>
            </Can>
          </form>
        </Form>
      </PanelBody>
    </Panel>
  )
}

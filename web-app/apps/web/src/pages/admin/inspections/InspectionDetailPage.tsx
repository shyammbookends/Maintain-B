import { fullName } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { Checklist } from '@/components/checklists/Checklist'
import { DetailList } from '@/components/common/DetailList'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useInspection } from '@/services/maintenance.service'
import { formatDateTime } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { InspectionResult } from './InspectionsPage'

/** Read-only record of a completed (or running) inspection. */
export function InspectionDetailPage() {
  const { t } = useTranslation()
  const { inspectionId = '' } = useParams()
  const query = useInspection(inspectionId)
  const back = { to: '/inspections', label: t('inspections.title') }

  if (query.isPending)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  if (query.isError)
    return (
      <>
        <PageHeader title={t('inspections.title')} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  const i = query.data
  return (
    <>
      <PageHeader
        back={back}
        title={i.name}
        meta={
          <>
            <span className="text-13 text-muted-foreground tabular">{i.code}</span>
            <InspectionResult i={i} />
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel className="content-start">
          <PanelHeader>
            <PanelTitle>{t('wo.details')}</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <DetailList
              items={[
                { label: t('templates.type'), value: enumLabel(t, 'inspectionType', i.type) },
                { label: t('wo.fieldRestaurant'), value: i.restaurant.name },
                {
                  label: t('wo.fieldAsset'),
                  value: i.asset && (
                    <Link to={`/assets/${i.asset.id}`} className="text-primary hover:underline">
                      {i.asset.name} · {i.asset.assetCode}
                    </Link>
                  ),
                },
                { label: t('inspections.colBy'), value: fullName(i.performedBy) },
                { label: t('inspections.colStarted'), value: formatDateTime(i.startedAt) },
                {
                  label: t('inspections.colSubmitted'),
                  value: i.submittedAt && formatDateTime(i.submittedAt),
                },
                {
                  label: t('inspections.summary'),
                  value: t('inspections.summaryValue', {
                    pass: i.passCount,
                    fail: i.failCount,
                    na: i.naCount,
                  }),
                  hidden: i.status !== 'SUBMITTED',
                },
              ]}
            />
            {i.notes && (
              <div className="mt-3 rounded-md bg-muted px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('inspections.notes')}
                </p>
                <p className="text-sm whitespace-pre-wrap">{i.notes}</p>
              </div>
            )}
          </PanelBody>
        </Panel>
        <Panel className="content-start">
          <PanelHeader>
            <PanelTitle>{t('checklist.title')}</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <Checklist items={i.items} editable={false} />
          </PanelBody>
        </Panel>
      </div>
    </>
  )
}

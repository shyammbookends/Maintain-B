import { REPORT_GROUPS } from '@maintainx/shared'
import { BarChart3, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Can } from '@/components/common/Can'
import { PageHeader } from '@/components/common/PageHeader'
import { ScheduledReportsPanel } from '@/components/reports/ReportSchedules'
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel'

/** Catalogue of reports, grouped by topic. */
export function ReportsPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('reports.title')} description={t('reports.subtitle')} />
      <Can permission="reports:export">
        <ScheduledReportsPanel />
      </Can>
      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(REPORT_GROUPS) as Array<keyof typeof REPORT_GROUPS>).map((group) => (
          <Panel key={group} className="content-start">
            <PanelHeader>
              <PanelTitle>{t(`reports.group_${group}`)}</PanelTitle>
            </PanelHeader>
            <ul className="divide-y">
              {REPORT_GROUPS[group].map((key) => (
                <li key={key}>
                  <Link
                    to={`/reports/${key}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <BarChart3 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{t(`reports.name.${key}`)}</span>
                      <span className="block text-13 text-muted-foreground">
                        {t(`reports.desc.${key}`)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  )
}

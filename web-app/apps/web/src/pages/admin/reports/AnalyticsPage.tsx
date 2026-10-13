import {
  CheckCheck,
  ClipboardList,
  Gauge,
  IndianRupee,
  ShieldCheck,
  Timer,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { Callout } from '@/components/common/Callout'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatStrip } from '@/components/common/StatStrip'
import { BarList } from '@/components/charts/BarList'
import { TrendChart } from '@/components/charts/TrendChart'
import { FilterSelect } from '@/components/tables'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useScopedRestaurantParam } from '@/hooks/useScopeFilter'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useTrends } from '@/services/automations.service'
import { formatCurrency, formatNumber } from '@/utils/format'

const localDay = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Maintenance KPIs over time: workload, repair speed, reliability, cost. */
export function AnalyticsPage() {
  const { t } = useTranslation()
  const restaurants = useRestaurants()
  const [params, setParams] = useSearchParams()
  const today = localDay(new Date())
  const from = params.get('from') ?? localDay(new Date(Date.now() - 89 * 86_400_000))
  const to = params.get('to') ?? today
  const [restaurantId, setRestaurantId] = useScopedRestaurantParam()
  const valid = from <= to && Date.parse(to) - Date.parse(from) <= 366 * 86_400_000
  const query = useTrends({ from, to, restaurantId })
  const set = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const d = query.data
  const hours = (h: number | null) => (h === null ? '—' : t('dashboard.hours', { value: h }))
  const pct = (p: number | null) => (p === null ? '—' : `${p}%`)

  return (
    <>
      <PageHeader title={t('analytics.title')} description={t('analytics.subtitle')} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="an-from">{t('reports.from')}</Label>
          <Input
            id="an-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => set('from', e.target.value)}
            className="tabular"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="an-to">{t('reports.to')}</Label>
          <Input
            id="an-to"
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => set('to', e.target.value)}
            className="tabular"
          />
        </div>
        {(restaurants.data?.length ?? 0) > 1 && (
          <FilterSelect
            label={t('wo.colRestaurant')}
            value={restaurantId}
            onChange={setRestaurantId}
            options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
          />
        )}
      </div>

      {!valid ? (
        <Callout tone="warning">{t('validation.rangeTooLong')}</Callout>
      ) : query.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid gap-4">
          <StatStrip
            className="lg:grid-cols-7"
            stats={[
              {
                label: t('analytics.created'),
                value: formatNumber(d!.totals.created),
                icon: ClipboardList,
              },
              {
                label: t('analytics.completed'),
                value: formatNumber(d!.totals.completed),
                icon: CheckCheck,
              },
              {
                label: t('analytics.reactiveShare'),
                value: pct(
                  d!.totals.created
                    ? Math.round((d!.totals.reactive / d!.totals.created) * 1000) / 10
                    : null,
                ),
                hint: t('analytics.mixHint', {
                  reactive: d!.totals.reactive,
                  preventive: d!.totals.preventive,
                }),
                icon: Wrench,
              },
              {
                label: t('analytics.pmCompliance'),
                value: pct(d!.totals.pmCompliance),
                icon: ShieldCheck,
              },
              { label: t('analytics.mttr'), value: hours(d!.totals.mttrHours), icon: Timer },
              { label: t('analytics.mtbf'), value: hours(d!.totals.mtbfHours), icon: Gauge },
              {
                label: t('analytics.cost'),
                value: formatCurrency(d!.totals.cost.total),
                icon: IndianRupee,
              },
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('analytics.workTitle')}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <TrendChart
                  label={t('analytics.workTitle')}
                  dates={d!.points.map((p) => p.start)}
                  series={[
                    {
                      key: 'created',
                      label: t('analytics.created'),
                      colorClass: 'text-chart-1',
                      swatchClass: 'bg-chart-1',
                      values: d!.points.map((p) => p.created),
                    },
                    {
                      key: 'completed',
                      label: t('analytics.completed'),
                      colorClass: 'text-chart-3',
                      swatchClass: 'bg-chart-3',
                      values: d!.points.map((p) => p.completed),
                    },
                  ]}
                />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('analytics.mixTitle')}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <TrendChart
                  label={t('analytics.mixTitle')}
                  dates={d!.points.map((p) => p.start)}
                  series={[
                    {
                      key: 'reactive',
                      label: t('analytics.reactive'),
                      colorClass: 'text-chart-2',
                      swatchClass: 'bg-chart-2',
                      values: d!.points.map((p) => p.reactive),
                    },
                    {
                      key: 'preventive',
                      label: t('analytics.preventive'),
                      colorClass: 'text-chart-1',
                      swatchClass: 'bg-chart-1',
                      values: d!.points.map((p) => p.preventive),
                    },
                  ]}
                />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('analytics.mttrTitle')}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <TrendChart
                  label={t('analytics.mttrTitle')}
                  dates={d!.points.map((p) => p.start)}
                  series={[
                    {
                      key: 'mttr',
                      label: t('analytics.mttr'),
                      colorClass: 'text-chart-4',
                      swatchClass: 'bg-chart-4',
                      values: d!.points.map((p) => p.mttrHours ?? 0),
                    },
                  ]}
                />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader className="flex items-center justify-between gap-2">
                <PanelTitle>{t('analytics.costTitle')}</PanelTitle>
                <Link
                  to={`/reports/cost-breakdown?from=${from}&to=${to}`}
                  className="text-13 font-medium text-primary"
                >
                  {t('analytics.byRestaurant')}
                </Link>
              </PanelHeader>
              <PanelBody>
                <BarList
                  format={formatCurrency}
                  items={(['parts', 'labour', 'vendor', 'other'] as const).map((k) => ({
                    key: k,
                    label: t(`analytics.cost_${k}`),
                    value: d!.totals.cost[k],
                  }))}
                />
              </PanelBody>
            </Panel>
          </div>
          <p className="text-13 text-muted-foreground">
            {t('analytics.definitions')}{' '}
            <Link to="/reports" className="font-medium text-primary">
              {t('analytics.allReports')}
            </Link>
          </p>
        </div>
      )}
    </>
  )
}

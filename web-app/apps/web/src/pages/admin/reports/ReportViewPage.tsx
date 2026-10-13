import {
  PRIORITY,
  REPORT_FILTER_KEYS,
  REPORT_KEYS,
  SNAPSHOT_REPORTS,
  WORK_ORDER_FILTER_REPORTS,
  WORK_ORDER_STATUS,
  WORK_ORDER_TYPE,
  fullName,
  type ReportCell,
  type ReportColumn,
  type ReportColumnType,
  type ReportFilters,
  type ReportKey,
} from '@maintainx/shared'
import { Download, FileText, Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { Can } from '@/components/common/Can'
import { Callout } from '@/components/common/Callout'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { ReportScheduleSheet } from '@/components/reports/ReportSchedules'
import { FilterSelect } from '@/components/tables'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Panel } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useScopedRestaurantParam } from '@/hooks/useScopeFilter'
import { useRestaurants, useTeams, useUserOptions } from '@/hooks/useAdminQueries'
import { useAssets } from '@/services/assets.service'
import { useVendorOptions } from '@/services/purchasing.service'
import { reportsApi, useReport } from '@/services/platform.service'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/utils/format'
import { enumLabel, looseT, type EnumKind } from '@/utils/i18n'

const localDay = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Columns whose values are enum codes, per report. */
const ENUM_COLUMNS: Partial<Record<string, EnumKind>> = {
  status: 'workOrderStatus',
  priority: 'priority',
  category: 'workOrderCategory',
  currentStatus: 'assetStatus',
  topCategory: 'workOrderCategory',
}

export function ReportViewPage() {
  const { key = '' } = useParams()
  if (!(REPORT_KEYS as readonly string[]).includes(key)) return <Navigate to="/reports" replace />
  return <ReportView reportKey={key as ReportKey} />
}

function ReportView({ reportKey }: { reportKey: ReportKey }) {
  const { t } = useTranslation()
  const tl = looseT(t)
  const restaurants = useRestaurants()
  const [params, setParams] = useSearchParams()
  const today = localDay(new Date())
  const from = params.get('from') ?? localDay(new Date(Date.now() - 29 * 86_400_000))
  const to = params.get('to') ?? today
  const [restaurantId, setRestaurantId] = useScopedRestaurantParam()
  const snapshot = SNAPSHOT_REPORTS.includes(reportKey)
  const valid = from <= to
  const woFilters = WORK_ORDER_FILTER_REPORTS.includes(reportKey)
  const filters = Object.fromEntries(
    REPORT_FILTER_KEYS.flatMap((k) => {
      const v = params.get(k)
      return woFilters && v ? [[k, v]] : []
    }),
  )
  const query = useReport(reportKey, { from, to, restaurantId, ...filters }, valid)
  const people = useUserOptions(restaurantId, woFilters)
  const teams = useTeams()
  const vendors = useVendorOptions(restaurantId, woFilters)
  const assets = useAssets({ restaurantId, pageSize: 100, sort: 'name:asc' }, woFilters)
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null)
  const [scheduling, setScheduling] = useState(false)

  const set = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const format = (c: ReportColumn, v: ReportCell) => {
    if (v === null || v === undefined || v === '') return '—'
    const kind =
      reportKey === 'failure-analysis' && c.key === 'category'
        ? 'failureCategory'
        : c.key === 'type'
          ? reportKey === 'inspection-results'
            ? 'inspectionType'
            : 'workOrderType'
          : ENUM_COLUMNS[c.key]
    if (kind && typeof v === 'string') return enumLabel(t, kind, v)
    if (c.key === 'onTime') return v === 'yes' ? t('common.yes') : t('common.no')
    return formatValue(c.type, v)
  }

  async function exportFile(format: 'csv' | 'pdf') {
    setExporting(format)
    try {
      await reportsApi[format](reportKey, { from, to, restaurantId, ...filters })
    } catch (err) {
      reportError(err, t)
    } finally {
      setExporting(null)
    }
  }

  const data = query.data
  return (
    <>
      <PageHeader
        back={{ to: '/reports', label: t('reports.title') }}
        title={tl(`reports.name.${reportKey}`)}
        description={tl(`reports.desc.${reportKey}`)}
        actions={
          <Can permission="reports:export">
            <Button variant="secondary" onClick={() => setScheduling(true)}>
              <Mail aria-hidden /> {t('reportSchedules.schedule')}
            </Button>
            <Button
              variant="secondary"
              loading={exporting === 'csv'}
              disabled={!data || data.rows.length === 0 || exporting !== null}
              onClick={() => void exportFile('csv')}
            >
              <Download aria-hidden /> {t('reports.exportCsv')}
            </Button>
            <Button
              variant="secondary"
              loading={exporting === 'pdf'}
              disabled={!data || data.rows.length === 0 || exporting !== null}
              onClick={() => void exportFile('pdf')}
            >
              <FileText aria-hidden /> {t('reports.exportPdf')}
            </Button>
          </Can>
        }
      />
      <Can permission="reports:export">
        <ReportScheduleSheet
          reportKey={reportKey}
          restaurantId={restaurantId}
          filters={filters as ReportFilters}
          open={scheduling}
          onOpenChange={setScheduling}
        />
      </Can>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        {!snapshot && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="report-from">{t('reports.from')}</Label>
              <Input
                id="report-from"
                type="date"
                value={from}
                max={to}
                onChange={(e) => set('from', e.target.value)}
                className="tabular"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="report-to">{t('reports.to')}</Label>
              <Input
                id="report-to"
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => set('to', e.target.value)}
                className="tabular"
              />
            </div>
          </>
        )}
        {(restaurants.data?.length ?? 0) > 1 && (
          <FilterSelect
            label={t('wo.colRestaurant')}
            value={restaurantId}
            onChange={setRestaurantId}
            options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
          />
        )}
        {woFilters && (
          <>
            <FilterSelect
              label={t('wo.fieldPriority')}
              value={params.get('priority') ?? undefined}
              onChange={(v) => set('priority', v)}
              options={PRIORITY.map((p) => ({ value: p, label: enumLabel(t, 'priority', p) }))}
            />
            <FilterSelect
              label={t('wo.colStatus')}
              value={params.get('status') ?? undefined}
              onChange={(v) => set('status', v)}
              options={WORK_ORDER_STATUS.map((p) => ({
                value: p,
                label: enumLabel(t, 'workOrderStatus', p),
              }))}
            />
            <FilterSelect
              label={t('wo.fieldType')}
              value={params.get('type') ?? undefined}
              onChange={(v) => set('type', v)}
              options={WORK_ORDER_TYPE.map((p) => ({
                value: p,
                label: enumLabel(t, 'workOrderType', p),
              }))}
            />
            <FilterSelect
              label={t('reports.filterTechnician')}
              value={params.get('userId') ?? undefined}
              onChange={(v) => set('userId', v)}
              options={(people.data ?? []).map((u) => ({ value: u.id, label: fullName(u) }))}
            />
            <FilterSelect
              label={t('reports.filterTeam')}
              value={params.get('teamId') ?? undefined}
              onChange={(v) => set('teamId', v)}
              options={(teams.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
            />
            <FilterSelect
              label={t('reports.filterVendor')}
              value={params.get('vendorId') ?? undefined}
              onChange={(v) => set('vendorId', v)}
              options={(vendors.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
            />
            <FilterSelect
              label={t('reports.filterAsset')}
              value={params.get('assetId') ?? undefined}
              onChange={(v) => set('assetId', v)}
              options={(assets.data?.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
            />
          </>
        )}
        {snapshot && <p className="text-13 text-muted-foreground">{t('reports.snapshot')}</p>}
      </div>

      {!valid ? (
        <Callout tone="warning">{t('validation.endBeforeStart')}</Callout>
      ) : query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {data!.summary.length > 0 && (
            <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data!.summary.map((s) => (
                <div key={s.label} className="rounded-lg border bg-background px-4 py-3">
                  <dt className="text-13 text-muted-foreground">{tl(`reports.sum.${s.label}`)}</dt>
                  <dd className="text-2xl font-semibold tabular">{formatValue(s.type, s.value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {data!.truncated && (
            <Callout tone="info" className="mb-3">
              {t('reports.truncated')}
            </Callout>
          )}
          <Panel className="overflow-hidden">
            {data!.rows.length === 0 ? (
              <EmptyState compact title={t('reports.empty')} description={t('reports.emptyBody')} />
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{tl(`reports.name.${reportKey}`)}</caption>
                  <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground shadow-[0_1px_0_var(--border)]">
                    <tr>
                      {data!.columns.map((c) => (
                        <th
                          key={c.key}
                          scope="col"
                          className={cn(
                            'px-3 py-2 font-medium whitespace-nowrap',
                            isNumeric(c.type) && 'text-right',
                          )}
                        >
                          {tl(`reports.col.${c.key}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data!.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/40">
                        {data!.columns.map((c) => (
                          <td
                            key={c.key}
                            className={cn(
                              'px-3 py-2',
                              isNumeric(c.type) && 'text-right tabular whitespace-nowrap',
                            )}
                          >
                            {format(c, r[c.key] ?? null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('reports.generated', {
              time: formatDateTime(data!.generatedAt),
              count: data!.rows.length,
            })}
          </p>
        </>
      )}
    </>
  )
}

const isNumeric = (t: ReportColumnType) => ['number', 'money', 'percent', 'hours'].includes(t)

function formatValue(type: ReportColumnType, v: ReportCell): string {
  if (v === null || v === undefined || v === '') return '—'
  switch (type) {
    case 'money':
      return formatCurrency(Number(v))
    case 'percent':
      return `${formatNumber(Number(v), { maximumFractionDigits: 1 })}%`
    case 'hours':
      return formatNumber(Number(v), { maximumFractionDigits: 1 })
    case 'number':
      return formatNumber(Number(v), { maximumFractionDigits: 3 })
    case 'date':
      return formatDate(`${String(v)}T00:00:00`)
    case 'datetime':
      return formatDateTime(String(v))
    default:
      return String(v)
  }
}

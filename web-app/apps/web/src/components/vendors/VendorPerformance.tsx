import type { VendorDetail } from '@maintainx/shared'
import { CheckCircle2, Clock, IndianRupee, Timer, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { StatStrip } from '@/components/common/StatStrip'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { formatCurrency, formatDate, formatNumber } from '@/utils/format'
import type { WorkOrderStatus } from '@maintainx/shared'

const hours = (t: (k: 'dashboard.hours', o: { value: number }) => string, h: number | null) =>
  h === null ? '—' : t('dashboard.hours', { value: h })

/** How the vendor performs on its jobs and what it cost (last 12 months). */
export function VendorPerformanceStrip({ v }: { v: VendorDetail }) {
  const { t } = useTranslation()
  const p = v.performance
  return (
    <StatStrip
      className="mb-4 lg:grid-cols-5"
      stats={[
        {
          label: t('vendorPerf.jobs'),
          value: formatNumber(p.workOrders.total),
          hint: t('vendorPerf.jobsHint', {
            open: p.workOrders.open,
            done: p.workOrders.completed,
          }),
          icon: Wrench,
        },
        {
          label: t('vendorPerf.response'),
          value: hours(t, p.avgResponseHours),
          hint:
            p.contractResponseHours === null
              ? undefined
              : t('vendorPerf.promised', { value: p.contractResponseHours }),
          icon: Clock,
        },
        {
          label: t('vendorPerf.completion'),
          value: hours(t, p.avgCompletionHours),
          icon: Timer,
        },
        {
          label: t('vendorPerf.onTime'),
          value: p.onTimeRate === null ? '—' : `${Math.round(p.onTimeRate * 100)}%`,
          icon: CheckCircle2,
        },
        {
          label: t('vendorPerf.spend'),
          value: formatCurrency(p.spend.total),
          hint: t('vendorPerf.spendHint', {
            invoices: formatCurrency(p.spend.invoices),
            jobs: formatCurrency(p.spend.workOrderCosts),
            purchases: formatCurrency(p.spend.purchases),
          }),
          icon: IndianRupee,
        },
      ]}
    />
  )
}

/** The vendor's latest jobs. */
export function VendorWorkOrders({ v }: { v: VendorDetail }) {
  const { t } = useTranslation()
  return (
    <Panel>
      <PanelHeader className="flex items-center justify-between gap-2">
        <PanelTitle>{t('vendorPerf.recentJobs')}</PanelTitle>
        <Link to={`/work-orders?vendorId=${v.id}`} className="text-13 font-medium text-primary">
          {t('actions.viewAll')}
        </Link>
      </PanelHeader>
      {v.recentWorkOrders.length === 0 ? (
        <PanelBody>
          <p className="text-13 text-muted-foreground">{t('vendorPerf.noJobs')}</p>
        </PanelBody>
      ) : (
        <ul className="divide-y">
          {v.recentWorkOrders.map((w) => (
            <li key={w.id}>
              <Link
                to={`/work-orders/${w.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{w.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    <span className="tabular">{w.code}</span> · {w.restaurant.name} ·{' '}
                    {formatDate(w.createdAt)}
                  </span>
                </span>
                <StatusBadge kind="workOrderStatus" value={w.status as WorkOrderStatus} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

import type { CostBreakdown, WorkOrderDetail } from '@maintainx/shared'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { formatCurrency } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import type { useWorkOrderActions } from './useWorkOrderActions'

const PARTS = ['parts', 'labour', 'vendor', 'other'] as const
const SWATCH: Record<(typeof PARTS)[number], string> = {
  parts: 'bg-chart-1',
  labour: 'bg-chart-2',
  vendor: 'bg-chart-3',
  other: 'bg-chart-4',
}

/**
 * Cost split as one stacked bar (fixed series order, 2px gaps) with a labelled
 * legend that carries every value, so colour is never the only cue.
 */
export function CostBreakdownView({ cost }: { cost: CostBreakdown }) {
  const { t } = useTranslation()
  const label = {
    parts: t('wo.costParts'),
    labour: t('wo.costLabour'),
    vendor: t('wo.costVendor'),
    other: t('wo.costOther'),
  }
  const shown = PARTS.filter((k) => cost[k] > 0)
  return (
    <div className="grid gap-3">
      <p className="text-2xl font-semibold tracking-tight tabular">{formatCurrency(cost.total)}</p>
      {cost.total > 0 && (
        <div className="flex h-2.5 gap-0.5" aria-hidden>
          {shown.map((k) => (
            <span
              key={k}
              className={`${SWATCH[k]} h-full first:rounded-l-full last:rounded-r-full`}
              style={{ width: `${(cost[k] / cost.total) * 100}%`, minWidth: 4 }}
              title={`${label[k]}: ${formatCurrency(cost[k])}`}
            />
          ))}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-13">
        {PARTS.map((k) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <span className={`size-2.5 rounded-sm ${SWATCH[k]}`} aria-hidden />
              {label[k]}
            </dt>
            <dd className="font-medium tabular">{formatCurrency(cost[k])}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function CostPanel({
  w,
  actions: a,
}: {
  w: WorkOrderDetail
  actions: ReturnType<typeof useWorkOrderActions>
}) {
  const { t } = useTranslation()
  return (
    <Panel>
      <PanelHeader className="flex items-center justify-between gap-2">
        <PanelTitle>{t('wo.cost')}</PanelTitle>
        {w.actions.costs && (
          <Button size="sm" variant="secondary" onClick={() => a.setDialog('cost')}>
            <Plus aria-hidden /> {t('wo.addCost')}
          </Button>
        )}
      </PanelHeader>
      <PanelBody className="grid gap-4">
        <CostBreakdownView cost={w.cost} />
        <p className="text-xs text-muted-foreground">{t('wo.labourHint')}</p>
        {w.costLines.length > 0 && (
          <ul className="divide-y rounded-md border">
            {w.costLines.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.description}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {enumLabel(t, 'workOrderCostType', c.type)}
                    {c.vendor && ` · ${c.vendor.name}`}
                  </span>
                </span>
                <span className="font-medium tabular">{formatCurrency(c.amount)}</span>
                {w.actions.costs && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('wo.removeCost', { name: c.description })}
                    loading={a.busy === `cost:${c.id}`}
                    onClick={() => a.removeCost(c.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  )
}

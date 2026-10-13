import { countVariance, fullName, type StockCountDetail } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ClipboardList, IndianRupee, Save, Scale, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState } from '@/components/common/ErrorState'
import { COUNT_TONE } from '@/components/inventory/count-status'
import { PageHeader } from '@/components/common/PageHeader'
import { StatStrip } from '@/components/common/StatStrip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { buyKeys, stockCountsApi, useStockCount } from '@/services/purchasing.service'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'
import { formatCurrency, formatDateTime, formatNumber } from '@/utils/format'

export function StockCountDetailPage() {
  const { t } = useTranslation()
  const { countId = '' } = useParams()
  const query = useStockCount(countId)
  const back = { to: '/stock-counts', label: t('counts.title') }
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
        <PageHeader title={t('counts.title')} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  return <Detail key={query.data.id} c={query.data} back={back} />
}

const parse = (v: string) => {
  const n = Number(v.replace(',', '.'))
  return v.trim() === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 1000) / 1000
}

function Detail({ c, back }: { c: StockCountDetail; back: { to: string; label: string } }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // Typed-in counts not saved yet, by line id.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<'complete' | 'cancel' | null>(null)
  const editable = c.actions.count

  const dirty = useMemo(
    () =>
      c.lines
        .filter((l) => l.id in draft)
        .map((l) => ({ lineId: l.id, countedQty: parse(draft[l.id]!) }))
        .filter((d) => d.countedQty !== c.lines.find((l) => l.id === d.lineId)!.countedQty),
    [c.lines, draft],
  )
  const invalid = Object.entries(draft).some(([, v]) => v.trim() !== '' && parse(v) === null)

  const refresh = (d: StockCountDetail) => {
    qc.setQueryData(buyKeys.count(c.id), d)
    void qc.invalidateQueries({ queryKey: buyKeys.counts })
    void qc.invalidateQueries({ queryKey: buyKeys.parts })
  }

  async function save() {
    if (dirty.length === 0) return
    setSaving(true)
    try {
      refresh(await stockCountsApi.save(c.id, { lines: dirty }))
      setDraft({})
      toast.success(t('counts.saved', { count: dirty.length }))
    } catch (err) {
      reportError(err, t)
    } finally {
      setSaving(false)
    }
  }

  const s = c.summary
  return (
    <>
      <PageHeader
        back={back}
        title={c.name}
        meta={
          <>
            <span className="text-13 text-muted-foreground tabular">{c.code}</span>
            <Badge tone={COUNT_TONE[c.status]}>{t(`counts.status_${c.status}`)}</Badge>
            <span className="text-13 text-muted-foreground">{c.restaurant.name}</span>
          </>
        }
        actions={
          editable && (
            <>
              <Button
                variant="secondary"
                onClick={() => void save()}
                loading={saving}
                disabled={dirty.length === 0 || invalid}
              >
                <Save aria-hidden /> {t('counts.save')}
              </Button>
              <Button
                onClick={() => setConfirm('complete')}
                disabled={!c.actions.complete || dirty.length > 0}
              >
                <CheckCheck aria-hidden /> {t('counts.complete')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('counts.cancel')}
                onClick={() => setConfirm('cancel')}
              >
                <XCircle />
              </Button>
            </>
          )
        }
      />

      <StatStrip
        className="mb-4"
        stats={[
          {
            label: t('counts.progress'),
            value: t('counts.countedOf', { counted: c.countedCount, total: c.lineCount }),
            icon: ClipboardList,
          },
          {
            label: t('counts.varianceLines'),
            value: formatNumber(s.varianceLines),
            icon: Scale,
          },
          {
            label: t('counts.netQuantity'),
            value: `${s.netQuantity > 0 ? '+' : ''}${formatNumber(s.netQuantity)}`,
            icon: Scale,
          },
          {
            label: t('counts.varianceValue'),
            value: formatCurrency(s.varianceValue),
            icon: IndianRupee,
          },
        ]}
      />
      {editable && dirty.length > 0 && (
        <p className="mb-3 text-13 text-muted-foreground" role="status">
          {t('counts.unsaved', { count: dirty.length })}
        </p>
      )}
      {c.status === 'COMPLETED' && c.completedBy && (
        <p className="mb-3 text-13 text-muted-foreground">
          {t('counts.completedBy', {
            name: fullName(c.completedBy),
            date: formatDateTime(c.completedAt!),
          })}
        </p>
      )}

      <Panel>
        <PanelHeader>
          <PanelTitle>{t('counts.lines')}</PanelTitle>
        </PanelHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium">{t('parts.colPart')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('counts.system')}</th>
                <th className="px-4 py-2 font-medium">{t('counts.counted')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('counts.variance')}</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">
                  {t('counts.countedByCol')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {c.lines.map((l) => {
                const typed = draft[l.id]
                const counted = typed !== undefined ? parse(typed) : l.countedQty
                const variance =
                  typed !== undefined
                    ? counted === null
                      ? null
                      : countVariance(counted, l.systemQty)
                    : l.variance
                const bad = typed !== undefined && typed.trim() !== '' && counted === null
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-2">
                      <Link
                        to={`/inventory/parts/${l.part.id}`}
                        className="block font-medium hover:underline"
                      >
                        {l.part.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        <span className="tabular">{l.part.partNumber}</span>
                        {l.storageLocation && ` · ${l.storageLocation}`}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap tabular">
                      {formatNumber(l.systemQty)} {l.part.unit}
                    </td>
                    <td className="px-4 py-2">
                      {editable ? (
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          aria-label={t('counts.countedFor', { name: l.part.name })}
                          aria-invalid={bad || undefined}
                          value={typed ?? (l.countedQty === null ? '' : String(l.countedQty))}
                          onChange={(e) => setDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                          className="h-10 w-28 tabular"
                        />
                      ) : (
                        <span className="tabular">
                          {l.countedQty === null ? '—' : formatNumber(l.countedQty)}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2 text-right whitespace-nowrap tabular',
                        variance !== null && variance < 0 && 'text-danger-fg',
                        variance !== null && variance > 0 && 'text-success-fg',
                      )}
                    >
                      {variance === null
                        ? '—'
                        : `${variance > 0 ? '+' : ''}${formatNumber(variance)}`}
                    </td>
                    <td className="hidden px-4 py-2 text-13 md:table-cell">
                      {l.countedBy ? fullName(l.countedBy) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirm === 'complete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('counts.completeTitle')}
        description={t('counts.completeBody', {
          lines: s.varianceLines,
          value: formatCurrency(s.varianceValue),
          uncounted: c.lineCount - c.countedCount,
        })}
        confirmLabel={t('counts.complete')}
        onConfirm={async () => {
          try {
            refresh(await stockCountsApi.complete(c.id))
            toast.success(t('counts.completed'))
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="destructive"
        title={t('counts.cancelTitle')}
        description={t('counts.cancelBody')}
        confirmLabel={t('counts.cancel')}
        onConfirm={async () => {
          try {
            refresh(await stockCountsApi.cancel(c.id))
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

import { PART_CONDITION, type PartCondition, type WorkOrderDetail } from '@maintainx/shared'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useWorkflow } from '@/contexts/WorkflowContext'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toaster'
import { useParts, workOrderPartsApi } from '@/services/purchasing.service'
import { useApplyWorkOrder } from '@/services/work-orders.service'
import { reportError } from '@/utils/errors'
import { formatCurrency, formatNumber } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { WorkOrderReservations } from './WorkOrderReservations'

/**
 * Parts used on a job. Adding a part takes it out of the restaurant's stock
 * straight away; removing a line puts it back.
 */
export function WorkOrderParts({ w, large = false }: { w: WorkOrderDetail; large?: boolean }) {
  const { t } = useTranslation()
  const apply = useApplyWorkOrder()
  const workflow = useWorkflow()
  const [adding, setAdding] = useState(false)
  const [partId, setPartId] = useState('')
  const [qty, setQty] = useState('1')
  const [condition, setCondition] = useState<PartCondition>('NEW')
  const [busy, setBusy] = useState<string | null>(null)
  const parts = useParts({ restaurantId: w.restaurant.id, pageSize: 100, sort: 'name:asc' }, adding)
  const selected = parts.data?.data.find((p) => p.id === partId)
  const total = w.parts.reduce((s, p) => s + p.qtyUsed * (p.unitCost ?? 0), 0)

  async function add() {
    const n = Number(qty.replace(',', '.'))
    if (!partId || !(n > 0)) return
    setBusy('add')
    try {
      await apply(await workOrderPartsApi.use(w.id, { partId, quantity: n, condition }))
      toast.success(t('woParts.added'))
      setPartId('')
      setQty('1')
      setCondition('NEW')
      setAdding(false)
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }

  async function remove(lineId: string) {
    setBusy(lineId)
    try {
      await apply(await workOrderPartsApi.remove(w.id, lineId))
      toast.success(t('woParts.returned'))
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }

  const h = large ? 'h-12 text-base' : undefined
  return (
    <div className="grid gap-3">
      {(!workflow || workflow.showReservations || w.reservations.length > 0) && (
        <WorkOrderReservations w={w} />
      )}
      {w.parts.length === 0 ? (
        <p className="text-13 text-muted-foreground">{t('woParts.none')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {w.parts.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{p.part.name}</span>
                <span className="block text-xs text-muted-foreground tabular">
                  {p.part.partNumber}
                  {p.condition !== 'NEW' && ` · ${enumLabel(t, 'partCondition', p.condition)}`}
                  {p.unitCost !== null && ` · ${formatCurrency(p.unitCost * p.qtyUsed)}`}
                </span>
              </span>
              <span className="text-sm tabular">
                {formatNumber(p.qtyUsed)} {p.part.unit}
              </span>
              {w.actions.parts && (
                <Button
                  variant="ghost"
                  size={large ? 'icon-lg' : 'icon-sm'}
                  aria-label={t('woParts.remove', { name: p.part.name })}
                  loading={busy === p.id}
                  onClick={() => void remove(p.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {w.parts.length > 0 && total > 0 && (
        <p className="text-right text-13 text-muted-foreground">
          {t('woParts.total', { amount: formatCurrency(total) })}
        </p>
      )}
      {w.actions.parts &&
        (adding ? (
          <div className="grid gap-3 rounded-md border p-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`wo-part-${w.id}`}>{t('woParts.part')}</Label>
              <Select value={partId} onValueChange={setPartId}>
                <SelectTrigger id={`wo-part-${w.id}`} className={h}>
                  <SelectValue placeholder={t('validation.selectOption')} />
                </SelectTrigger>
                <SelectContent>
                  {(parts.data?.data ?? []).map((p) => {
                    const inStock = p.stock?.quantity ?? 0
                    return (
                      <SelectItem key={p.id} value={p.id} disabled={inStock <= 0}>
                        {p.name} ·{' '}
                        {t('woParts.inStock', { qty: formatNumber(inStock), unit: p.unit })}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              {parts.data && parts.data.data.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('woParts.noParts')}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`wo-qty-${w.id}`}>{t('woParts.quantity')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`wo-qty-${w.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className={`max-w-32 tabular ${h ?? ''}`}
                />
                {selected && <span className="text-sm text-muted-foreground">{selected.unit}</span>}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label id={`wo-cond-${w.id}`}>{t('woParts.condition')}</Label>
              <div
                role="radiogroup"
                aria-labelledby={`wo-cond-${w.id}`}
                className="flex flex-wrap gap-2"
              >
                {PART_CONDITION.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={condition === c}
                    onClick={() => setCondition(c)}
                    className={
                      condition === c
                        ? 'h-10 rounded-full border border-primary bg-info-soft px-4 text-sm font-medium text-info-fg'
                        : 'h-10 rounded-full border px-4 text-sm hover:bg-muted/60'
                    }
                  >
                    {enumLabel(t, 'partCondition', c)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size={large ? 'xl' : 'default'}
                onClick={() => setAdding(false)}
              >
                {t('actions.cancel')}
              </Button>
              <Button
                size={large ? 'xl' : 'default'}
                disabled={!partId || !(Number(qty) > 0)}
                loading={busy === 'add'}
                onClick={() => void add()}
              >
                {t('woParts.use')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            size={large ? 'xl' : 'sm'}
            className="justify-self-start"
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden /> {t('woParts.add')}
          </Button>
        ))}
    </div>
  )
}

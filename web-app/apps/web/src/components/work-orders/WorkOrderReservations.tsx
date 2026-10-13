import type { WorkOrderDetail } from '@maintainx/shared'
import { Bookmark, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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
import { reservationsApi, useParts } from '@/services/purchasing.service'
import { useApplyWorkOrder } from '@/services/work-orders.service'
import { reportError } from '@/utils/errors'
import { formatNumber } from '@/utils/format'

/**
 * Stock set aside for this job while it is planned. The technician sees what
 * is waiting for them; using the part draws the reservation down, and
 * whatever is left is freed when the job is completed or cancelled.
 */
export function WorkOrderReservations({ w }: { w: WorkOrderDetail }) {
  const { t } = useTranslation()
  const apply = useApplyWorkOrder()
  const [adding, setAdding] = useState(false)
  const [partId, setPartId] = useState('')
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState<string | null>(null)
  const parts = useParts({ restaurantId: w.restaurant.id, pageSize: 100, sort: 'name:asc' }, adding)
  const selected = parts.data?.data.find((p) => p.id === partId)

  if (w.reservations.length === 0 && !w.actions.reserve) return null

  async function reserve() {
    const n = Number(qty.replace(',', '.'))
    if (!partId || !(n > 0)) return
    setBusy('add')
    try {
      await apply(await reservationsApi.reserve(w.id, { partId, quantity: n }))
      toast.success(t('reserve.added'))
      setPartId('')
      setQty('1')
      setAdding(false)
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }

  async function release(id: string) {
    setBusy(id)
    try {
      await apply(await reservationsApi.release(w.id, id))
      toast.success(t('reserve.released'))
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label={t('reserve.title')} className="grid gap-2">
      <p className="flex items-center gap-1.5 text-13 font-medium">
        <Bookmark className="size-3.5 text-muted-foreground" aria-hidden /> {t('reserve.title')}
      </p>
      {w.reservations.length === 0 ? (
        <p className="text-13 text-muted-foreground">{t('reserve.none')}</p>
      ) : (
        <ul className="divide-y rounded-md border border-dashed">
          {w.reservations.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{r.part.name}</span>
                <span className="block text-xs text-muted-foreground tabular">
                  {r.part.partNumber}
                </span>
              </span>
              <span className="text-sm tabular">
                {formatNumber(r.quantity)} {r.part.unit}
              </span>
              {w.actions.reserve && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('reserve.release', { name: r.part.name })}
                  loading={busy === r.id}
                  onClick={() => void release(r.id)}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {w.actions.reserve &&
        (adding ? (
          <div className="grid gap-3 rounded-md border p-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`res-part-${w.id}`}>{t('woParts.part')}</Label>
              <Select value={partId} onValueChange={setPartId}>
                <SelectTrigger id={`res-part-${w.id}`}>
                  <SelectValue placeholder={t('validation.selectOption')} />
                </SelectTrigger>
                <SelectContent>
                  {(parts.data?.data ?? []).map((p) => {
                    const available = p.stock?.available ?? 0
                    return (
                      <SelectItem key={p.id} value={p.id} disabled={available <= 0}>
                        {p.name} ·{' '}
                        {t('reserve.available', { qty: formatNumber(available), unit: p.unit })}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`res-qty-${w.id}`}>{t('woParts.quantity')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`res-qty-${w.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="max-w-32 tabular"
                />
                {selected && <span className="text-sm text-muted-foreground">{selected.unit}</span>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setAdding(false)}>
                {t('actions.cancel')}
              </Button>
              <Button
                disabled={!partId || !(Number(qty) > 0)}
                loading={busy === 'add'}
                onClick={() => void reserve()}
              >
                {t('reserve.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setAdding(true)}
          >
            <Bookmark aria-hidden /> {t('reserve.add')}
          </Button>
        ))}
    </section>
  )
}

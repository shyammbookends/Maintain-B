import { fullName, type PurchaseOrderDetail } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  PackageCheck,
  Pencil,
  Send,
  Truck,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { Callout } from '@/components/common/Callout'
import { DetailList } from '@/components/common/DetailList'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormActions } from '@/components/forms'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toaster'
import { ReasonDialog } from '@/components/work-orders/dialogs'
import { buyKeys, poApi, usePurchaseOrder } from '@/services/purchasing.service'
import { describeError, reportError } from '@/utils/errors'
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/utils/format'

export function PurchaseOrderDetailPage() {
  const { t } = useTranslation()
  const { orderId = '' } = useParams()
  const query = usePurchaseOrder(orderId)
  const back = { to: '/purchase-orders', label: t('po.title') }
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
        <PageHeader title={t('po.title')} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  return <Detail po={query.data} back={back} />
}

function Detail({ po, back }: { po: PurchaseOrderDetail; back: { to: string; label: string } }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'reject' | 'cancel' | 'receive' | null>(null)

  const apply = async (next: PurchaseOrderDetail) => {
    qc.setQueryData(buyKeys.po(next.id), next)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['purchase-orders', 'list'] }),
      qc.invalidateQueries({ queryKey: buyKeys.parts }),
      qc.invalidateQueries({ queryKey: buyKeys.vendors }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
    ])
  }
  const run = async (key: string, fn: () => Promise<PurchaseOrderDetail>, success: string) => {
    setBusy(key)
    try {
      await apply(await fn())
      toast.success(success)
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }

  const a = po.actions
  const buttons: Array<{
    key: string
    show: boolean
    label: string
    icon: LucideIcon
    onClick: () => void
    primary?: boolean
  }> = [
    {
      key: 'approve',
      show: a.approve,
      label: t('po.approve'),
      icon: CheckCircle2,
      primary: true,
      onClick: () => void run('approve', () => poApi.approve(po.id), t('po.approved')),
    },
    {
      key: 'reject',
      show: a.reject,
      label: t('po.reject'),
      icon: XCircle,
      onClick: () => setDialog('reject'),
    },
    {
      key: 'submit',
      show: a.submit,
      label: t('po.submit'),
      icon: Send,
      primary: true,
      onClick: () => void run('submit', () => poApi.submit(po.id), t('po.submitted')),
    },
    {
      key: 'order',
      show: a.order,
      label: t('po.markOrdered'),
      icon: Truck,
      primary: true,
      onClick: () => void run('order', () => poApi.order(po.id), t('po.ordered')),
    },
    {
      key: 'receive',
      show: a.receive,
      label: t('po.receive'),
      icon: PackageCheck,
      primary: true,
      onClick: () => setDialog('receive'),
    },
  ]

  return (
    <>
      <PageHeader
        back={back}
        title={po.code}
        meta={
          <>
            <StatusBadge kind="purchaseOrderStatus" value={po.status} />
            <Link to={`/vendors/${po.vendor.id}`} className="text-13 text-primary hover:underline">
              {po.vendor.name}
            </Link>
            <span className="text-13 text-muted-foreground">{po.restaurant.name}</span>
          </>
        }
        actions={
          <>
            {buttons
              .filter((b) => b.show)
              .map((b) => (
                <Button
                  key={b.key}
                  variant={b.primary ? 'default' : 'secondary'}
                  loading={busy === b.key}
                  onClick={b.onClick}
                >
                  <b.icon aria-hidden /> {b.label}
                </Button>
              ))}
            {a.edit && (
              <Button asChild variant="secondary">
                <Link to={`/purchase-orders/${po.id}/edit`}>
                  <Pencil aria-hidden /> {t('actions.edit')}
                </Link>
              </Button>
            )}
            {a.cancel && (
              <Button variant="destructive-outline" onClick={() => setDialog('cancel')}>
                {t('po.cancel')}
              </Button>
            )}
          </>
        }
      />

      {po.selfApprovalBlocked && (
        <Callout tone="info" className="mb-4">
          {t('po.selfApproval')}
        </Callout>
      )}
      {po.status === 'CANCELLED' && po.cancellationReason && (
        <Callout tone="neutral" className="mb-4" title={t('po.cancelledTitle')}>
          {po.cancellationReason}
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel className="content-start">
          <PanelHeader>
            <PanelTitle>{t('po.items')}</PanelTitle>
          </PanelHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">{t('po.part')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('po.qty')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('po.received')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('parts.unitCost')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('po.lineTotal')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {po.items.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2">
                      <Link
                        to={`/inventory/parts/${i.part.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {i.part.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground tabular">
                        {i.part.partNumber}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular">
                      {formatNumber(i.qtyOrdered)} {i.part.unit}
                    </td>
                    <td className="px-4 py-2 text-right tabular">{formatNumber(i.qtyReceived)}</td>
                    <td className="px-4 py-2 text-right tabular">{formatCurrency(i.unitCost)}</td>
                    <td className="px-4 py-2 text-right tabular">{formatCurrency(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr className="border-t">
                  <td colSpan={4} className="px-4 py-1.5 text-right">
                    {t('po.subtotal')}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular">{formatCurrency(po.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-4 py-1.5 text-right">
                    {t('po.tax')}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular">{formatCurrency(po.tax)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={4} className="px-4 py-1.5 text-right">
                    {t('po.total')}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular">{formatCurrency(po.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>

        <div className="grid content-start gap-4">
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('wo.details')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <DetailList
                items={[
                  {
                    label: t('po.requestedBy'),
                    value: `${fullName(po.requestedBy)} · ${formatDateTime(po.createdAt)}`,
                  },
                  {
                    label: t('po.submittedAt'),
                    value: po.submittedAt && formatDateTime(po.submittedAt),
                    hidden: !po.submittedAt,
                  },
                  {
                    label: t('po.approvedBy'),
                    value:
                      po.approvedBy &&
                      `${fullName(po.approvedBy)} · ${formatDateTime(po.approvedAt!)}`,
                    hidden: !po.approvedBy,
                  },
                  {
                    label: t('po.orderedAt'),
                    value: po.orderedAt && formatDateTime(po.orderedAt),
                    hidden: !po.orderedAt,
                  },
                  {
                    label: t('po.expected'),
                    value: po.expectedAt && formatDate(`${po.expectedAt}T00:00:00`),
                  },
                  {
                    label: t('po.receivedAt'),
                    value: po.receivedAt && formatDateTime(po.receivedAt),
                    hidden: !po.receivedAt,
                  },
                ]}
              />
              {po.notes && <p className="mt-3 text-sm whitespace-pre-wrap">{po.notes}</p>}
            </PanelBody>
          </Panel>
          {po.receipts.length > 0 && (
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('po.receipts')}</PanelTitle>
              </PanelHeader>
              <ul className="divide-y">
                {po.receipts.map((r) => (
                  <li key={r.id} className="grid gap-1 px-4 py-2.5 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {fullName(r.receivedBy)} · {formatDateTime(r.receivedAt)}
                    </span>
                    <span>
                      {r.lines.map((l) => `${l.partName} × ${formatNumber(l.quantity)}`).join(', ')}
                    </span>
                    {r.notes && <span className="text-13 text-muted-foreground">{r.notes}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <ReasonDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => setDialog(o ? 'reject' : null)}
        title={t('po.rejectTitle')}
        description={t('po.rejectBody')}
        label={t('po.reason')}
        confirmLabel={t('po.reject')}
        tone="destructive"
        onSubmit={async (reason) => {
          await apply(await poApi.reject(po.id, { reason }))
          toast.success(t('po.rejected'))
        }}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => setDialog(o ? 'cancel' : null)}
        title={t('po.cancelTitle')}
        description={t('po.cancelBody')}
        label={t('po.reason')}
        confirmLabel={t('po.cancel')}
        tone="destructive"
        onSubmit={async (reason) => {
          await apply(await poApi.cancel(po.id, { reason }))
          toast.success(t('po.cancelled'))
        }}
      />
      {dialog === 'receive' && (
        <ReceiveDialog
          po={po}
          onClose={() => setDialog(null)}
          onDone={async (next) => {
            await apply(next)
            toast.success(next.status === 'RECEIVED' ? t('po.receivedAll') : t('po.receivedSome'))
            setDialog(null)
          }}
        />
      )}
    </>
  )
}

function ReceiveDialog({
  po,
  onClose,
  onDone,
}: {
  po: PurchaseOrderDetail
  onClose: () => void
  onDone: (next: PurchaseOrderDetail) => Promise<void>
}) {
  const { t } = useTranslation()
  const open = po.items.filter((i) => i.qtyReceived < i.qtyOrdered)
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(
      open.map((i) => [i.id, String(Math.round((i.qtyOrdered - i.qtyReceived) * 1000) / 1000)]),
    ),
  )
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const next = await poApi.receive(po.id, {
        lines: open.map((i) => ({ itemId: i.id, quantity: Number(qty[i.id] || 0) })),
        notes,
      })
      await onDone(next)
    } catch (err) {
      setError(describeError(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('po.receiveTitle')}</DialogTitle>
          <DialogDescription>
            {t('po.receiveBody', { restaurant: po.restaurant.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <Callout tone="danger">{error}</Callout>}
          {open.map((i) => {
            const left = Math.round((i.qtyOrdered - i.qtyReceived) * 1000) / 1000
            return (
              <div key={i.id} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                <Label htmlFor={`rcv-${i.id}`} className="grid gap-0.5">
                  <span>{i.part.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {t('po.leftToReceive', { qty: formatNumber(left), unit: i.part.unit })}
                  </span>
                </Label>
                <Input
                  id={`rcv-${i.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={left}
                  step="any"
                  value={qty[i.id] ?? ''}
                  onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))}
                  className="tabular"
                />
              </div>
            )
          })}
          <div className="grid gap-1.5">
            <Label htmlFor="rcv-notes">
              {t('po.receiptNote')}{' '}
              <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
            </Label>
            <Textarea
              id="rcv-notes"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <FormActions>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('actions.cancel')}
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              {t('po.receive')}
            </Button>
          </FormActions>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { fullName, type PartDetail, type StockLevel } from '@maintainx/shared'
import { ArrowDownUp, Download, Pencil, ShoppingCart, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { QrCode } from '@/components/assets/QrCode'
import { Can } from '@/components/common/Can'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { DetailList } from '@/components/common/DetailList'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { PartForm } from '@/components/inventory/PartForm'
import {
  AdjustStockDialog,
  StockSettingsDialog,
  TransferStockDialog,
} from '@/components/inventory/StockDialogs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import { buyKeys, partsApi, usePart } from '@/services/purchasing.service'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'
import { formatCurrency, formatDateTime, formatNumber } from '@/utils/format'
import { downloadQrPng, partQrUrl } from '@/utils/qr'
import { StockQty } from './InventoryPage'

export function PartDetailPage() {
  const { t } = useTranslation()
  const { partId = '' } = useParams()
  const query = usePart(partId)
  const back = { to: '/inventory', label: t('inventory.title') }
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
        <PageHeader title={t('inventory.title')} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  return <Detail p={query.data} back={back} />
}

function Detail({ p, back }: { p: PartDetail; back: { to: string; label: string } }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const restaurants = useRestaurants()
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState<string | null>(null)
  const [moving, setMoving] = useState<StockLevel | null>(null)
  const [settings, setSettings] = useState<StockLevel | null>(null)
  const [archiving, setArchiving] = useState(false)
  const archive = useInvalidatingMutation(() => partsApi.archive(p.id), [buyKeys.parts])
  const orderable = p.stockLevels.find((l) => l.low)?.restaurant.id

  return (
    <>
      <PageHeader
        back={back}
        title={p.name}
        meta={
          <>
            <span className="text-13 text-muted-foreground tabular">{p.partNumber}</span>
            {p.sku && (
              <span className="text-13 text-muted-foreground tabular">
                {t('parts.sku')}: {p.sku}
              </span>
            )}
            {p.category && <Badge tone="outline">{p.category}</Badge>}
          </>
        }
        actions={
          <>
            {p.can.adjust && (
              <Button onClick={() => setAdjusting('')}>
                <ArrowDownUp aria-hidden /> {t('stock.adjust')}
              </Button>
            )}
            <Can permission="purchase_orders:create">
              <Button asChild variant="secondary">
                <Link
                  to={`/purchase-orders/new?partId=${p.id}${orderable ? `&restaurantId=${orderable}` : ''}`}
                >
                  <ShoppingCart aria-hidden /> {t('parts.order')}
                </Link>
              </Button>
            </Can>
            {p.can.edit && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> {t('actions.edit')}
              </Button>
            )}
            {p.can.delete && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('parts.archive')}
                onClick={() => setArchiving(true)}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel className="content-start">
          <PanelHeader>
            <PanelTitle>{t('wo.details')}</PanelTitle>
          </PanelHeader>
          <PanelBody>
            {p.description && <p className="mb-3 text-sm whitespace-pre-wrap">{p.description}</p>}
            <DetailList
              items={[
                { label: t('parts.unit'), value: p.unit },
                { label: t('parts.unitCost'), value: formatCurrency(p.unitCost) },
                { label: t('parts.minStock'), value: `${formatNumber(p.minStock)} ${p.unit}` },
                {
                  label: t('parts.reorderQty'),
                  value:
                    p.reorderQty === null
                      ? t('parts.reorderAuto')
                      : `${formatNumber(p.reorderQty)} ${p.unit}`,
                },
                {
                  label: t('parts.preferredVendor'),
                  value: p.preferredVendor && (
                    <Link
                      to={`/vendors/${p.preferredVendor.id}`}
                      className="text-primary hover:underline"
                    >
                      {p.preferredVendor.name}
                    </Link>
                  ),
                },
                { label: t('parts.storage'), value: p.storageLocation },
              ]}
            />
            <div className="mt-4 flex items-center gap-4 rounded-lg border bg-muted/40 p-3">
              <QrCode
                value={partQrUrl(p.publicId)}
                label={t('parts.qrLabel', { name: p.name })}
                className="w-24 shrink-0"
              />
              <div className="grid gap-2">
                <p className="text-13 text-muted-foreground">{t('parts.qrHint')}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => void downloadQrPng(partQrUrl(p.publicId), `${p.partNumber}.png`)}
                >
                  <Download aria-hidden /> {t('assets.downloadPng')}
                </Button>
              </div>
            </div>
          </PanelBody>
        </Panel>

        <Panel className="content-start">
          <PanelHeader>
            <PanelTitle>{t('stock.byRestaurant')}</PanelTitle>
          </PanelHeader>
          {p.stockLevels.length === 0 ? (
            <PanelBody>
              <p className="text-13 text-muted-foreground">{t('stock.none')}</p>
            </PanelBody>
          ) : (
            <ul className="divide-y">
              {p.stockLevels.map((l) => (
                <li
                  key={l.restaurant.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{l.restaurant.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('stock.minimum', { qty: formatNumber(l.minStock), unit: p.unit })}
                      {l.minOverride !== null && ` · ${t('stock.custom')}`}
                      {l.storageLocation && ` · ${l.storageLocation}`}
                    </span>
                    {l.reserved > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {t('stock.reservedAvailable', {
                          reserved: formatNumber(l.reserved),
                          available: formatNumber(l.available),
                          unit: p.unit,
                        })}
                      </span>
                    )}
                  </span>
                  <StockQty qty={l.quantity} unit={p.unit} low={l.low} />
                  {p.can.adjust && (
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAdjusting(l.restaurant.id)}
                      >
                        {t('stock.adjust')}
                      </Button>
                      {l.available > 0 && (restaurants.data?.length ?? 0) > 1 && (
                        <Button size="sm" variant="ghost" onClick={() => setMoving(l)}>
                          {t('transfer.open')}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setSettings(l)}>
                        {t('stock.settings')}
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {p.reservations.length > 0 && (
        <Panel className="mt-4">
          <PanelHeader>
            <PanelTitle>{t('stock.reservations')}</PanelTitle>
          </PanelHeader>
          <ul className="divide-y">
            {p.reservations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <Link
                    to={`/work-orders/${r.workOrder.id}`}
                    className="block text-sm font-medium text-primary hover:underline"
                  >
                    {r.workOrder.code} · {r.workOrder.title}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {r.restaurant.name} · {fullName(r.createdBy)} · {formatDateTime(r.createdAt)}
                  </span>
                </span>
                <span className="text-sm tabular">
                  {formatNumber(r.quantity)} {p.unit}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="mt-4">
        <PanelHeader>
          <PanelTitle>{t('stock.ledger')}</PanelTitle>
        </PanelHeader>
        {p.transactions.length === 0 ? (
          <PanelBody>
            <p className="text-13 text-muted-foreground">{t('stock.ledgerEmpty')}</p>
          </PanelBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">{t('stock.when')}</th>
                  <th className="px-4 py-2 font-medium">{t('stock.movement')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('stock.change')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('stock.balance')}</th>
                  <th className="px-4 py-2 font-medium">{t('wo.fieldRestaurant')}</th>
                  <th className="px-4 py-2 font-medium">{t('stock.byWhom')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {p.transactions.map((x) => (
                  <tr key={x.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-13">
                      {formatDateTime(x.createdAt)}
                    </td>
                    <td className="px-4 py-2">
                      <span className="block">{t(`stock.txn_${x.type}`)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {x.reference ? (
                          <Link
                            to={
                              x.reference.type === 'WORK_ORDER'
                                ? `/work-orders/${x.reference.id}`
                                : x.reference.type === 'STOCK_COUNT'
                                  ? `/stock-counts/${x.reference.id}`
                                  : `/purchase-orders/${x.reference.id}`
                            }
                            className="text-primary hover:underline"
                          >
                            {x.reference.code ?? x.reference.type}
                          </Link>
                        ) : (
                          x.reason
                        )}
                      </span>
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2 text-right tabular',
                        x.quantityDelta < 0 ? 'text-danger-fg' : 'text-success-fg',
                      )}
                    >
                      {x.quantityDelta > 0 ? '+' : ''}
                      {formatNumber(x.quantityDelta)}
                    </td>
                    <td className="px-4 py-2 text-right tabular">{formatNumber(x.balanceAfter)}</td>
                    <td className="px-4 py-2">{x.restaurant.name}</td>
                    <td className="px-4 py-2 text-13">
                      {x.actor ? fullName(x.actor) : '—'}
                      {x.issuedTo && (
                        <span className="block text-xs text-muted-foreground">
                          {t('stock.issuedToName', { name: fullName(x.issuedTo) })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('parts.edit')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing && (
              <PartForm
                part={p}
                onCancel={() => setEditing(false)}
                onDone={() => setEditing(false)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {adjusting !== null && restaurants.data && (
        <AdjustStockDialog
          part={p}
          open
          onOpenChange={(o) => !o && setAdjusting(null)}
          restaurants={restaurants.data}
          restaurantId={adjusting || undefined}
        />
      )}
      {moving && restaurants.data && (
        <TransferStockDialog
          part={p}
          open
          onOpenChange={(o) => !o && setMoving(null)}
          from={moving}
          restaurants={restaurants.data}
        />
      )}
      {settings && (
        <StockSettingsDialog
          part={p}
          level={settings}
          open
          onOpenChange={(o) => !o && setSettings(null)}
        />
      )}
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        tone="destructive"
        title={t('parts.archiveTitle', { name: p.name })}
        description={t('parts.archiveBody')}
        confirmLabel={t('parts.archive')}
        onConfirm={async () => {
          try {
            await archive.mutateAsync(undefined)
            toast.success(t('parts.archived'))
            navigate('/inventory', { replace: true })
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

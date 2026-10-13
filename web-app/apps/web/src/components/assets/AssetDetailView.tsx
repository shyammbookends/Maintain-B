import type { AssetDetail } from '@maintainx/shared'
import {
  AlertTriangle,
  Boxes,
  CheckCheck,
  ClipboardList,
  Download,
  History,
  IndianRupee,
  Printer,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Callout } from '@/components/common/Callout'
import { DetailList } from '@/components/common/DetailList'
import { CustomFieldValues } from '@/components/common/CustomFieldInputs'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { AssetMeters, AssetRootCauses } from './AssetMeters'
import { CostBreakdownView } from '@/components/work-orders/CostPanel'
import { cn } from '@/utils/cn'
import {
  DUE_TONE_CLASS,
  describeDue,
  formatCurrency,
  formatDate,
  formatRelative,
} from '@/utils/format'
import { AssetHistory } from './AssetHistory'
import { assetQrUrl, downloadQrPng } from '@/utils/qr'
import { QrCode } from './QrCode'
import { WarrantyBadge } from './WarrantyBadge'

interface AssetDetailViewProps {
  asset: AssetDetail
  /** Worker app: single column, no QR tools. */
  compact?: boolean
}

/** Everything about one asset. Shared by the admin page and the worker/QR page. */
export function AssetDetailView({ asset, compact = false }: AssetDetailViewProps) {
  const { t } = useTranslation()
  const date = (v: string | null) => (v ? formatDate(`${v}T00:00:00`) : null)

  const details = (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('assets.sectionDetails')}</PanelTitle>
      </PanelHeader>
      <PanelBody className="py-1">
        <DetailList
          items={[
            {
              label: t('assets.assetId'),
              value: <span className="tabular">{asset.assetCode}</span>,
            },
            { label: t('assets.category'), value: asset.category.name },
            {
              label: t('assets.criticality'),
              value: <StatusBadge kind="assetCriticality" value={asset.criticality} />,
            },
            {
              label: t('assets.parent'),
              value: asset.parent && (
                <Link
                  to={`${compact ? '/w/assets' : '/assets'}/${asset.parent.id}`}
                  className="text-primary hover:underline"
                >
                  {asset.parent.name} · {asset.parent.assetCode}
                </Link>
              ),
              hidden: !asset.parent,
            },
            { label: t('assets.restaurant'), value: asset.restaurant.name },
            { label: t('assets.location'), value: asset.location?.name },
            { label: t('assets.manufacturer'), value: asset.manufacturer },
            {
              label: t('assets.vendor'),
              value: asset.vendor && (
                <span>
                  {asset.vendor.name}
                  {asset.vendor.phone && (
                    <a
                      href={`tel:${asset.vendor.phone.replace(/\s/g, '')}`}
                      className="ml-2 text-primary hover:underline"
                    >
                      {asset.vendor.phone}
                    </a>
                  )}
                </span>
              ),
              hidden: !asset.vendor,
            },
            { label: t('assets.model'), value: asset.model },
            {
              label: t('assets.serialNumber'),
              value: asset.serialNumber && <span className="tabular">{asset.serialNumber}</span>,
            },
            {
              label: t('assets.downtime'),
              value: t('assets.downtimeValue', { hours: asset.downtimeHours90d }),
            },
            { label: t('assets.notes'), value: asset.notes, hidden: !asset.notes },
          ]}
        />
        <div className="pb-3">
          <CustomFieldValues entity="ASSET" values={asset.customFields} />
        </div>
      </PanelBody>
    </Panel>
  )

  const purchase = (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('assets.sectionPurchase')}</PanelTitle>
        <WarrantyBadge warrantyEnd={asset.warrantyEnd} />
      </PanelHeader>
      <PanelBody className="py-1">
        <DetailList
          items={[
            { label: t('assets.purchaseDate'), value: date(asset.purchaseDate) },
            {
              label: t('assets.purchaseCost'),
              value: asset.purchaseCost ? formatCurrency(asset.purchaseCost) : null,
            },
            { label: t('assets.warrantyStart'), value: date(asset.warrantyStart) },
            { label: t('assets.warrantyEnd'), value: date(asset.warrantyEnd) },
            { label: t('assets.installDate'), value: date(asset.installDate) },
          ]}
        />
      </PanelBody>
    </Panel>
  )

  const workOrders = (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <ClipboardList className="size-4 text-muted-foreground" aria-hidden />{' '}
          {t('assets.sectionWorkOrders')}
        </PanelTitle>
      </PanelHeader>
      {asset.openWorkOrders.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {t('assets.noWorkOrders')}
        </p>
      ) : (
        <ul className="divide-y">
          {asset.openWorkOrders.map((w) => {
            const due = w.dueDate ? describeDue(w.dueDate, t) : null
            return (
              <li key={w.id} className="grid gap-1 px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  {compact ? (
                    <p className="text-sm font-medium">{w.title}</p>
                  ) : (
                    <Link
                      to={`/work-orders/${w.id}`}
                      className="text-sm font-medium hover:text-primary hover:underline"
                    >
                      {w.title}
                    </Link>
                  )}
                  <StatusBadge kind="workOrderStatus" value={w.status} />
                </div>
                <p className="flex gap-2 text-13 text-muted-foreground">
                  <span className="tabular">{w.code}</span>
                  <StatusBadge kind="priority" value={w.priority} />
                  {due && (
                    <span className={cn('font-medium', DUE_TONE_CLASS[due.tone])}>{due.label}</span>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )

  const components = asset.children.length > 0 && (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <Boxes className="size-4 text-muted-foreground" aria-hidden /> {t('assets.components')}
        </PanelTitle>
      </PanelHeader>
      <ul className="divide-y">
        {asset.children.map((c) => (
          <li key={c.id}>
            <Link
              to={`${compact ? '/w/assets' : '/assets'}/${c.id}`}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-muted/50"
            >
              <span>
                <span className="font-medium">{c.name}</span>{' '}
                <span className="text-13 text-muted-foreground tabular">{c.assetCode}</span>
              </span>
              <StatusBadge kind="assetStatus" value={c.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )

  const stats = asset.workOrderStats
  const maintenance = !compact && (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <IndianRupee className="size-4 text-muted-foreground" aria-hidden />
          {t('assets.lifetimeCost')}
        </PanelTitle>
      </PanelHeader>
      <PanelBody className="grid gap-4">
        <CostBreakdownView cost={asset.cost} />
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: t('assets.statJobs'), value: stats.total },
            { label: t('assets.statFailures'), value: stats.reactive },
            { label: t('assets.statDone'), value: stats.completed },
          ].map((x) => (
            <div key={x.label} className="rounded-md bg-muted/60 px-2 py-2">
              <dd className="text-lg font-semibold tabular">{x.value}</dd>
              <dt className="text-xs text-muted-foreground">{x.label}</dt>
            </div>
          ))}
        </dl>
      </PanelBody>
    </Panel>
  )

  const recent = !compact && asset.recentWorkOrders.length > 0 && (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <CheckCheck className="size-4 text-muted-foreground" aria-hidden />
          {t('assets.recentWork')}
        </PanelTitle>
      </PanelHeader>
      <ul className="divide-y">
        {asset.recentWorkOrders.map((w) => (
          <li key={w.id}>
            <Link
              to={`/work-orders/${w.id}`}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{w.title}</span>
                <span className="text-13 text-muted-foreground tabular">{w.code}</span>
              </span>
              <StatusBadge kind="workOrderStatus" value={w.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )

  const history = (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" aria-hidden />{' '}
          {t('assets.sectionHistory')}
        </PanelTitle>
      </PanelHeader>
      <AssetHistory items={asset.history} />
    </Panel>
  )

  const qr = !compact && (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('assets.qrTitle')}</PanelTitle>
      </PanelHeader>
      <PanelBody className="grid justify-items-center gap-3">
        <QrCode
          value={assetQrUrl(asset.publicId)}
          label={`${t('assets.qrTitle')}: ${asset.name}`}
          className="w-40"
        />
        <p className="text-center text-13 text-muted-foreground">{t('assets.qrHint')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void downloadQrPng(assetQrUrl(asset.publicId), `${asset.assetCode}.png`)}
          >
            <Download aria-hidden /> {t('assets.downloadPng')}
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link to={`/assets/qr-print?ids=${asset.id}`}>
              <Printer aria-hidden /> {t('assets.printLabel')}
            </Link>
          </Button>
        </div>
      </PanelBody>
    </Panel>
  )

  const downNotice = asset.downSince && (
    <Callout tone="danger" icon={AlertTriangle}>
      {t('assets.downSince', { time: formatRelative(asset.downSince) })}
    </Callout>
  )

  const meters = <AssetMeters assetId={asset.id} large={compact} />

  if (compact) {
    return (
      <div className="grid gap-4 px-4 py-4">
        {downNotice}
        {workOrders}
        {meters}
        {details}
        {components}
        {purchase}
        {history}
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid content-start gap-4">
        {downNotice}
        {details}
        {workOrders}
        {meters}
        {components}
        {recent}
        <AssetRootCauses assetId={asset.id} />
        {history}
      </div>
      <div className="grid content-start gap-4">
        {maintenance}
        {qr}
        {purchase}
      </div>
    </div>
  )
}

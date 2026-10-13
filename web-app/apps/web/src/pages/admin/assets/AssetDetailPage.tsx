import {
  Activity,
  ArrowRightLeft,
  CalendarClock,
  ClipboardList,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { AssetDetailView } from '@/components/assets/AssetDetailView'
import { AssetForm } from '@/components/assets/AssetForm'
import { AssetStatusDialog } from '@/components/assets/AssetStatusDialog'
import { AssetTransferDialog } from '@/components/assets/AssetTransferDialog'
import { Can } from '@/components/common/Can'
import { DocumentsPanel } from '@/components/documents/DocumentList'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation } from '@/hooks/useAdminQueries'
import { assetKeys, assetsApi, useAsset } from '@/services/assets.service'
import { reportError } from '@/utils/errors'

export function AssetDetailPage() {
  const { t } = useTranslation()
  const { assetId = '' } = useParams()
  const navigate = useNavigate()
  const query = useAsset(assetId)
  const [editing, setEditing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const archive = useInvalidatingMutation(
    () => assetsApi.archive(assetId),
    [assetKeys.all, assetKeys.locationsAll],
  )

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title={t('assets.title')} back={{ to: '/assets', label: t('assets.title') }} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  }

  const asset = query.data
  return (
    <>
      <PageHeader
        back={{ to: '/assets', label: t('assets.title') }}
        title={asset.name}
        meta={
          <>
            <span className="text-13 text-muted-foreground tabular">{asset.assetCode}</span>
            <StatusBadge kind="assetStatus" value={asset.status} />
            <StatusBadge kind="assetCriticality" value={asset.criticality} />
            <Badge tone="outline">{asset.category.name}</Badge>
          </>
        }
        actions={
          <>
            <Can permission="work_orders:view">
              <Button asChild variant="secondary">
                <Link to={`/work-orders?assetId=${asset.id}`}>
                  <ClipboardList aria-hidden /> {t('wo.title')}
                </Link>
              </Button>
            </Can>
            <Can permission="maintenance:create">
              <Button asChild variant="secondary">
                <Link
                  to={`/maintenance?new=1&newAssetId=${asset.id}&newRestaurantId=${asset.restaurant.id}`}
                >
                  <CalendarClock aria-hidden /> {t('pm.newForAsset')}
                </Link>
              </Button>
            </Can>
            <Can permission="work_orders:create">
              <Button asChild variant="secondary">
                <Link
                  to={`/work-orders?new=1&newAssetId=${asset.id}&newRestaurantId=${asset.restaurant.id}${asset.location ? `&newLocationId=${asset.location.id}` : ''}`}
                >
                  <Plus aria-hidden /> {t('wo.new')}
                </Link>
              </Button>
            </Can>
            {(asset.can.edit || asset.can.delete) && (
              <>
                {asset.can.edit && (
                  <>
                    <Button onClick={() => setStatusOpen(true)}>
                      <Activity aria-hidden /> {t('assets.changeStatus')}
                    </Button>
                    {asset.can.transfer && (
                      <Button variant="secondary" onClick={() => setTransferring(true)}>
                        <ArrowRightLeft aria-hidden /> {t('assets.transfer')}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => setEditing(true)}>
                      <Pencil aria-hidden /> {t('actions.edit')}
                    </Button>
                  </>
                )}
                {asset.can.delete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('assets.archive')}
                    onClick={() => setConfirmArchive(true)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </>
            )}
          </>
        }
      />

      <AssetDetailView asset={asset} />

      <Can permission="documents:view">
        <Panel className="mt-4">
          <PanelHeader>
            <PanelTitle>{t('documents.pageTitle')}</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <DocumentsPanel ownerType="ASSET" ownerId={asset.id} ownerName={asset.name} />
          </PanelBody>
        </Panel>
      </Can>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('assets.editTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing && (
              <AssetForm
                asset={asset}
                onDone={() => setEditing(false)}
                onCancel={() => setEditing(false)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {asset.can.transfer && (
        <AssetTransferDialog asset={asset} open={transferring} onOpenChange={setTransferring} />
      )}

      <AssetStatusDialog
        key={asset.status}
        asset={asset}
        open={statusOpen}
        onOpenChange={setStatusOpen}
      />

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        tone="destructive"
        title={t('assets.archiveTitle', { name: asset.name })}
        description={t('assets.archiveBody')}
        confirmLabel={t('assets.archive')}
        onConfirm={async () => {
          try {
            await archive.mutateAsync()
            toast.success(t('assets.archived'))
            navigate('/assets', { replace: true })
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

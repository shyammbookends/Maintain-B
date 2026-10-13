import { useTranslation } from 'react-i18next'
import { Megaphone } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { AssetDetailView } from '@/components/assets/AssetDetailView'
import { ErrorState } from '@/components/common/ErrorState'
import { DocumentsPanel } from '@/components/documents/DocumentList'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { useAsset } from '@/services/assets.service'

export function WorkerAssetPage() {
  const { t } = useTranslation()
  const { assetId = '' } = useParams()
  const query = useAsset(assetId)

  return (
    <>
      <WorkerPageHeader title={query.data?.name ?? t('nav.myAssets')} backTo="/w/assets" />
      {query.isPending ? (
        <div className="grid gap-3 p-4" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          title={t('assets.notFound')}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
            <span className="text-13 text-muted-foreground tabular">{query.data.assetCode}</span>
            <StatusBadge kind="assetStatus" value={query.data.status} />
            <span className="text-13 text-muted-foreground">{query.data.category.name}</span>
          </div>
          <div className="px-4 pt-3">
            <Button asChild size="xl" className="w-full">
              <Link to={`/w/report?assetId=${query.data.id}`}>
                <Megaphone aria-hidden /> {t('report.forAsset')}
              </Link>
            </Button>
          </div>
          <AssetDetailView asset={query.data} compact />
          <section className="grid gap-2 px-4 pb-6" aria-labelledby="asset-docs">
            <h2 id="asset-docs" className="text-sm font-semibold">
              {t('documents.pageTitle')}
            </h2>
            <DocumentsPanel
              ownerType="ASSET"
              ownerId={query.data.id}
              ownerName={query.data.name}
              readOnly
            />
          </section>
        </>
      )}
    </>
  )
}

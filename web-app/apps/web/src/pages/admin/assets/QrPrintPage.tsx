import type { AssetListItem } from '@maintainx/shared'
import { useQueries } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { QrCode } from '@/components/assets/QrCode'
import { assetQrUrl } from '@/utils/qr'
import { Callout } from '@/components/common/Callout'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { assetsApi, useAssets } from '@/services/assets.service'

const MAX_LABELS = 100

/**
 * Printable sheet of QR labels. Either specific assets (?ids=a,b) or whatever
 * matches the Assets list filters. Uses the browser's print dialog.
 */
export function QrPrintPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean)

  const byFilter = useAssets(
    {
      page: 1,
      pageSize: MAX_LABELS,
      sort: 'name:asc',
      q: params.get('q') ?? undefined,
      restaurantId: params.get('restaurantId') ?? undefined,
      categoryId: params.get('categoryId') ?? undefined,
      status: params.get('status') ?? undefined,
    },
    ids.length === 0,
  )
  const byId = useQueries({
    queries: ids.slice(0, MAX_LABELS).map((id) => ({
      queryKey: ['assets', 'detail', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => assetsApi.get(id, signal),
    })),
  })

  const loading = ids.length ? byId.some((q) => q.isPending) : byFilter.isPending
  const error = ids.length ? byId.find((q) => q.isError)?.error : byFilter.error
  const assets: AssetListItem[] = ids.length
    ? byId.flatMap((q) => (q.data ? [q.data] : []))
    : (byFilter.data?.data ?? [])
  const total = ids.length ? ids.length : (byFilter.data?.meta.total ?? 0)

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          back={{ to: '/assets', label: t('assets.title') }}
          title={t('qr.printTitle')}
          description={t('qr.printHint', { count: assets.length })}
          actions={
            <Button onClick={() => window.print()} disabled={assets.length === 0}>
              <Printer aria-hidden /> {t('qr.print')}
            </Button>
          }
        />
        {total > MAX_LABELS && (
          <Callout tone="info" className="mb-4">
            {t('qr.tooMany', { count: MAX_LABELS })}
          </Callout>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : assets.length === 0 ? (
        <EmptyState title={t('qr.none')} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(5cm,1fr))] gap-3 print:gap-2">
          {assets.map((a) => (
            <li
              key={a.id}
              className="flex break-inside-avoid flex-col items-center gap-1 rounded-md border bg-white p-3 text-center text-black print:rounded-none print:border-dashed"
            >
              <QrCode
                value={assetQrUrl(a.publicId)}
                label={`${a.assetCode} ${a.name}`}
                className="w-[3.5cm]"
              />
              <p className="w-full truncate text-sm font-semibold">{a.name}</p>
              <p className="text-xs tabular">{a.assetCode}</p>
              <p className="w-full truncate text-[10px]">
                {[a.restaurant.name, a.location?.name].filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

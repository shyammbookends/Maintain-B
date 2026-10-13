import { ChevronRight, Package, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { SearchInput } from '@/components/tables'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { useAssets } from '@/services/assets.service'

/** Assets in the worker's restaurants, searchable; tap to open. */
export function WorkerAssetsPage() {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [pageSize, setPageSize] = useState(30)
  const query = useAssets({ q: q || undefined, page: 1, pageSize, sort: 'name:asc' })

  return (
    <>
      <WorkerPageHeader
        title={t('nav.myAssets')}
        backTo="/w/more"
        actions={
          <Button asChild variant="ghost" size="icon-lg" aria-label={t('nav.scan')}>
            <Link to="/w/scan">
              <ScanLine className="size-5" />
            </Link>
          </Button>
        }
      />
      <div className="grid gap-3 px-4 py-4">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder={t('assets.search')}
          className="sm:w-full [&_input]:h-11 [&_input]:text-base"
        />
        {query.isPending ? (
          <div className="grid gap-2" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : query.data.data.length === 0 ? (
          <EmptyState icon={Package} title={q ? t('table.noResults') : t('assets.emptyTitle')} />
        ) : (
          <>
            <ul className="divide-y overflow-hidden rounded-lg border">
              {query.data.data.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/w/assets/${a.id}`}
                    className="flex items-center gap-3 px-4 py-3 active:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium">{a.name}</span>
                      <span className="block truncate text-13 text-muted-foreground">
                        {[a.location?.name, a.restaurant.name].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <StatusBadge kind="assetStatus" value={a.status} />
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            {query.data.meta.total > query.data.data.length && (
              <Button
                variant="secondary"
                size="lg"
                loading={query.isFetching}
                onClick={() => setPageSize((n) => n + 30)}
              >
                {t('worker.loadMore')}
              </Button>
            )}
          </>
        )}
      </div>
    </>
  )
}

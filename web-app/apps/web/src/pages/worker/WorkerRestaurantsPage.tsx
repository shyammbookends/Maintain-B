import { Building2, Clock, MapPin, Phone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { useWorkerRestaurants } from '@/services/worker.service'

export function WorkerRestaurantsPage() {
  const { t } = useTranslation()
  const query = useWorkerRestaurants()

  return (
    <>
      <WorkerPageHeader title={t('worker.restaurantsTitle')} backTo="/w/more" />
      <div className="px-4 py-4">
        {query.isPending ? (
          <div className="grid gap-2" aria-busy="true">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : query.data.length === 0 ? (
          <EmptyState icon={Building2} title={t('worker.restaurantsEmpty')} />
        ) : (
          <ul className="grid gap-2">
            {query.data.map((r) => {
              const address = [r.addressLine1, r.addressLine2, r.city].filter(Boolean).join(', ')
              return (
                <li key={r.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold">{r.name}</p>
                      <p className="text-13 text-muted-foreground">
                        {r.openTasks > 0
                          ? t('worker.openTasks', { count: r.openTasks })
                          : t('worker.noOpenTasks')}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">{r.code}</span>
                  </div>
                  <ul className="mt-3 grid gap-1.5 text-sm">
                    {address && (
                      <li className="flex gap-2">
                        <MapPin
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span>{address}</span>
                      </li>
                    )}
                    {r.opensAt && r.closesAt && (
                      <li className="flex gap-2">
                        <Clock
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="tabular">
                          {t('worker.hours', { from: r.opensAt, to: r.closesAt })}
                        </span>
                      </li>
                    )}
                  </ul>
                  {r.phone && (
                    <a
                      href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}
                      aria-label={t('worker.call', { name: r.name })}
                      className="mt-3 flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium active:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <Phone className="size-4" aria-hidden /> {r.phone}
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

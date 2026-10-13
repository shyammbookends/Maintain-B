import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronRight, Megaphone, MapPin, Package, PackageX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useParams } from 'react-router'
import { FullPageLoader } from '@/components/common/FullPageStatus'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { useCurrentUser } from '@/contexts/AuthContext'
import { BrandMark } from '@/layouts/BrandMark'
import { locationsApi } from '@/services/assets.service'
import { ApiError } from '@/services/http'
import { partsApi } from '@/services/purchasing.service'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'
import { homePath } from '@/utils/redirect'

function NotFound({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const notFound = error instanceof ApiError && (error.status === 404 || error.status === 400)
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-app px-6 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-background text-muted-foreground">
        <PackageX className="size-5" aria-hidden />
      </div>
      <h1 className="max-w-sm text-base font-semibold">
        {notFound ? t('qr.codeNotFound') : describeError(error, t)}
      </h1>
      <Button asChild className="mt-5">
        <Link to={homePath(user)}>{t('common.backHome')}</Link>
      </Button>
    </main>
  )
}

/**
 * Where a scanned location QR lands (/l/:publicId): where you are, the
 * equipment here (each opens in your own app), open work here, and a big
 * "Report a problem here" button.
 */
export function LocationQrLandingPage() {
  const { t } = useTranslation()
  const { publicId = '' } = useParams()
  const user = useCurrentUser()
  const query = useQuery({
    queryKey: ['locations', 'public', publicId],
    queryFn: ({ signal }) => locationsApi.byPublicId(publicId, signal),
    retry: false,
  })
  if (query.isPending) return <FullPageLoader />
  if (query.isError) return <NotFound error={query.error} />

  const l = query.data
  const worker = user.roleKind === 'WORKER'
  const assetBase = worker ? '/w/assets' : '/assets'
  const path = [...l.path.map((p) => p.name), l.name].join(' › ')

  return (
    <main className="min-h-dvh bg-app">
      <header className="glass sticky top-0 z-10 flex h-14 items-center justify-between border-b px-4">
        <BrandMark />
        <Button asChild variant="ghost" size="sm">
          <Link to={homePath(user)}>{t('common.backHome')}</Link>
        </Button>
      </header>
      <div className="mx-auto grid max-w-2xl gap-5 px-4 py-6">
        <section className="bg-brand animate-rise rounded-2xl px-5 py-6 shadow-[0_12px_32px_-12px_oklch(0.42_0.17_262/0.55)]">
          <p className="flex items-center gap-1.5 text-sm text-white/85">
            <Building2 className="size-4" aria-hidden /> {l.restaurant.name}
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <MapPin className="size-6" aria-hidden /> {l.name}
          </h1>
          <p className="mt-1 text-sm text-white/85">
            {enumLabel(t, 'locationType', l.type)} · {path}
          </p>
          {l.description && <p className="mt-2 text-sm text-white/90">{l.description}</p>}
        </section>

        {l.can.report && (
          <Button asChild size="xl">
            <Link
              to={
                worker
                  ? `/w/report?locationId=${l.id}&restaurantId=${l.restaurant.id}`
                  : `/work-orders?new=1&newRestaurantId=${l.restaurant.id}&newLocationId=${l.id}`
              }
            >
              <Megaphone aria-hidden /> {t('qr.reportHere')}
            </Link>
          </Button>
        )}

        <section className="grid gap-2" aria-labelledby="loc-assets">
          <h2 id="loc-assets" className="text-sm font-semibold">
            {t('qr.equipmentHere', { count: l.assets.length })}
          </h2>
          {l.assets.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              {t('qr.noEquipmentHere')}
            </p>
          ) : (
            <ul className="stagger grid gap-2">
              {l.assets.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`${assetBase}/${a.id}`}
                    className="card-lift flex items-center gap-3 rounded-xl border bg-card p-3 shadow-card"
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-info-soft text-info-fg">
                      <Package className="size-4.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{a.name}</span>
                      <span className="text-xs text-muted-foreground tabular">{a.assetCode}</span>
                    </span>
                    <StatusBadge kind="assetStatus" value={a.status} />
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {l.children.length > 0 && (
          <section className="grid gap-2" aria-labelledby="loc-children">
            <h2 id="loc-children" className="text-sm font-semibold">
              {t('qr.inside')}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {l.children.map((c) => (
                <li
                  key={c.id}
                  className="rounded-full border bg-card px-3 py-1 text-13 shadow-card"
                >
                  {c.name}
                </li>
              ))}
            </ul>
          </section>
        )}

        {l.openWorkOrders.length > 0 && (
          <section className="grid gap-2" aria-labelledby="loc-work">
            <h2 id="loc-work" className="text-sm font-semibold">
              {t('assets.sectionWorkOrders')}
            </h2>
            <ul className="divide-y rounded-xl border bg-card shadow-card">
              {l.openWorkOrders.map((w) => (
                <li key={w.id}>
                  <Link
                    to={`/work-orders/${w.id}`}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-muted/50"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-13 text-muted-foreground tabular">{w.code}</span>{' '}
                      {w.title}
                    </span>
                    <StatusBadge kind="workOrderStatus" value={w.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}

/** Where a scanned part QR lands (/p/:publicId): managers get the part page, others its stock. */
export function PartQrLandingPage() {
  const { t } = useTranslation()
  const { publicId = '' } = useParams()
  const user = useCurrentUser()
  const query = useQuery({
    queryKey: ['parts', 'public', publicId],
    queryFn: ({ signal }) => partsApi.byPublicId(publicId, signal),
    retry: false,
  })
  if (query.isPending) return <FullPageLoader />
  if (query.isError) return <NotFound error={query.error} />
  const p = query.data
  if (user.roleKind !== 'WORKER') return <Navigate to={`/inventory/parts/${p.id}`} replace />
  return (
    <main className="min-h-dvh bg-app">
      <header className="glass sticky top-0 z-10 flex h-14 items-center justify-between border-b px-4">
        <BrandMark />
        <Button asChild variant="ghost" size="sm">
          <Link to={homePath(user)}>{t('common.backHome')}</Link>
        </Button>
      </header>
      <div className="mx-auto grid max-w-2xl gap-4 px-4 py-6">
        <section className="animate-rise rounded-2xl border bg-card p-5 shadow-card">
          <p className="text-13 text-muted-foreground tabular">{p.partNumber}</p>
          <h1 className="text-xl font-semibold">{p.name}</h1>
          {p.storageLocation && (
            <p className="mt-1 text-sm text-muted-foreground">{p.storageLocation}</p>
          )}
        </section>
        <ul className="grid gap-2">
          {p.stockLevels.map((s) => (
            <li
              key={s.restaurant.id}
              className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm shadow-card"
            >
              <span>{s.restaurant.name}</span>
              <span className={s.low ? 'font-semibold text-danger-fg' : 'font-semibold'}>
                {s.quantity} {p.unit}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}

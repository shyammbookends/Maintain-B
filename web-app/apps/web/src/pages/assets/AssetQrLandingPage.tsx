import { useQuery } from '@tanstack/react-query'
import { PackageX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useParams } from 'react-router'
import { FullPageLoader } from '@/components/common/FullPageStatus'
import { Button } from '@/components/ui/button'
import { useCurrentUser } from '@/contexts/AuthContext'
import { ApiError } from '@/services/http'
import { assetsApi } from '@/services/assets.service'
import { describeError } from '@/utils/errors'
import { homePath } from '@/utils/redirect'

/**
 * Where a scanned QR code lands (/a/:publicId). Sign-in is handled by the route
 * guard (the code survives the login redirect); then the asset opens in the
 * right app for the user. Unknown or out-of-scope codes get a clear message.
 */
export function AssetQrLandingPage() {
  const { t } = useTranslation()
  const { publicId = '' } = useParams()
  const user = useCurrentUser()
  const query = useQuery({
    queryKey: ['assets', 'public', publicId],
    queryFn: ({ signal }) => assetsApi.byPublicId(publicId, signal),
    retry: false,
  })

  if (query.isPending) return <FullPageLoader />
  if (query.isSuccess) {
    const base = user.roleKind === 'WORKER' ? '/w/assets' : '/assets'
    return <Navigate to={`${base}/${query.data.id}`} replace />
  }

  const notFound =
    query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-background text-muted-foreground">
        <PackageX className="size-5" aria-hidden />
      </div>
      <h1 className="max-w-sm text-base font-semibold">
        {notFound ? t('assets.notFound') : describeError(query.error, t)}
      </h1>
      <Button asChild className="mt-5">
        <Link to={homePath(user)}>{t('common.backHome')}</Link>
      </Button>
    </main>
  )
}

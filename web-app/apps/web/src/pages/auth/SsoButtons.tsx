import type { ApiResponse, SsoProvider } from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Callout } from '@/components/common/Callout'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { API_BASE, http } from '@/services/http'
import { homePath } from '@/utils/redirect'
import { looseT } from '@/utils/i18n'

/** "Continue with Google / Microsoft" — only the providers the server has keys for. */
export function SsoButtons() {
  const { t } = useTranslation()
  const providers = useQuery({
    queryKey: ['auth', 'sso-providers'],
    queryFn: ({ signal }) =>
      http.get<ApiResponse<SsoProvider[]>>('/auth/sso/providers', { signal }).then((r) => r.data),
    staleTime: Infinity,
    retry: false,
  })
  const list = Array.isArray(providers.data) ? providers.data : []
  if (list.length === 0) return null
  return (
    <div className="grid gap-2">
      <p className="relative text-center text-xs text-muted-foreground before:absolute before:top-1/2 before:left-0 before:h-px before:w-full before:bg-border">
        <span className="relative bg-background px-2">{t('sso.or')}</span>
      </p>
      {list.map((p) => (
        <Button key={p} variant="secondary" size="lg" className="w-full" asChild>
          {/* A real navigation: the provider's page takes over, then sends the browser back. */}
          <a href={`${API_BASE}/auth/sso/${p}/start`}>{t(`sso.continue_${p}`)}</a>
        </Button>
      ))}
    </div>
  )
}

/** Where Google / Microsoft send the browser back; the session cookie is already set. */
export function SsoReturnPage() {
  const { t } = useTranslation()
  const { status, user } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const error = params.get('error')
  useEffect(() => {
    if (!error && status === 'authenticated' && user) navigate(homePath(user), { replace: true })
  }, [error, status, user, navigate])

  if (!error && (status === 'loading' || status === 'authenticated'))
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <Spinner />
      </div>
    )
  const reason = error ?? 'no_account'
  return (
    <div className="mx-auto grid min-h-dvh max-w-sm content-center gap-4 px-4">
      <Callout tone="warning" title={t('sso.failedTitle')}>
        {looseT(t)(`sso.error_${['not_configured', 'expired', 'not_verified', 'disabled', 'locked'].includes(reason) ? reason : 'no_account'}`)}
      </Callout>
      <Button asChild>
        <Link to="/login">{t('sso.backToLogin')}</Link>
      </Button>
    </div>
  )
}

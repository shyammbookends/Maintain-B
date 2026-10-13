import { loginSchema } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { Callout } from '@/components/common/Callout'
import { Form, FormRootError, PasswordField, TextField, useZodForm } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { describeError } from '@/utils/errors'
import { homePath, safeRedirect } from '@/utils/redirect'
import { SsoButtons } from './SsoButtons'

export function LoginPage() {
  const { t } = useTranslation()
  const { login, signedOutReason } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const expired = params.get('expired') === '1' || signedOutReason === 'expired'

  const form = useZodForm(loginSchema, { defaultValues: { identifier: '', password: '' } })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const user = await login(values)
      const next = user.mustChangePassword
        ? '/change-password'
        : (safeRedirect(params.get('redirect')) ?? homePath(user))
      navigate(next, { replace: true })
    } catch (err) {
      // Wrong credentials / locked / offline are about the whole form, not one field.
      form.setError('root', { message: describeError(err, t) })
      form.setValue('password', '')
      form.setFocus('password')
    }
  })

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.signInTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('auth.signInSubtitle')}</p>
      </div>

      {!errors.root && expired && <Callout tone="info">{t('auth.sessionExpired')}</Callout>}
      {!errors.root && !expired && signedOutReason === 'logout' && (
        <Callout tone="neutral">{t('auth.signedOut')}</Callout>
      )}

      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormRootError message={errors.root?.message} />
          <TextField
            control={form.control}
            name="identifier"
            label={t('auth.identifier')}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
          />
          <PasswordField
            control={form.control}
            name="password"
            label={t('auth.password')}
            autoComplete="current-password"
            required
          />
          <Button type="submit" size="lg" className="mt-1 w-full" loading={isSubmitting}>
            {t('auth.signIn')}
          </Button>
        </form>
      </Form>
      <SsoButtons />

      <p className="text-center text-13 text-muted-foreground">{t('auth.forgotPassword')}</p>
    </div>
  )
}

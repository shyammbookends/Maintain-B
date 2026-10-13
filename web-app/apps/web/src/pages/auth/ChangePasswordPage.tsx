import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm'
import { Button } from '@/components/ui/button'
import { useAuth, useCurrentUser } from '@/contexts/AuthContext'
import { homePath } from '@/utils/redirect'

/**
 * Forced on first sign-in (and after an admin reset). Users can also reach it
 * voluntarily; then it shows a way back instead of "sign out".
 */
export function ChangePasswordPage() {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const required = user.mustChangePassword

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {required ? t('auth.setNewPasswordTitle') : t('auth.changePassword')}
        </h1>
        {required && (
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.setNewPasswordBody')}</p>
        )}
      </div>

      <ChangePasswordForm stacked onDone={() => navigate(homePath(user), { replace: true })} />

      <div className="text-center">
        {required ? (
          <Button variant="link" size="sm" onClick={() => void logout()}>
            {t('actions.signOut')}
          </Button>
        ) : (
          <Link to={homePath(user)} className="text-13 text-primary hover:underline">
            {t('actions.back')}
          </Link>
        )}
      </div>
    </div>
  )
}

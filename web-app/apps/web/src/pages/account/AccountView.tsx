import { fullName } from '@maintainx/shared'
import { KeyRound, LogOut } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { DetailList } from '@/components/common/DetailList'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NotificationSettings } from '@/components/notifications/NotificationSettings'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useAuth, useCurrentUser } from '@/contexts/AuthContext'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'

interface AccountViewProps {
  /** Worker app: stacked full-width layout and a bottom sheet for the password form. */
  compact?: boolean
}

/** The signed-in user's own account: who they are, where they work, language, security. */
export function AccountView({ compact = false }: AccountViewProps) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const { logout, logoutEverywhere } = useAuth()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [confirmEverywhere, setConfirmEverywhere] = useState(false)

  const restaurants = user.isSuperAdmin ? (
    <span>{t('account.allRestaurants')}</span>
  ) : user.restaurants.length > 0 ? (
    <ul className="flex flex-wrap gap-1.5">
      {user.restaurants.map((r) => (
        <li key={r.id}>
          <Badge tone="outline">{r.name}</Badge>
        </li>
      ))}
    </ul>
  ) : (
    <span className="text-muted-foreground">{t('account.noRestaurants')}</span>
  )

  return (
    <div className={cn('grid gap-4', compact ? 'p-4' : 'max-w-3xl')}>
      <Panel>
        <PanelBody className="flex items-center gap-3">
          <Avatar name={fullName(user)} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{fullName(user)}</p>
            <p className="truncate text-13 text-muted-foreground">
              {user.roles.map((r) => r.name).join(', ')}
            </p>
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>{t('account.profile')}</PanelTitle>
        </PanelHeader>
        <PanelBody className="py-1">
          <DetailList
            items={[
              { label: t('account.email'), value: user.email },
              { label: t('account.username'), value: user.username },
              { label: t('account.phone'), value: user.phone },
              { label: t('account.restaurants'), value: restaurants },
            ]}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>{t('account.preferences')}</PanelTitle>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">{t('common.language')}</p>
            <p className="text-13 text-muted-foreground">{t('account.languageHint')}</p>
          </div>
          <LanguageSwitcher
            className={cn(compact ? 'h-11 w-full text-base' : 'h-9 w-40 text-sm')}
          />
        </PanelBody>
      </Panel>

      <NotificationSettings />

      <Panel>
        <PanelHeader>
          <PanelTitle>{t('account.security')}</PanelTitle>
        </PanelHeader>
        <PanelBody className="grid gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">{t('auth.password')}</p>
              <p className="text-13 text-muted-foreground">{t('account.passwordDesc')}</p>
            </div>
            <Button
              variant="secondary"
              size={compact ? 'lg' : 'default'}
              onClick={() => setPasswordOpen(true)}
            >
              <KeyRound aria-hidden /> {t('auth.changePassword')}
            </Button>
          </div>
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">{t('auth.signOutEverywhere')}</p>
              <p className="text-13 text-muted-foreground">{t('account.signOutEverywhereDesc')}</p>
            </div>
            <Button
              variant="destructive-outline"
              size={compact ? 'lg' : 'default'}
              onClick={() => setConfirmEverywhere(true)}
            >
              {t('auth.signOutEverywhere')}
            </Button>
          </div>
        </PanelBody>
      </Panel>

      {compact && (
        <Button variant="secondary" size="xl" className="w-full" onClick={() => void logout()}>
          <LogOut aria-hidden /> {t('actions.signOut')}
        </Button>
      )}

      <Sheet open={passwordOpen} onOpenChange={setPasswordOpen}>
        <SheetContent side={compact ? 'bottom' : 'right'}>
          <SheetHeader>
            <SheetTitle>{t('auth.changePassword')}</SheetTitle>
            <SheetDescription>{t('auth.passwordHint')}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {passwordOpen && (
              <ChangePasswordForm
                stacked={compact}
                onDone={() => setPasswordOpen(false)}
                onCancel={() => setPasswordOpen(false)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmEverywhere}
        onOpenChange={setConfirmEverywhere}
        tone="destructive"
        title={t('auth.signOutEverywhere')}
        description={t('auth.signOutEverywhereBody')}
        confirmLabel={t('auth.signOutEverywhere')}
        onConfirm={async () => {
          try {
            await logoutEverywhere()
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </div>
  )
}

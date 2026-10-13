import {
  NOTIFICATION_TYPE,
  UNMUTABLE_NOTIFICATIONS,
  type NotificationType,
} from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { BellRing } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { TestNotificationButton } from './TestNotificationButton'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toaster'
import {
  notificationsApi,
  platformKeys,
  useNotificationPreferences,
} from '@/services/platform.service'
import { reportError } from '@/utils/errors'
import { currentPushSubscription, disablePush, enablePush, pushSupported } from '@/utils/push'

/**
 * Which alerts the user wants in the app and (when the server can send them)
 * by email; plus push notifications on this device. Critical issues can't be
 * turned off in the app.
 */
export function NotificationSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const prefs = useNotificationPreferences()
  const emailOn = prefs.data?.channels.email ?? false

  async function save(muted: NotificationType[], email: NotificationType[]) {
    try {
      const next = await notificationsApi.setPreferences(muted, email)
      qc.setQueryData(platformKeys.preferences, next)
    } catch (err) {
      reportError(err, t)
    }
  }

  const toggle = (type: NotificationType, on: boolean) => {
    const muted = new Set(prefs.data?.muted ?? [])
    if (on) muted.delete(type)
    else muted.add(type)
    void save([...muted], prefs.data?.email ?? [])
  }
  const toggleEmail = (type: NotificationType, on: boolean) => {
    const email = new Set(prefs.data?.email ?? [])
    if (on) email.add(type)
    else email.delete(type)
    void save(prefs.data?.muted ?? [], [...email])
  }

  return (
    <Panel>
      <PanelHeader className="flex items-center justify-between gap-2">
        <PanelTitle>{t('notifications.settings')}</PanelTitle>
        <TestNotificationButton />
      </PanelHeader>
      <PanelBody className="grid gap-1">
        <p className="mb-2 text-13 text-muted-foreground">{t('notifications.settingsHint')}</p>
        {prefs.data?.channels.push && prefs.data.channels.pushKey && (
          <PushToggle publicKey={prefs.data.channels.pushKey} />
        )}
        {prefs.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="flex justify-end gap-6 text-xs text-muted-foreground" aria-hidden>
              <span>{t('notifications.inApp')}</span>
              {emailOn && <span>{t('notifications.email')}</span>}
            </div>
            {NOTIFICATION_TYPE.map((type) => {
              const locked = UNMUTABLE_NOTIFICATIONS.includes(type)
              const id = `notif-${type}`
              const label = t(`notifications.type_${type}`)
              return (
                <div key={type} className="flex min-h-11 items-center justify-between gap-3">
                  <label htmlFor={id} className="text-sm">
                    {label}
                    {locked && (
                      <span className="block text-xs text-muted-foreground">
                        {t('notifications.alwaysOn')}
                      </span>
                    )}
                  </label>
                  <span className="flex items-center gap-6">
                    <Switch
                      id={id}
                      checked={locked || !prefs.data?.muted.includes(type)}
                      disabled={locked}
                      onCheckedChange={(on) => toggle(type, on)}
                    />
                    {emailOn && (
                      <Switch
                        aria-label={t('notifications.emailFor', { type: label })}
                        checked={prefs.data?.email.includes(type) ?? false}
                        onCheckedChange={(on) => toggleEmail(type, on)}
                      />
                    )}
                  </span>
                </div>
              )
            })}
          </>
        )}
      </PanelBody>
    </Panel>
  )
}

function PushToggle({ publicKey }: { publicKey: string }) {
  const { t } = useTranslation()
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void currentPushSubscription().then((s) => setOn(!!s))
  }, [])
  if (!pushSupported()) return null

  async function change() {
    setBusy(true)
    try {
      if (on) {
        await disablePush()
        setOn(false)
      } else {
        const r = await enablePush(publicKey)
        if (r === 'granted') {
          setOn(true)
          toast.success(t('notifications.pushOn'))
        } else
          toast.info(
            t(r === 'denied' ? 'notifications.pushDenied' : 'notifications.pushUnavailable'),
          )
      }
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5">
      <BellRing className="size-4 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 text-sm">
        {t('notifications.pushTitle')}
        <span className="block text-xs text-muted-foreground">{t('notifications.pushHint')}</span>
      </span>
      <Button
        size="sm"
        variant="secondary"
        loading={busy || on === null}
        onClick={() => void change()}
      >
        {on ? t('notifications.pushDisable') : t('notifications.pushEnable')}
      </Button>
    </div>
  )
}

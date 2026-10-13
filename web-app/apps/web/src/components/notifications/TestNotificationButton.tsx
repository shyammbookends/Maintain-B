import { Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { http } from '@/services/http'
import { reportError } from '@/utils/errors'

/** Account page: send yourself a test notification (in-app, email and push if set up). */
export function TestNotificationButton() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await http.post('/notifications/test')
          toast.success(t('integrations.testSent'))
        } catch (err) {
          reportError(err, t)
        } finally {
          setBusy(false)
        }
      }}
    >
      <Mail aria-hidden /> {t('integrations.sendTest')}
    </Button>
  )
}

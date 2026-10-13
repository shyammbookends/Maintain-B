import { useTranslation } from 'react-i18next'
import { SecretReveal } from '@/components/common/SecretReveal'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface TempPassword {
  name: string
  password: string
  title: string
}

/** Shows a just-issued temporary password once. Closing it discards the value. */
export function TempPasswordDialog({
  value,
  onClose,
}: {
  value: TempPassword | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showClose={false} onInteractOutside={(e) => e.preventDefault()}>
        {value && (
          <>
            <DialogHeader>
              <DialogTitle>{value.title}</DialogTitle>
              <DialogDescription>
                {t('users.tempPasswordBody', { name: value.name })}
              </DialogDescription>
            </DialogHeader>
            <SecretReveal value={value.password} label={t('users.tempPasswordTitle')} />
            <DialogFooter>
              <Button onClick={onClose}>{t('common.done')}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

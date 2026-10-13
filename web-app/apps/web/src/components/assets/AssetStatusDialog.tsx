import { ASSET_STATUS, assetStatusChangeSchema, type AssetDetail } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import {
  Form,
  FormActions,
  FormRootError,
  SelectField,
  TextareaField,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation } from '@/hooks/useAdminQueries'
import { assetKeys, assetsApi } from '@/services/assets.service'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

export function AssetStatusDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(assetStatusChangeSchema, {
    defaultValues: { status: asset.status, note: '' },
  })
  const save = useInvalidatingMutation(
    (v: { status: AssetDetail['status']; note: string }) => assetsApi.changeStatus(asset.id, v),
    [assetKeys.all, ['dashboard']],
  )
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values)
      toast.success(t('assets.statusChanged'))
      onOpenChange(false)
      form.reset({ status: values.status, note: '' })
    } catch (err) {
      form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assets.statusTitle')}</DialogTitle>
          <DialogDescription>
            {asset.name} · {asset.assetCode}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <SelectField
              control={form.control}
              name="status"
              label={t('assets.newStatus')}
              options={ASSET_STATUS.map((s) => ({
                value: s,
                label: enumLabel(t, 'assetStatus', s),
              }))}
            />
            <TextareaField
              control={form.control}
              name="note"
              label={t('assets.statusNote')}
              optional
              rows={2}
            />
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('actions.save')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

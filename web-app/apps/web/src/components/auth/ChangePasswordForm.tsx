import { changePasswordFormSchema } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import {
  Form,
  FormActions,
  FormRootError,
  PasswordField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/contexts/AuthContext'
import { describeError } from '@/utils/errors'

interface ChangePasswordFormProps {
  onDone?: () => void
  onCancel?: () => void
  /** Full-width submit (sign-in style) instead of a right-aligned action row. */
  stacked?: boolean
}

export function ChangePasswordForm({ onDone, onCancel, stacked = false }: ChangePasswordFormProps) {
  const { t } = useTranslation()
  const { changePassword } = useAuth()
  const form = useZodForm(changePasswordFormSchema, {
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await changePassword({ currentPassword, newPassword })
      toast.success(t('auth.passwordChanged'))
      onDone?.()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <PasswordField
          control={form.control}
          name="currentPassword"
          label={t('auth.currentPassword')}
          autoComplete="current-password"
          required
          autoFocus={stacked}
        />
        <PasswordField
          control={form.control}
          name="newPassword"
          label={t('auth.newPassword')}
          description={t('auth.passwordHint')}
          autoComplete="new-password"
          required
        />
        <PasswordField
          control={form.control}
          name="confirmPassword"
          label={t('auth.confirmPassword')}
          autoComplete="new-password"
          required
        />
        {stacked ? (
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            {t('auth.savePassword')}
          </Button>
        ) : (
          <FormActions>
            {onCancel && (
              <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
                {t('actions.cancel')}
              </Button>
            )}
            <Button type="submit" loading={isSubmitting}>
              {t('auth.savePassword')}
            </Button>
          </FormActions>
        )}
      </form>
    </Form>
  )
}

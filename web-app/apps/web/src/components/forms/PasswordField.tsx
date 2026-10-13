import { Eye, EyeOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Control, FieldPath, FieldValues } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './form'

interface PasswordFieldProps<T extends FieldValues, N extends FieldPath<T>, TT> {
  control: Control<T, unknown, TT>
  name: N
  label: ReactNode
  description?: ReactNode
  required?: boolean
  disabled?: boolean
  className?: string
  /** "current-password" for sign-in, "new-password" so password managers offer to generate one. */
  autoComplete: 'current-password' | 'new-password'
  autoFocus?: boolean
}

/** Password input with a show/hide toggle (important on phones, where typos are common). */
export function PasswordField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  description,
  required,
  disabled,
  className,
  autoComplete,
  autoFocus,
}: PasswordFieldProps<T, N, TT>) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel required={required}>{label}</FormLabel>
          <div className="relative">
            <FormControl>
              <Input
                type={visible ? 'text' : 'password'}
                name={field.name}
                ref={field.ref}
                value={(field.value as string | undefined) ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                disabled={disabled}
                autoComplete={autoComplete}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={autoFocus}
                className="pr-10"
                aria-required={required || undefined}
              />
            </FormControl>
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
              aria-pressed={visible}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              {visible ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </button>
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

import { Slot } from 'radix-ui'
import { createContext, useContext, useId, type ComponentProps } from 'react'
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { cn } from '@/utils/cn'
import { translateValidationMessage } from '@/utils/i18n'

/*
 * shadcn/ui form primitives on react-hook-form. Every control gets a stable id,
 * aria-describedby (description + error), aria-invalid, and translated errors.
 */

export const Form = FormProvider

interface FormFieldContextValue {
  name: string
}
const FormFieldContext = createContext<FormFieldContextValue | null>(null)

interface FormItemContextValue {
  id: string
}
const FormItemContext = createContext<FormItemContextValue | null>(null)

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  TTransformedValues = TFieldValues,
>(props: ControllerProps<TFieldValues, TName, TTransformedValues>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

export function useFormField() {
  const fieldContext = useContext(FormFieldContext)
  const itemContext = useContext(FormItemContext)
  if (!fieldContext) throw new Error('useFormField must be used inside <FormField>')
  if (!itemContext) throw new Error('useFormField must be used inside <FormItem>')

  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)
  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-control`,
    formDescriptionId: `${id}-description`,
    formMessageId: `${id}-message`,
    ...fieldState,
  }
}

export function FormItem({ className, ...props }: ComponentProps<'div'>) {
  const id = useId()
  return (
    <FormItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn('grid content-start gap-1.5', className)} {...props} />
    </FormItemContext.Provider>
  )
}

export function FormLabel({
  className,
  children,
  required,
  optional,
  ...props
}: ComponentProps<typeof Label> & { required?: boolean; optional?: boolean }) {
  const { t } = useTranslation()
  const { formItemId } = useFormField()
  return (
    <Label htmlFor={formItemId} className={className} {...props}>
      {children}
      {required && (
        <>
          <span aria-hidden className="text-danger-fg">
            *
          </span>
          <span className="sr-only">({t('common.required')})</span>
        </>
      )}
      {optional && (
        <span className="text-xs font-normal text-muted-foreground">({t('common.optional')})</span>
      )}
    </Label>
  )
}

export function FormControl(props: ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()
  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
      aria-invalid={!!error}
      {...props}
    />
  )
}

export function FormDescription({ className, ...props }: ComponentProps<'p'>) {
  const { formDescriptionId } = useFormField()
  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

export function FormMessage({ className, children, ...props }: ComponentProps<'p'>) {
  const { t } = useTranslation()
  const { error, formMessageId } = useFormField()
  const body = error ? translateValidationMessage(t, String(error.message ?? '')) : children
  if (!body) return null
  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      role={error ? 'alert' : undefined}
      className={cn('text-xs font-medium text-danger-fg', className)}
      {...props}
    >
      {body}
    </p>
  )
}

/** Form-level error (e.g. server rejected the whole submission). */
export function FormRootError({ message, className }: { message?: string; className?: string }) {
  const { t } = useTranslation()
  if (!message) return null
  return (
    <p
      role="alert"
      className={cn(
        'rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-fg',
        className,
      )}
    >
      {translateValidationMessage(t, message)}
    </p>
  )
}

/** Right-aligned action row at the bottom of a form. */
export function FormActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="form-actions"
      className={cn('flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

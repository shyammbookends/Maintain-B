import type { ReactNode } from 'react'
import type { Control, FieldPath, FieldValues } from 'react-hook-form'
import { CheckboxList, type CheckboxOption } from '@/components/common/CheckboxList'
import { FormField, FormItem, FormMessage, useFormField } from './form'
import { cn } from '@/utils/cn'

interface CheckboxListFieldProps<T extends FieldValues, N extends FieldPath<T>, TT> {
  control: Control<T, unknown, TT>
  name: N
  label: ReactNode
  description?: ReactNode
  options: readonly CheckboxOption[]
  emptyMessage?: ReactNode
  disabled?: boolean
  required?: boolean
  className?: string
}

function GroupLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  const { formItemId } = useFormField()
  return (
    <span
      id={`${formItemId}-label`}
      className="flex items-center gap-1 text-sm leading-none font-medium"
    >
      {children}
      {required && (
        <span aria-hidden className="text-danger-fg">
          *
        </span>
      )}
    </span>
  )
}

function GroupControl(props: Omit<Parameters<typeof CheckboxList>[0], 'aria-labelledby'>) {
  const { formItemId, formDescriptionId, formMessageId, error } = useFormField()
  return (
    <CheckboxList
      {...props}
      invalid={!!error}
      aria-labelledby={`${formItemId}-label`}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
    />
  )
}

function GroupDescription({ children }: { children: ReactNode }) {
  const { formDescriptionId } = useFormField()
  return (
    <p id={formDescriptionId} className="text-xs text-muted-foreground">
      {children}
    </p>
  )
}

/** Multi-select form field (array of ids) rendered as a checkbox list. */
export function CheckboxListField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  description,
  options,
  emptyMessage,
  disabled,
  required,
  className,
}: CheckboxListFieldProps<T, N, TT>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn(className)}>
          <GroupLabel required={required}>{label}</GroupLabel>
          {description && <GroupDescription>{description}</GroupDescription>}
          <GroupControl
            options={options}
            value={(field.value as string[] | undefined) ?? []}
            onChange={(v) => {
              field.onChange(v)
              field.onBlur()
            }}
            emptyMessage={emptyMessage}
            disabled={disabled}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

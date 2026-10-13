import type { ComponentProps, ReactNode } from 'react'
import type { Control, FieldPath, FieldValues } from 'react-hook-form'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/utils/cn'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './form'

/*
 * One-line field components: label + control + description + error, fully wired.
 *
 *   <TextField control={form.control} name="title" label="Title" required />
 */

interface BaseFieldProps<T extends FieldValues, N extends FieldPath<T>, TT> {
  control: Control<T, unknown, TT>
  name: N
  label: ReactNode
  description?: ReactNode
  required?: boolean
  optional?: boolean
  disabled?: boolean
  className?: string
}

type InputPassthrough = Omit<
  ComponentProps<'input'>,
  'name' | 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'disabled' | 'required' | 'type'
>

export function TextField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  description,
  required,
  optional,
  disabled,
  className,
  type = 'text',
  ...inputProps
}: BaseFieldProps<T, N, TT> &
  InputPassthrough & {
    type?: 'text' | 'email' | 'tel' | 'password' | 'url' | 'search' | 'datetime-local'
  }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <FormControl>
            <Input
              {...inputProps}
              type={type}
              name={field.name}
              ref={field.ref}
              value={(field.value as string | undefined) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              disabled={disabled}
              aria-required={required || undefined}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function TextareaField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  description,
  required,
  optional,
  disabled,
  className,
  rows,
  placeholder,
  maxLength,
}: BaseFieldProps<T, N, TT> & { rows?: number; placeholder?: string; maxLength?: number }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <FormControl>
            <Textarea
              name={field.name}
              ref={field.ref}
              value={(field.value as string | undefined) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              disabled={disabled}
              rows={rows}
              placeholder={placeholder}
              maxLength={maxLength}
              aria-required={required || undefined}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/** Stores `number | undefined` (never NaN or ''). Pair with z.number().optional(). */
export function NumberField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  description,
  required,
  optional,
  disabled,
  className,
  min,
  max,
  step,
  suffix,
  placeholder,
}: BaseFieldProps<T, N, TT> & {
  min?: number
  max?: number
  step?: number
  suffix?: ReactNode
  placeholder?: string
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <div className="relative">
            <FormControl>
              <Input
                type="number"
                inputMode="decimal"
                name={field.name}
                ref={field.ref}
                value={field.value === undefined || field.value === null ? '' : String(field.value)}
                onChange={(e) => {
                  const n = e.target.valueAsNumber
                  field.onChange(Number.isNaN(n) ? undefined : n)
                }}
                onBlur={field.onBlur}
                disabled={disabled}
                min={min}
                max={max}
                step={step}
                placeholder={placeholder}
                className={cn('tabular', suffix ? 'pr-14' : undefined)}
                aria-required={required || undefined}
              />
            </FormControl>
            {suffix && (
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                {suffix}
              </span>
            )}
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/** Native date input (best mobile UX). Value is 'YYYY-MM-DD' or ''. */
export function DateField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  description,
  required,
  optional,
  disabled,
  className,
  min,
  max,
}: BaseFieldProps<T, N, TT> & { min?: string; max?: string }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <FormControl>
            <Input
              type="date"
              name={field.name}
              ref={field.ref}
              value={(field.value as string | undefined) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              disabled={disabled}
              min={min}
              max={max}
              className="tabular"
              aria-required={required || undefined}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export function SelectField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  description,
  required,
  optional,
  disabled,
  className,
  options,
  placeholder,
}: BaseFieldProps<T, N, TT> & { options: readonly SelectOption[]; placeholder?: string }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <Select
            name={field.name}
            value={(field.value as string | undefined) ?? ''}
            onValueChange={(v) => {
              field.onChange(v)
              field.onBlur()
            }}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger ref={field.ref} aria-required={required || undefined}>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/** Inline on/off setting with label on the left and switch on the right. */
export function SwitchField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  description,
  disabled,
  className,
}: Omit<BaseFieldProps<T, N, TT>, 'required' | 'optional'>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem
          className={cn(
            'flex items-center justify-between gap-4 rounded-md border px-3 py-2.5',
            className,
          )}
        >
          <div className="grid gap-1">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch
              ref={field.ref}
              name={field.name}
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
              disabled={disabled}
            />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

export function CheckboxField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  description,
  disabled,
  className,
}: Omit<BaseFieldProps<T, N, TT>, 'required' | 'optional'>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn('flex flex-row items-start gap-2.5', className)}>
          <FormControl>
            <Checkbox
              ref={field.ref}
              name={field.name}
              checked={Boolean(field.value)}
              onCheckedChange={(v) => field.onChange(v === true)}
              onBlur={field.onBlur}
              disabled={disabled}
              className="mt-0.5"
            />
          </FormControl>
          <div className="grid gap-1">
            <FormLabel className="font-normal">{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  )
}

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm, type FieldValues, type Resolver, type UseFormProps } from 'react-hook-form'
import type { z } from 'zod'
import i18n from '@/i18n'

/**
 * useForm + Zod with sensible defaults:
 *  - validates on blur first, then on every change once a field has an error
 *  - re-validates fields that are in error when the UI language changes,
 *    so messages switch language too
 */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  options: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'> = {},
) {
  const form = useForm<z.input<S>, unknown, z.output<S>>({
    mode: 'onTouched',
    reValidateMode: 'onChange',
    ...options,
    resolver: zodResolver(schema as never) as unknown as Resolver<z.input<S>, unknown, z.output<S>>,
  })

  // `form` is a stable object whose `formState` is refreshed each render, so the
  // handler always reads the latest errors without re-subscribing.
  useEffect(() => {
    const revalidateErrors = () => {
      const names = Object.keys(form.formState.errors)
      if (names.length > 0) void form.trigger(names as never)
    }
    i18n.on('languageChanged', revalidateErrors)
    return () => i18n.off('languageChanged', revalidateErrors)
  }, [form])

  return form
}

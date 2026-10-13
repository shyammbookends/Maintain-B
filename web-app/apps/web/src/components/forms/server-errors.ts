import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import { ApiError } from '@/services/http'

function hasPath(values: unknown, path: string): boolean {
  let cursor: unknown = values
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object' || !(segment in cursor)) return false
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return true
}

/**
 * Maps API `fieldErrors` onto form fields (and focuses the first one).
 * Returns true when at least one error was attached; when false the caller
 * should show a general message instead (toast or <FormRootError>).
 *
 * Fields must be present in the form values (give every field a default value).
 * `aliases` maps API field names onto differently named form fields.
 */
export function applyServerErrors<T extends FieldValues, C, TT>(
  form: UseFormReturn<T, C, TT>,
  error: unknown,
  aliases: Record<string, string> = {},
): boolean {
  if (!(error instanceof ApiError) || !error.fieldErrors) return false

  const values = form.getValues()
  let applied = false
  for (const [apiPath, messages] of Object.entries(error.fieldErrors)) {
    const path = aliases[apiPath] ?? apiPath
    const message = messages[0]
    if (!message || !hasPath(values, path)) continue
    form.setError(path as Path<T>, { type: 'server', message }, { shouldFocus: !applied })
    applied = true
  }
  return applied
}

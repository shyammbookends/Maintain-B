import { looksLikePhone, normalizePhone } from '@maintainx/shared'

export interface IdentifierLookup {
  field: 'email' | 'username' | 'phone'
  value: string
}

/** One login box accepts email, phone or username; decide which column to search. */
export function parseIdentifier(raw: string): IdentifierLookup {
  const value = raw.trim()
  if (value.includes('@')) return { field: 'email', value: value.toLowerCase() }
  if (looksLikePhone(value)) return { field: 'phone', value: normalizePhone(value) }
  return { field: 'username', value: value.toLowerCase() }
}

/** All restaurants are in India; 10-digit local numbers get this prefix. */
export const DEFAULT_COUNTRY_CODE = '+91'

/**
 * Canonical phone form used for storage and login lookup:
 * strip spaces, dashes, dots and brackets; local 10-digit numbers (optionally
 * with a leading 0) become +91XXXXXXXXXX; "0091…" becomes "+91…".
 *
 *   "98765 43210" → "+919876543210"     "+91 (98765) 43210" → "+919876543210"
 */
export function normalizePhone(raw: string): string {
  let v = raw.trim().replace(/[\s().-]/g, '')
  if (v.startsWith('00')) v = `+${v.slice(2)}`
  if (/^0\d{10}$/.test(v)) v = v.slice(1)
  if (/^\d{10}$/.test(v)) return `${DEFAULT_COUNTRY_CODE}${v}`
  return v
}

/** Loose check for "this looks like a phone number" (used to route login lookups). */
export function looksLikePhone(raw: string): boolean {
  return /^\+?\d{7,15}$/.test(raw.trim().replace(/[\s().-]/g, ''))
}

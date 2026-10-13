/*
 * Flutter AppColors tones (mobile-app/lib/widgets/common.dart) for the phone
 * components.
 */

export type MTone = 'info' | 'violet' | 'success' | 'warning' | 'sky' | 'danger' | 'neutral'

/** Solid accent colour of a tone (icons, stripes) — Flutter `toneAccent`. */
export const TONE_ACCENT: Record<MTone, string> = {
  info: '#4f46e5',
  violet: '#7c3aed',
  success: '#10b981',
  warning: '#f59e0b',
  sky: '#0ea5e9',
  danger: '#e11d48',
  neutral: '#64748b',
}

/** Soft background + text colour of a tone — Flutter `toneColors`. */
export const TONE_SOFT: Record<MTone, { bg: string; fg: string }> = {
  info: { bg: '#eef2ff', fg: '#4338ca' },
  violet: { bg: '#f5f3ff', fg: '#6d28d9' },
  success: { bg: '#ecfdf5', fg: '#047857' },
  warning: { bg: '#fffbeb', fg: '#b45309' },
  sky: { bg: '#f0f9ff', fg: '#0369a1' },
  danger: { bg: '#fff1f2', fg: '#be123c' },
  neutral: { bg: '#f1f5f9', fg: '#64748b' },
}

export const MENU_TONES: MTone[] = ['info', 'violet', 'success', 'warning', 'sky', 'danger']

/** `rgba` of a hex colour. */
export function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function initialsOf(p: { firstName?: string | null; lastName?: string | null } | null) {
  if (!p) return '?'
  return `${(p.firstName ?? '').slice(0, 1)}${(p.lastName ?? '').slice(0, 1)}`.toUpperCase() || '?'
}

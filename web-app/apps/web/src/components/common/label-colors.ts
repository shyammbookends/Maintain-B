import type { LabelColor } from '@maintainx/shared'

/** Soft background + strong text per label colour (text contrast ≥ 4.5:1). */
export const LABEL_COLOR_CLASS: Record<LabelColor, string> = {
  blue: 'bg-blue-50 text-blue-800 ring-blue-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  red: 'bg-rose-50 text-rose-800 ring-rose-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  teal: 'bg-teal-50 text-teal-800 ring-teal-200',
  pink: 'bg-pink-50 text-pink-800 ring-pink-200',
  slate: 'bg-slate-100 text-slate-800 ring-slate-300',
}

export const LABEL_SWATCH_CLASS: Record<LabelColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  violet: 'bg-violet-500',
  teal: 'bg-teal-500',
  pink: 'bg-pink-500',
  slate: 'bg-slate-500',
}

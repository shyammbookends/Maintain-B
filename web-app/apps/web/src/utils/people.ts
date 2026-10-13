import { fullName, type PersonRef } from '@maintainx/shared'
import type { TFunction } from 'i18next'

/** Who reported it: the signed-in reporter, or the guest from the public portal. */
export function reporterName(
  t: TFunction,
  r: { requestedBy: PersonRef | null; guest: { name: string; phone: string | null } | null },
): string {
  if (r.requestedBy) return fullName(r.requestedBy)
  return t('portal.guestName', { name: r.guest?.name ?? '—' })
}

/** Uploader of a file; portal guests have no account. */
export function uploaderName(t: TFunction, p: PersonRef | null): string {
  return p ? fullName(p) : t('portal.guest')
}

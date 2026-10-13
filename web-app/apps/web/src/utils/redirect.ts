import type { AuthUser } from '@maintainx/shared'

/**
 * Only same-app paths are allowed as post-login redirects, so a crafted link
 * like /login?redirect=https://evil.example can't bounce users off-site.
 */
export function safeRedirect(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null
  if (/^\/(login|change-password)(\/|\?|$)/.test(value)) return null
  return value
}

/** Where a user lands after signing in. Workers get the mobile app; everyone else the admin app. */
export function homePath(user: Pick<AuthUser, 'roleKind'>): string {
  return user.roleKind === 'WORKER' ? '/w' : '/'
}

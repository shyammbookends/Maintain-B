import type { SsoProvider } from '@maintainx/shared'
import { createHash, randomBytes } from 'node:crypto'
import { env } from '../../config/env.js'

/*
 * "Sign in with Google / Microsoft" (OpenID Connect, authorization code +
 * PKCE). The provider proves the email address; the user must already exist
 * in the app with that email. Keys come from the free Google Cloud console /
 * Microsoft Entra app registration.
 */

interface ProviderConfig {
  authorize: string
  token: string
  userinfo: string
  clientId: string
  clientSecret: string
  scope: string
}

function config(p: SsoProvider): ProviderConfig | null {
  if (p === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null
    return {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      scope: 'openid email profile',
    }
  }
  // Only the organisation's own directory: its admins vouch for the email.
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.MICROSOFT_TENANT_ID)
    return null
  const base = `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID)}/oauth2/v2.0`
  return {
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    userinfo: 'https://graph.microsoft.com/oidc/userinfo',
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    scope: 'openid email profile',
  }
}

export const enabledProviders = (): SsoProvider[] =>
  (['google', 'microsoft'] as const).filter((p) => config(p) !== null)

export const redirectUri = (p: SsoProvider) =>
  `${env.APP_URL.replace(/\/+$/, '')}/api/v1/auth/sso/${p}/callback`

const b64url = (b: Buffer) => b.toString('base64url')

/** Where to send the browser, plus the state + PKCE verifier to remember (cookie). */
export function startUrl(p: SsoProvider): { url: string; state: string; verifier: string } | null {
  const c = config(p)
  if (!c) return null
  const state = b64url(randomBytes(24))
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const url = new URL(c.authorize)
  url.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri(p),
    response_type: 'code',
    scope: c.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return { url: url.toString(), state, verifier }
}

/** Exchanges the code and returns the verified email (or null). */
export async function verifiedEmail(
  p: SsoProvider,
  code: string,
  verifier: string,
): Promise<string | null> {
  const c = config(p)
  if (!c) return null
  const tokenRes = await fetch(c.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(p),
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code_verifier: verifier,
    }),
  })
  if (!tokenRes.ok) return null
  const { access_token, id_token } = (await tokenRes.json()) as {
    access_token?: string
    id_token?: string
  }
  if (!access_token) return null
  if (p === 'microsoft') return microsoftEmail(id_token)
  const infoRes = await fetch(c.userinfo, {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!infoRes.ok) return null
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean | string }
  if (!info.email) return null
  if (info.email_verified !== true && info.email_verified !== 'true') return null
  return info.email.toLowerCase()
}

/** Claims of a JWT received straight from the provider's token endpoint over TLS (OIDC §3.1.3.7). */
export function jwtClaims(token: string | undefined): Record<string, unknown> | null {
  const part = token?.split('.')[1]
  if (!part) return null
  try {
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Microsoft's `email` claim is not verified (any directory admin, or a guest,
 * can set it to someone else's address). Only accept a sign-in that comes from
 * the configured tenant, by a member of it (not a guest from elsewhere), and
 * use the address only when Entra marks its domain verified (`xms_edov`) —
 * otherwise the sign-in name (UPN), which must be on one of the tenant's
 * verified domains.
 */
export function microsoftEmail(idToken: string | undefined): string | null {
  const c = jwtClaims(idToken)
  const tenant = env.MICROSOFT_TENANT_ID?.toLowerCase()
  if (!c || !tenant) return null
  const tid = typeof c.tid === 'string' ? c.tid.toLowerCase() : ''
  const iss = typeof c.iss === 'string' ? c.iss.toLowerCase() : ''
  if (!tid || !iss.includes(`/${tid}/`)) return null
  // A GUID tenant must match exactly; a domain tenant only resolves to its own GUID anyway.
  if (/^[0-9a-f-]{36}$/.test(tenant) && tid !== tenant) return null
  if (c.aud !== env.MICROSOFT_CLIENT_ID) return null
  if (typeof c.idp === 'string' && !c.idp.toLowerCase().includes(tid)) return null // guest
  const verifiedEmail =
    (c.xms_edov === true || c.xms_edov === 'true' || c.xms_edov === 1) && typeof c.email === 'string'
      ? c.email
      : null
  const upn = typeof c.preferred_username === 'string' ? c.preferred_username : null
  const email = verifiedEmail ?? upn
  return email && /^[^@\s]+@[^@\s]+$/.test(email) ? email.toLowerCase() : null
}

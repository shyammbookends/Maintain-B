import { createHmac, timingSafeEqual } from 'node:crypto'

export interface FileLinkClaims {
  key: string
  /** Unix seconds. */
  exp: number
  type: string
  name: string
  dl: '0' | '1'
}

function payload(c: FileLinkClaims): string {
  return [c.key, String(c.exp), c.type, c.name, c.dl].join('\n')
}

export function signFileLink(claims: FileLinkClaims, secret: string): string {
  return createHmac('sha256', secret).update(payload(claims)).digest('base64url')
}

export function verifyFileLink(
  claims: FileLinkClaims & { sig: string },
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isFinite(claims.exp) || claims.exp < now) return false
  const expected = Buffer.from(signFileLink(claims, secret))
  const given = Buffer.from(claims.sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** API-relative path the local driver hands out; the web client prefixes its API base URL. */
export function buildSignedFilePath(claims: FileLinkClaims, secret: string): string {
  const params = new URLSearchParams({
    key: claims.key,
    exp: String(claims.exp),
    type: claims.type,
    name: claims.name,
    dl: claims.dl,
    sig: signFileLink(claims, secret),
  })
  return `/api/v1/files?${params.toString()}`
}

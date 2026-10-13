import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { ERROR_CODES } from '@maintainx/shared'
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose'
import { env } from '../config/env.js'
import { UnauthenticatedError } from './errors.js'

const ISSUER = 'maintainx-api'
const AUDIENCE = 'maintainx-web'
const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET)

export interface AccessClaims {
  /** user id */
  sub: string
  /** organization id */
  org: string
  /** user.tokenVersion at issue time; bumping it invalidates every access token. */
  tv: number
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ org: claims.org, tv: claims.tv })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessKey)
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    })
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.org !== 'string' ||
      typeof payload.tv !== 'number'
    ) {
      throw new UnauthenticatedError(ERROR_CODES.TOKEN_INVALID, 'Your session is no longer valid.')
    }
    return { sub: payload.sub, org: payload.org, tv: payload.tv }
  } catch (err) {
    if (err instanceof UnauthenticatedError) throw err
    if (err instanceof joseErrors.JWTExpired) {
      throw new UnauthenticatedError(ERROR_CODES.TOKEN_EXPIRED, 'Your session has expired.')
    }
    throw new UnauthenticatedError(ERROR_CODES.TOKEN_INVALID, 'Your session is no longer valid.')
  }
}

/** Opaque refresh token: 384 random bits, URL-safe. Only its hash is stored. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

/** Keyed hash, so a leaked database alone can't be used to forge lookups. */
export function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex')
}

import { randomUUID } from 'node:crypto'
import {
  AUTH_LOCKOUT_MINUTES,
  AUTH_MAX_FAILED_ATTEMPTS,
  ERROR_CODES,
  type AuthSession,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type UpdatePreferencesInput,
} from '@maintainx/shared'
import type { Request } from 'express'
import { env } from '../../config/env.js'
import { recordAudit } from '../../core/audit.js'
import {
  AppError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from '../../core/errors.js'
import { logger } from '../../core/logger.js'
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../core/password.js'
import { prisma } from '../../core/prisma.js'
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../core/tokens.js'
import type { AuthContext } from './auth.context.js'
import { revokeNativeDevices } from '../notifications/devices.service.js'
import { findUsersByIdentifier, loadUser } from './auth.repository.js'
import { parseIdentifier } from './identifier.js'

/**
 * A refresh token rotated less than this long ago is treated as a benign race
 * (two tabs refreshing at once) rather than theft: the request fails, but the
 * login is not revoked. The losing tab simply retries with the new cookie.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000

export interface SessionResult {
  session: AuthSession
  refreshToken: string
}

/*
 * Password sign-in answers unknown user, wrong password and locked account the
 * same way (401 INVALID_CREDENTIALS), so the response can't be used to find out
 * which accounts exist — an attacker could otherwise lock any account and look
 * for the different "locked" answer. The message mentions the pause instead.
 */
const invalidCredentials = () =>
  new UnauthenticatedError(
    ERROR_CODES.INVALID_CREDENTIALS,
    'Incorrect login details. After several failed attempts, sign-in pauses for a few minutes.',
  )
/** SSO only: the provider already proved who the person is. */
const accountLocked = () =>
  new AppError(423, ERROR_CODES.ACCOUNT_LOCKED, 'Too many failed attempts. Try again later.')
const accountDisabled = () =>
  new ForbiddenError('This account has been disabled.', ERROR_CODES.ACCOUNT_DISABLED)
const sessionInvalid = () =>
  new UnauthenticatedError(ERROR_CODES.TOKEN_INVALID, 'Your session is no longer valid.')

async function issueRefreshToken(userId: string, familyId: string, req?: Request): Promise<string> {
  const token = generateRefreshToken()
  await prisma.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      userAgent: req?.get('user-agent')?.slice(0, 500) ?? null,
      ip: req?.ip ?? null,
    },
  })
  return token
}

async function buildSession(authUser: AuthUser, tokenVersion: number): Promise<AuthSession> {
  return {
    accessToken: await signAccessToken({
      sub: authUser.id,
      org: authUser.organizationId,
      tv: tokenVersion,
    }),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    user: authUser,
  }
}

async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function login(input: LoginInput, req: Request): Promise<SessionResult> {
  const lookup = parseIdentifier(input.identifier)
  const matches = await findUsersByIdentifier(lookup.field, lookup.value)

  if (matches.length !== 1) {
    await burnPasswordCheck(input.password)
    if (matches.length > 1) logger.warn({ field: lookup.field }, 'ambiguous login identifier')
    throw invalidCredentials()
  }

  const user = matches[0]!
  const now = new Date()
  const audit = (action: string, metadata?: Record<string, unknown>) =>
    recordAudit(
      {
        organizationId: user.organizationId,
        actorId: user.id,
        action,
        entityType: 'AUTH',
        entityId: user.id,
        metadata: { method: lookup.field, ...metadata },
      },
      req,
    )

  if (user.lockedUntil && user.lockedUntil > now) {
    await burnPasswordCheck(input.password)
    await audit('auth.login_blocked', { lockedUntil: user.lockedUntil.toISOString() })
    throw invalidCredentials()
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const attempts = user.failedLoginCount + 1
    const lock = attempts >= AUTH_MAX_FAILED_ATTEMPTS
    await prisma.user.update({
      where: { id: user.id },
      data: {
        // On lock the counter restarts, so the user gets a fresh set of tries once it expires.
        failedLoginCount: lock ? 0 : attempts,
        lockedUntil: lock
          ? new Date(now.getTime() + AUTH_LOCKOUT_MINUTES * 60_000)
          : user.lockedUntil,
      },
    })
    await audit('auth.login_failed', { attempt: attempts, locked: lock })
    throw invalidCredentials()
  }

  // Only revealed after a correct password, so it can't be used to probe accounts.
  if (user.status === 'DISABLED') {
    await audit('auth.login_denied', { reason: 'disabled' })
    throw accountDisabled()
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, status: 'ACTIVE' },
  })

  const loaded = await loadUser(user.id)
  if (!loaded) throw invalidCredentials()
  const refreshToken = await issueRefreshToken(user.id, randomUUID(), req)
  await audit('auth.login')
  return { session: await buildSession(loaded.authUser, loaded.record.tokenVersion), refreshToken }
}

/**
 * Sign-in with Google / Microsoft: the provider confirmed the email address.
 * Only existing, active users can sign in this way (no self sign-up).
 */
export async function ssoLogin(
  email: string,
  provider: string,
  req: Request,
): Promise<SessionResult> {
  const matches = await findUsersByIdentifier('email', email.toLowerCase())
  if (matches.length !== 1) throw invalidCredentials()
  const user = matches[0]!
  const audit = (action: string, metadata?: Record<string, unknown>) =>
    recordAudit(
      {
        organizationId: user.organizationId,
        actorId: user.id,
        action,
        entityType: 'AUTH',
        entityId: user.id,
        metadata: { method: provider, ...metadata },
      },
      req,
    )
  if (user.status === 'DISABLED') {
    await audit('auth.login_denied', { reason: 'disabled' })
    throw accountDisabled()
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw accountLocked()
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lastLoginAt: new Date(), status: 'ACTIVE' },
  })
  const loaded = await loadUser(user.id)
  if (!loaded) throw invalidCredentials()
  const refreshToken = await issueRefreshToken(user.id, randomUUID(), req)
  await audit('auth.login')
  return { session: await buildSession(loaded.authUser, loaded.record.tokenVersion), refreshToken }
}

export async function refresh(rawToken: string | undefined, req: Request): Promise<SessionResult> {
  // No cookie at all: never signed in on this device (clients needn't retry).
  if (!rawToken) throw new UnauthenticatedError()
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
  })
  if (!record) throw sessionInvalid()

  const now = Date.now()
  if (record.revokedAt) {
    if (now - record.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
      // A token that was rotated long ago is being replayed: assume it was stolen.
      await revokeFamily(record.familyId)
      const owner = await prisma.user.findUnique({
        where: { id: record.userId },
        select: { organizationId: true },
      })
      if (owner) {
        await recordAudit(
          {
            organizationId: owner.organizationId,
            actorId: record.userId,
            action: 'auth.refresh_token_reuse',
            entityType: 'AUTH',
            entityId: record.userId,
            metadata: { familyId: record.familyId },
          },
          req,
        )
      }
      logger.warn(
        { userId: record.userId, familyId: record.familyId },
        'refresh token reuse detected',
      )
    }
    throw sessionInvalid()
  }

  if (record.expiresAt.getTime() <= now) {
    throw new UnauthenticatedError(ERROR_CODES.TOKEN_EXPIRED, 'Your session has expired.')
  }

  // Atomic rotation: only one concurrent request can consume this token. One
  // UPDATE statement (updateMany adds BEGIN/COMMIT round trips), and the user
  // is read at the same time; it's only used once the token is ours.
  const [consumed, loaded] = await Promise.all([
    prisma.$executeRaw`
      UPDATE refresh_tokens SET revoked_at = ${new Date(now)}
       WHERE id = ${record.id}::uuid AND revoked_at IS NULL`,
    loadUser(record.userId),
  ])
  if (consumed === 0) throw sessionInvalid()

  if (!loaded || loaded.record.status === 'DISABLED' || loaded.record.archivedAt) {
    await revokeFamily(record.familyId)
    throw sessionInvalid()
  }

  const refreshToken = await issueRefreshToken(record.userId, record.familyId, req)
  return { session: await buildSession(loaded.authUser, loaded.record.tokenVersion), refreshToken }
}

/** Ends this device's login. Unknown or already-revoked tokens are ignored. */
export async function logout(rawToken: string | undefined, req: Request): Promise<void> {
  if (!rawToken) return
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    include: { user: { select: { organizationId: true } } },
  })
  if (!record) return
  await revokeFamily(record.familyId)
  await recordAudit(
    {
      organizationId: record.user.organizationId,
      actorId: record.userId,
      action: 'auth.logout',
      entityType: 'AUTH',
      entityId: record.userId,
    },
    req,
  )
}

/** Signs the user out everywhere: every access token and every refresh token stops working. */
export async function logoutEverywhere(auth: AuthContext, req: Request): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: auth.userId }, data: { tokenVersion: { increment: 1 } } })
    await tx.refreshToken.updateMany({
      where: { userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await revokeNativeDevices(tx, auth.userId)
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'auth.logout_all',
        entityType: 'AUTH',
        entityId: auth.userId,
      },
      req,
      tx,
    )
  })
}

/**
 * Changes the password, clears "must change password", and signs out every
 * other device. Returns a fresh session for the current device.
 */
export async function changePassword(
  auth: AuthContext,
  input: ChangePasswordInput,
  req: Request,
): Promise<SessionResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } })
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new ValidationError({ currentPassword: ['validation.currentPasswordWrong'] })
  }

  const passwordHash = await hashPassword(input.newPassword)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    })
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await revokeNativeDevices(tx, user.id)
    await recordAudit(
      {
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'auth.password_changed',
        entityType: 'AUTH',
        entityId: user.id,
        metadata: { wasRequired: user.mustChangePassword },
      },
      req,
      tx,
    )
  })

  const loaded = await loadUser(user.id)
  if (!loaded) throw sessionInvalid()
  const refreshToken = await issueRefreshToken(user.id, randomUUID(), req)
  return { session: await buildSession(loaded.authUser, loaded.record.tokenVersion), refreshToken }
}

export async function updatePreferences(
  auth: AuthContext,
  input: UpdatePreferencesInput,
): Promise<AuthUser> {
  await prisma.user.update({
    where: { id: auth.userId },
    data: { preferredLocale: input.preferredLocale },
  })
  return { ...auth.user, preferredLocale: input.preferredLocale }
}

import { changePasswordSchema, loginSchema, updatePreferencesSchema } from '@maintainx/shared'
import { Router, type CookieOptions, type Response } from 'express'
import { env } from '../../config/env.js'
import { sendData, sendNoContent } from '../../core/http.js'
import { parseBody } from '../../core/validate.js'
import { getAuth, requireAuth, requireCsrfHeader } from '../../middleware/authenticate.js'
import { createSharedRateLimiter } from '../../middleware/security.js'
import * as auth from './auth.service.js'

export const REFRESH_COOKIE = 'mx_rt'
const COOKIE_PATH = '/api/v1/auth'

function cookieOptions(): CookieOptions {
  return { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: COOKIE_PATH }
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(),
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  })
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions())
}

function readRefreshCookie(cookies: unknown): string | undefined {
  const value = (cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Per-IP brake on password guessing; account lockout handles per-account guessing. */
const loginLimiter = createSharedRateLimiter('login', { windowMs: 15 * 60_000, limit: 20 })

export const authRouter = Router()

authRouter.post('/auth/login', loginLimiter, requireCsrfHeader, async (req, res) => {
  const input = parseBody(loginSchema, req)
  const { session, refreshToken } = await auth.login(input, req)
  setRefreshCookie(res, refreshToken)
  res.setHeader('Cache-Control', 'no-store')
  sendData(res, session)
})

// On failure the cookie is deliberately left alone: in a two-tab race the losing
// request must not clear the fresh cookie the winning request just set.
authRouter.post('/auth/refresh', requireCsrfHeader, async (req, res) => {
  const { session, refreshToken } = await auth.refresh(readRefreshCookie(req.cookies), req)
  setRefreshCookie(res, refreshToken)
  res.setHeader('Cache-Control', 'no-store')
  sendData(res, session)
})

authRouter.post('/auth/logout', requireCsrfHeader, async (req, res) => {
  await auth.logout(readRefreshCookie(req.cookies), req)
  clearRefreshCookie(res)
  sendNoContent(res)
})

authRouter.post(
  '/auth/logout-all',
  ...requireAuth({ allowPendingPasswordChange: true, sessionOnly: true }),
  async (req, res) => {
    await auth.logoutEverywhere(getAuth(req), req)
    clearRefreshCookie(res)
    sendNoContent(res)
  },
)

authRouter.get('/auth/me', ...requireAuth({ allowPendingPasswordChange: true }), (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  sendData(res, getAuth(req).user)
})

authRouter.patch(
  '/auth/me/preferences',
  ...requireAuth({ allowPendingPasswordChange: true, sessionOnly: true }),
  async (req, res) => {
    const input = parseBody(updatePreferencesSchema, req)
    sendData(res, await auth.updatePreferences(getAuth(req), input))
  },
)

authRouter.post(
  '/auth/change-password',
  ...requireAuth({ allowPendingPasswordChange: true, sessionOnly: true }),
  async (req, res) => {
    const input = parseBody(changePasswordSchema, req)
    const { session, refreshToken } = await auth.changePassword(getAuth(req), input, req)
    setRefreshCookie(res, refreshToken)
    res.setHeader('Cache-Control', 'no-store')
    sendData(res, session)
  },
)

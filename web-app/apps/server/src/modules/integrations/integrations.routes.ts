import {
  SSO_PROVIDERS,
  createApiKeySchema,
  idParamSchema,
  webhookSchema,
  type SsoProvider,
} from '@maintainx/shared'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { requirePermission } from '../../core/authz.js'
import { AppError, ForbiddenError } from '../../core/errors.js'
import { sendCreated, sendData } from '../../core/http.js'
import { logger } from '../../core/logger.js'
import { parseBody, parseParams } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { createSharedRateLimiter } from '../../middleware/security.js'
import * as auth from '../auth/auth.service.js'
import * as apiKeys from './api-keys.service.js'
import * as sso from './sso.js'
import * as webhooks from './webhooks.service.js'

/** API keys, webhooks (settings:edit) and single sign-on. */
export const integrationsRouter = Router()
integrationsRouter.use(['/api-keys', '/webhooks'], ...requireAuth())
const edit = requirePermission('settings:edit')

// API keys can't manage API keys or webhooks (a leaked key can't make more).
integrationsRouter.use(['/api-keys', '/webhooks'], (req, _res, next) => {
  if (getAuth(req).apiKeyId) throw new ForbiddenError('Not available with an API key.')
  next()
})

integrationsRouter.get('/api-keys', edit, async (req, res) => {
  sendData(res, await apiKeys.listApiKeys(getAuth(req)))
})
integrationsRouter.post('/api-keys', edit, async (req, res) => {
  sendCreated(res, await apiKeys.createApiKey(getAuth(req), parseBody(createApiKeySchema, req), req))
})
integrationsRouter.delete('/api-keys/:id', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await apiKeys.revokeApiKey(getAuth(req), id, req))
})

integrationsRouter.get('/webhooks', edit, async (req, res) => {
  sendData(res, await webhooks.listWebhooks(getAuth(req)))
})
integrationsRouter.post('/webhooks', edit, async (req, res) => {
  sendCreated(res, await webhooks.createWebhook(getAuth(req), parseBody(webhookSchema, req), req))
})
integrationsRouter.put('/webhooks/:id', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await webhooks.updateWebhook(getAuth(req), id, parseBody(webhookSchema, req), req))
})
integrationsRouter.delete('/webhooks/:id', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await webhooks.deleteWebhook(getAuth(req), id, req))
})
integrationsRouter.post('/webhooks/:id/test', edit, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await webhooks.testWebhook(getAuth(req), id))
})

// ---------------------------------------------------------------- single sign-on

const ssoLimiter = createSharedRateLimiter('sso', { windowMs: 15 * 60_000, limit: 30 })
const providerParam = z.object({ provider: z.enum(SSO_PROVIDERS) })
const STATE_COOKIE = 'mx_sso'
const stateCookie = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  // Lax: the provider sends the browser back with a top-level GET.
  sameSite: 'lax' as const,
  path: '/api/v1/auth/sso',
  maxAge: 10 * 60_000,
}
const appUrl = (path: string) => `${env.APP_URL.replace(/\/+$/, '')}${path}`
const fail = (res: Response, code: string) => res.redirect(302, appUrl(`/sso?error=${code}`))

integrationsRouter.get('/auth/sso/providers', (_req, res) => {
  sendData(res, sso.enabledProviders())
})

integrationsRouter.get('/auth/sso/:provider/start', ssoLimiter, (req, res) => {
  const { provider } = parseParams(providerParam, req)
  const start = sso.startUrl(provider)
  if (!start) return fail(res, 'not_configured')
  res.cookie(STATE_COOKIE, `${provider}.${start.state}.${start.verifier}`, stateCookie)
  res.redirect(302, start.url)
})

integrationsRouter.get('/auth/sso/:provider/callback', ssoLimiter, async (req, res) => {
  const { provider } = parseParams(providerParam, req)
  const raw = typeof req.cookies?.[STATE_COOKIE] === 'string' ? (req.cookies[STATE_COOKIE] as string) : ''
  res.clearCookie(STATE_COOKIE, { ...stateCookie, maxAge: undefined })
  const [savedProvider, state, verifier] = raw.split('.')
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (
    !code ||
    !state ||
    !verifier ||
    savedProvider !== provider ||
    req.query.state !== state
  )
    return fail(res, 'expired')
  try {
    const email = await sso.verifiedEmail(provider as SsoProvider, code, verifier)
    if (!email) return fail(res, 'not_verified')
    const { refreshToken } = await auth.ssoLogin(email, provider, req)
    res.cookie('mx_rt', refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    })
    res.redirect(302, appUrl('/sso?ok=1'))
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500
    if (status >= 500) logger.error({ err, provider }, 'sso sign-in failed')
    fail(res, status === 403 ? 'disabled' : status === 423 ? 'locked' : 'no_account')
  }
})

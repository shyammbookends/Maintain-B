import cors from 'cors'
import type { RequestHandler } from 'express'
import { rateLimit, type Options as RateLimitOptions } from 'express-rate-limit'
import helmet from 'helmet'
import { env } from '../config/env.js'
import { RateLimitedError } from '../core/errors.js'
import { PostgresRateLimitStore } from './rate-limit-store.js'

const baseHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
})

/** JSON responses never run as a page: lock them down completely. */
const apiCsp = helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
  },
})

/**
 * helmet defaults everywhere; a deny-all CSP and no-store caching on API
 * responses. Signed file downloads (/files) set their own headers so PDFs and
 * photos still open inline in the browser.
 */
export const securityHeaders: RequestHandler = (req, res, next) => {
  baseHeaders(req, res, (err?: unknown) => {
    if (err) return next(err)
    if (req.path.startsWith('/api/v1/files')) return next()
    res.setHeader('Cache-Control', 'no-store')
    apiCsp(req, res, next)
  })
}

export const corsPolicy = cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  exposedHeaders: ['x-request-id'],
  maxAge: 600,
})

/**
 * A limiter whose counts are shared by every server instance (Postgres). Use it
 * for abuse-sensitive routes; `name` keeps each limiter's counters apart. If the
 * database can't be reached the request goes through (account lockout and the
 * other checks still apply) rather than taking the site down.
 */
export function createSharedRateLimiter(name: string, overrides: Partial<RateLimitOptions> = {}) {
  return createRateLimiter({
    store: new PostgresRateLimitStore(`rl:${name}`),
    passOnStoreError: true,
    ...overrides,
  })
}

export function createRateLimiter(overrides: Partial<RateLimitOptions> = {}) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest,
    handler: (_req, _res, next) => next(new RateLimitedError()),
    ...overrides,
  })
}

/** General limiter for every /api route. Login gets a stricter one in the auth module. */
export const apiRateLimiter = createRateLimiter()

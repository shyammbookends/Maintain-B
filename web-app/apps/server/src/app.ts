import compression from 'compression'
import cookieParser from 'cookie-parser'
import express, { Router, type Express } from 'express'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import { httpLogger } from './middleware/http-logger.js'
import { notFoundHandler } from './middleware/not-found.js'
import { requestId } from './middleware/request-id.js'
import { apiRateLimiter, corsPolicy, securityHeaders } from './middleware/security.js'
import { idempotency } from './middleware/idempotency.js'
import { apiRouter } from './modules/index.js'

export interface CreateAppOptions {
  /** Test-only hook: extra routes mounted under /api/v1/__test. Ignored outside NODE_ENV=test. */
  testRoutes?: (router: Router) => void
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express()

  app.set('trust proxy', env.TRUST_PROXY ? 1 : false)
  app.disable('x-powered-by')

  app.use(requestId)
  app.use(httpLogger)
  app.use(securityHeaders)
  app.use(corsPolicy)
  // gzip JSON (lists shrink 5–10×); signed file downloads are already compressed media.
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => !req.path.startsWith('/api/v1/files') && compression.filter(req, res),
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  app.use(cookieParser())

  app.use('/api/v1', apiRateLimiter, idempotency, apiRouter)

  // Belt and braces: never on a hosting platform, whatever NODE_ENV says.
  if (env.isTest && !env.isProduction && !process.env.VERCEL && options.testRoutes) {
    const testRouter = Router()
    options.testRoutes(testRouter)
    app.use('/api/v1/__test', testRouter)
  }

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

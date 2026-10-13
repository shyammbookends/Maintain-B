import { Router } from 'express'
import { appInfo } from '../../config/app-info.js'
import { env } from '../../config/env.js'
import { sendData } from '../../core/http.js'
import { checkDatabase } from '../../core/prisma.js'

export const healthRouter = Router()

/** Liveness: the process is up. Never touches the database. */
healthRouter.get('/health', (_req, res) => {
  sendData(res, {
    status: 'ok' as const,
    service: appInfo.name,
    version: appInfo.version,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  })
})

/** Readiness: the process can serve traffic (database reachable). 503 when degraded. */
healthRouter.get('/ready', async (_req, res) => {
  const database = await checkDatabase()
  const ready = database.ok
  res.status(ready ? 200 : 503).json({
    data: {
      status: ready ? 'ready' : 'degraded',
      checks: {
        database: { status: database.ok ? 'up' : 'down', latencyMs: database.latencyMs },
      },
      timestamp: new Date().toISOString(),
    },
  })
})

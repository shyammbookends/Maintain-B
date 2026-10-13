import { createApp } from './app.js'
import { appInfo } from './config/app-info.js'
import { env } from './config/env.js'
import { logger } from './core/logger.js'
import { connectEarly, prisma } from './core/prisma.js'
import { startBackgroundJobs } from './jobs/index.js'

connectEarly()
const app = createApp()

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    { port: env.PORT, host: env.HOST, env: env.NODE_ENV, version: appInfo.version },
    'API listening',
  )
})

// Slightly above common proxy idle timeouts (60s) to avoid dropped keep-alive connections.
// Preventive maintenance, alerts and clean-up run in the background.
const stopJobs = startBackgroundJobs()

server.keepAliveTimeout = 65_000
server.headersTimeout = 66_000

let shuttingDown = false

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ reason }, 'shutting down')
  stopJobs()

  const force = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  force.unref()

  server.close(async (err) => {
    if (err) logger.error({ err }, 'error while closing server')
    try {
      await prisma.$disconnect()
    } catch (disconnectErr) {
      logger.error({ err: disconnectErr }, 'error while disconnecting database')
    }
    clearTimeout(force)
    process.exit(err ? 1 : exitCode)
  })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal))
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection')
  void shutdown('unhandledRejection', 1)
})

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception')
  void shutdown('uncaughtException', 1)
})

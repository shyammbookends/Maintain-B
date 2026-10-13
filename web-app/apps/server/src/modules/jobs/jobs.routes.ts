import { timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { env } from '../../config/env.js'
import { ForbiddenError, NotFoundError } from '../../core/errors.js'
import { sendData } from '../../core/http.js'
import { runAllJobs } from '../../jobs/index.js'

/**
 * Serverless hosts (Vercel) can't keep timers running, so a scheduler calls
 * this endpoint instead. It only exists when CRON_SECRET is configured, and
 * requires `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends).
 * Every job is idempotent, so extra calls are harmless.
 */
export const jobsRouter = Router()

function authorized(header: string | undefined): boolean {
  if (!env.CRON_SECRET || !header) return false
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`)
  const given = Buffer.from(header)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

jobsRouter.get('/jobs/run', async (req, res) => {
  if (!env.CRON_SECRET) throw new NotFoundError('Route')
  if (!authorized(req.headers.authorization)) throw new ForbiddenError()
  sendData(res, await runAllJobs())
})

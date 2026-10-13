import { pruneRateLimits } from '../middleware/rate-limit-store.js'
import { logger } from '../core/logger.js'
import { prisma } from '../core/prisma.js'
import { runPmGenerator } from '../modules/maintenance/pm-generator.js'
import { pruneNotifications } from '../modules/notifications/notifications.service.js'
import type { Prisma } from '@prisma/client'
import { runAlerts } from './alerts.js'
import { runReportSchedules } from './report-schedules.js'
import { runStorageJobs } from './storage.js'
import { IDEMPOTENCY_TTL_MS } from '../middleware/idempotency.js'

/*
 * Background jobs, run by an in-process timer and/or the cron endpoint. Every
 * run first claims the job in job_runs (one atomic statement), so several
 * server instances, or a timer and the cron endpoint together, never run the
 * same job twice at once (alerts and automations would fire twice).
 */

interface Job {
  name: string
  everyMs: number
  /** Delay before the first run after start-up. */
  firstAfterMs: number
  run: () => Promise<unknown>
}

/** Sessions that expired more than a week ago are no longer needed for reuse detection. */
export async function cleanup() {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const tokens = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: weekAgo } } })
  const notifications = await pruneNotifications()
  const keys = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_TTL_MS) } },
  })
  const rateLimits = await pruneRateLimits()
  return { tokens: tokens.count, notifications, idempotencyKeys: keys.count, rateLimits }
}

export const JOBS: Job[] = [
  { name: 'pm-generator', everyMs: 5 * 60_000, firstAfterMs: 5_000, run: () => runPmGenerator() },
  { name: 'alerts', everyMs: 60 * 60_000, firstAfterMs: 30_000, run: () => runAlerts() },
  // Scheduled email reports (each one is claimed before sending, so never sent twice).
  {
    name: 'report-schedules',
    everyMs: 5 * 60_000,
    firstAfterMs: 45_000,
    run: () => runReportSchedules(),
  },
  { name: 'cleanup', everyMs: 24 * 60 * 60_000, firstAfterMs: 60_000, run: cleanup },
  // Shrink old photos, remove expired files, warn before the plan is full.
  { name: 'storage', everyMs: 6 * 60 * 60_000, firstAfterMs: 120_000, run: () => runStorageJobs() },
]

export function startBackgroundJobs(jobs: Job[] = JOBS): () => void {
  const timers: NodeJS.Timeout[] = []
  for (const job of jobs) {
    let running = false
    const tick = async () => {
      if (running) return
      running = true
      const started = Date.now()
      try {
        const result = await runJobOnce(job, new Date())
        logger.debug({ job: job.name, ms: Date.now() - started, result }, 'job finished')
      } catch (err) {
        logger.error({ err, job: job.name }, 'job failed')
      } finally {
        running = false
      }
    }
    const first = setTimeout(() => void tick(), job.firstAfterMs)
    const every = setInterval(() => void tick(), job.everyMs)
    first.unref()
    every.unref()
    timers.push(first, every)
  }
  return () => timers.forEach((t) => clearTimeout(t))
}

/** A cron that fires a little early (GitHub Actions / Vercel jitter) still counts as on time. */
const CRON_SLACK_MS = 2 * 60_000

/**
 * Claims a job for this run: true when it hasn't started within its own
 * interval. One atomic statement, so overlapping cron calls (or several
 * instances) never run the same job twice at once.
 */
async function claimJob(name: string, everyMs: number, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - Math.max(0, everyMs - CRON_SLACK_MS))
  const claimed = await prisma.$executeRaw`
    INSERT INTO job_runs (name, last_started_at) VALUES (${name}, ${now})
    ON CONFLICT (name) DO UPDATE SET last_started_at = EXCLUDED.last_started_at
    WHERE job_runs.last_started_at <= ${cutoff}`
  return claimed === 1
}

/**
 * Every job that is due, in order (used by the cron endpoint on serverless
 * hosting). The endpoint is called every 15 minutes, but each job still runs
 * at its own pace: hourly alerts once an hour, the daily cleanup once a day.
 */
export async function runAllJobs(now = new Date(), jobs: Job[] = JOBS) {
  const results: Record<string, unknown> = {}
  for (const job of jobs) results[job.name] = await runJobOnce(job, now)
  return results
}

/** Runs one job if it is due and not running elsewhere; records the outcome. */
async function runJobOnce(job: Job, now: Date): Promise<unknown> {
  if (!(await claimJob(job.name, job.everyMs, now))) return { skipped: 'ran recently' }
  let result: unknown
  try {
    result = await job.run()
  } catch (err) {
    logger.error({ err, job: job.name }, 'job failed')
    result = { error: true }
  }
  await prisma.jobRun
    .update({
      where: { name: job.name },
      data: {
        lastEndedAt: new Date(),
        lastResult: JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue,
      },
    })
    .catch((err: unknown) => logger.warn({ err, job: job.name }, 'job bookkeeping failed'))
  return result
}

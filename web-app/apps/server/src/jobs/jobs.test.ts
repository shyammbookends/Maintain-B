import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { env } from '../config/env.js'
import { prisma } from '../core/prisma.js'
import { resetDatabase } from '../test/db.js'
import { runAllJobs, startBackgroundJobs } from './index.js'

/*
 * The cron endpoint is called every 15 minutes (GitHub Actions) plus daily
 * (Vercel Cron). Each job must still run at its own pace and never overlap.
 */

const app = createApp()
const MIN = 60_000

function counter(name: string, everyMs: number) {
  const job = {
    name,
    everyMs,
    firstAfterMs: 0,
    runs: 0,
    run: async () => {
      job.runs++
      await new Promise((r) => setTimeout(r, 20))
      return { ok: job.runs }
    },
  }
  return job
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(() => {
  env.CRON_SECRET = undefined
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('runAllJobs', () => {
  it('runs each job at its own pace however often the cron calls', async () => {
    const fast = counter('fast', 5 * MIN)
    const hourly = counter('hourly', 60 * MIN)
    const jobs = [fast, hourly]
    const t0 = new Date('2026-10-10T00:00:00Z')
    const at = (minutes: number) => new Date(t0.getTime() + minutes * MIN)

    expect(await runAllJobs(t0, jobs)).toEqual({ fast: { ok: 1 }, hourly: { ok: 1 } })
    // 15-minute cron ticks for an hour (the last one a minute early, like real cron jitter).
    for (const m of [15, 30, 45, 59]) await runAllJobs(at(m), jobs)
    expect(fast.runs).toBe(5)
    expect(hourly.runs).toBe(2)
    // A second call in the same minute does nothing.
    expect(await runAllJobs(at(59), jobs)).toEqual({
      fast: { skipped: 'ran recently' },
      hourly: { skipped: 'ran recently' },
    })
    const row = await prisma.jobRun.findUniqueOrThrow({ where: { name: 'hourly' } })
    expect(row.lastResult).toEqual({ ok: 2 })
    expect(row.lastEndedAt).not.toBeNull()
  })

  it('overlapping calls run a job once', async () => {
    const job = counter('once', 5 * MIN)
    const now = new Date()
    await Promise.all([runAllJobs(now, [job]), runAllJobs(now, [job]), runAllJobs(now, [job])])
    expect(job.runs).toBe(1)
  })

  it('a failing job is reported and does not stop the others', async () => {
    const ok = counter('ok', 5 * MIN)
    const broken = {
      name: 'broken',
      everyMs: 5 * MIN,
      firstAfterMs: 0,
      run: async () => {
        throw new Error('boom')
      },
    }
    expect(await runAllJobs(new Date(), [broken, ok])).toEqual({
      broken: { error: true },
      ok: { ok: 1 },
    })
  })
})

describe('GET /jobs/run', () => {
  it('needs the cron secret, then runs the real jobs', async () => {
    expect((await request(app).get('/api/v1/jobs/run')).status).toBe(404)
    env.CRON_SECRET = 'a-long-enough-cron-secret'
    expect((await request(app).get('/api/v1/jobs/run')).status).toBe(403)
    expect(
      (await request(app).get('/api/v1/jobs/run').set('Authorization', 'Bearer wrong')).status,
    ).toBe(403)
    const res = await request(app)
      .get('/api/v1/jobs/run')
      .set('Authorization', 'Bearer a-long-enough-cron-secret')
    expect(res.status).toBe(200)
    expect(Object.keys(res.body.data)).toEqual([
      'pm-generator',
      'alerts',
      'report-schedules',
      'cleanup',
      'storage',
    ])
    // Called again right away (e.g. two cron providers): everything is skipped.
    const again = await request(app)
      .get('/api/v1/jobs/run')
      .set('Authorization', 'Bearer a-long-enough-cron-secret')
    expect(Object.values(again.body.data).every((r) => (r as { skipped?: string }).skipped)).toBe(
      true,
    )
  })
})

describe('startBackgroundJobs', () => {
  it('two server instances (or a timer and the cron endpoint) run a job once', async () => {
    const job = counter('alerts-like', 60 * MIN)
    const stopA = startBackgroundJobs([job])
    const stopB = startBackgroundJobs([job])
    await new Promise((r) => setTimeout(r, 300))
    stopA()
    stopB()
    expect(job.runs).toBe(1)
    expect(await runAllJobs(new Date(), [job])).toEqual({ 'alerts-like': { skipped: 'ran recently' } })
  })
})

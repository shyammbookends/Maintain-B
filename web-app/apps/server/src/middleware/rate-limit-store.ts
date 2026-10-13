import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit'
import { prisma } from '../core/prisma.js'

/**
 * express-rate-limit store kept in Postgres, so a limit holds across every
 * serverless instance (Vercel starts many, each with empty in-memory counters).
 * Used for the limits that matter for abuse: sign-in, SSO, the public portal
 * and expensive exports. One upsert per request; expired rows are reused in
 * place and swept by the cleanup job.
 */
export class PostgresRateLimitStore implements Store {
  windowMs = 60_000
  /** Not shared with other processes' memory. */
  localKeys = false

  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs
  }

  private key(key: string) {
    return `${this.prefix}:${key}`.slice(0, 300)
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const row = await prisma.rateLimitHit.findUnique({ where: { key: this.key(key) } })
    if (!row || row.resetAt <= new Date()) return undefined
    return { totalHits: row.hits, resetTime: row.resetAt }
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const resetAt = new Date(Date.now() + this.windowMs)
    const rows = await prisma.$queryRaw<Array<{ hits: number; reset_at: Date }>>`
      INSERT INTO rate_limit_hits (key, hits, reset_at)
      VALUES (${this.key(key)}, 1, ${resetAt})
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limit_hits.reset_at <= now() THEN 1 ELSE rate_limit_hits.hits + 1 END,
        reset_at = CASE WHEN rate_limit_hits.reset_at <= now() THEN EXCLUDED.reset_at
                        ELSE rate_limit_hits.reset_at END
      RETURNING hits, reset_at`
    const row = rows[0]!
    return { totalHits: row.hits, resetTime: row.reset_at }
  }

  async decrement(key: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0) WHERE key = ${this.key(key)}`
  }

  async resetKey(key: string): Promise<void> {
    await prisma.rateLimitHit.deleteMany({ where: { key: this.key(key) } })
  }
}

/** Removes counters whose window has ended. */
export async function pruneRateLimits(now = new Date()): Promise<number> {
  const { count } = await prisma.rateLimitHit.deleteMany({ where: { resetAt: { lt: now } } })
  return count
}

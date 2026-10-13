import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { signAccessToken } from '../core/tokens.js'
import { createFixture, resetDatabase } from '../test/db.js'

/*
 * A phone that loses signal mid-request drops the connection before the
 * response is written. The work is still done, so the key must still record
 * the outcome; otherwise every retry is refused with 409 "still being saved"
 * for a whole day.
 */

let release: () => void = () => {}
let calls = 0
const app = createApp({
  testRoutes: (r) => {
    r.post('/slow', async (_req, res) => {
      calls++
      await new Promise<void>((resolve) => (release = resolve))
      res.json({ data: { ok: true } })
    })
  },
})

beforeEach(async () => {
  await resetDatabase()
  calls = 0
})

afterAll(async () => {
  await prisma.$disconnect()
})

function send(port: number, token: string, key: string, abort: boolean) {
  return new Promise<{ status: number; replay?: string } | null>((resolve, reject) => {
    const req = http.request(
      {
        port,
        method: 'POST',
        path: '/api/v1/__test/slow',
        headers: {
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': key,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        res.resume()
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            replay: res.headers['idempotent-replay'] as string | undefined,
          }),
        )
      },
    )
    req.on('error', (err) => (abort ? resolve(null) : reject(err)))
    req.end('{}')
    if (abort) setTimeout(() => req.destroy(), 100)
  })
}

describe('idempotency keys', () => {
  it('records the outcome even when the client disconnected before the response', async () => {
    const fx = await createFixture({ restaurants: 1 })
    const user = await fx.createUser({ role: 'ADMIN', username: 'a' })
    const token = await signAccessToken({ sub: user.id, org: fx.orgId, tv: user.tokenVersion })
    const server = app.listen(0)
    try {
      const port = (server.address() as AddressInfo).port
      expect(await send(port, token, 'abort-key-0001', true)).toBeNull()
      // The handler finishes after the client has gone.
      release()
      await new Promise((r) => setTimeout(r, 300))
      const row = await prisma.idempotencyKey.findFirst({ where: { key: 'abort-key-0001' } })
      expect(row?.statusCode).toBe(200)
      const retry = await send(port, token, 'abort-key-0001', false)
      expect(retry).toEqual({ status: 200, replay: 'true' })
      expect(calls).toBe(1)
    } finally {
      server.close()
    }
  })
})

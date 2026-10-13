import { ERROR_CODES, IDEMPOTENCY_HEADER } from '@maintainx/shared'
import { Prisma } from '@prisma/client'
import type { RequestHandler } from 'express'
import { AppError } from '../core/errors.js'
import { logger } from '../core/logger.js'
import { prisma } from '../core/prisma.js'
import { verifyAccessToken } from '../core/tokens.js'

/*
 * Offline sync sends every queued write with an Idempotency-Key. The first
 * request with a key claims it (a row with status 0) and stores its response;
 * a retry with the same key gets that stored response instead of doing the
 * work twice. A retry while the first is still running gets 409. Keys are
 * per user and kept for a day (cleanup job).
 */

const KEY = /^[A-Za-z0-9_-]{8,100}$/
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000

export const idempotency: RequestHandler = async (req, res, next) => {
  const key = req.get(IDEMPOTENCY_HEADER)
  if (!key || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS')
    return next()
  if (!KEY.test(key))
    return next(new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Bad Idempotency-Key.'))
  const header = req.get('authorization')
  if (!header?.startsWith('Bearer ')) return next()
  let userId: string
  try {
    userId = (await verifyAccessToken(header.slice('Bearer '.length).trim())).sub
  } catch {
    // Let the route's own authentication answer.
    return next()
  }
  const path = req.originalUrl.split('?')[0]!

  try {
    await prisma.idempotencyKey.create({
      data: { userId, key, method: req.method, path, statusCode: 0 },
    })
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'))
      return next(err)
    const seen = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } })
    if (!seen || seen.method !== req.method || seen.path !== path)
      return next(
        new AppError(
          422,
          ERROR_CODES.VALIDATION_ERROR,
          'Idempotency-Key reused for another request.',
        ),
      )
    if (seen.statusCode === 0)
      return next(
        new AppError(409, ERROR_CODES.REQUEST_IN_PROGRESS, 'This change is still being saved.'),
      )
    res.setHeader('Idempotent-Replay', 'true')
    if (seen.body === null) return res.status(seen.statusCode).end()
    return res.status(seen.statusCode).json(seen.body)
  }

  // Store the outcome. Server errors release the key so the client can retry.
  // Recorded when the handler ends the response, not on 'finish': a client that
  // dropped the connection (flaky mobile signal) never sees 'finish', which
  // would leave the key "in progress" and refuse every retry for a day.
  let body: unknown = null
  let stored = false
  const json = res.json.bind(res)
  res.json = (b: unknown) => {
    body = b
    return json(b)
  }
  const end = res.end.bind(res) as (...args: unknown[]) => typeof res
  res.end = ((...args: unknown[]) => {
    store()
    return end(...args)
  }) as typeof res.end
  const store = () => {
    if (stored) return
    stored = true
    const done =
      res.statusCode >= 500
        ? prisma.idempotencyKey.delete({ where: { userId_key: { userId, key } } })
        : prisma.idempotencyKey.update({
            where: { userId_key: { userId, key } },
            data: {
              statusCode: res.statusCode,
              body: body === null ? Prisma.JsonNull : (body as Prisma.InputJsonValue),
            },
          })
    done.catch((err: unknown) => logger.warn({ err }, 'idempotency key not stored'))
  }
  next()
}

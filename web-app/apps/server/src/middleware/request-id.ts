import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/

/** Attach a correlation id to every request and echo it back. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id')
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID()
  req.requestId = id
  res.setHeader('x-request-id', id)
  next()
}

import type { RequestHandler } from 'express'
import { NotFoundError } from '../core/errors.js'

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`))
}

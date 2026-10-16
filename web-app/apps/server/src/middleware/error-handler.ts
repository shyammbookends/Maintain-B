import { Prisma } from '@prisma/client'
import type { ErrorRequestHandler } from 'express'
import { ERROR_CODES, type ApiErrorBody, type ErrorCode } from '@maintainx/shared'
import { AppError, type FieldErrors } from '../core/errors.js'
import { logger } from '../core/logger.js'
import { loggableUrl } from './http-logger.js'

interface Mapped {
  status: number
  code: ErrorCode
  message: string
  fieldErrors?: FieldErrors
  /** Log at error level (unexpected / server-side) or stay quiet (expected client error). */
  severity: 'error' | 'quiet'
}

interface BodyParserError {
  type: string
  status?: number
  statusCode?: number
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as BodyParserError).type === 'string' &&
    ('status' in err || 'statusCode' in err)
  )
}

function mapError(err: unknown): Mapped {
  if (err instanceof AppError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      fieldErrors: err.fieldErrors,
      severity: err.status >= 500 ? 'error' : 'quiet',
    }
  }

  if (isBodyParserError(err)) {
    switch (err.type) {
      case 'entity.too.large':
        return {
          status: 413,
          code: ERROR_CODES.PAYLOAD_TOO_LARGE,
          message: 'The request is too large.',
          severity: 'quiet',
        }
      case 'entity.parse.failed':
        return {
          status: 400,
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'The request body is not valid JSON.',
          severity: 'quiet',
        }
      case 'charset.unsupported':
      case 'encoding.unsupported':
        return {
          status: 415,
          code: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
          message: 'Unsupported request encoding.',
          severity: 'quiet',
        }
      default:
        return {
          status: err.status ?? err.statusCode ?? 400,
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'The request could not be read.',
          severity: 'quiet',
        }
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = (err.meta?.target as string[] | string | undefined) ?? []
        const fields = Array.isArray(target) ? target : [target]
        return {
          status: 409,
          code: ERROR_CODES.CONFLICT,
          message: 'A record with the same value already exists.',
          // i18n key; the web client translates `validation.*` messages.
          fieldErrors: Object.fromEntries(fields.map((f) => [f, ['validation.alreadyInUse']])),
          severity: 'quiet',
        }
      }
      case 'P2025':
        return {
          status: 404,
          code: ERROR_CODES.NOT_FOUND,
          message: 'The record was not found.',
          severity: 'quiet',
        }
      case 'P2003':
        return {
          status: 409,
          code: ERROR_CODES.CONFLICT,
          message: 'This record is linked to other records and cannot be changed this way.',
          severity: 'quiet',
        }
      default:
        break
    }
  }

  // Text PostgreSQL can't store (e.g. a NUL byte that reached a query unvalidated): bad input, not a crash.
  if (
    (err instanceof Prisma.PrismaClientKnownRequestError ||
      err instanceof Prisma.PrismaClientUnknownRequestError) &&
    /invalid byte sequence|0x00/i.test(err.message)
  ) {
    return {
      status: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'The request contains characters that are not allowed.',
      severity: 'quiet',
    }
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: 'The database is not available right now. Please try again shortly.',
      severity: 'error',
    }
  }

  return {
    status: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Something went wrong on our side. Please try again.',
    severity: 'error',
  }
}

/**
 * Final error middleware. Users get a code, a human-readable message and a
 * request id; stack traces and internal details go to the server log only.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const mapped = mapError(err)
  const requestId = req.requestId

  if (mapped.severity === 'error') {
    logger.error(
      { err, requestId, method: req.method, url: loggableUrl(req.originalUrl) },
      'request failed',
    )
  }

  if (res.headersSent) {
    next(err)
    return
  }

  const body: ApiErrorBody = {
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.fieldErrors ? { fieldErrors: mapped.fieldErrors } : {}),
      requestId,
    },
  }
  res.status(mapped.status).json(body)
}

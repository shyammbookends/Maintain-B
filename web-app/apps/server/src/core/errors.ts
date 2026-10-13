import { ERROR_CODES, type ErrorCode } from '@maintainx/shared'

export type FieldErrors = Record<string, string[]>

/**
 * Errors that are safe to show to users. Anything else that reaches the
 * error handler becomes a generic 500 with a request id.
 */
export class AppError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly fieldErrors: FieldErrors | undefined
  readonly details: unknown

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { fieldErrors?: FieldErrors; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.status = status
    this.code = code
    this.fieldErrors = options.fieldErrors
    this.details = options.details
  }
}

export class ValidationError extends AppError {
  constructor(fieldErrors: FieldErrors, message = 'Some fields are invalid.') {
    super(400, ERROR_CODES.VALIDATION_ERROR, message, { fieldErrors })
  }
}

export class UnauthenticatedError extends AppError {
  constructor(
    code: ErrorCode = ERROR_CODES.UNAUTHENTICATED,
    message = 'Please sign in to continue.',
  ) {
    super(401, code, message)
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to do this.',
    code: ErrorCode = ERROR_CODES.FORBIDDEN,
  ) {
    super(403, code, message)
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Record') {
    super(404, ERROR_CODES.NOT_FOUND, `${what} not found.`)
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.CONFLICT, details?: unknown) {
    super(409, code, message, { details })
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'The upload is too large.') {
    super(413, ERROR_CODES.PAYLOAD_TOO_LARGE, message)
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Please wait a moment and try again.') {
    super(429, ERROR_CODES.RATE_LIMITED, message)
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'The service is temporarily unavailable. Please try again shortly.') {
    super(503, ERROR_CODES.SERVICE_UNAVAILABLE, message)
  }
}

/** Narrow a nullable lookup result or throw a 404. */
export function ensureFound<T>(value: T | null | undefined, what = 'Record'): T {
  if (value === null || value === undefined) throw new NotFoundError(what)
  return value
}

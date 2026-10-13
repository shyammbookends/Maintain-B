import { API_KEY_PREFIX, AUTH_CSRF_HEADER, AUTH_CSRF_VALUE, ERROR_CODES } from '@maintainx/shared'
import { authenticateApiKey } from '../modules/integrations/api-keys.service.js'
import type { Request, RequestHandler } from 'express'
import { ForbiddenError, UnauthenticatedError } from '../core/errors.js'
import { verifyAccessToken } from '../core/tokens.js'
import { buildAuthContext, type AuthContext } from '../modules/auth/auth.context.js'
import { loadUser } from '../modules/auth/auth.repository.js'

/**
 * Verifies the Bearer access token and loads the user's current roles,
 * permissions and restaurant scope. Changes to a user (disable, role change,
 * password change via tokenVersion) take effect on their very next request.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization')
  if (!header?.startsWith('Bearer ')) throw new UnauthenticatedError()
  const bearer = header.slice('Bearer '.length).trim()
  // Integrations use API keys ("mx_live_…") instead of a session.
  if (bearer.startsWith(API_KEY_PREFIX)) {
    req.auth = await authenticateApiKey(bearer)
    return next()
  }

  const claims = await verifyAccessToken(header.slice('Bearer '.length).trim())
  const loaded = await loadUser(claims.sub)
  if (
    !loaded ||
    loaded.record.organizationId !== claims.org ||
    loaded.record.tokenVersion !== claims.tv
  ) {
    throw new UnauthenticatedError(ERROR_CODES.TOKEN_INVALID, 'Your session is no longer valid.')
  }
  if (loaded.record.status === 'DISABLED' || loaded.record.archivedAt) {
    throw new UnauthenticatedError(ERROR_CODES.ACCOUNT_DISABLED, 'This account has been disabled.')
  }

  req.auth = buildAuthContext(loaded.authUser, loaded.orgRestaurantIds)
  next()
}

/**
 * Users flagged "must change password" may only reach the endpoints that let
 * them do that (pass allowPendingPasswordChange for those).
 */
export function requireAuth(
  options: {
    allowPendingPasswordChange?: boolean
    /**
     * Personal-account endpoints (chats, inbox, devices, password, saved views):
     * an integration's API key acts with narrowed scopes and must not reach the
     * creator's private messages, notifications or sign-in settings.
     */
    sessionOnly?: boolean
  } = {},
): RequestHandler[] {
  return [
    authenticate,
    (req, _res, next) => {
      if (options.sessionOnly && req.auth?.apiKeyId) {
        throw new ForbiddenError('Not available with an API key.')
      }
      if (req.auth?.user.mustChangePassword && !options.allowPendingPasswordChange) {
        throw new ForbiddenError(
          'Please set a new password to continue.',
          ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
        )
      }
      next()
    },
  ]
}

export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw new UnauthenticatedError()
  return req.auth
}

/**
 * Cookie-authenticated endpoints must carry a custom header. Browsers don't let
 * cross-site forms/images set it, and cross-origin scripts need a CORS
 * preflight that our policy rejects — so this blocks CSRF.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (req.get(AUTH_CSRF_HEADER) !== AUTH_CSRF_VALUE) {
    throw new ForbiddenError('Request blocked.')
  }
  next()
}

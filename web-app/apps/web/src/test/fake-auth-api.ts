import type { AuthSession, AuthUser } from '@maintainx/shared'
import { vi } from 'vitest'

/**
 * In-memory stand-in for the /auth API, installed as global fetch. Mirrors
 * the real server's status codes and error codes closely enough to drive the
 * UI through full sign-in flows.
 */

export function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    organizationId: 'o1',
    email: 'priya@bookends.local',
    username: 'priya',
    phone: '+919876543210',
    firstName: 'Priya',
    lastName: 'Mehta',
    preferredLocale: 'en',
    mustChangePassword: false,
    roleKind: 'ADMIN',
    isSuperAdmin: false,
    roles: [{ id: 'r1', name: 'Admin', systemKey: 'ADMIN' }],
    permissions: ['notifications:view'],
    restaurants: [{ id: 'rest1', code: 'R1', name: 'Restaurant 1' }],
    ...overrides,
  }
}

interface Options {
  /** Extra routes for non-auth endpoints; return undefined to fall through to 404. */
  routes?: (
    method: string,
    path: string,
    body: Record<string, unknown>,
    query: URLSearchParams,
  ) => Response | undefined
  user?: AuthUser
  password?: string
  /** Start with a valid refresh cookie (returning visitor). */
  signedIn?: boolean
  /** Fail the start-up refresh with a network error this many times. */
  offlineRefreshes?: number
  locked?: boolean
}

export function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function error(status: number, code: string, fieldErrors?: Record<string, string[]>): Response {
  return json({ error: { code, message: code, fieldErrors, requestId: 'req-test' } }, status)
}

export function installFakeAuthApi(options: Options = {}) {
  const state = {
    user: options.user ?? makeUser(),
    password: options.password ?? 'Correct-Horse-9',
    hasCookie: options.signedIn ?? false,
    tokenSeq: 0,
    offline: options.offlineRefreshes ?? 0,
    calls: [] as string[],
  }

  const session = (): AuthSession => ({
    accessToken: `token-${++state.tokenSeq}`,
    expiresIn: 900,
    user: state.user,
  })

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = init?.method ?? 'GET'
    const body =
      init?.body && !(init.body instanceof FormData)
        ? (JSON.parse(String(init.body)) as Record<string, string>)
        : {}
    state.calls.push(`${method} ${path}`)

    switch (`${method} ${path}`) {
      case 'POST /auth/refresh':
        if (state.offline > 0) {
          state.offline--
          throw new TypeError('Failed to fetch')
        }
        return state.hasCookie ? json({ data: session() }) : error(401, 'UNAUTHENTICATED')
      case 'POST /auth/login': {
        if (options.locked) return error(423, 'ACCOUNT_LOCKED')
        const id = body.identifier?.toLowerCase()
        const matches = [state.user.email, state.user.username].includes(id ?? '')
        if (!matches || body.password !== state.password) return error(401, 'INVALID_CREDENTIALS')
        state.hasCookie = true
        return json({ data: session() })
      }
      case 'POST /auth/logout':
        state.hasCookie = false
        return new Response(null, { status: 204 })
      case 'POST /auth/change-password':
        if (body.currentPassword !== state.password) {
          return error(400, 'VALIDATION_ERROR', {
            currentPassword: ['validation.currentPasswordWrong'],
          })
        }
        state.password = body.newPassword ?? ''
        state.user = { ...state.user, mustChangePassword: false }
        return json({ data: session() })
      case 'PATCH /auth/me/preferences':
        state.user = {
          ...state.user,
          preferredLocale: body.preferredLocale as AuthUser['preferredLocale'],
        }
        return json({ data: state.user })
      default: {
        const extra = options.routes?.(method, path, body, url.searchParams)
        if (extra) return extra
        return error(404, 'NOT_FOUND')
      }
    }
  })

  vi.stubGlobal('fetch', fetchMock)
  return { state, fetchMock }
}

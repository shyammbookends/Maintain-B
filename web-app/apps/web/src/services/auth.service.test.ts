import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getAccessToken, http, setAccessToken } from './http'
import { refreshSession, subscribeSession, type SessionEvent } from './auth.service'
import { makeUser } from '@/test/fake-auth-api'
import { homePath, safeRedirect } from '@/utils/redirect'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const session = (token: string) => ({
  data: { accessToken: token, expiresIn: 900, user: makeUser() },
})

beforeEach(() => setAccessToken(null))
afterEach(() => setAccessToken(null))

describe('HTTP client session handling', () => {
  it('sends the token and the CSRF header', async () => {
    const fetchMock = vi.fn(async () => json({ data: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    setAccessToken('abc')
    await http.get('/things')
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer abc')
    expect(headers['x-requested-with']).toBe('maintainx')
  })

  it('refreshes once on an expired token, retries, and shares the refresh across concurrent requests', async () => {
    let refreshes = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/auth/refresh')) {
          refreshes++
          await new Promise((r) => setTimeout(r, 20))
          return json(session('fresh'))
        }
        const auth = (init.headers as Record<string, string>).Authorization
        return auth === 'Bearer fresh'
          ? json({ data: 'ok' })
          : json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401)
      }),
    )
    setAccessToken('stale')
    const results = await Promise.all([http.get('/a'), http.get('/b'), http.get('/c')])
    expect(results).toEqual([{ data: 'ok' }, { data: 'ok' }, { data: 'ok' }])
    expect(refreshes).toBe(1)
    expect(getAccessToken()).toBe('fresh')
  })

  it('signals sign-out when the refresh is rejected', async () => {
    const events: SessionEvent[] = []
    const unsubscribe = subscribeSession((e) => events.push(e))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/refresh')
          ? json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401)
          : json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401),
      ),
    )
    setAccessToken('stale')
    await expect(http.get('/a')).rejects.toBeInstanceOf(ApiError)
    expect(events).toContainEqual({ type: 'signedOut', reason: 'expired' })
    expect(getAccessToken()).toBeNull()
    unsubscribe()
  })

  it('stays signed in when the refresh fails because of the network', async () => {
    const events: SessionEvent[] = []
    const unsubscribe = subscribeSession((e) => events.push(e))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/refresh')) throw new TypeError('Failed to fetch')
        return json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401)
      }),
    )
    setAccessToken('stale')
    await expect(http.get('/a')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    expect(events.some((e) => e.type === 'signedOut')).toBe(false)
    unsubscribe()
  })

  it('retries a refresh once when another tab just rotated the cookie', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ++n === 1
          ? json({ error: { code: 'TOKEN_INVALID', message: 'x' } }, 401)
          : json(session('t2')),
      ),
    )
    const s = await refreshSession()
    expect(s?.accessToken).toBe('t2')
    expect(n).toBe(2)
  })

  it('does not wait and retry when there is no session cookie at all', async () => {
    const fetchMock = vi.fn(async () =>
      json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await refreshSession()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('redirect helpers', () => {
  it('only allows in-app paths', () => {
    expect(safeRedirect('/assets?x=1')).toBe('/assets?x=1')
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil',
      'javascript:alert(1)',
      '/login',
      '/change-password',
      '',
      null,
    ]) {
      expect(safeRedirect(bad)).toBeNull()
    }
  })

  it('sends workers to the worker app', () => {
    expect(homePath({ roleKind: 'WORKER' })).toBe('/w')
    expect(homePath({ roleKind: 'ADMIN' })).toBe('/')
  })
})

import {
  type AuthUser,
  type PortalInfo,
  type SavedViewDto,
  type SearchResults,
} from '@maintainx/shared'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '@/app/providers'
import i18n from '@/i18n'
import { appRoutes } from '@/routes/app.routes'
import { setAccessToken } from '@/services/http'
import { installFakeAuthApi, json, makeUser } from '@/test/fake-auth-api'

/* Phase A in the browser: public portal, global search, saved views, repeat. */

const R1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Restaurant 1' }
const admin = makeUser({
  firstName: 'Priya',
  permissions: ['work_orders:view', 'work_orders:create', 'parts:view', 'assets:view'],
})

const page = <T,>(data: T[]) => ({
  data,
  meta: { page: 1, pageSize: 25, total: data.length, totalPages: 1 },
})

type Route = Parameters<typeof installFakeAuthApi>[0] extends infer O
  ? O extends { routes?: infer R }
    ? R
    : never
  : never

function renderAt(
  path: string,
  user: AuthUser,
  routes: NonNullable<Route>,
  signedIn = true,
) {
  const fake = installFakeAuthApi({
    user,
    signedIn,
    routes: (method, p, body, query) =>
      routes(method, p, body, query) ?? (method === 'GET' ? json(page([])) : undefined),
  })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { router, fake }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
})
afterEach(() => setAccessToken(null))

describe('public request portal', () => {
  const info: PortalInfo = {
    organization: 'Bookends',
    restaurant: { name: 'Restaurant 1', city: 'Ahmedabad' },
    location: null,
    locations: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Kitchen' }],
  }

  it('lets a guest report a problem without logging in, then check its status', async () => {
    const { fake } = renderAt(
      '/r/abcdef0123456789',
      admin,
      (method, path, body) => {
        if (path === '/public/portal/abcdef0123456789') return json({ data: info })
        if (method === 'POST' && path.endsWith('/requests'))
          return json({ data: { code: 'REQ-000042' } }, 201)
        if (method === 'POST' && path.endsWith('/status')) {
          expect(body).toEqual({ phone: '98765 43210' })
          return json({
            data: [
              {
                code: 'REQ-000042',
                title: 'Sink leaking',
                category: 'PLUMBING',
                priority: 'HIGH',
                status: 'CONVERTED',
                workOrderStatus: 'IN_PROGRESS',
                createdAt: '2026-10-05T10:00:00.000Z',
                updatedAt: '2026-10-05T11:00:00.000Z',
              },
            ],
          })
        }
        return undefined
      },
      false,
    )
    expect(await screen.findByRole('heading', { name: 'Restaurant 1' })).toBeInTheDocument()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/What kind of problem/), 'Sink leaking')
    await user.click(screen.getByRole('radio', { name: 'Urgent' }))
    await user.type(screen.getByLabelText(/Your name/), 'Asha')
    await user.type(screen.getAllByLabelText(/Phone number/)[0]!, '98765 43210')
    await user.click(screen.getByRole('button', { name: /Send/ }))
    expect(await screen.findByText(/REQ-000042/)).toBeInTheDocument()

    const sent = fake.fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.body instanceof FormData,
    )![1] as RequestInit
    const form = sent.body as FormData
    expect(form.get('title')).toBe('Sink leaking')
    expect(form.get('name')).toBe('Asha')
    expect(form.get('priority')).toBe('HIGH')

    await user.click(screen.getByRole('tab', { name: 'Check status' }))
    await user.type(screen.getByLabelText(/Phone number/), '98765 43210')
    await user.click(screen.getByRole('button', { name: 'Check status' }))
    const list = await screen.findByRole('list', { name: 'Check status' })
    expect(within(list).getByText('Sink leaking')).toBeInTheDocument()
    expect(within(list).getByText('In progress')).toBeInTheDocument()
  })

  it('says so when the link is switched off', async () => {
    renderAt('/r/abcdef0123456789', admin, () => json({ error: { code: 'NOT_FOUND' } }, 404), false)
    expect(await screen.findByRole('heading', { name: 'This link isn’t active' })).toBeInTheDocument()
  })
})

describe('global search', () => {
  it('opens with Ctrl+K and jumps to a result', async () => {
    const results: SearchResults = {
      q: 'freez',
      hits: [
        {
          kind: 'workOrder',
          id: 'w1',
          title: 'WO-000007 · Freezer alarm',
          subtitle: 'Restaurant 1',
          url: '/work-orders/44444444-4444-4444-8444-444444444444',
        },
        {
          kind: 'part',
          id: 'p1',
          title: 'Freezer gasket',
          subtitle: 'FG-1',
          url: '/inventory/parts/p1',
        },
      ],
    }
    const { router } = renderAt('/work-orders', admin, (_m, path, _b, query) => {
      if (path === '/search') {
        expect(query.get('q')).toBe('freez')
        return json({ data: results })
      }
      return undefined
    })
    await screen.findByRole('heading', { name: 'Work orders' })
    const user = userEvent.setup()
    await user.keyboard('{Control>}k{/Control}')
    const box = await screen.findByRole('combobox', { name: 'Search everything' })
    await user.type(box, 'freez')
    expect(await screen.findByRole('option', { name: /Freezer gasket/ })).toBeInTheDocument()
    expect(screen.getByText('Parts')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/work-orders/44444444-4444-4444-8444-444444444444',
      ),
    )
  })
})

describe('saved views', () => {
  it('saves the current filters and opens a saved view', async () => {
    let views: SavedViewDto[] = [
      {
        id: 'v1',
        resource: 'work_orders',
        name: 'Team: overdue',
        query: 'view=overdue',
        shared: true,
        mine: false,
        owner: { id: 'x', firstName: 'Boss', lastName: 'A' },
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ]
    let posted: Record<string, unknown> | undefined
    const { router } = renderAt('/work-orders?priority=HIGH', admin, (method, path, body) => {
      if (path === '/saved-views' && method === 'GET') return json({ data: views })
      if (path === '/saved-views' && method === 'POST') {
        posted = body
        views = [
          ...views,
          { ...views[0]!, id: 'v2', name: 'Urgent', query: 'priority=HIGH', shared: false, mine: true },
        ]
        return json({ data: views }, 201)
      }
      return undefined
    })
    await screen.findByRole('heading', { name: 'Work orders' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Views/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Save current view/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Save view' })
    await user.type(within(dialog).getByLabelText(/Name/), 'Urgent')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(posted).toEqual({
        resource: 'work_orders',
        query: 'priority=HIGH',
        name: 'Urgent',
        shared: false,
      }),
    )
    // The active view's name shows on the button.
    expect(await screen.findByRole('button', { name: /Urgent/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Urgent/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Team: overdue/ }))
    await waitFor(() => expect(router.state.location.search).toBe('?view=overdue'))
  })
})

describe('repeat', () => {
  it('creates a work order that repeats every 2 weeks from completion', async () => {
    let sent: Record<string, unknown> | undefined
    renderAt('/work-orders', admin, (method, path, body) => {
      if (path === '/restaurants') return json({ data: [{ ...R1, code: 'R1' }] })
      if (method === 'POST' && path === '/work-orders') {
        sent = body
        return json({ error: { code: 'VALIDATION_ERROR', message: 'stop here' } }, 400)
      }
      return undefined
    })
    await screen.findByRole('heading', { name: 'Work orders' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /New work order/ }))
    const sheet = await screen.findByRole('dialog')
    await user.type(within(sheet).getByLabelText(/Title/), 'Clean hood filters')
    // Repeat lives under "More options".
    await user.click(within(sheet).getByRole('button', { name: /More options/ }))
    await user.click(within(sheet).getByRole('combobox', { name: /Repeat/ }))
    await user.click(await screen.findByRole('option', { name: 'Week' }))
    const every = within(sheet).getByRole('spinbutton', { name: /Every/ })
    // Replace the default 1.
    await user.type(every, '2', { initialSelectionStart: 0, initialSelectionEnd: 1 })
    await user.click(within(sheet).getByRole('combobox', { name: /Next due date/ }))
    await user.click(await screen.findByRole('option', { name: 'From when it’s done' }))
    await user.click(within(sheet).getByRole('button', { name: 'Create work order' }))
    await waitFor(() =>
      expect(sent?.repeat).toEqual({ every: 2, unit: 'WEEK', basis: 'COMPLETION' }),
    )
  })
})


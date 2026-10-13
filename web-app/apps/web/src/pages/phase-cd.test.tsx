import { type AuthUser, type ChatMessageDto, type ConversationListItem } from '@maintainx/shared'
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
import { WO_DEFAULTS, NEW_ACTIONS } from '@/test/work-order-fixtures'

/* Phases C & D in the browser: chat, print, API keys, SSO buttons. */

const R1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Restaurant 1' }
const ravi = { id: '22222222-2222-4222-8222-222222222222', firstName: 'Ravi', lastName: 'Kumar' }
const priya = { id: '33333333-3333-4333-8333-333333333333', firstName: 'Priya', lastName: 'Shah' }
const CHAT = '99999999-9999-4999-8999-999999999999'

const admin = makeUser({
  id: priya.id,
  firstName: 'Priya',
  lastName: 'Shah',
  permissions: ['dashboard:view', 'work_orders:view', 'settings:view', 'settings:edit'],
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

function renderAt(path: string, user: AuthUser, routes: NonNullable<Route>, signedIn = true) {
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

describe('team chat', () => {
  it('opens a chat, shows messages and sends one', async () => {
    const convo: ConversationListItem = {
      id: CHAT,
      type: 'DIRECT',
      title: 'Ravi Kumar',
      members: [
        { ...priya, role: 'Admin' },
        { ...ravi, role: 'Worker' },
      ],
      lastMessage: {
        body: 'Fridge 2 is noisy',
        authorName: 'Ravi Kumar',
        createdAt: '2026-10-05T10:00:00.000Z',
        voiceSec: null,
      },
      unread: 1,
      lastMessageAt: '2026-10-05T10:00:00.000Z',
      viewOnly: false,
    }
    const msg = (o: Partial<ChatMessageDto>): ChatMessageDto => ({
      id: 'm1',
      body: 'Fridge 2 is noisy',
      author: ravi,
      workOrder: null,
      voice: null,
      createdAt: '2026-10-05T10:00:00.000Z',
      mine: false,
      deleted: false,
      ...o,
    })
    let sent: unknown
    let read = false
    renderAt(`/chat/${CHAT}`, admin, (method, path, body) => {
      if (path === '/chats' && method === 'GET') return json({ data: [convo] })
      if (path === '/chats/unread') return json({ data: { count: 1 } })
      if (path === `/chats/${CHAT}/messages` && method === 'GET')
        return json({ data: { messages: [msg({})], hasMore: false } })
      if (path === `/chats/${CHAT}/read`) {
        read = true
        return new Response(null, { status: 204 })
      }
      if (path === `/chats/${CHAT}/messages` && method === 'POST') {
        sent = body
        return json({ data: msg({ id: 'm2', body: 'On my way', author: priya, mine: true }) }, 201)
      }
      return undefined
    })
    expect(await screen.findByText('Fridge 2 is noisy', { selector: 'p' })).toBeInTheDocument()
    await waitFor(() => expect(read).toBe(true))
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Write a message…' }), 'On my way{Enter}')
    await waitFor(() => expect(sent).toEqual({ body: 'On my way', workOrderId: '' }))
    expect(await screen.findByText('On my way')).toBeInTheDocument()
    // The nav shows the unread count.
    expect(
      within(screen.getByRole('navigation', { name: 'Main navigation' })).getByText('1'),
    ).toBeInTheDocument()
  })
})

describe('work order print', () => {
  it('renders a clean printable page', async () => {
    const w = {
      id: '44444444-4444-4444-8444-444444444444',
      code: 'WO-000007',
      title: 'Replace door gasket',
      type: 'REACTIVE',
      category: 'REFRIGERATION',
      priority: 'HIGH',
      status: 'CLOSED',
      dueDate: null,
      restaurant: R1,
      location: null,
      asset: null,
      assignedUser: ravi,
      assignedTeam: null,
      createdAt: '2026-09-30T10:00:00.000Z',
      description: 'Door does not seal.',
      estimatedMinutes: null,
      minutesWorked: 45,
      timerRunning: false,
      startedAt: null,
      completedAt: '2026-09-30T12:00:00.000Z',
      closedAt: null,
      holdReason: null,
      completionNotes: null,
      reopenCount: 0,
      createdBy: priya,
      closedBy: null,
      procedure: null,
      pmSchedule: null,
      parts: [],
      checklist: [],
      sourceRequest: null,
      attachments: [],
      messages: [],
      history: [],
      ...WO_DEFAULTS,
      actions: { ...NEW_ACTIONS },
    }
    renderAt(`/work-orders/${w.id}/print`, admin, (_m, path) =>
      path === `/work-orders/${w.id}` ? json({ data: w }) : undefined,
    )
    expect(await screen.findByRole('heading', { name: 'Replace door gasket' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Print or save as PDF/ })).toBeInTheDocument()
    expect(screen.getByText('Door does not seal.')).toBeInTheDocument()
    // No app chrome on the printable page.
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  })
})

describe('API keys', () => {
  it('creates a key and shows it once', async () => {
    let posted: unknown
    renderAt('/settings?tab=integrations', admin, (method, path, body) => {
      if (path === '/api-keys' && method === 'POST') {
        posted = body
        return json(
          {
            data: {
              id: 'k1',
              name: 'Accounting',
              prefix: 'mx_live_abcd',
              scopes: ['work_orders:view'],
              createdBy: priya,
              lastUsedAt: null,
              expiresAt: null,
              revokedAt: null,
              createdAt: '2026-10-05T10:00:00.000Z',
              key: 'mx_live_abcdSECRET',
            },
          },
          201,
        )
      }
      if (path === '/notifications/delivery')
        return json({ data: { email: false, push: false, vapidPublicKey: null } })
      if (path === '/auth/sso/providers') return json({ data: [] })
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Create API key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' })
    await user.type(within(dialog).getByLabelText('Name'), 'Accounting')
    await user.click(within(dialog).getByRole('button', { name: 'Create API key' }))
    expect(await within(dialog).findByText('mx_live_abcdSECRET')).toBeInTheDocument()
    expect(posted).toMatchObject({ name: 'Accounting', expiresInDays: 365 })
  })
})

describe('single sign-on', () => {
  it('shows only the configured providers on the sign-in page', async () => {
    renderAt(
      '/login',
      admin,
      (_m, path) => (path === '/auth/sso/providers' ? json({ data: ['google'] }) : undefined),
      false,
    )
    const google = await screen.findByRole('link', { name: 'Continue with Google' })
    expect(google).toHaveAttribute('href', '/api/v1/auth/sso/google/start')
    expect(screen.queryByRole('link', { name: 'Continue with Microsoft' })).not.toBeInTheDocument()
  })

  it('explains why a sign-in failed', async () => {
    renderAt('/sso?error=no_account', admin, () => undefined, false)
    expect(
      await screen.findByText('No account uses that email address. Ask your admin to add you.'),
    ).toBeInTheDocument()
  })
})

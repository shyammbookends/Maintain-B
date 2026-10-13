import { type AuthUser, type ConversationListItem } from '@maintainx/shared'
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

/* Chat page: admin oversight (All chats, read-only) and admin-only groups. */

const ravi = { id: '22222222-2222-4222-8222-222222222222', firstName: 'Ravi', lastName: 'Kumar' }
const meena = { id: '44444444-4444-4444-8444-444444444444', firstName: 'Meena', lastName: 'Joshi' }
const CHAT = '99999999-9999-4999-8999-999999999999'

const overseen: ConversationListItem = {
  id: CHAT,
  type: 'DIRECT',
  title: 'Ravi Kumar & Meena Joshi',
  members: [
    { ...ravi, role: 'User' },
    { ...meena, role: 'User' },
  ],
  lastMessage: {
    body: 'Fryer is fixed',
    authorName: 'Ravi Kumar',
    createdAt: '2026-10-05T10:00:00.000Z',
    voiceSec: null,
  },
  unread: 0,
  lastMessageAt: '2026-10-05T10:00:00.000Z',
  viewOnly: true,
}

type Routes = NonNullable<NonNullable<Parameters<typeof installFakeAuthApi>[0]>['routes']>

function renderAt(path: string, user: AuthUser, routes: Routes) {
  installFakeAuthApi({
    user,
    signedIn: true,
    routes: (method, p, body, query) =>
      routes(method, p, body, query) ??
      (method === 'GET'
        ? json({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 1 } })
        : undefined),
  })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
})
afterEach(() => setAccessToken(null))

describe('chat oversight', () => {
  it('admins switch to All chats; an overseen chat is read-only and never marked read', async () => {
    const admin = makeUser({ permissions: ['dashboard:view'] })
    const scopes: string[] = []
    let read = false
    const router = renderAt('/chat', admin, (method, path, _body, query) => {
      if (path === '/chats' && method === 'GET') {
        const scope = query.get('scope') ?? 'mine'
        scopes.push(scope)
        return json({ data: scope === 'all' ? [overseen] : [] })
      }
      if (path === '/chats/unread') return json({ data: { count: 0 } })
      if (path === `/chats/${CHAT}/messages`)
        return json({
          data: {
            messages: [
              {
                id: 'm1',
                body: 'Fryer is fixed',
                author: ravi,
                workOrder: null,
                createdAt: '2026-10-05T10:00:00.000Z',
                mine: false,
                deleted: false,
              },
            ],
            hasMore: false,
          },
        })
      if (path === `/chats/${CHAT}/read`) {
        read = true
        return new Response(null, { status: 204 })
      }
      return undefined
    })
    const user = userEvent.setup()
    expect(await screen.findByText('No chats yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New group/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /All chats/ }))
    await waitFor(() => expect(scopes).toContain('all'))
    await user.click(await screen.findByRole('link', { name: /Ravi Kumar & Meena Joshi/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/chat/${CHAT}`))
    expect(router.state.location.search).toBe('?view=all')

    expect(await screen.findByText('Fryer is fixed', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/viewing this chat as an admin/)
    expect(screen.queryByRole('textbox', { name: 'Write a message…' })).toBeNull()
    expect(read).toBe(false)
  })

  it('deleting my last message refreshes the chat list preview (regression)', async () => {
    const worker = makeUser({
      id: ravi.id,
      roleKind: 'WORKER',
      roles: [{ id: 'r3', name: 'User', systemKey: 'WORKER' }],
      permissions: ['work_orders:view'],
    })
    let deleted = false
    let listCalls = 0
    const mine: ConversationListItem = {
      ...overseen,
      title: 'Meena Joshi',
      viewOnly: false,
      lastMessage: { ...overseen.lastMessage!, body: 'oops typo', authorName: 'Ravi Kumar' },
    }
    renderAt(`/w/chat/${CHAT}`, worker, (method, path) => {
      if (path === '/chats' && method === 'GET') {
        listCalls++
        return json({ data: [deleted ? { ...mine, lastMessage: null } : mine] })
      }
      if (path === '/chats/unread') return json({ data: { count: 0 } })
      if (path === `/chats/${CHAT}/messages` && method === 'GET')
        return json({
          data: {
            messages: [
              {
                id: 'm1',
                body: 'oops typo',
                author: ravi,
                workOrder: null,
                voice: null,
                createdAt: '2026-10-05T10:00:00.000Z',
                mine: true,
                deleted,
              },
            ],
            hasMore: false,
          },
        })
      if (path === `/chats/${CHAT}/messages/m1` && method === 'DELETE') {
        deleted = true
        return new Response(null, { status: 204 })
      }
      if (path === `/chats/${CHAT}/read`) return new Response(null, { status: 204 })
      return undefined
    })
    const user = userEvent.setup()
    await screen.findByText('oops typo', { selector: 'p' })
    const before = listCalls
    await user.click(screen.getByRole('button', { name: 'Delete message' }))
    const confirm = screen.queryByRole('alertdialog')
    if (confirm) await user.click(within(confirm).getAllByRole('button').at(-1)!)
    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(listCalls).toBeGreaterThan(before))
  })

  it('users have no group or All chats controls', async () => {
    const worker = makeUser({
      roleKind: 'WORKER',
      roles: [{ id: 'r3', name: 'User', systemKey: 'WORKER' }],
      permissions: ['work_orders:view'],
    })
    renderAt('/w/chat', worker, (method, path) => {
      if (path === '/chats' && method === 'GET') return json({ data: [] })
      if (path === '/chats/unread') return json({ data: { count: 0 } })
      return undefined
    })
    expect(await screen.findByRole('button', { name: /New chat/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New group/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /All chats/ })).toBeNull()
  })
})

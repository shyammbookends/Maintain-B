import {
  ADMIN_DEFAULT_PERMISSIONS,
  ALL_PERMISSIONS,
  type RoleDto,
  type UserListItem,
} from '@maintainx/shared'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '@/app/providers'
import i18n from '@/i18n'
import { appRoutes } from '@/routes/app.routes'
import { setAccessToken } from '@/services/http'
import { installFakeAuthApi, json, makeUser } from '@/test/fake-auth-api'

const R1 = { id: '11111111-1111-4111-8111-111111111111', code: 'R1', name: 'Restaurant 1' }
const ROLE_WORKER: RoleDto = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Worker',
  description: null,
  kind: 'WORKER',
  isSystem: true,
  systemKey: 'WORKER',
  locked: true,
  permissions: ['work_orders:view'],
  userCount: 3,
}

const ravi: UserListItem = {
  id: '33333333-3333-4333-8333-333333333333',
  firstName: 'Ravi',
  lastName: 'Kumar',
  email: null,
  username: 'ravi',
  phone: null,
  status: 'ACTIVE',
  locked: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
  jobTitle: null,
  hourlyRate: null,
  role: { id: ROLE_WORKER.id, name: 'Worker', systemKey: 'WORKER', kind: 'WORKER' },
  restaurants: [R1],
}

function renderApp(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

const admin = makeUser({ permissions: [...ADMIN_DEFAULT_PERMISSIONS], restaurants: [R1] })

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
})
afterEach(() => setAccessToken(null))

describe('admin navigation', () => {
  it('shows only modules the user may open; extra tools open with their page', async () => {
    installFakeAuthApi({ user: admin, signedIn: true, routes: () => json({ data: [] }) })
    renderApp('/teams')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    const links = () =>
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent)
    expect(links()).toEqual([
      'Dashboard',
      'Work orders',
      'Requests',
      'Maintenance',
      'Chat',
      'Assets',
      'Inventory',
      'Purchase orders',
      'Vendors',
      'Reports',
      'Restaurants',
      'Users',
      // "More tools" is open because Teams lives there.
      'Calendar',
      'Inspections',
      'Procedures',
      'Analytics',
      'Stock counts',
      'Teams',
      'Documents',
      'My account',
    ])
    // Advanced settings are Super Admin only.
    expect(within(nav).queryByRole('button', { name: /Advanced settings/ })).not.toBeInTheDocument()
  })

  it('keeps "Advanced settings" folded for Super Admin until opened, and remembers it', async () => {
    const boss = makeUser({ isSuperAdmin: true, permissions: [...ALL_PERMISSIONS] })
    installFakeAuthApi({ user: boss, signedIn: true, routes: () => json({ data: [] }) })
    renderApp('/teams')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
    const user = userEvent.setup()
    const advanced = within(nav).getByRole('button', { name: /Advanced settings/ })
    expect(advanced).toHaveAttribute('aria-expanded', 'false')
    await user.click(advanced)
    expect(within(nav).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Automations' })).toBeInTheDocument()
    expect(localStorage.getItem('mx.nav.open')).toBe('["advanced"]')
  })

  it('a direct link to a module without permission shows "no access"', async () => {
    installFakeAuthApi({ user: admin, signedIn: true, routes: () => json({ data: [] }) })
    renderApp('/audit')
    expect(
      await screen.findByRole('heading', { name: 'You don’t have access to this page' }),
    ).toBeInTheDocument()
  })
})

describe('users', () => {
  it('lists users and creates one, showing the temporary password once', async () => {
    let created: Record<string, unknown> | undefined
    installFakeAuthApi({
      user: admin,
      signedIn: true,
      routes: (method, path, body) => {
        if (method === 'GET' && path === '/users') {
          return json({ data: [ravi], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } })
        }
        if (path === '/roles/assignable') return json({ data: [ROLE_WORKER] })
        if (path === '/restaurants') return json({ data: [{ ...R1, status: 'ACTIVE' }] })
        if (method === 'POST' && path === '/users') {
          created = body
          return json(
            {
              data: {
                user: {
                  ...ravi,
                  id: 'new',
                  firstName: 'Imran',
                  lastName: 'Shaikh',
                  username: 'imran',
                  teams: [],
                  can: {},
                },
                temporaryPassword: 'Kx7mPq2Rta',
              },
            },
            201,
          )
        }
        return undefined
      },
    })
    renderApp('/users')

    const table = await screen.findByRole('table', { name: 'Users' })
    expect(await within(table).findByText('Ravi Kumar')).toBeInTheDocument()
    expect(within(table).getByText('Locked')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'New user' })[0]!)
    await user.type(await screen.findByLabelText(/^First name/), 'Imran')
    await user.type(screen.getByLabelText(/^Last name/), 'Shaikh')
    await user.type(screen.getByLabelText(/^Username/), 'imran')
    await user.click(screen.getByRole('combobox', { name: /Role/ }))
    await user.click(await screen.findByRole('option', { name: /Worker/ }))
    await user.click(screen.getByRole('checkbox', { name: /Restaurant 1/ }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Kx7mPq2Rta')).toBeInTheDocument()
    expect(created).toMatchObject({
      firstName: 'Imran',
      username: 'imran',
      roleId: ROLE_WORKER.id,
      restaurantIds: [R1.id],
    })

    const dialog = screen.getByRole('dialog')
    const results = await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => v.id)).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('Kx7mPq2Rta')).not.toBeInTheDocument())
  })

  it('needs at least one sign-in identifier', async () => {
    installFakeAuthApi({
      user: admin,
      signedIn: true,
      routes: (method, path) => {
        if (path === '/users')
          return json({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } })
        if (path === '/roles/assignable') return json({ data: [ROLE_WORKER] })
        if (path === '/restaurants') return json({ data: [] })
        return method ? undefined : undefined
      },
    })
    renderApp('/users')
    expect(await screen.findByText('No users yet')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'New user' })[0]!)
    await user.type(await screen.findByLabelText(/^First name/), 'A')
    await user.type(screen.getByLabelText(/^Last name/), 'B')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(
      await screen.findByText('Enter at least one of email, username or phone.'),
    ).toBeInTheDocument()
  })
})

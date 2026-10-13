import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '@/app/providers'
import i18n from '@/i18n'
import { setAccessToken } from '@/services/http'
import { installFakeAuthApi, json, makeUser } from '@/test/fake-auth-api'
import { appRoutes } from './app.routes'

function renderApp(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...utils, router }
}

async function signIn(identifier = 'priya', password = 'Correct-Horse-9') {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText(/Email, username or phone/), identifier)
  await user.type(screen.getByLabelText(/^Password/), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return user
}

async function expectAccessible(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([])
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
})

afterEach(() => {
  setAccessToken(null)
})

describe('sign-in flow', () => {
  it('sends anonymous visitors to sign in, then back to where they were going', async () => {
    installFakeAuthApi()
    const { router, container } = renderApp('/account')

    await screen.findByRole('heading', { name: 'Sign in to your account' })
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('?redirect=%2Faccount')
    await expectAccessible(container)

    await signIn()
    await screen.findByRole('heading', { name: 'My account' })
    expect(router.state.location.pathname).toBe('/account')
    expect(screen.getByText('priya@bookends.local')).toBeInTheDocument()
    expect(screen.getByText('Restaurant 1')).toBeInTheDocument()
    await expectAccessible(container)
  })

  it('signs in with email too, case-insensitively', async () => {
    installFakeAuthApi()
    renderApp('/login')
    await signIn('PRIYA@bookends.local')
    await screen.findByRole('heading', { name: 'My account' })
  })

  it('shows a clear error for wrong details and clears the password', async () => {
    installFakeAuthApi()
    renderApp('/login')
    await signIn('priya', 'wrong-pass-1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect login details.')
    expect(screen.getByLabelText(/^Password/)).toHaveValue('')
    expect(screen.getByLabelText(/^Password/)).toHaveFocus()
  })

  it('explains a locked account', async () => {
    installFakeAuthApi({ locked: true })
    renderApp('/login')
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many failed attempts/)
  })

  it('ignores off-site redirect targets', async () => {
    installFakeAuthApi()
    const { router } = renderApp('/login?redirect=//evil.example/steal')
    await signIn()
    await screen.findByRole('heading', { name: 'My account' })
    expect(router.state.location.pathname).toBe('/account')
  })

  it('applies the language saved on the account', async () => {
    installFakeAuthApi({ user: makeUser({ preferredLocale: 'hi' }) })
    renderApp('/login')
    await signIn()
    await screen.findByRole('heading', { name: 'मेरा खाता' }, { timeout: 5000 })
  })
})

describe('session', () => {
  it('a returning visitor is signed in silently from the refresh cookie', async () => {
    const { state } = installFakeAuthApi({ signedIn: true })
    renderApp('/account')
    await screen.findByRole('heading', { name: 'My account' })
    expect(state.calls).not.toContain('POST /auth/login')
  })

  it('does not bounce to sign-in when the server is unreachable on start-up', async () => {
    installFakeAuthApi({ signedIn: true, offlineRefreshes: 1 })
    renderApp('/account')
    expect(
      await screen.findByRole('heading', { name: 'Can’t reach the server' }),
    ).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { name: 'My account' })
  })

  it('signing out returns to the sign-in page with a confirmation', async () => {
    installFakeAuthApi({ signedIn: true })
    const { router } = renderApp('/account')
    await screen.findByRole('heading', { name: 'My account' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await screen.findByText('You’ve been signed out.')
    expect(router.state.location.pathname).toBe('/login')
  })
})

describe('first sign-in password change', () => {
  it('forces a new password before anything else, then continues', async () => {
    installFakeAuthApi({ user: makeUser({ mustChangePassword: true }) })
    const { router, container } = renderApp('/login')
    await signIn()

    await screen.findByRole('heading', { name: 'Set a new password' })
    expect(router.state.location.pathname).toBe('/change-password')
    await expectAccessible(container)

    // Other pages are not reachable yet.
    await router.navigate('/account')
    await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'))

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/^Current password/), 'Correct-Horse-9')
    await user.type(screen.getByLabelText(/^New password/), 'Brand-New-77')
    await user.type(screen.getByLabelText(/^Confirm new password/), 'Brand-New-78')
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    expect(await screen.findByText('Passwords don’t match.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/^Confirm new password/))
    await user.type(screen.getByLabelText(/^Confirm new password/), 'Brand-New-77')
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    await screen.findByRole('heading', { name: 'My account' })
  })

  it('shows "current password is incorrect" on the right field', async () => {
    installFakeAuthApi({ user: makeUser({ mustChangePassword: true }) })
    renderApp('/login')
    await signIn()
    await screen.findByRole('heading', { name: 'Set a new password' })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/^Current password/), 'not-it-123')
    await user.type(screen.getByLabelText(/^New password/), 'Brand-New-77')
    await user.type(screen.getByLabelText(/^Confirm new password/), 'Brand-New-77')
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Current password/)).toHaveFocus()
  })
})

describe('admin and worker apps are separate', () => {
  const worker = makeUser({
    roleKind: 'WORKER',
    roles: [{ id: 'r3', name: 'Worker', systemKey: 'WORKER' }],
    permissions: ['work_orders:view', 'requests:create', 'requests:view', 'assets:view'],
  })

  const homeRoute = (_m: string, path: string) =>
    path === '/me/home'
      ? json({
          data: { counts: { today: 0, overdue: 0, inProgress: 0, doneThisWeek: 0 }, next: [] },
        })
      : undefined

  it('workers land in the mobile app', async () => {
    installFakeAuthApi({ user: worker, routes: homeRoute })
    const { router, container } = renderApp('/login')
    await signIn()
    await screen.findByRole('heading', { name: /Priya/, level: 1 })
    expect(router.state.location.pathname).toBe('/w')
    expect(await screen.findByText('You’re all caught up.')).toBeInTheDocument()
    await expectAccessible(container)
  })

  it('workers cannot open admin pages, admins cannot open worker pages', async () => {
    installFakeAuthApi({ user: worker, signedIn: true, routes: homeRoute })
    const { router } = renderApp('/account')
    await waitFor(() => expect(router.state.location.pathname).toBe('/w'))
  })

  it('admins are kept out of /w', async () => {
    installFakeAuthApi({ signedIn: true })
    const { router } = renderApp('/w/account')
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'))
  })

  it('Super Admin sees "All restaurants"', async () => {
    installFakeAuthApi({ user: makeUser({ isSuperAdmin: true }), signedIn: true })
    renderApp('/account')
    expect(await screen.findByText('All restaurants')).toBeInTheDocument()
  })
})

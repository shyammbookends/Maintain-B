import { ADMIN_DEFAULT_PERMISSIONS, type LocationDto, type RestaurantDto } from '@maintainx/shared'
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

const R1: RestaurantDto = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'R1',
  name: 'Restaurant 1',
  addressLine1: 'SG Highway',
  addressLine2: null,
  city: 'Ahmedabad',
  state: 'Gujarat',
  postalCode: '380054',
  phone: '+91 98765 43210',
  email: null,
  opensAt: '09:00',
  closesAt: '23:00',
  status: 'ACTIVE',
  manager: null,
  contactName: null,
  portalId: 'abcdef0123456789',
  createdAt: new Date().toISOString(),
}

const admin = makeUser({
  permissions: [...ADMIN_DEFAULT_PERMISSIONS],
  restaurants: [{ id: R1.id, code: R1.code, name: R1.name }],
})

function setup(path: string) {
  let locations: LocationDto[] = [
    {
      id: 'l1',
      restaurantId: R1.id,
      parentId: null,
      publicId: 'LOCQR1234567',
      name: 'Storage',
      type: 'STORAGE',
      description: null,
      assetCount: 2,
    },
  ]
  const posted: unknown[] = []
  installFakeAuthApi({
    user: admin,
    signedIn: true,
    routes: (method, p, body) => {
      if (p === `/restaurants/${R1.id}`) return json({ data: R1 })
      if (p === '/locations' && method === 'GET') return json({ data: locations })
      if (p === '/locations' && method === 'POST') {
        posted.push(body)
        const created = {
          id: 'l2',
          restaurantId: R1.id,
          name: String((body as { name: string }).name),
          type: 'BAR',
          description: null,
          assetCount: 0,
        } as LocationDto
        locations = [...locations, created]
        return json({ data: created }, 201)
      }
      return undefined
    },
  })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...utils, posted, router }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
})
afterEach(() => setAccessToken(null))

describe('restaurant page', () => {
  it('shows details and permitted tabs', async () => {
    const { container } = setup(`/restaurants/${R1.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Restaurant 1' })
    expect(screen.getByText('SG Highway, Ahmedabad, Gujarat, 380054')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Details',
      'Locations',
      'Assets',
      'People',
      'Teams',
      'Documents',
    ])
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(r.violations.map((v) => v.id)).toEqual([])
  })

  it('locations: list with asset counts, archive blocked while in use, add a new one', async () => {
    const { posted, router } = setup(`/restaurants/${R1.id}?tab=locations`)
    expect(await screen.findByText('Storage')).toBeInTheDocument()
    expect(screen.getByText(/2 assets/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive location: Storage' })).toBeDisabled()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add location' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Name/), 'Bar counter')
    await user.click(within(dialog).getByRole('combobox', { name: /Type/ }))
    await user.click(await screen.findByRole('option', { name: 'Bar' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Bar counter')).toBeInTheDocument()
    expect(posted).toEqual([
      { restaurantId: R1.id, parentId: '', name: 'Bar counter', type: 'BAR', description: '' },
    ])
    expect(router.state.location.search).toBe('?tab=locations')
  })

  it('restaurant list rows open the restaurant page', async () => {
    installFakeAuthApi({
      user: admin,
      signedIn: true,
      routes: (_m, p) => {
        if (p === '/restaurants') return json({ data: [R1] })
        if (p === `/restaurants/${R1.id}`) return json({ data: R1 })
        return undefined
      },
    })
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/restaurants'] })
    render(
      <AppProviders
        queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </AppProviders>,
    )
    await userEvent.setup().click(await screen.findByText('Restaurant 1'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/restaurants/${R1.id}`))
  })
})

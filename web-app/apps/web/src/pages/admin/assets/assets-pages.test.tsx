import {
  ADMIN_DEFAULT_PERMISSIONS,
  WORKER_PERMISSION_FLOOR,
  type AssetDetail,
  type AssetListItem,
  type LocationDto,
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
import { parseAssetQr } from '@/utils/qr'

const R1 = { id: '11111111-1111-4111-8111-111111111111', code: 'R1', name: 'Restaurant 1' }
const CAT = { id: '22222222-2222-4222-8222-222222222222', name: 'Refrigerator', assetCount: 1 }
const LOC: LocationDto = {
  id: '33333333-3333-4333-8333-333333333333',
  restaurantId: R1.id,
  parentId: null,
  publicId: 'LOCQR1234567',
  name: 'Storage',
  type: 'STORAGE',
  description: null,
  assetCount: 1,
}

const ITEM: AssetListItem = {
  id: '44444444-4444-4444-8444-444444444444',
  publicId: 'Kx7mPq2RtaZB',
  assetCode: 'AST-0001',
  name: 'Walk-in freezer',
  status: 'BROKEN',
  criticality: 'HIGH',
  parent: null,
  category: { id: CAT.id, name: CAT.name },
  restaurant: R1,
  location: { id: LOC.id, name: LOC.name },
  manufacturer: 'Blue Star',
  model: 'WF-200',
  serialNumber: 'BS-22-00418',
  warrantyEnd: '2099-01-31',
}

const DETAIL: AssetDetail = {
  ...ITEM,
  purchaseDate: '2024-03-01',
  purchaseCost: '185000',
  customFields: {},
  vendor: null,
  installDate: null,
  children: [],
  cost: { parts: 0, labour: 0, vendor: 0, other: 0, total: 0 },
  workOrderStats: { total: 0, reactive: 0, completed: 0 },
  recentWorkOrders: [],
  warrantyStart: '2024-03-01',
  notes: null,
  createdAt: new Date().toISOString(),
  downtimeHours90d: 5,
  downSince: new Date(Date.now() - 3_600_000).toISOString(),
  openWorkOrders: [],
  history: [
    {
      id: 'h2',
      eventType: 'STATUS_CHANGED',
      actor: { id: 'u1', firstName: 'Priya', lastName: 'Mehta' },
      oldValue: { status: 'OPERATIONAL' },
      newValue: { status: 'BROKEN' },
      note: 'Compressor not starting',
      occurredAt: new Date().toISOString(),
    },
    {
      id: 'h1',
      eventType: 'CREATED',
      actor: null,
      oldValue: null,
      newValue: null,
      note: null,
      occurredAt: new Date().toISOString(),
    },
  ],
  can: { edit: true, delete: true, transfer: true },
}

const admin = makeUser({ permissions: [...ADMIN_DEFAULT_PERMISSIONS], restaurants: [R1] })
const worker = makeUser({
  roleKind: 'WORKER',
  roles: [{ id: 'r3', name: 'Worker', systemKey: 'WORKER' }],
  permissions: [...WORKER_PERMISSION_FLOOR],
  restaurants: [R1],
})

function renderAt(
  path: string,
  user = admin,
  calls: Array<{ method: string; path: string; body: unknown }> = [],
) {
  installFakeAuthApi({
    user,
    signedIn: true,
    routes: (method, p, body) => {
      calls.push({ method, path: p, body })
      if (p === '/assets' && method === 'GET')
        return json({ data: [ITEM], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } })
      if (p === '/assets' && method === 'POST')
        return json(
          { data: { ...DETAIL, id: 'new-id', name: String((body as { name: string }).name) } },
          201,
        )
      if (p === `/assets/${ITEM.id}`) return json({ data: DETAIL })
      if (p === `/assets/by-public/${ITEM.publicId}`) return json({ data: DETAIL })
      if (p.startsWith('/assets/by-public/'))
        return json({ error: { code: 'NOT_FOUND', message: 'x' } }, 404)
      if (p === '/asset-categories') return json({ data: [CAT] })
      if (p === '/restaurants') return json({ data: [{ ...R1, status: 'ACTIVE' }] })
      if (p === '/locations') return json({ data: [LOC] })
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
  return { ...utils, router, calls }
}

async function expectAccessible(container: HTMLElement) {
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
})
afterEach(() => setAccessToken(null))

describe('parseAssetQr', () => {
  it('accepts our asset links from any host and rejects everything else', () => {
    expect(parseAssetQr('https://maint.bookends.in/a/Kx7mPq2RtaZB')).toBe('Kx7mPq2RtaZB')
    expect(parseAssetQr('http://localhost:5173/a/Kx7mPq2RtaZB/')).toBe('Kx7mPq2RtaZB')
    expect(parseAssetQr('https://example.com/menu')).toBeNull()
    expect(parseAssetQr('WIFI:S:Bookends;T:WPA;P:secret;;')).toBeNull()
    expect(parseAssetQr('https://x/a/../../etc')).toBeNull()
  })
})

describe('admin assets', () => {
  it('lists assets with status and warranty, and opens the detail page', async () => {
    const { router, container } = renderAt('/assets')
    const table = await screen.findByRole('table', { name: 'Assets' })
    expect(await within(table).findByText('Walk-in freezer')).toBeInTheDocument()
    expect(within(table).getByText('Offline / broken')).toBeInTheDocument()
    expect(within(table).getByText('Under warranty')).toBeInTheDocument()
    await expectAccessible(container)

    await userEvent.setup().click(within(table).getByText('Walk-in freezer'))
    await screen.findByRole('heading', { level: 1, name: 'Walk-in freezer' })
    expect(router.state.location.pathname).toBe(`/assets/${ITEM.id}`)
  })

  it('detail page: downtime notice, history, QR code', async () => {
    const { container } = renderAt(`/assets/${ITEM.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Walk-in freezer' })
    expect(screen.getByText(/Not working since/)).toBeInTheDocument()
    expect(screen.getByText('“Compressor not starting”')).toBeInTheDocument()
    expect(screen.getByText(/Operational → Offline \/ broken/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /QR code: Walk-in freezer/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Print label/ })).toHaveAttribute(
      'href',
      `/assets/qr-print?ids=${ITEM.id}`,
    )
    await expectAccessible(container)
  })

  it('creates an asset with restaurant and location', async () => {
    const { calls, router } = renderAt('/assets')
    await screen.findByText('Walk-in freezer')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'New asset' })[0]!)
    await user.type(await screen.findByLabelText(/^Name/), 'Ice machine')
    await user.click(screen.getByRole('combobox', { name: /Category/ }))
    await user.click(await screen.findByRole('option', { name: 'Refrigerator' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Location/ })).toBeEnabled())
    await user.click(screen.getByRole('combobox', { name: /Location/ }))
    await user.click(await screen.findByRole('option', { name: 'Storage' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/assets/new-id'))
    const post = calls.find((c) => c.method === 'POST' && c.path === '/assets')!
    expect(post.body).toMatchObject({
      name: 'Ice machine',
      categoryId: CAT.id,
      restaurantId: R1.id,
      locationId: LOC.id,
    })
  })
})

describe('QR landing and worker app', () => {
  it('a scanned code opens the asset in the worker app', async () => {
    const { router } = renderAt(`/a/${ITEM.publicId}`, worker)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/assets/${ITEM.id}`))
    await screen.findByRole('heading', { level: 1, name: 'Walk-in freezer' })
    // Workers don't get admin controls or QR tools.
    expect(screen.queryByRole('button', { name: /Change status/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument()
  })

  it('a scanned code opens the admin asset page for admins', async () => {
    const { router } = renderAt(`/a/${ITEM.publicId}`)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/assets/${ITEM.id}`))
  })

  it('unknown or out-of-scope codes explain themselves', async () => {
    renderAt('/a/UnknownCode99', worker)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/doesn’t exist/)
  })

  it('worker tab bar has Scan; My Assets lists and searches', async () => {
    const { container, calls } = renderAt('/w/assets', worker)
    expect(await screen.findByRole('link', { name: /Walk-in freezer/ })).toHaveAttribute(
      'href',
      `/w/assets/${ITEM.id}`,
    )
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Home', 'My Tasks', 'Scan', 'Alerts', 'More'])
    await userEvent.setup().type(screen.getByRole('searchbox'), 'freezer')
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/assets' && c.method === 'GET')).toBe(true),
    )
    await expectAccessible(container)
  })
})

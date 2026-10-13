import type {
  AuthUser,
  PartListItem,
  StockCountDetail,
  VendorContractDto,
  VendorDetail,
  WorkOrderActions,
  WorkOrderDetail,
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
import { NEW_ACTIONS, WO_DEFAULTS } from '@/test/work-order-fixtures'

/* Phases 9–10 in the browser: cycle counts, reservations, low-stock orders, vendor contracts. */

const R1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Restaurant 1' }
const priya = { id: '33333333-3333-4333-8333-333333333333', firstName: 'Priya', lastName: 'Shah' }
const PART = '55555555-5555-4555-8555-555555555555'
const VENDOR = '66666666-6666-4666-8666-666666666666'

const admin = makeUser({
  id: priya.id,
  firstName: 'Priya',
  permissions: [
    'work_orders:view',
    'work_orders:edit',
    'parts:view',
    'inventory:view',
    'inventory:edit',
    'vendors:view',
    'vendors:edit',
    'purchase_orders:view',
    'purchase_orders:create',
  ],
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

function renderAt(path: string, user: AuthUser, routes: NonNullable<Route>) {
  installFakeAuthApi({
    user,
    signedIn: true,
    routes: (method, p, body, query) =>
      routes(method, p, body, query) ??
      // Anything else the page loads around the feature: empty.
      (method === 'GET' ? json(page([])) : undefined),
  })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
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

// ---------------------------------------------------------------------------

function stockCount(o: Partial<StockCountDetail> = {}): StockCountDetail {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    code: 'SC-000001',
    name: 'Monthly count',
    status: 'IN_PROGRESS',
    restaurant: R1,
    createdBy: priya,
    createdAt: '2026-10-04T08:00:00.000Z',
    completedAt: null,
    lineCount: 1,
    countedCount: 0,
    category: null,
    storageLocation: null,
    notes: null,
    completedBy: null,
    cancelledAt: null,
    lines: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        part: { id: PART, name: 'Door gasket', partNumber: 'GSK-200', unit: 'pcs' },
        storageLocation: 'Shelf A',
        systemQty: 98,
        countedQty: null,
        variance: null,
        unitCost: 450,
        countedBy: null,
        countedAt: null,
      },
    ],
    summary: { varianceLines: 0, netQuantity: 0, varianceValue: 0 },
    actions: { count: true, complete: false, cancel: true },
    ...o,
  }
}

describe('cycle count', () => {
  it('shows the live difference, saves counts and completes the count', async () => {
    let current = stockCount()
    const saved: unknown[] = []
    let completed = false
    const { container } = renderAt(`/stock-counts/${current.id}`, admin, (method, path, body) => {
      if (method === 'GET' && path === `/stock-counts/${current.id}`) return json({ data: current })
      if (method === 'PUT' && path.endsWith('/lines')) {
        saved.push(body)
        const line = { ...current.lines[0]!, countedQty: 95, variance: -3, countedBy: priya }
        current = {
          ...current,
          countedCount: 1,
          lines: [line],
          summary: { varianceLines: 1, netQuantity: -3, varianceValue: -1350 },
          actions: { count: true, complete: true, cancel: true },
        }
        return json({ data: current })
      }
      if (method === 'POST' && path.endsWith('/complete')) {
        completed = true
        current = {
          ...current,
          status: 'COMPLETED',
          actions: { count: false, complete: false, cancel: false },
        }
        return json({ data: current })
      }
      return undefined
    })

    expect(await screen.findByRole('heading', { name: 'Monthly count' })).toBeInTheDocument()
    await expectAccessible(container)
    const user = userEvent.setup()
    const input = screen.getByRole('spinbutton', { name: 'Counted quantity for Door gasket' })
    await user.type(input, '95')
    // Difference shows before saving; completing waits for the save.
    expect(screen.getByText('-3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete count' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Save counts' }))
    await waitFor(() =>
      expect(saved).toEqual([
        { lines: [{ lineId: '88888888-8888-4888-8888-888888888888', countedQty: 95 }] },
      ]),
    )
    expect(await screen.findByText('-₹1,350')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Complete count' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Complete count' }))
    await waitFor(() => expect(completed).toBe(true))
    expect(await screen.findByText('Completed')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

const ACTIONS: WorkOrderActions = {
  edit: true,
  assign: false,
  start: false,
  hold: false,
  resume: false,
  complete: false,
  ...NEW_ACTIONS,
  reserve: true,
  reopen: false,
  unassign: false,
  upload: false,
  message: true,
  checklist: false,
  parts: false,
}

function workOrder(o: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    code: 'WO-000021',
    title: 'Fridge door seal',
    type: 'REACTIVE',
    category: 'REFRIGERATION',
    priority: 'HIGH',
    status: 'ASSIGNED',
    dueDate: null,
    restaurant: R1,
    location: null,
    asset: null,
    assignedUser: null,
    assignedTeam: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    description: null,
    estimatedMinutes: null,
    minutesWorked: 0,
    timerRunning: false,
    startedAt: null,
    completedAt: null,
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
    actions: ACTIONS,
    ...o,
  }
}

const gasket: PartListItem = {
  id: PART,
  publicId: 'PARTQR123456',
  name: 'Door gasket',
  partNumber: 'GSK-200',
  sku: null,
  category: null,
  unit: 'pcs',
  unitCost: 450,
  minStock: 1,
  reorderQty: null,
  preferredVendor: null,
  totalQuantity: 5,
  lowCount: 0,
  stock: {
    restaurant: R1,
    quantity: 5,
    minStock: 1,
    minOverride: null,
    storageLocation: null,
    low: false,
    reserved: 1,
    available: 4,
  },
}

describe('reservations on a planned job', () => {
  it('reserves a part from what is available', async () => {
    let current = workOrder()
    let reserved: unknown
    renderAt(`/work-orders/${current.id}`, admin, (method, path, body) => {
      if (method === 'GET' && path === `/work-orders/${current.id}`) return json({ data: current })
      if (method === 'GET' && path === '/parts') return json(page([gasket]))
      if (method === 'POST' && path.endsWith('/reservations')) {
        reserved = body
        current = {
          ...current,
          reservations: [
            {
              id: '99999999-9999-4999-8999-999999999999',
              part: { id: PART, name: 'Door gasket', partNumber: 'GSK-200', unit: 'pcs' },
              quantity: 2,
              createdBy: priya,
              createdAt: new Date().toISOString(),
            },
          ],
        }
        return json({ data: current })
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Reserve a part' }))
    await user.click(screen.getByRole('combobox', { name: 'Part' }))
    await user.click(await screen.findByRole('option', { name: /Door gasket · 4 pcs available/ }))
    const qty = screen.getAllByRole('spinbutton', { name: 'Quantity' }).at(-1)!
    await user.clear(qty)
    await user.type(qty, '2')
    await user.click(screen.getByRole('button', { name: 'Reserve' }))
    await waitFor(() => expect(reserved).toEqual({ partId: PART, quantity: 2 }))
    expect(
      await screen.findByRole('button', { name: 'Release reservation for Door gasket' }),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

describe('low stock purchase requests', () => {
  it('drafts orders and lists parts that still need a vendor', async () => {
    renderAt('/inventory', admin, (method, path) => {
      if (method === 'GET' && path === '/restaurants') return json({ data: [R1] })
      if (method === 'POST' && path === '/purchase-orders/from-low-stock')
        return json(
          {
            data: {
              created: [
                {
                  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                  code: 'PO-000007',
                  vendor: { id: VENDOR, name: 'CoolTech' },
                  itemCount: 2,
                },
              ],
              withoutVendor: [{ id: PART, name: 'Bulb', partNumber: 'BLB-1' }],
              alreadyOrdered: 1,
            },
          },
          201,
        )
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Order low stock' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Draft purchase requests' }))
    expect(await within(dialog).findByRole('link', { name: 'PO-000007' })).toHaveAttribute(
      'href',
      '/purchase-orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    )
    expect(within(dialog).getByText('1 low part is already on an open order.')).toBeInTheDocument()
    expect(within(dialog).getByText('These need a preferred vendor first')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

const vendor: VendorDetail = {
  id: VENDOR,
  name: 'CoolTech Services',
  contactName: null,
  phone: null,
  email: null,
  city: null,
  categories: ['REFRIGERATION'],
  restaurants: [R1],
  openOrders: 0,
  altPhone: null,
  address: null,
  taxId: null,
  notes: null,
  spend12m: 0,
  unpaidAmount: 0,
  partCount: 0,
  assetCount: 0,
  performance: {
    workOrders: { total: 4, open: 1, completed: 3 },
    avgResponseHours: 2.5,
    avgCompletionHours: 6,
    onTimeRate: 0.75,
    contractResponseHours: 4,
    spend: { invoices: 1000, workOrderCosts: 1500, purchases: 1600, total: 4100 },
  },
  recentWorkOrders: [],
  parts: [],
  can: { edit: true, delete: false },
}

describe('vendor contracts and performance', () => {
  it('shows the measured performance and adds a contract', async () => {
    let contracts: VendorContractDto[] = []
    let sent: Record<string, unknown> | undefined
    const { container } = renderAt(`/vendors/${VENDOR}`, admin, (method, path, body) => {
      if (method === 'GET' && path === `/vendors/${VENDOR}`) return json({ data: vendor })
      if (method === 'GET' && path === `/vendors/${VENDOR}/contracts`)
        return json({ data: contracts })
      if (method === 'GET' && path === '/restaurants') return json({ data: [R1] })
      if (method === 'POST' && path === `/vendors/${VENDOR}/contracts`) {
        sent = body
        contracts = [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            title: 'Refrigeration AMC',
            contractNumber: null,
            startDate: '2026-10-01',
            endDate: '2026-10-20',
            value: 60000,
            responseHours: 4,
            restaurant: R1,
            terms: null,
            state: 'expiring',
          },
        ]
        return json({ data: contracts }, 201)
      }
      return undefined
    })
    expect(await screen.findByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Promised 4h')).toBeInTheDocument()
    expect(screen.getByText('₹4,100')).toBeInTheDocument()
    await expectAccessible(container)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add contract' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Title/), 'Refrigeration AMC')
    await user.type(within(dialog).getByLabelText(/^Promised response/), '4')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(sent).toMatchObject({ title: 'Refrigeration AMC', responseHours: 4 }),
    )
    expect(await screen.findByText('Ending soon')).toBeInTheDocument()
  })
})

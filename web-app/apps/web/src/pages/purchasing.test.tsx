import type {
  AuthUser,
  PagedResponse,
  PartDetail,
  PartListItem,
  PurchaseOrderDetail,
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

const R1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Restaurant 1' }
const ravi = { id: '22222222-2222-4222-8222-222222222222', firstName: 'Ravi', lastName: 'Kumar' }
const priya = { id: '33333333-3333-4333-8333-333333333333', firstName: 'Priya', lastName: 'Shah' }
const PART_ID = '55555555-5555-4555-8555-555555555555'

const admin = makeUser({
  id: priya.id,
  firstName: 'Priya',
  permissions: [
    'parts:view',
    'parts:create',
    'parts:edit',
    'inventory:view',
    'inventory:edit',
    'purchase_orders:view',
    'purchase_orders:create',
    'purchase_orders:edit',
    'purchase_orders:approve',
    'purchase_orders:delete',
    'vendors:view',
    'assets:view',
    'assets:create',
  ],
})
const worker = makeUser({
  id: ravi.id,
  firstName: 'Ravi',
  roleKind: 'WORKER',
  roles: [{ id: 'r3', name: 'Worker', systemKey: 'WORKER' }],
  permissions: ['work_orders:view', 'work_orders:edit', 'parts:view', 'inventory:view'],
})

const paged = <T,>(data: T[]): PagedResponse<T> => ({
  data,
  meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 },
})

type Routes = NonNullable<NonNullable<Parameters<typeof installFakeAuthApi>[0]>['routes']>

function renderAt(path: string, user: AuthUser, routes: Routes) {
  installFakeAuthApi({ user, signedIn: true, routes })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...utils, router }
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

function order(o: Partial<PurchaseOrderDetail> = {}): PurchaseOrderDetail {
  return {
    id: 'po1',
    code: 'PO-000003',
    status: 'ORDERED',
    vendor: { id: 'v1', name: 'CoolTech Services' },
    restaurant: R1,
    total: 2386,
    itemCount: 1,
    requestedBy: ravi,
    expectedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    notes: null,
    subtotal: 2251,
    tax: 135,
    approvedBy: priya,
    submittedAt: '2026-10-01T10:00:00.000Z',
    approvedAt: '2026-10-01T11:00:00.000Z',
    orderedAt: '2026-10-01T12:00:00.000Z',
    receivedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    items: [
      {
        id: 'it1',
        part: { id: PART_ID, name: 'Door gasket', partNumber: 'GSK-200', unit: 'pcs' },
        description: null,
        qtyOrdered: 4,
        qtyReceived: 1,
        unitCost: 400,
        lineTotal: 1600,
      },
    ],
    receipts: [],
    selfApprovalBlocked: false,
    actions: {
      edit: false,
      submit: false,
      approve: false,
      reject: false,
      order: false,
      receive: true,
      cancel: false,
    },
    ...o,
  }
}

describe('purchase order detail', () => {
  it('receives the remaining quantity into stock', async () => {
    let po = order()
    let body: unknown
    const { container } = renderAt('/purchase-orders/po1', admin, (method, path, b) => {
      if (method === 'GET' && path === '/purchase-orders/po1') return json({ data: po })
      if (method === 'POST' && path === '/purchase-orders/po1/receive') {
        body = b
        po = {
          ...po,
          status: 'RECEIVED',
          items: [{ ...po.items[0]!, qtyReceived: 4 }],
          actions: { ...po.actions, receive: false },
        }
        return json({ data: po })
      }
      return undefined
    })
    expect(await screen.findByRole('heading', { name: 'PO-000003' })).toBeInTheDocument()
    expect(screen.getByText('₹2,386')).toBeInTheDocument()
    await expectAccessible(container)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Receive items/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('3 pcs still to receive')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Door gasket/)).toHaveValue(3)
    await user.click(within(dialog).getByRole('button', { name: 'Receive items' }))
    await waitFor(() =>
      expect(body).toEqual({ lines: [{ itemId: 'it1', quantity: 3 }], notes: '' }),
    )
    expect(
      await screen.findByText('Received', { selector: '[data-slot="badge"], span' }),
    ).toBeInTheDocument()
  })

  it('explains why the requester cannot approve', async () => {
    renderAt('/purchase-orders/po1', admin, (method, path) => {
      if (method === 'GET' && path === '/purchase-orders/po1')
        return json({
          data: order({
            status: 'PENDING_APPROVAL',
            requestedBy: priya,
            selfApprovalBlocked: true,
            actions: {
              edit: false,
              submit: false,
              approve: false,
              reject: false,
              order: false,
              receive: false,
              cancel: true,
            },
          }),
        })
      return undefined
    })
    expect(await screen.findByText(/someone else must approve it/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument()
  })
})

describe('purchase order form', () => {
  it('fills the unit cost from the chosen part (regression)', async () => {
    const part = {
      id: PART_ID,
      publicId: 'PARTQR123456',
      name: 'Door gasket',
      partNumber: 'GSK-200',
      sku: null,
      reorderQty: null,
      category: null,
      unit: 'pcs',
      unitCost: 450,
      minStock: 1,
      preferredVendor: null,
      totalQuantity: 2,
      lowCount: 0,
      stock: null,
    } satisfies PartListItem
    renderAt(
      '/purchase-orders/new',
      { ...admin, restaurants: [{ ...R1, code: 'R1' }] },
      (method, path) => {
        if (method === 'GET' && path === '/restaurants')
          return json({ data: [{ ...R1, code: 'R1', status: 'ACTIVE' }] })
        if (method === 'GET' && path === '/parts') return json(paged([part]))
        if (method === 'GET' && path.startsWith('/vendors'))
          return json({ data: [{ id: 'v1', name: 'CoolTech Services' }] })
        return undefined
      },
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('combobox', { name: /^Part/ }))
    await user.click(await screen.findByRole('option', { name: /Door gasket/ }))
    await waitFor(() => expect(screen.getByLabelText(/^Unit cost/)).toHaveValue(450))
  })
})

describe('parts used on a task (worker)', () => {
  it('picks an in-stock part and records it', async () => {
    let w: WorkOrderDetail = {
      id: '44444444-4444-4444-8444-444444444444',
      code: 'WO-000021',
      title: 'Fix freezer door',
      type: 'REACTIVE',
      category: 'REFRIGERATION',
      priority: 'MEDIUM',
      status: 'IN_PROGRESS',
      dueDate: null,
      restaurant: R1,
      location: null,
      asset: null,
      assignedUser: ravi,
      assignedTeam: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      description: null,
      estimatedMinutes: null,
      minutesWorked: 3,
      timerRunning: true,
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
      checklist: [],
      parts: [],
      sourceRequest: null,
      attachments: [],
      messages: [],
      history: [],
      ...WO_DEFAULTS,
      actions: {
        edit: false,
        assign: false,
        start: false,
        hold: true,
        resume: false,
        complete: true,
        ...NEW_ACTIONS,
        reopen: false,
        unassign: false,
        upload: false,
        message: true,
        checklist: false,
        parts: true,
      },
    }
    const part: PartListItem = {
      id: PART_ID,
      publicId: 'PARTQR123456',
      name: 'Door gasket',
      partNumber: 'GSK-200',
      sku: null,
      reorderQty: null,
      category: null,
      unit: 'pcs',
      unitCost: 450,
      minStock: 1,
      preferredVendor: null,
      totalQuantity: 2,
      lowCount: 0,
      stock: {
        restaurant: R1,
        quantity: 2,
        minStock: 1,
        minOverride: null,
        storageLocation: null,
        low: false,
        reserved: 0,
        available: 2,
      },
    }
    let used: unknown
    renderAt(`/w/tasks/${w.id}`, worker, (method, path, body) => {
      if (method === 'GET' && path === `/work-orders/${w.id}`) return json({ data: w })
      if (path === '/parts') return json(paged([part]))
      if (method === 'POST' && path === `/work-orders/${w.id}/parts`) {
        used = body
        w = {
          ...w,
          parts: [
            {
              id: 'l1',
              part: { id: PART_ID, name: 'Door gasket', partNumber: 'GSK-200', unit: 'pcs' },
              condition: 'NEW',
              qtyUsed: 1,
              unitCost: 450,
            },
          ],
        }
        return json({ data: w })
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Add part used/ }))
    await user.click(screen.getByRole('combobox', { name: 'Part' }))
    await user.click(await screen.findByRole('option', { name: /Door gasket · 2 pcs in stock/ }))
    await user.click(screen.getByRole('button', { name: 'Use part' }))
    await waitFor(() => expect(used).toEqual({ partId: PART_ID, quantity: 1, condition: 'NEW' }))
    expect(await screen.findByText('Parts cost: ₹450')).toBeInTheDocument()
  })
})

describe('stock adjustment', () => {
  it('counts stock at a restaurant', async () => {
    let p: PartDetail = {
      id: PART_ID,
      publicId: 'PARTQR123456',
      name: 'Door gasket',
      partNumber: 'GSK-200',
      sku: null,
      reorderQty: null,
      reservations: [],
      category: 'Refrigeration',
      unit: 'pcs',
      unitCost: 450,
      minStock: 2,
      preferredVendor: null,
      totalQuantity: 5,
      lowCount: 0,
      stock: null,
      description: null,
      storageLocation: null,
      stockLevels: [
        {
          restaurant: R1,
          quantity: 5,
          minStock: 2,
          minOverride: null,
          storageLocation: null,
          low: false,
          reserved: 0,
          available: 5,
        },
      ],
      transactions: [],
      can: { edit: true, delete: false, adjust: true },
    }
    let body: Record<string, unknown> | undefined
    renderAt(`/inventory/parts/${PART_ID}`, admin, (method, path, b) => {
      if (method === 'GET' && path === `/parts/${PART_ID}`) return json({ data: p })
      if (path === '/restaurants') return json({ data: [{ ...R1, code: 'R1', status: 'ACTIVE' }] })
      if (method === 'POST' && path === `/parts/${PART_ID}/adjust`) {
        body = b
        p = { ...p, stockLevels: [{ ...p.stockLevels[0]!, quantity: 1, low: true }] }
        return json({ data: p })
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click((await screen.findAllByRole('button', { name: 'Adjust stock' }))[0]!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Now: 5 pcs')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('combobox', { name: 'What happened' }))
    await user.click(await screen.findByRole('option', { name: /Counted/ }))
    await user.type(within(dialog).getByLabelText(/^Counted quantity/), '1')
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Stock take')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(body).toMatchObject({
        restaurantId: R1.id,
        mode: 'COUNT',
        quantity: 1,
        reason: 'Stock take',
      }),
    )
    expect(body!.unitCost).toBeUndefined()
    expect(await screen.findByText('Low')).toBeInTheDocument()
  })
})

describe('asset form', () => {
  it('saves an asset without a location or vendor (regression)', async () => {
    let sent: Record<string, unknown> | undefined
    const cat = { id: '66666666-6666-4666-8666-666666666666', name: 'Refrigerator', assetCount: 0 }
    renderAt('/assets', admin, (method, path, body) => {
      if (path === '/assets' && method === 'GET') return json(paged([]))
      if (path === '/asset-categories') return json({ data: [cat] })
      if (path === '/restaurants') return json({ data: [{ ...R1, code: 'R1', status: 'ACTIVE' }] })
      if (path === '/locations') return json({ data: [] })
      if (path === '/vendors/options') return json({ data: [{ id: 'v1', name: 'CoolTech' }] })
      if (path === '/assets' && method === 'POST') {
        sent = body
        return json({ error: { code: 'CONFLICT', message: 'stop' } }, 409)
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /New asset/ }))
    await user.type(await screen.findByLabelText(/^Name/), 'Walk-in freezer')
    await user.click(screen.getByRole('combobox', { name: /Category/ }))
    await user.click(await screen.findByRole('option', { name: 'Refrigerator' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(sent).toMatchObject({ name: 'Walk-in freezer', locationId: '', vendorId: '' }),
    )
  })
})

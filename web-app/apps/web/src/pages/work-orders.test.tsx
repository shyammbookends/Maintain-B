import type {
  AuthUser,
  RequestDetail,
  WorkOrderActions,
  WorkOrderDetail,
  WorkerRestaurant,
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

const admin = makeUser({
  id: priya.id,
  firstName: 'Priya',
  permissions: [
    'work_orders:view',
    'work_orders:create',
    'work_orders:edit',
    'work_orders:assign',
    'work_orders:approve',
    'requests:view',
    'requests:approve',
  ],
})
const worker = makeUser({
  id: ravi.id,
  firstName: 'Ravi',
  roleKind: 'WORKER',
  roles: [{ id: 'r3', name: 'Worker', systemKey: 'WORKER' }],
  permissions: ['work_orders:view', 'requests:view', 'requests:create', 'assets:view'],
})

const NO_ACTIONS: WorkOrderActions = {
  edit: false,
  assign: false,
  start: false,
  hold: false,
  resume: false,
  complete: false,
  ...NEW_ACTIONS,
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
    code: 'WO-000007',
    title: 'Replace door gasket',
    type: 'REACTIVE',
    category: 'REFRIGERATION',
    priority: 'HIGH',
    status: 'ASSIGNED',
    dueDate: null,
    restaurant: R1,
    location: null,
    asset: null,
    assignedUser: ravi,
    assignedTeam: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    description: 'Door does not seal.',
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
    actions: NO_ACTIONS,
    ...o,
  }
}

const RESTAURANTS: WorkerRestaurant[] = [
  {
    id: R1.id,
    code: 'R1',
    name: R1.name,
    addressLine1: null,
    addressLine2: null,
    city: null,
    phone: null,
    opensAt: null,
    closesAt: null,
    openTasks: 0,
  },
]

type Route = Parameters<typeof installFakeAuthApi>[0] extends infer O
  ? O extends { routes?: infer R }
    ? R
    : never
  : never

function renderAt(path: string, user: AuthUser, routes: NonNullable<Route>) {
  const fake = installFakeAuthApi({ user, signedIn: true, routes })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...utils, router, fake }
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

describe('admin work order detail', () => {
  it('approves and closes a task waiting for review', async () => {
    let current = workOrder({
      status: 'REVIEW',
      completionNotes: 'Gasket replaced',
      actions: { ...NO_ACTIONS, verify: true, reject: true },
    })
    let closeBody: unknown
    const { container } = renderAt(`/work-orders/${current.id}`, admin, (method, path, body) => {
      if (method === 'GET' && path === `/work-orders/${current.id}`) return json({ data: current })
      if (method === 'POST' && path === `/work-orders/${current.id}/verify`) {
        closeBody = body
        current = {
          ...current,
          status: 'CLOSED',
          closedBy: priya,
          closedAt: new Date().toISOString(),
          verifiedBy: priya,
          verifiedAt: new Date().toISOString(),
          actions: { ...NO_ACTIONS, reopen: true, message: false },
        }
        return json({ data: current })
      }
      return undefined
    })

    expect(await screen.findByRole('heading', { name: 'Replace door gasket' })).toBeInTheDocument()
    expect(screen.getByText('Waiting for your verification')).toBeInTheDocument()
    expect(screen.getByText('Gasket replaced')).toBeInTheDocument()
    await expectAccessible(container)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Approve work' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Note/), 'Checked, cold again')
    await user.click(within(dialog).getByRole('button', { name: 'Approve work' }))

    await waitFor(() => expect(closeBody).toEqual({ note: 'Checked, cold again' }))
    expect(await screen.findByText('Verified by')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve work' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
  })
})

describe('requests', () => {
  const request: RequestDetail = {
    id: '55555555-5555-4555-8555-555555555555',
    code: 'REQ-000003',
    title: 'Fridge not cooling',
    category: 'REFRIGERATION',
    priority: 'HIGH',
    status: 'NEW',
    restaurant: R1,
    location: null,
    asset: null,
    requestedBy: ravi,
    guest: null,
    photoCount: 0,
    createdAt: '2026-10-01T08:00:00.000Z',
    description: 'Fridge not cooling, ice on the back wall',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    workOrder: null,
    attachments: [],
    reviewNote: null,
    can: { convert: true, reject: true, approve: true },
  }

  it('opens a request from the list and rejects it with a reason', async () => {
    let current = request
    let rejectBody: unknown
    renderAt('/requests', admin, (method, path, body) => {
      if (path === '/requests')
        return json({ data: [current], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } })
      if (path === '/restaurants') return json({ data: [] })
      if (method === 'GET' && path === `/requests/${request.id}`) return json({ data: current })
      if (method === 'POST' && path === `/requests/${request.id}/reject`) {
        rejectBody = body
        current = {
          ...current,
          status: 'REJECTED',
          rejectionReason: String(body.reason),
          reviewedBy: priya,
          can: { convert: false, reject: false, approve: false },
        }
        return json({ data: current })
      }
      return undefined
    })

    const user = userEvent.setup()
    await user.click(await screen.findByText('Fridge not cooling'))
    expect(await screen.findByText('Fridge not cooling, ice on the back wall')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create work order' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject request' })
    await user.type(within(dialog).getByLabelText(/Reason/), 'Duplicate of REQ-000002')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(rejectBody).toEqual({ reason: 'Duplicate of REQ-000002' }))
    expect(await screen.findByText('Rejected by Priya Shah')).toBeInTheDocument()
  })
})

describe('worker task', () => {
  it('starts an assigned task, then offers hold and complete', async () => {
    let current = workOrder({ actions: { ...NO_ACTIONS, start: true, upload: true } })
    let completeBody: Record<string, unknown> | undefined
    const { container } = renderAt(`/w/tasks/${current.id}`, worker, (method, path, body) => {
      if (method === 'GET' && path === `/work-orders/${current.id}`) return json({ data: current })
      if (method === 'POST' && path === `/work-orders/${current.id}/start`) {
        current = {
          ...current,
          status: 'IN_PROGRESS',
          timerRunning: true,
          actions: { ...NO_ACTIONS, hold: true, complete: true, upload: true },
        }
        return json({ data: current })
      }
      if (method === 'POST' && path === `/work-orders/${current.id}/complete`) {
        completeBody = body
        current = { ...current, status: 'REVIEW', timerRunning: false, actions: NO_ACTIONS }
        return json({ data: current })
      }
      return undefined
    })

    expect(await screen.findByRole('heading', { name: 'Replace door gasket' })).toBeInTheDocument()
    // The tab bar is hidden on the focused task screen.
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    await expectAccessible(container)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Start task' }))
    expect(await screen.findByText(/Timer running/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Put on hold' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Complete' }))
    const sheet = await screen.findByRole('dialog', { name: 'Repair report' })
    const send = within(sheet).getByRole('button', { name: 'Send for verification' })
    // No parts recorded yet: say so first.
    expect(send).toBeDisabled()
    await user.click(within(sheet).getByRole('checkbox', { name: 'No parts used' }))
    await user.click(send)
    expect(await within(sheet).findAllByText(/at least 3 characters/)).not.toHaveLength(0)
    await user.type(within(sheet).getByLabelText(/Problem found/), 'Gasket torn')
    await user.type(within(sheet).getByLabelText(/Work performed/), 'Replaced the gasket')
    await user.click(within(sheet).getByRole('combobox', { name: /Final condition/ }))
    await user.click(await screen.findByRole('option', { name: 'Fully working' }))
    await user.click(within(sheet).getByRole('checkbox', { name: /I confirm/ }))
    await user.click(send)
    expect(await screen.findByText('Sent for review')).toBeInTheDocument()
    expect(completeBody).toMatchObject({
      problemFound: 'Gasket torn',
      workPerformed: 'Replaced the gasket',
      finalCondition: 'FULLY_WORKING',
      noPartsUsed: true,
      confirmed: true,
    })
  })
})

describe('report a problem', () => {
  it('sends a typed problem, description and urgency (category picked from the words)', async () => {
    let sent: Record<string, unknown> | undefined
    const { router, container } = renderAt('/w/report', worker, (method, path, body) => {
      if (path === '/me/restaurants') return json({ data: RESTAURANTS })
      if (path === '/assets')
        return json({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } })
      if (method === 'POST' && path === '/requests') {
        sent = body
        return json({ data: { id: 'x', code: 'REQ-000009' } }, 201)
      }
      if (path === '/requests')
        return json({ data: [], meta: { page: 1, pageSize: 50, total: 0, totalPages: 0 } })
      return undefined
    })

    expect(await screen.findByRole('heading', { name: 'Report a problem' })).toBeInTheDocument()
    await expectAccessible(container)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(screen.getByLabelText(/What kind of problem/)).toHaveAttribute('aria-invalid', 'true')

    await user.type(screen.getByLabelText(/What kind of problem/), 'Sink tap leaking')
    await user.type(screen.getByLabelText(/What’s wrong/), 'Tap leaking under the sink')
    await user.click(screen.getByRole('radio', { name: 'Urgent' }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/w/reports'))
    expect(sent).toMatchObject({
      restaurantId: R1.id,
      category: 'PLUMBING',
      description: 'Tap leaking under the sink',
      priority: 'HIGH',
      assetId: '',
      title: 'Sink tap leaking',
    })
  })
})

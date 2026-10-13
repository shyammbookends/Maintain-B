import type {
  AuthUser,
  ChatMessageDto,
  ConversationListItem,
  WorkOrderActions,
  WorkOrderDetail,
  WorkerRestaurant,
} from '@maintainx/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '@/app/providers'
import { useWorkOrderActions } from '@/components/work-orders/useWorkOrderActions'
import i18n from '@/i18n'
import { appRoutes } from '@/routes/app.routes'
import { ApiError, http, setAccessToken } from '@/services/http'
import { offlineStatus } from '@/services/offline'
import { assetMissingFrom } from '@/services/assets.service'
import { requestsApi, workKeys, workOrdersApi } from '@/services/work-orders.service'
import { installFakeAuthApi, json, makeUser } from '@/test/fake-auth-api'
import { NEW_ACTIONS, WO_DEFAULTS } from '@/test/work-order-fixtures'

/* Regression tests for the logic audit (stale data, offline queue, scope, links). */

const R1 = { id: '11111111-1111-4111-8111-111111111111', code: 'R1', name: 'Restaurant 1' }
const R2 = { id: '66666666-6666-4666-8666-666666666666', code: 'R2', name: 'Restaurant 2' }
const ravi = { id: '22222222-2222-4222-8222-222222222222', firstName: 'Ravi', lastName: 'Kumar' }
const priya = { id: '33333333-3333-4333-8333-333333333333', firstName: 'Priya', lastName: 'Shah' }
const ASSET = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Walk-in freezer',
  assetCode: 'A-0150',
  status: 'OPERATIONAL' as const,
  publicId: 'pub-freezer',
}

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
    status: 'IN_PROGRESS',
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
  return { ...utils, router, fake, client }
}

const page = <T,>(data: T[], total = data.length) => ({
  data,
  meta: { page: 1, pageSize: 100, total, totalPages: Math.ceil(total / 100) },
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
  localStorage.clear()
})
afterEach(() => {
  setAccessToken(null)
  vi.restoreAllMocks()
})

describe('work order form', () => {
  it('keeps an asset that is beyond the first 100 loaded when editing', async () => {
    const admin = makeUser({
      id: priya.id,
      permissions: ['work_orders:view', 'work_orders:edit', 'assets:view'],
      restaurants: [R1],
    })
    let current = workOrder({ asset: ASSET, actions: { ...NO_ACTIONS, edit: true } })
    let saved: Record<string, unknown> | undefined
    const others = Array.from({ length: 100 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Asset ${i}`,
      assetCode: `A-${i}`,
    }))
    renderAt(`/work-orders/${current.id}`, admin, (method, path, body) => {
      if (method === 'GET' && path === `/work-orders/${current.id}`) return json({ data: current })
      if (method === 'GET' && path === '/restaurants') return json({ data: [R1] })
      // 150 assets: the job's asset is not on the first page of 100.
      if (method === 'GET' && path === '/assets') return json(page(others, 150))
      if (method === 'PUT' && path === `/work-orders/${current.id}`) {
        saved = body
        current = { ...current }
        return json({ data: current })
      }
      return undefined
    })

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const save = await screen.findByRole('button', { name: 'Save changes' })
    // Let the asset list arrive before saving (it used to clear the asset).
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /Asset/ })).toHaveTextContent('Walk-in freezer'),
    )
    await user.click(save)
    await waitFor(() => expect(saved).toBeDefined())
    expect(saved!.assetId).toBe(ASSET.id)
  })

  it('assetMissingFrom only reports a miss when the list is complete', () => {
    const one = { id: 'a', name: 'A', assetCode: 'A' }
    type Page = Parameters<typeof assetMissingFrom>[0]
    expect(assetMissingFrom(page([one], 1) as unknown as Page, 'b')).toBe(true)
    expect(assetMissingFrom(page([one], 1) as unknown as Page, 'a')).toBe(false)
    expect(assetMissingFrom(page([one], 120) as unknown as Page, 'b')).toBe(false)
  })
})

describe('work order cache after an action', () => {
  it('refreshes the calendar and workload, not just the lists', async () => {
    const qc = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const w = workOrder()
    const calendarKey = [...workKeys.workOrders, 'calendar', { from: 'x' }]
    const workloadKey = [...workKeys.workOrders, 'workload', R1.id]
    qc.setQueryData(calendarKey, [])
    qc.setQueryData(workloadKey, [])
    qc.setQueryData(workKeys.workOrder(w.id), w)
    vi.spyOn(workOrdersApi, 'hold').mockResolvedValue({ ...w, status: 'ON_HOLD' })

    const { result } = renderHook(() => useWorkOrderActions(w), { wrapper })
    await act(() => result.current.hold('Waiting for a part'))

    expect(qc.getQueryState(calendarKey)?.isInvalidated).toBe(true)
    expect(qc.getQueryState(workloadKey)?.isInvalidated).toBe(true)
    // The record itself was just written, not marked stale.
    expect(qc.getQueryState(workKeys.workOrder(w.id))?.isInvalidated).toBe(false)
    expect(qc.getQueryData<WorkOrderDetail>(workKeys.workOrder(w.id))?.status).toBe('ON_HOLD')
  })
})

describe('offline', () => {
  it('a change saved on the device closes the dialog instead of failing (no double queue)', async () => {
    const qc = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const hold = vi
      .spyOn(workOrdersApi, 'hold')
      .mockRejectedValue(new ApiError(0, 'QUEUED_OFFLINE', 'queued'))
    const { result } = renderHook(() => useWorkOrderActions(workOrder()), { wrapper })
    // Resolves (the dialog closes) rather than throwing an error into the dialog.
    await expect(result.current.hold('Waiting for a part')).resolves.toBeUndefined()
    expect(hold).toHaveBeenCalledTimes(1)
    // A real failure still reaches the dialog.
    hold.mockRejectedValueOnce(new ApiError(409, 'INVALID_TRANSITION', 'nope'))
    await expect(result.current.hold('again')).rejects.toBeInstanceOf(ApiError)
  })

  it('comes back online when the server answers again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(http.get('/things')).rejects.toBeInstanceOf(ApiError)
    expect(offlineStatus.get().online).toBe(false)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ data: 1 })),
    )
    await http.get('/things')
    expect(offlineStatus.get().online).toBe(true)
  })

  it('a problem report saved offline leaves the form (sending again would duplicate it)', async () => {
    const worker = makeUser({
      id: ravi.id,
      roleKind: 'WORKER',
      roles: [{ id: 'r3', name: 'User', systemKey: 'WORKER' }],
      permissions: ['requests:view', 'requests:create', 'assets:view'],
      restaurants: [R1],
    })
    const restaurants: WorkerRestaurant[] = [
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
    const create = vi
      .spyOn(requestsApi, 'create')
      .mockRejectedValue(new ApiError(0, 'QUEUED_OFFLINE', 'queued'))
    const { router } = renderAt('/w/report', worker, (method, path) => {
      if (method === 'GET' && path === '/me/restaurants') return json({ data: restaurants })
      if (method === 'GET' && path === '/assets') return json(page([]))
      if (method === 'GET' && path === '/requests') return json(page([]))
      return undefined
    })
    const user = userEvent.setup()
    await user.type(
      await screen.findByRole('textbox', { name: /What kind of problem/ }),
      'Fridge not cooling',
    )
    await user.type(screen.getByRole('textbox', { name: /What’s wrong/ }), 'Warm since morning')
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/reports'))
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('restaurant scope', () => {
  it('switching the top-bar restaurant moves a list page filter with it', async () => {
    const admin = makeUser({
      id: priya.id,
      permissions: ['work_orders:view'],
      restaurants: [R1, R2],
    })
    localStorage.setItem(`mx.scope.${admin.id}`, R1.id)
    const { router } = renderAt('/work-orders', admin, (method, path) => {
      if (method === 'GET' && path === '/restaurants') return json({ data: [R1, R2] })
      if (method === 'GET' && path === '/work-orders') return json(page([]))
      return undefined
    })
    const filterOf = () => new URLSearchParams(router.state.location.search).get('restaurantId')
    await waitFor(() => expect(filterOf()).toBe(R1.id))

    const user = userEvent.setup()
    const header = (await screen.findByRole('main')).previousElementSibling as HTMLElement
    await user.click(within(header).getByRole('combobox', { name: 'Restaurant' }))
    await user.click(await screen.findByRole('option', { name: 'Restaurant 2' }))
    await waitFor(() => expect(filterOf()).toBe(R2.id))

    await user.click(within(header).getByRole('combobox', { name: 'Restaurant' }))
    await user.click(await screen.findByRole('option', { name: 'All my restaurants' }))
    await waitFor(() => expect(filterOf()).toBeNull())
  })

  it('"All restaurants" on a report page sticks even with a top-bar restaurant', async () => {
    const admin = makeUser({
      id: priya.id,
      permissions: ['reports:view', 'work_orders:view'],
      restaurants: [R1, R2],
    })
    localStorage.setItem(`mx.scope.${admin.id}`, R1.id)
    const { router } = renderAt('/analytics', admin, (method, path) => {
      if (method === 'GET' && path === '/restaurants') return json({ data: [R1, R2] })
      return undefined
    })
    // The page's own filter (the top bar has a restaurant switcher too).
    await screen.findByRole('heading', { name: /Analytics|Trends/ })
    const filter = await within(await screen.findByRole('main')).findByRole('combobox', {
      name: 'Restaurant',
    })
    expect(filter).toHaveTextContent('Restaurant 1')
    const user = userEvent.setup()
    await user.click(filter)
    await user.click(await screen.findByRole('option', { name: 'All' }))
    await waitFor(() => expect(filter).toHaveTextContent('All'))
    expect(new URLSearchParams(router.state.location.search).get('restaurantId')).toBe('')
  })
})

describe('calendar and navigation', () => {
  it('survives a broken ?date= and folds the nav group holding the page', async () => {
    const admin = makeUser({ id: priya.id, permissions: ['work_orders:view'], restaurants: [R1] })
    renderAt('/calendar?date=not-a-date', admin, (method, path) => {
      if (method === 'GET' && path === '/calendar') return json({ data: [] })
      if (method === 'GET' && path === '/restaurants') return json({ data: [R1] })
      return undefined
    })
    expect(await screen.findByRole('heading', { name: 'Calendar' })).toBeInTheDocument()

    const nav = screen.getAllByRole('navigation', { name: 'Main navigation' })[0]!
    const group = within(nav).getByRole('button', { name: 'More tools' })
    expect(group).toHaveAttribute('aria-expanded', 'true')
    await userEvent.setup().click(group)
    expect(group).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('team chat', () => {
  it('shows a message that arrives in an empty conversation', async () => {
    const admin = makeUser({ id: priya.id, permissions: ['dashboard:view'], restaurants: [R1] })
    const CHAT = '99999999-9999-4999-8999-999999999999'
    const convo: ConversationListItem = {
      id: CHAT,
      type: 'DIRECT',
      title: 'Ravi Kumar',
      members: [
        { ...priya, role: 'Admin' },
        { ...ravi, role: 'User' },
      ],
      lastMessage: null,
      unread: 0,
      lastMessageAt: null,
    } as unknown as ConversationListItem
    const incoming: ChatMessageDto = {
      id: 'm1',
      body: 'Fridge 2 is noisy',
      author: ravi,
      workOrder: null,
      voice: null,
      createdAt: '2026-10-05T10:00:00.000Z',
      mine: false,
      deleted: false,
    }
    let delivered = false
    renderAt(`/chat/${CHAT}`, admin, (method, path) => {
      if (path === '/chats' && method === 'GET') return json({ data: [convo] })
      if (path === '/chats/unread') return json({ data: { count: 0 } })
      if (path === `/chats/${CHAT}/messages` && method === 'GET')
        return json({ data: { messages: delivered ? [incoming] : [], hasMore: false } })
      if (path === `/chats/${CHAT}/read`) return new Response(null, { status: 204 })
      return undefined
    })
    expect(await screen.findByRole('textbox', { name: 'Write a message…' })).toBeInTheDocument()
    delivered = true
    expect(
      await screen.findByText('Fridge 2 is noisy', { selector: 'p' }, { timeout: 6000 }),
    ).toBeInTheDocument()
  }, 10_000)
})

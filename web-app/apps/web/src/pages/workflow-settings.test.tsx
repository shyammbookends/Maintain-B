import {
  DEFAULT_WORKFLOW,
  type AuthUser,
  type WorkOrderActions,
  type WorkOrderDetail,
  type WorkflowSettings,
} from '@maintainx/shared'
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
import { NEW_ACTIONS, WO_DEFAULTS } from '@/test/work-order-fixtures'

/* Step 2: the strict rules are switches; the default flow is MaintainX-simple. */

const R1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Restaurant 1' }
const ravi = { id: '22222222-2222-4222-8222-222222222222', firstName: 'Ravi', lastName: 'Kumar' }
const priya = { id: '33333333-3333-4333-8333-333333333333', firstName: 'Priya', lastName: 'Shah' }

const owner = makeUser({
  id: priya.id,
  firstName: 'Priya',
  permissions: ['work_orders:view', 'settings:view', 'settings:edit', 'inventory:view'],
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
    priority: 'MEDIUM',
    status: 'IN_PROGRESS',
    dueDate: null,
    restaurant: R1,
    location: null,
    asset: null,
    assignedUser: ravi,
    assignedTeam: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    description: null,
    estimatedMinutes: null,
    minutesWorked: 20,
    timerRunning: true,
    startedAt: '2026-09-30T10:00:00.000Z',
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
    completionCheck: {
      ...WO_DEFAULTS.completionCheck,
      reportRequired: false,
      verificationRequired: false,
    },
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
  installFakeAuthApi({ user, signedIn: true, routes })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
})
afterEach(() => setAccessToken(null))

describe('workflow settings page', () => {
  it('turns on the strict rules and hides stock counts while they are off', async () => {
    let saved: WorkflowSettings | undefined
    let current: WorkflowSettings = { ...DEFAULT_WORKFLOW }
    renderAt('/settings', owner, (method, path, body) => {
      if (path === '/settings/workflow' && method === 'GET') return json({ data: current })
      if (path === '/settings/workflow' && method === 'PUT') {
        saved = body as WorkflowSettings
        current = saved
        return json({ data: current })
      }
      return undefined
    })
    const report = await screen.findByRole('switch', { name: /Require a full repair report/ })
    expect(report).not.toBeChecked()
    // Extra inventory tools stay out of the menu (even under "More tools") until turned on.
    const user = userEvent.setup()
    const more = screen.getByRole('button', { name: /More tools/ })
    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('link', { name: 'Stock counts' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Strict/ }))
    expect(report).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved?.requireVerification).toBe(true))
    expect(saved).toMatchObject({ requireRepairReport: true, simpleStatuses: false })
    expect(await screen.findByRole('link', { name: 'Stock counts' })).toBeInTheDocument()
  })
})

describe('simple completion', () => {
  it('shows simple statuses and finishes a job with one tap and a note', async () => {
    let current = workOrder({ actions: { ...NO_ACTIONS, hold: true, complete: true } })
    let body: Record<string, unknown> | undefined
    renderAt(`/w/tasks/${current.id}`, worker, (method, path, b) => {
      if (path === '/settings/workflow') return json({ data: DEFAULT_WORKFLOW })
      if (method === 'GET' && path === `/work-orders/${current.id}`) return json({ data: current })
      if (method === 'POST' && path === `/work-orders/${current.id}/complete`) {
        body = b
        current = { ...current, status: 'CLOSED', timerRunning: false, actions: NO_ACTIONS }
        return json({ data: current })
      }
      return undefined
    })
    expect(await screen.findByRole('heading', { name: 'Replace door gasket' })).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Complete' }))
    const sheet = await screen.findByRole('dialog', { name: 'Complete work order' })
    // No repair report: no "problem found" or confirmation, just an optional note.
    expect(within(sheet).queryByLabelText(/Problem found/)).not.toBeInTheDocument()
    await user.type(within(sheet).getByLabelText(/Notes/), 'Fitted a new gasket')
    await user.click(within(sheet).getByRole('button', { name: 'Mark as done' }))
    expect(await screen.findByText('Work order done.')).toBeInTheDocument()
    expect(body).toMatchObject({ notes: 'Fitted a new gasket', noPartsUsed: true })
    // CLOSED reads as "Done" with simple statuses.
    expect(await screen.findByText('Done')).toBeInTheDocument()
  })
})

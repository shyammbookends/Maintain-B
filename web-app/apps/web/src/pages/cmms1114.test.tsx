import type {
  AnalyticsTrends,
  AssetMeterDto,
  AuthUser,
  AutomationDto,
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
import { AssetMeters } from '@/components/assets/AssetMeters'
import i18n from '@/i18n'
import { appRoutes } from '@/routes/app.routes'
import { setAccessToken } from '@/services/http'
import { installFakeAuthApi, json, makeUser } from '@/test/fake-auth-api'
import { NEW_ACTIONS, WO_DEFAULTS } from '@/test/work-order-fixtures'

/* Phases 11–14 in the browser: automations, root cause, internal notes, meters, analytics. */

const R1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Restaurant 1' }
const priya = { id: '33333333-3333-4333-8333-333333333333', firstName: 'Priya', lastName: 'Shah' }
const ravi = { id: '22222222-2222-4222-8222-222222222222', firstName: 'Ravi', lastName: 'Kumar' }
const WO = '44444444-4444-4444-8444-444444444444'
const ASSET = '55555555-5555-4555-8555-555555555555'

const admin = makeUser({
  id: priya.id,
  firstName: 'Priya',
  isSuperAdmin: true,
  permissions: [
    'work_orders:view',
    'work_orders:edit',
    'automations:view',
    'automations:create',
    'automations:edit',
    'assets:view',
    'meters:view',
    'meters:create',
    'meters:edit',
    'reports:view',
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
      routes(method, p, body, query) ?? (method === 'GET' ? json(page([])) : undefined),
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

describe('automations', () => {
  it('creates an IF / THEN rule', { timeout: 20_000 }, async () => {
    let rules: AutomationDto[] = []
    let sent: Record<string, unknown> | undefined
    const { container } = renderAt('/automations', admin, (method, path, body) => {
      if (method === 'GET' && path === '/automations') return json({ data: rules })
      if (method === 'GET' && path === '/restaurants') return json({ data: [R1] })
      if (method === 'POST' && path === '/automations') {
        sent = body
        const created: AutomationDto = {
          id: 'a1',
          name: String(body.name),
          description: null,
          trigger: 'WORK_ORDER_OVERDUE',
          restaurant: null,
          conditions: {},
          actions: body.actions as AutomationDto['actions'],
          active: true,
          runCount: 0,
          lastRunAt: null,
          createdBy: priya,
          createdAt: new Date().toISOString(),
          can: { edit: true, delete: true },
        }
        rules = [created]
        return json({ data: created }, 201)
      }
      return undefined
    })
    expect(await screen.findByText('No automations yet')).toBeInTheDocument()
    await expectAccessible(container)
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'New automation' })[0]!)
    const sheet = await screen.findByRole('dialog')
    await user.type(within(sheet).getByLabelText('Name'), 'Overdue → managers')
    await user.click(within(sheet).getByRole('combobox', { name: 'When' }))
    await user.click(await screen.findByRole('option', { name: 'A work order becomes overdue' }))
    await user.type(within(sheet).getByLabelText('Message'), 'Please follow up')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(sent).toMatchObject({
        name: 'Overdue → managers',
        trigger: 'WORK_ORDER_OVERDUE',
        restaurantId: '',
        actions: [{ type: 'NOTIFY', recipients: 'MANAGERS', message: 'Please follow up' }],
      }),
    )
    expect(
      await screen.findByText('If A work order becomes overdue → Send a notification'),
    ).toBeInTheDocument()
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
  rca: true,
  internalNotes: true,
  reopen: false,
  unassign: false,
  upload: true,
  message: true,
  checklist: false,
  parts: false,
}

function workOrder(o: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: WO,
    code: 'WO-000031',
    title: 'Generator not starting',
    type: 'REACTIVE',
    category: 'ELECTRICAL',
    priority: 'HIGH',
    status: 'CLOSED',
    dueDate: null,
    restaurant: R1,
    location: null,
    asset: null,
    assignedUser: ravi,
    assignedTeam: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    description: null,
    estimatedMinutes: null,
    minutesWorked: 30,
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

describe('work order: root cause and internal notes', () => {
  it(
    'records a root cause and posts an internal note mentioning someone',
    { timeout: 20_000 },
    async () => {
      let current = workOrder()
      let rca: Record<string, unknown> | undefined
      let message: Record<string, unknown> | undefined
      renderAt(`/work-orders/${WO}`, admin, (method, path, body) => {
        if (method === 'GET' && path === `/work-orders/${WO}`) return json({ data: current })
        if (method === 'GET' && path === `/work-orders/${WO}/people`) return json({ data: [ravi] })
        if (method === 'PUT' && path.endsWith('/root-cause')) {
          rca = body
          current = {
            ...current,
            rootCause: {
              id: 'r1',
              failure: String(body.failure),
              cause: null,
              rootCause: String(body.rootCause),
              category: body.category as 'ELECTRICAL',
              correctiveAction: null,
              preventiveAction: null,
              createdBy: priya,
              updatedAt: new Date().toISOString(),
              workOrder: { id: WO, code: current.code, title: current.title },
              asset: null,
            },
          }
          return json({ data: current })
        }
        if (method === 'POST' && path.endsWith('/messages')) {
          message = body
          current = {
            ...current,
            messages: [
              {
                id: 'm1',
                body: String(body.body),
                author: priya,
                createdAt: new Date().toISOString(),
                mine: true,
                parentId: null,
                internal: true,
                mentions: [ravi],
                attachments: [],
              },
            ],
          }
          return json({ data: current })
        }
        return undefined
      })
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Record root cause' }))
      const dialog = await screen.findByRole('dialog')
      await user.clear(within(dialog).getByLabelText(/^Root cause/))
      await user.type(within(dialog).getByLabelText(/^Root cause/), 'Charger relay failed')
      await user.click(within(dialog).getByRole('combobox', { name: /Category/ }))
      await user.click(await screen.findByRole('option', { name: 'Electrical' }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(rca).toMatchObject({ rootCause: 'Charger relay failed', category: 'ELECTRICAL' }),
      )
      expect(await screen.findByText('Charger relay failed')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Mention' }))
      await user.click(screen.getByRole('combobox', { name: 'Mention someone' }))
      await user.click(await screen.findByRole('option', { name: 'Ravi Kumar' }))
      await user.type(screen.getByRole('textbox', { name: /message/i }), 'check the warranty')
      await user.click(screen.getByRole('checkbox', { name: /Internal note/ }))
      await user.click(screen.getByRole('button', { name: 'Send' }))
      await waitFor(() => expect(message).toMatchObject({ internal: true, mentionIds: [ravi.id] }))
      expect(String(message!.body)).toContain('@Ravi Kumar')
      expect(await screen.findByText('Mentioned: Ravi Kumar')).toBeInTheDocument()
    },
  )
})

// ---------------------------------------------------------------------------

describe('asset meters and analytics', () => {
  it('records a meter reading', async () => {
    const meter: AssetMeterDto = {
      id: 'm1',
      name: 'Runtime',
      type: 'RUNTIME_HOURS',
      unit: 'h',
      currentValue: 480,
      previousValue: 450,
      lastReadingAt: new Date().toISOString(),
      readings: [],
      can: { read: true, manage: true },
    }
    let sent: Record<string, unknown> | undefined
    installFakeAuthApi({
      user: admin,
      signedIn: true,
      routes: (method, path, body) => {
        if (method === 'GET' && path === `/assets/${ASSET}/meters`) return json({ data: [meter] })
        if (method === 'POST' && path.endsWith('/readings')) {
          sent = body
          return json({ data: [{ ...meter, currentValue: 512, previousValue: 480 }] }, 201)
        }
        return undefined
      },
    })
    render(
      <AppProviders
        queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AssetMeters assetId={ASSET} />
      </AppProviders>,
    )
    expect(await screen.findByText('480 h')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Record reading' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Reading/), '512')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent).toMatchObject({ value: 512 }))
    expect(await screen.findByText('512 h')).toBeInTheDocument()
  })

  it('shows trend KPIs', async () => {
    const trends: AnalyticsTrends = {
      bucket: 'day',
      points: [
        { start: '2026-10-01', created: 3, completed: 1, reactive: 2, preventive: 1, mttrHours: 5 },
        { start: '2026-10-02', created: 1, completed: 2, reactive: 1, preventive: 0, mttrHours: 7 },
      ],
      totals: {
        created: 4,
        completed: 3,
        reactive: 3,
        preventive: 1,
        mttrHours: 6,
        mtbfHours: 240,
        pmCompliance: 80,
        cost: { parts: 450, labour: 600, vendor: 0, other: 0, total: 1050 },
      },
    }
    const { container } = renderAt('/analytics', admin, (method, path) => {
      if (method === 'GET' && path === '/reports/analytics/trends') return json({ data: trends })
      return undefined
    })
    expect(await screen.findByText('80%')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('₹1,050')).toBeInTheDocument()
    await expectAccessible(container)
  })
})

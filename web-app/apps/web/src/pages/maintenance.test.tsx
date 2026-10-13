import type {
  AuthUser,
  ChecklistItemDto,
  InspectionDetail,
  InspectionTemplateDto,
  PmScheduleDetail,
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
    'maintenance:view',
    'maintenance:create',
    'maintenance:edit',
    'maintenance:delete',
    'procedures:view',
    'procedures:create',
    'procedures:edit',
    'work_orders:view',
    'work_orders:create',
    'inspections:view',
  ],
})
const worker = makeUser({
  id: ravi.id,
  firstName: 'Ravi',
  roleKind: 'WORKER',
  roles: [{ id: 'r3', name: 'Worker', systemKey: 'WORKER' }],
  permissions: ['work_orders:view', 'inspections:view', 'inspections:create', 'inspections:edit'],
})

const step = (o: Partial<ChecklistItemDto>): ChecklistItemDto => ({
  showIf: null,
  id: 'i1',
  attachments: [],
  options: [],
  requirePhoto: false,
  position: 1,
  title: 'Freezer temperature',
  instruction: null,
  inputType: 'NUMBER',
  unit: '°C',
  minValue: -25,
  maxValue: -15,
  required: true,
  result: null,
  numericValue: null,
  textValue: null,
  note: null,
  completedAt: null,
  completedBy: null,
  correctiveWorkOrder: null,
  ...o,
})

const ACTIONS: WorkOrderActions = {
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
  checklist: true,
  parts: false,
}

function workOrder(o: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    code: 'WO-000012',
    title: 'Weekly freezer check',
    type: 'PREVENTIVE',
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
    minutesWorked: 5,
    timerRunning: true,
    startedAt: '2026-10-02T09:00:00.000Z',
    completedAt: null,
    closedAt: null,
    holdReason: null,
    completionNotes: null,
    reopenCount: 0,
    createdBy: priya,
    closedBy: null,
    procedure: { id: 'p1', name: 'Freezer weekly check' },
    pmSchedule: { id: 's1', name: 'Freezer check' },
    parts: [],
    checklist: [
      step({}),
      step({
        id: 'i2',
        position: 2,
        title: 'Door gasket intact',
        inputType: 'PASS_FAIL_NA',
        unit: null,
        minValue: null,
        maxValue: null,
      }),
    ],
    sourceRequest: null,
    attachments: [],
    messages: [],
    history: [],
    ...WO_DEFAULTS,
    actions: ACTIONS,
    ...o,
  }
}

type Routes = NonNullable<Parameters<typeof installFakeAuthApi>[0]>['routes']

function renderAt(path: string, user: AuthUser, routes: NonNullable<Routes>) {
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

describe('worker task checklist', () => {
  it('saves answers as they are given; the hint counts what is left before completing', async () => {
    const left = (w: WorkOrderDetail) => w.checklist.filter((c) => c.result === null).length
    let current = workOrder()
    current = {
      ...current,
      completionCheck: { ...current.completionCheck, stepsLeft: left(current) },
    }
    const answers: Array<{ itemId: string; body: Record<string, unknown> }> = []
    const { container } = renderAt(`/w/tasks/${current.id}`, worker, (method, path, body) => {
      if (method === 'GET' && path === `/work-orders/${current.id}`) return json({ data: current })
      const m = path.match(/^\/work-orders\/[^/]+\/checklist\/(.+)$/)
      if (method === 'PUT' && m) {
        answers.push({ itemId: m[1]!, body })
        const v = body.numericValue as number | undefined
        current = {
          ...current,
          checklist: current.checklist.map((c) =>
            c.id !== m[1]
              ? c
              : c.inputType === 'NUMBER'
                ? {
                    ...c,
                    numericValue: v ?? null,
                    result: v === undefined ? null : v > -15 ? 'FAIL' : 'PASS',
                  }
                : { ...c, result: (body.result as ChecklistItemDto['result']) || null },
          ),
        }
        current = {
          ...current,
          completionCheck: { ...current.completionCheck, stepsLeft: left(current) },
        }
        return json({ data: current })
      }
      return undefined
    })

    expect(await screen.findByText('Checklist')).toBeInTheDocument()
    expect(screen.getByText('Allowed -25 to -15 °C')).toBeInTheDocument()
    expect(screen.getByText('2 things left before you can complete')).toBeInTheDocument()
    await expectAccessible(container)

    const user = userEvent.setup()
    const temp = screen.getByRole('spinbutton', { name: /Freezer temperature/ })
    await user.type(temp, '-9')
    await user.tab()
    await waitFor(() =>
      expect(answers[0]).toMatchObject({ itemId: 'i1', body: { numericValue: -9 } }),
    )
    expect(await screen.findByText(/1 step failed/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Pass' }))
    await waitFor(() =>
      expect(answers[1]).toMatchObject({ itemId: 'i2', body: { result: 'PASS' } }),
    )
    await waitFor(() =>
      expect(screen.queryByText(/left before you can complete/)).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled()
  })
})

describe('worker inspection', () => {
  it('starts a checklist, answers it and submits', async () => {
    const template: InspectionTemplateDto = {
      id: 't1',
      name: 'Opening checklist',
      type: 'OPENING',
      procedure: { id: 'p1', name: 'Opening', stepCount: 1 },
      restaurant: null,
      active: true,
    }
    let ins: InspectionDetail = {
      id: 'ins1',
      code: 'INS-000004',
      name: 'Opening checklist',
      type: 'OPENING',
      status: 'IN_PROGRESS',
      restaurant: R1,
      asset: null,
      performedBy: ravi,
      startedAt: new Date().toISOString(),
      submittedAt: null,
      passCount: 0,
      failCount: 0,
      naCount: 0,
      itemCount: 1,
      notes: null,
      items: [
        step({
          id: 'g1',
          title: 'Gas valves closed overnight',
          inputType: 'PASS_FAIL_NA',
          unit: null,
          minValue: null,
          maxValue: null,
        }),
      ],
      can: { answer: true, submit: true },
    }
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
    let startBody: unknown
    const { router } = renderAt('/w/checklists', worker, (method, path, body) => {
      if (path === '/me/restaurants') return json({ data: restaurants })
      if (path === '/inspection-templates') return json({ data: [template] })
      if (method === 'GET' && path === '/inspections')
        return json({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } })
      if (method === 'POST' && path === '/inspections') {
        startBody = body
        return json({ data: ins }, 201)
      }
      if (method === 'GET' && path === '/inspections/ins1') return json({ data: ins })
      if (method === 'PUT' && path === '/inspections/ins1/items/g1') {
        ins = { ...ins, items: [{ ...ins.items[0]!, result: body.result as 'FAIL' }] }
        return json({ data: ins })
      }
      if (method === 'POST' && path === '/inspections/ins1/submit') {
        ins = {
          ...ins,
          status: 'SUBMITTED',
          failCount: 1,
          notes: String(body.notes),
          can: { answer: false, submit: false },
        }
        return json({ data: ins })
      }
      return undefined
    })

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Opening checklist/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/inspections/ins1'))
    expect(startBody).toEqual({ templateId: 't1', restaurantId: R1.id, assetId: '' })

    expect(await screen.findByRole('button', { name: /Submit checklist/ })).toBeDisabled()
    await user.click(await screen.findByRole('radio', { name: 'Fail' }))
    await user.type(screen.getByLabelText(/Note for Gas valves/), 'Left open')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Submit checklist/ })).toBeEnabled(),
    )
    await user.type(screen.getByLabelText(/^Notes/), 'Told the manager')
    await user.click(screen.getByRole('button', { name: /Submit checklist/ }))
    expect(await screen.findByText('Submitted')).toBeInTheDocument()
    expect(screen.getByText(/Follow-up work orders were created/)).toBeInTheDocument()
  })
})

describe('procedure editor', () => {
  // Lots of typing: slow when the whole suite runs in parallel.
  it('builds a procedure with a number step and sends it', { timeout: 15_000 }, async () => {
    let sent: Record<string, unknown> | undefined
    const { router } = renderAt('/procedures/new', admin, (method, path, body) => {
      if (path === '/restaurants') return json({ data: [{ ...R1, code: 'R1', status: 'ACTIVE' }] })
      if (method === 'POST' && path === '/procedures') {
        sent = body
        return json(
          {
            data: {
              id: 'p9',
              name: body.name,
              steps: [],
              can: { edit: true, delete: true },
              version: 1,
              stepCount: 1,
              usedBy: { schedules: 0, templates: 0 },
              restaurant: R1,
              category: null,
              description: null,
              updatedAt: '',
            },
          },
          201,
        )
      }
      if (method === 'GET' && path === '/procedures/p9')
        return json({ error: { code: 'NOT_FOUND', message: 'x' } }, 404)
      return undefined
    })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/^Name/), 'Freezer weekly check')
    await user.type(screen.getByLabelText(/^Step/), 'Freezer temperature')
    await user.click(screen.getByRole('combobox', { name: /Answer type/ }))
    await user.click(await screen.findByRole('option', { name: 'Reading (number)' }))
    await user.type(await screen.findByLabelText(/^Minimum/), '-25')
    await user.type(screen.getByLabelText(/^Maximum/), '-15')
    await user.type(screen.getByLabelText(/^Unit/), '°C')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/procedures/p9'))
    expect(sent).toMatchObject({
      name: 'Freezer weekly check',
      restaurantId: R1.id,
      category: '',
      steps: [
        {
          title: 'Freezer temperature',
          inputType: 'NUMBER',
          minValue: -25,
          maxValue: -15,
          unit: '°C',
          required: true,
        },
      ],
    })
  })
})

describe('maintenance schedule detail', () => {
  it('shows the plan and pauses the schedule', async () => {
    let s: PmScheduleDetail = {
      id: 's1',
      name: 'AC filter cleaning',
      frequency: 'WEEKLY',
      intervalDays: null,
      daysOfWeek: [1, 4],
      dayOfMonth: null,
      timeOfDay: '10:00',
      triggerType: 'TIME',
      meter: null,
      meterInterval: null,
      meterThreshold: null,
      nextDueReading: null,
      lastTriggeredReading: null,
      restaurant: R1,
      asset: null,
      procedure: null,
      assignedUser: ravi,
      assignedTeam: null,
      priority: 'MEDIUM',
      category: 'AC',
      active: true,
      nextDueAt: '2026-10-05T04:30:00.000Z',
      compliance: 80,
      description: null,
      estimatedMinutes: 30,
      leadTimeDays: 1,
      startDate: '2026-10-01',
      endDate: null,
      lastGeneratedAt: null,
      upcoming: ['2026-10-05', '2026-10-08'],
      recentWorkOrders: [],
      can: { edit: true, delete: true },
    }
    let activeBody: unknown
    const { container } = renderAt('/maintenance/s1', admin, (method, path, body) => {
      if (method === 'GET' && path === '/pm-schedules/s1') return json({ data: s })
      if (method === 'PUT' && path === '/pm-schedules/s1/active') {
        activeBody = body
        s = { ...s, active: false, upcoming: [] }
        return json({ data: s })
      }
      return undefined
    })
    expect(await screen.findByRole('heading', { name: 'AC filter cleaning' })).toBeInTheDocument()
    expect(screen.getByText('Weekly on Mon, Thu at 10:00')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    await expectAccessible(container)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(activeBody).toEqual({ active: false }))
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(within(container).getByText('Paused. Resume to plan new dates.')).toBeInTheDocument()
  })
})

describe('meter-based maintenance schedule', () => {
  const asset = {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Generator',
    assetCode: 'AST-0001',
  }
  const meter = { id: '66666666-6666-4666-8666-666666666666', name: 'Runtime', unit: 'h' }
  const meterSchedule = (o: Partial<PmScheduleDetail> = {}): PmScheduleDetail => ({
    id: 's2',
    name: 'Generator service',
    frequency: 'MONTHLY',
    intervalDays: null,
    daysOfWeek: [],
    dayOfMonth: 1,
    timeOfDay: null,
    triggerType: 'METER',
    meter: { ...meter, currentValue: 1_230 },
    meterInterval: 500,
    meterThreshold: null,
    nextDueReading: 1_500,
    lastTriggeredReading: 1_005,
    restaurant: R1,
    asset,
    procedure: null,
    assignedUser: null,
    assignedTeam: null,
    priority: 'HIGH',
    category: 'ELECTRICAL',
    active: true,
    nextDueAt: null,
    compliance: null,
    description: null,
    estimatedMinutes: null,
    leadTimeDays: 0,
    startDate: '2026-10-01',
    endDate: null,
    lastGeneratedAt: null,
    upcoming: [],
    recentWorkOrders: [],
    can: { edit: true, delete: true },
    ...o,
  })

  it('shows the meter rule and the next due reading, and saves it unchanged', async () => {
    const s = meterSchedule()
    let saved: unknown
    const { container } = renderAt('/maintenance/s2', admin, (method, path, body) => {
      if (method === 'GET' && path === '/pm-schedules/s2') return json({ data: s })
      if (method === 'PUT' && path === '/pm-schedules/s2') {
        saved = body
        return json({ data: s })
      }
      if (path === '/restaurants') return json({ data: [{ ...R1, code: 'R1', status: 'ACTIVE' }] })
      if (path === `/assets/${asset.id}/meters`)
        return json({
          data: [
            {
              ...meter,
              type: 'RUNTIME_HOURS',
              currentValue: 1_230,
              previousValue: 1_005,
              lastReadingAt: null,
              readings: [],
              can: { read: true, manage: true },
            },
          ],
        })
      return undefined
    })
    expect(await screen.findByRole('heading', { name: 'Generator service' })).toBeInTheDocument()
    expect(screen.getByText('Every 500 h')).toBeInTheDocument()
    expect(screen.getByText('Next due at 1,500 h')).toBeInTheDocument()
    expect(screen.getByText('Current reading: 1,230 h')).toBeInTheDocument()
    expect(screen.getByText('Last work order at 1,005 h')).toBeInTheDocument()
    await expectAccessible(container)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('combobox', { name: 'Create work orders' })).toHaveTextContent(
      'From meter readings',
    )
    expect(within(dialog).queryByText('Repeat')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(saved).toMatchObject({
        triggerType: 'METER',
        assetId: asset.id,
        meterId: meter.id,
        meterInterval: 500,
      }),
    )
    expect((saved as { meterThreshold?: number }).meterThreshold).toBeUndefined()
  })

  it('a reached one-time threshold reads as done', async () => {
    const s = meterSchedule({
      meterInterval: null,
      meterThreshold: 10_000,
      nextDueReading: null,
      lastTriggeredReading: 10_020,
      active: false,
    })
    renderAt('/maintenance/s2', admin, (method, path) =>
      method === 'GET' && path === '/pm-schedules/s2' ? json({ data: s }) : undefined,
    )
    expect(await screen.findByText('At 10,000 h')).toBeInTheDocument()
    expect(
      screen.getByText('Done: the reading was reached and no more work orders are due.'),
    ).toBeInTheDocument()
  })
})

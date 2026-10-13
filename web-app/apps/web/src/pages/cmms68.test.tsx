import type {
  AuthUser,
  CalendarItem,
  ChecklistItemDto,
  WorkOrderActions,
  WorkOrderDetail,
} from '@maintainx/shared'
import { QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

/* Phases 6–8 in the browser: evidence, richer checklists, the calendar. */

const R1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Restaurant 1' }
const ravi = { id: '22222222-2222-4222-8222-222222222222', firstName: 'Ravi', lastName: 'Kumar' }
const priya = { id: '33333333-3333-4333-8333-333333333333', firstName: 'Priya', lastName: 'Shah' }

const admin = makeUser({
  id: priya.id,
  firstName: 'Priya',
  permissions: ['work_orders:view', 'work_orders:edit', 'work_orders:assign', 'maintenance:view'],
})
const worker = makeUser({
  id: ravi.id,
  firstName: 'Ravi',
  roleKind: 'WORKER',
  roles: [{ id: 'r3', name: 'Worker', systemKey: 'WORKER' }],
  permissions: ['work_orders:view', 'work_orders:complete'],
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
  upload: true,
  message: true,
  checklist: true,
  parts: false,
}

const step = (o: Partial<ChecklistItemDto>): ChecklistItemDto => ({
  showIf: null,
  id: 's1',
  position: 1,
  title: 'Power off',
  instruction: null,
  inputType: 'CHECKBOX',
  unit: null,
  minValue: null,
  maxValue: null,
  required: true,
  options: [],
  requirePhoto: false,
  attachments: [],
  result: null,
  numericValue: null,
  textValue: null,
  note: null,
  completedAt: null,
  completedBy: null,
  correctiveWorkOrder: null,
  ...o,
})

function workOrder(o: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    code: 'WO-000021',
    title: 'AC maintenance',
    type: 'PREVENTIVE',
    category: 'AC',
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
    minutesWorked: 12,
    timerRunning: true,
    startedAt: null,
    completedAt: null,
    closedAt: null,
    holdReason: null,
    completionNotes: null,
    reopenCount: 0,
    createdBy: priya,
    closedBy: null,
    procedure: { id: 'p1', name: 'AC maintenance' },
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

async function expectAccessible(container: HTMLElement) {
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
})
afterEach(() => setAccessToken(null))

describe('technician task: evidence and checklist', () => {
  it('shows required before/after, uploads a stage, and answers the new step types', async () => {
    let current = workOrder({
      checklist: [
        step({}),
        step({
          id: 's2',
          position: 2,
          title: 'Filter state',
          inputType: 'MULTIPLE_CHOICE',
          options: ['Clean', 'Dirty'],
        }),
        step({ id: 's3', position: 3, title: 'Coil photo', inputType: 'PHOTO' }),
      ],
      completionCheck: {
        stepsLeft: 3,
        needsBeforePhoto: true,
        needsAfterPhoto: true,
        subWorkOrdersOpen: 0,
        evidence: { BEFORE: 0, DURING: 0, AFTER: 0 },
        reportRequired: true,
        verificationRequired: true,
      },
    })
    const answers: Array<Record<string, unknown>> = []
    const uploads: string[] = []
    const { container } = renderAt(`/w/tasks/${current.id}`, worker, (method, path, body) => {
      if (method === 'GET' && path === `/work-orders/${current.id}`) return json({ data: current })
      if (method === 'PUT' && path.includes('/checklist/')) {
        answers.push(body)
        return json({ data: current })
      }
      if (method === 'POST' && path.endsWith('/attachments')) {
        uploads.push(path)
        current = {
          ...current,
          attachments: [
            {
              id: 'a1',
              kind: 'PHOTO',
              stage: 'BEFORE',
              caption: null,
              fileName: 'before.png',
              mimeType: 'image/png',
              sizeBytes: 1,
              url: '/files/a1',
              thumbUrl: null,
              removed: false,
              uploadedBy: ravi,
              createdAt: new Date().toISOString(),
            },
          ],
          completionCheck: {
            ...current.completionCheck,
            needsBeforePhoto: false,
            evidence: { BEFORE: 1, DURING: 0, AFTER: 0 },
          },
        }
        return json({ data: current })
      }
      return undefined
    })

    expect(await screen.findByRole('heading', { name: 'AC maintenance' })).toBeInTheDocument()
    const before = screen.getByRole('region', { name: 'Before' })
    expect(within(before).getByText('Required')).toBeInTheDocument()
    expect(screen.getByText('5 things left before you can complete')).toBeInTheDocument()
    await expectAccessible(container)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Power off/ }))
    await waitFor(() => expect(answers[0]).toMatchObject({ result: 'PASS' }))
    await user.click(screen.getByRole('radio', { name: 'Dirty' }))
    await waitFor(() => expect(answers[1]).toMatchObject({ textValue: 'Dirty' }))

    // Evidence through the picker (jsdom has no live camera).
    const png = new File(['x'], 'before.png', { type: 'image/png' })
    await user.upload(screen.getByTestId('evidence-input-BEFORE'), png)
    await waitFor(() => expect(uploads).toContain(`/work-orders/${current.id}/attachments`))
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Before' })).queryByText('Required'),
      ).toBeNull(),
    )
  })
})

describe('calendar', () => {
  const today = new Date()
  const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 30)
  const items: CalendarItem[] = [
    {
      kind: 'work_order',
      id: 'w1',
      code: 'WO-000031',
      title: 'Clean AC filters',
      status: 'SCHEDULED',
      priority: 'HIGH',
      type: 'PREVENTIVE',
      at: at.toISOString(),
      scheduledStart: at.toISOString(),
      dueDate: null,
      estimatedMinutes: 60,
      overdue: false,
      restaurant: R1,
      asset: null,
      assignedUser: ravi,
      assignedTeam: null,
      canReschedule: true,
    },
    {
      kind: 'forecast',
      id: 'pm1:x',
      scheduleId: 'pm1',
      name: 'Fire extinguisher check',
      date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
      priority: 'MEDIUM',
      restaurant: R1,
      asset: null,
      assignedUser: null,
      assignedTeam: null,
    },
  ]

  it('shows jobs and planned PM, and moves a job by drag-and-drop', async () => {
    let moved: Record<string, unknown> | undefined
    const { container } = renderAt('/calendar', admin, (method, path, body) => {
      if (path === '/calendar') return json({ data: items })
      if (path === '/restaurants') return json({ data: [] })
      if (path === '/teams') return json({ data: [] })
      if (path === '/users/options') return json({ data: [] })
      if (method === 'POST' && path === '/work-orders/w1/schedule') {
        moved = body
        return json({ data: {} })
      }
      return undefined
    })
    const chip = await screen.findByRole('link', { name: /Clean AC filters/ })
    expect(screen.getByRole('link', { name: /Fire extinguisher check/ })).toHaveAttribute(
      'href',
      '/maintenance/pm1',
    )
    await expectAccessible(container)

    // Drag onto the next day: same time of day, one day later.
    const next = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1)
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    const store = new Map<string, string>()
    const dataTransfer = {
      setData: (k: string, v: string) => store.set(k, v),
      getData: (k: string) => store.get(k) ?? '',
      get types() {
        return [...store.keys()]
      },
      effectAllowed: 'move',
      dropEffect: 'move',
    }
    // The next day may be in the following week; switch to month view so it's on screen.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Month' }))
    const target = await screen.findByLabelText(key)
    fireEvent.dragStart(await screen.findByRole('link', { name: /Clean AC filters/ }), {
      dataTransfer,
    })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    await waitFor(() => expect(moved).toBeDefined())
    expect(new Date(moved!.scheduledStart as string).getTime()).toBe(
      new Date(next.getFullYear(), next.getMonth(), next.getDate(), 9, 30).getTime(),
    )
    expect(chip).toBeDefined()
  })
})

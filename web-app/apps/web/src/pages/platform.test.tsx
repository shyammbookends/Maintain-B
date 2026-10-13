import type {
  AuditLogDto,
  AuthUser,
  DocumentDto,
  NotificationDto,
  PagedResponse,
  ReportResult,
  ReportScheduleDto,
} from '@maintainx/shared'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '@/app/providers'
import i18n from '@/i18n'
import { appRoutes } from '@/routes/app.routes'
import { setAccessToken } from '@/services/http'
import { installFakeAuthApi, json, makeUser } from '@/test/fake-auth-api'

const R1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Restaurant 1' }
const WO = '44444444-4444-4444-8444-444444444444'
const priya = { id: '33333333-3333-4333-8333-333333333333', firstName: 'Priya', lastName: 'Shah' }

const admin = makeUser({
  id: priya.id,
  firstName: 'Priya',
  isSuperAdmin: true,
  permissions: [
    'reports:view',
    'reports:export',
    'documents:view',
    'documents:create',
    'audit_logs:view',
    'audit_logs:export',
    'work_orders:view',
  ],
})
const worker = makeUser({
  firstName: 'Ravi',
  roleKind: 'WORKER',
  roles: [{ id: 'r3', name: 'Worker', systemKey: 'WORKER' }],
  permissions: ['work_orders:view'],
})

const paged = <T,>(data: T[]): PagedResponse<T> => ({
  data,
  meta: { page: 1, pageSize: 50, total: data.length, totalPages: 1 },
})

type Routes = NonNullable<NonNullable<Parameters<typeof installFakeAuthApi>[0]>['routes']>

function renderAt(path: string, user: AuthUser, routes: Routes) {
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

const note = (o: Partial<NotificationDto> = {}): NotificationDto => ({
  id: 'n1',
  type: 'TASK_ASSIGNED',
  title: 'WO-000007 · Fix tap',
  body: null,
  actionUrl: `/work-orders/${WO}`,
  priority: 'MEDIUM',
  readAt: null,
  createdAt: new Date().toISOString(),
  ...o,
})

describe('notifications', () => {
  it('worker alerts tab: badge, list, opening one marks it read and goes to the task', async () => {
    let readCalled = false
    const { router, container } = renderAt('/w/notifications', worker, (method, path) => {
      if (path === '/notifications/unread-count')
        return json({ data: { count: readCalled ? 0 : 1 } })
      if (path === '/notifications') return json({ ...paged([note()]), unread: 1 })
      if (method === 'POST' && path === '/notifications/n1/read') {
        readCalled = true
        return json({ data: note({ readAt: new Date().toISOString() }) })
      }
      if (path === `/work-orders/${WO}`)
        return json({ error: { code: 'NOT_FOUND', message: 'x' } }, 404)
      return undefined
    })
    expect(await screen.findByText('WO-000007 · Fix tap')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(await within(nav).findByText('1')).toBeInTheDocument()
    await expectAccessible(container)

    await userEvent.setup().click(screen.getByRole('button', { name: /WO-000007 · Fix tap/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/tasks/${WO}`))
    await waitFor(() => expect(readCalled).toBe(true))
  })

  it('admin bell shows the latest and marks all read', async () => {
    let readAll = false
    renderAt('/notifications', admin, (method, path) => {
      if (path === '/notifications/unread-count') return json({ data: { count: readAll ? 0 : 2 } })
      if (path === '/notifications')
        return json({
          ...paged([
            note(),
            note({
              id: 'n2',
              type: 'LOW_STOCK',
              title: 'Door gasket',
              actionUrl: '/inventory/parts/x',
            }),
          ]),
          unread: readAll ? 0 : 2,
        })
      if (method === 'POST' && path === '/notifications/read-all') {
        readAll = true
        return json({ data: { updated: 2 } })
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    const pop = await screen.findByRole('dialog')
    expect(within(pop).getByText('Door gasket')).toBeInTheDocument()
    await user.click(within(pop).getByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(readAll).toBe(true))
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })
})

describe('documents', () => {
  it('uploads a licence with an expiry date', async () => {
    const doc: DocumentDto = {
      id: 'd1',
      title: 'FSSAI licence',
      docType: 'LICENSE',
      ownerType: 'RESTAURANT',
      owner: R1,
      restaurant: R1,
      fileName: 'fssai.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 120_000,
      issuedAt: null,
      expiresAt: '2026-10-20',
      expiry: 'expiring',
      uploadedBy: priya,
      createdAt: new Date().toISOString(),
      url: '/api/v1/files?x',
      downloadUrl: '/api/v1/files?y',
      can: { edit: true, delete: true },
    }
    let uploaded = false
    renderAt(`/restaurants/${R1.id}?tab=documents`, admin, (method, path) => {
      if (path === `/restaurants/${R1.id}`)
        return json({
          data: {
            ...R1,
            code: 'R1',
            status: 'ACTIVE',
            addressLine1: null,
            addressLine2: null,
            city: null,
            state: null,
            postalCode: null,
            phone: null,
            email: null,
            opensAt: null,
            closesAt: null,
            timezone: 'Asia/Kolkata',
            counts: { locations: 0, assets: 0, users: 0, teams: 0, openWorkOrders: 0 },
          },
        })
      if (path === '/documents' && method === 'GET') return json(paged(uploaded ? [doc] : []))
      if (path === '/documents' && method === 'POST') {
        uploaded = true
        return json({ data: doc }, 201)
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Upload document/ }))
    const dialog = await screen.findByRole('dialog')
    const file = new File(['%PDF-1.4'], 'fssai.pdf', { type: 'application/pdf' })
    await user.upload(within(dialog).getByTestId('document-file'), file)
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue('fssai')
    await user.clear(within(dialog).getByLabelText(/^Title/))
    await user.type(within(dialog).getByLabelText(/^Title/), 'FSSAI licence')
    await user.type(within(dialog).getByLabelText(/^Expires on/), '2026-10-20')
    await user.click(within(dialog).getByRole('button', { name: 'Upload document' }))
    expect(await screen.findByText('FSSAI licence')).toBeInTheDocument()
    expect(screen.getByText(/Expires/)).toBeInTheDocument()
  })
})

describe('reports', () => {
  it('shows summary and a translated table', async () => {
    const result: ReportResult = {
      key: 'work-orders-completed',
      columns: [
        { key: 'code', label: 'code', type: 'text' },
        { key: 'priority', label: 'priority', type: 'text' },
        { key: 'hoursWorked', label: 'hoursWorked', type: 'hours' },
        { key: 'onTime', label: 'onTime', type: 'text' },
      ],
      rows: [{ code: 'WO-000001', priority: 'HIGH', hoursWorked: 1.5, onTime: 'yes' }],
      summary: [{ label: 'onTimeRate', value: 100, type: 'percent' }],
      truncated: false,
      generatedAt: new Date().toISOString(),
    }
    let query = ''
    const { container } = renderAt(
      '/reports/work-orders-completed?from=2026-09-01&to=2026-09-30',
      admin,
      (_m, path, _b, q) => {
        if (path === '/reports/work-orders-completed') {
          query = q.toString()
          return json({ data: result })
        }
        if (path === '/restaurants') return json({ data: [] })
        return undefined
      },
    )
    expect(
      await screen.findByRole('heading', { name: 'Completed work orders' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('100%')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Hours worked' })).toBeInTheDocument()
    expect(within(table).getByText('High')).toBeInTheDocument()
    expect(within(table).getByText('Yes')).toBeInTheDocument()
    expect(query).toBe('from=2026-09-01&to=2026-09-30')
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeEnabled()
    await expectAccessible(container)
  })
})

describe('report PDF export and schedules', () => {
  const result: ReportResult = {
    key: 'work-order-summary',
    columns: [{ key: 'restaurant', label: 'restaurant', type: 'text' }],
    rows: [{ restaurant: 'Restaurant 1' }],
    summary: [],
    truncated: false,
    generatedAt: new Date().toISOString(),
  }
  const ravi = { id: '22222222-2222-4222-8222-222222222222', firstName: 'Ravi', lastName: 'Kumar' }

  it('downloads the PDF and schedules a weekly email', async () => {
    const created = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:report')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    let pdfQuery = ''
    let schedules: ReportScheduleDto[] = []
    const { container } = renderAt(
      '/reports/work-order-summary?from=2026-09-01&to=2026-09-30',
      admin,
      (method, path, body, q) => {
        if (path === '/reports/work-order-summary') return json({ data: result })
        if (path === '/reports/work-order-summary/pdf') {
          pdfQuery = q.toString()
          return new Response(new Blob(['%PDF-1.7 test']), {
            headers: { 'Content-Type': 'application/pdf' },
          })
        }
        if (path === '/restaurants')
          return json({ data: [{ ...R1, code: 'R1', status: 'ACTIVE' }] })
        if (path === '/users/options') return json({ data: [{ ...ravi, role: 'User' }] })
        if (method === 'GET' && path === '/report-schedules') return json({ data: schedules })
        if (method === 'POST' && path === '/report-schedules') {
          created(body)
          const s: ReportScheduleDto = {
            id: 'rs1',
            reportKey: 'work-order-summary',
            restaurant: R1,
            filters: {},
            frequency: 'WEEKLY',
            timeOfDay: '08:00',
            dayOfWeek: 1,
            dayOfMonth: null,
            format: 'PDF',
            recipientUsers: [ravi],
            recipientEmails: ['owner@example.com'],
            active: true,
            nextRunAt: '2026-10-12T02:30:00.000Z',
            lastRunAt: null,
            lastRun: null,
            createdBy: priya,
            timeZone: 'Asia/Kolkata',
          }
          schedules = [s]
          return json({ data: s }, 201)
        }
        return undefined
      },
    )
    expect(await screen.findByRole('heading', { name: 'Work order summary' })).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Export PDF/ }))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())
    expect(pdfQuery).toBe('from=2026-09-01&to=2026-09-30')

    await user.click(screen.getByRole('button', { name: /Schedule/ }))
    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('This report isn’t emailed yet.')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: /New schedule/ }))
    await user.click(await within(sheet).findByRole('checkbox', { name: /Ravi Kumar/ }))
    await user.type(within(sheet).getByLabelText('Other email addresses'), 'owner@example.com')
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith({
        reportKey: 'work-order-summary',
        restaurantId: R1.id,
        filters: {},
        frequency: 'WEEKLY',
        timeOfDay: '08:00',
        dayOfWeek: 1,
        format: 'PDF',
        recipientUserIds: [ravi.id],
        recipientEmails: ['owner@example.com'],
        active: true,
      }),
    )
    expect(await within(sheet).findByText('Every Monday at 08:00')).toBeInTheDocument()
    expect(within(sheet).getByText(/2 recipients/)).toBeInTheDocument()
    await expectAccessible(container)
  })
})

describe('audit log', () => {
  it('lists entries and opens the before/after detail', async () => {
    const entry: AuditLogDto = {
      id: 'a1',
      action: 'work_order.assigned',
      entityType: 'WORK_ORDER',
      entityId: WO,
      actor: priya,
      restaurant: R1,
      oldValue: { assignedUserId: null },
      newValue: { assignedUserId: 'u2' },
      metadata: null,
      ip: '10.0.0.5',
      userAgent: 'Chrome',
      requestId: 'req-1',
      createdAt: new Date().toISOString(),
    }
    renderAt('/audit', admin, (_m, path) => {
      if (path === '/audit-logs') return json(paged([entry]))
      if (path === '/restaurants') return json({ data: [] })
      if (path === '/users/options') return json({ data: [] })
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /work_order.assigned/ }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('10.0.0.5')).toBeInTheDocument()
    expect(within(sheet).getByText('Before')).toBeInTheDocument()
    expect(within(sheet).getByText(/"assignedUserId": "u2"/)).toBeInTheDocument()
  })
})

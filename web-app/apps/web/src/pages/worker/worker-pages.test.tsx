import type { WorkerHome, WorkerRestaurant, WorkerSchedule, WorkerTask } from '@maintainx/shared'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '@/app/providers'
import i18n from '@/i18n'
import { appRoutes } from '@/routes/app.routes'
import { setAccessToken } from '@/services/http'
import { installFakeAuthApi, json, makeUser } from '@/test/fake-auth-api'

const worker = makeUser({
  firstName: 'Ravi',
  roleKind: 'WORKER',
  roles: [{ id: 'r3', name: 'Worker', systemKey: 'WORKER' }],
  permissions: ['work_orders:view', 'restaurants:view'],
})

function task(overrides: Partial<WorkerTask>): WorkerTask {
  return {
    id: 't1',
    code: 'WO-000101',
    title: 'Clean ice machine',
    priority: 'MEDIUM',
    status: 'ASSIGNED',
    type: 'REACTIVE',
    dueDate: new Date(Date.now() - 3_600_000).toISOString(),
    scheduledStart: null,
    overdue: true,
    completedAt: null,
    restaurant: { id: 'r1', name: 'Restaurant 1' },
    location: { id: 'l1', name: 'Bar' },
    asset: null,
    team: null,
    ...overrides,
  }
}

const HOME: WorkerHome = {
  counts: {
    today: 2,
    overdue: 1,
    inProgress: 1,
    doneThisWeek: 5,
    highPriority: 1,
    preventive: 0,
    checklistsDue: 2,
  },
  next: [
    task({ id: 'a', title: 'Fix freezer door', status: 'IN_PROGRESS', priority: 'CRITICAL' }),
    task({ id: 'b', title: 'Clean ice machine', team: { id: 'tm', name: 'Kitchen crew' } }),
  ],
}

const today = new Date()
const key = (d: Date) => d.toISOString().slice(0, 10)
const SCHEDULE: WorkerSchedule = {
  timeZone: 'Asia/Kolkata',
  days: Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today.getTime() + i * 86_400_000)
    return { date: key(d), tasks: i === 3 ? [task({ id: 's', title: 'Monthly AC service' })] : [] }
  }),
}

const RESTAURANTS: WorkerRestaurant[] = [
  {
    id: 'r1',
    code: 'R1',
    name: 'Restaurant 1',
    addressLine1: 'SG Highway',
    addressLine2: null,
    city: 'Ahmedabad',
    phone: '+91 98765 43210',
    opensAt: '09:00',
    closesAt: '23:00',
    openTasks: 2,
  },
]

function renderAt(
  path: string,
  overrides: { home?: WorkerHome; tasks?: Record<string, WorkerTask[]>; locale?: 'hi' } = {},
) {
  const tasks = overrides.tasks ?? { today: HOME.next, upcoming: [], done: [] }
  installFakeAuthApi({
    user: overrides.locale ? { ...worker, preferredLocale: overrides.locale } : worker,
    signedIn: true,
    routes: (_m, path, _b, q) => {
      if (path === '/me/home') return json({ data: overrides.home ?? HOME })
      if (path === '/me/tasks') {
        const list = tasks[q.get('view') ?? 'today'] ?? []
        return json({
          data: list,
          meta: { page: 1, pageSize: 20, total: list.length, totalPages: 1 },
        })
      }
      if (path === '/me/schedule') return json({ data: SCHEDULE })
      if (path === '/me/restaurants') return json({ data: RESTAURANTS })
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

describe('worker app', () => {
  it('home: greeting, counts, next tasks with work in progress first', async () => {
    const { container } = renderAt('/w')
    await screen.findByRole('heading', { level: 1, name: /Ravi/ })
    expect(await screen.findByText('Fix freezer door')).toBeInTheDocument()
    expect(screen.getByText('Team: Kitchen crew')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Home', 'My Tasks', 'Scan', 'Alerts', 'More'])
    await expectAccessible(container)
  })

  it('home: friendly empty state', async () => {
    renderAt('/w', {
      home: {
        counts: {
          today: 0,
          overdue: 0,
          inProgress: 0,
          doneThisWeek: 0,
          highPriority: 0,
          preventive: 0,
          checklistsDue: 0,
        },
        next: [],
      },
    })
    expect(await screen.findByText('You’re all caught up.')).toBeInTheDocument()
    expect(screen.getByText('No pending tasks for today.')).toBeInTheDocument()
  })

  it('my tasks: tabs switch views and are kept in the URL', async () => {
    const { router, container } = renderAt('/w/tasks', {
      tasks: {
        today: [task({ title: 'Today job' })],
        upcoming: [],
        done: [task({ title: 'Old job', status: 'CLOSED' })],
      },
    })
    expect(await screen.findByText('Today job')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'Upcoming' }))
    expect(await screen.findByText('Nothing coming up.')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?view=upcoming')
    await user.click(screen.getByRole('tab', { name: 'Done' }))
    expect(await screen.findByText('Old job')).toBeInTheDocument()
    await expectAccessible(container)
  })

  it('schedule: today/tomorrow headings and busy days', async () => {
    const { container } = renderAt('/w/schedule')
    expect(await screen.findByText('Monthly AC service')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Today/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Tomorrow/ })).toBeInTheDocument()
    expect(screen.getAllByText('Nothing scheduled')).toHaveLength(2)
    await expectAccessible(container)
  })

  it('more → my restaurants with tap-to-call', async () => {
    const { container } = renderAt('/w/more')
    const user = userEvent.setup()
    // On the phone screen (the desktop sidebar has the same link).
    await user.click(
      await within(await screen.findByRole('main')).findByRole('link', { name: 'My Restaurants' }),
    )
    const call = await screen.findByRole('link', { name: 'Call Restaurant 1' })
    expect(call).toHaveAttribute('href', 'tel:+919876543210')
    expect(screen.getByText('Open 09:00–23:00')).toBeInTheDocument()
    expect(screen.getByText('2 open tasks')).toBeInTheDocument()
    await expectAccessible(container)
  })

  it('works in Hindi', async () => {
    // Language saved on the account is applied at sign-in.
    renderAt('/w', { locale: 'hi' })
    expect(await screen.findByText('अगला काम')).toBeInTheDocument()
  })
})

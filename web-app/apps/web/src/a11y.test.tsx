/**
 * Automated accessibility checks (axe-core) on the design-system building
 * blocks, rendered the way pages use them. Colour contrast is checked
 * separately in styles/tokens.test.ts (jsdom cannot compute colours).
 */
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { ClipboardList, Home } from 'lucide-react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '@/app/providers'
import i18n from '@/i18n'
import { AdminLayout } from '@/layouts/AdminLayout'
import { BrandMark } from '@/layouts/BrandMark'
import { WorkerLayout } from '@/layouts/WorkerLayout'
import { TaskCard } from '@/components/worker/TaskCard'
import { ResultToggle } from '@/components/worker/ResultToggle'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { FormsPage } from '@/pages/dev/design/FormsPage'
import { DataTablePage } from '@/pages/dev/design/DataTablePage'
import { FoundationsPage } from '@/pages/dev/design/FoundationsPage'
import { ApiError } from '@/services/http'

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  })
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  )
  expect(summary).toEqual([])
}

function withApp(ui: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AppProviders queryClient={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </AppProviders>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('accessibility (axe-core)', () => {
  it('admin shell with a page inside', async () => {
    const { container } = withApp(
      <Routes>
        <Route
          element={
            <AdminLayout
              brand={<BrandMark />}
              nav={[
                {
                  key: 'g',
                  label: 'Operations',
                  items: [{ key: 'h', label: 'Home', to: '/', icon: Home, end: true }],
                },
              ]}
            />
          }
        >
          <Route index element={<FoundationsPage />} />
        </Route>
      </Routes>,
    )
    await expectNoViolations(container)
  })

  it('worker shell with task list and checklist toggle', async () => {
    // WorkerLayout reads route handles, so it needs a data router (as in the app).
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <WorkerLayout
            tabs={[
              { key: 'h', label: 'Home', to: '/', icon: Home, end: true },
              { key: 't', label: 'My Tasks', to: '/tasks', icon: ClipboardList, badge: 3 },
            ]}
          />
        ),
        children: [
          {
            index: true,
            element: (
              <div className="grid gap-2 p-4">
                <h1>Tasks</h1>
                <TaskCard
                  to="/tasks/1"
                  code="WO-000001"
                  title="Walk-in freezer not holding temperature"
                  restaurant="Restaurant 1"
                  location="Storage"
                  priority="CRITICAL"
                  status="ASSIGNED"
                  dueDate={new Date(Date.now() - 3_600_000)}
                />
                <p id="step">Door seal</p>
                <ResultToggle labelledBy="step" value="PASS" onChange={() => {}} />
              </div>
            ),
          },
        ],
      },
    ])
    const client = new QueryClient()
    const { container } = render(
      <AppProviders queryClient={client}>
        <RouterProvider router={router} />
      </AppProviders>,
    )
    await screen.findByRole('navigation', { name: 'Main navigation' })
    await expectNoViolations(container)
  })

  it('worker shell hides the tab bar for focused routes', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <WorkerLayout tabs={[{ key: 'h', label: 'Home', to: '/', icon: Home }]} />,
          children: [
            { index: true, element: <h1>Home</h1> },
            { path: 'task', handle: { hideWorkerNav: true }, element: <h1>Task</h1> },
          ],
        },
      ],
      { initialEntries: ['/task'] },
    )
    render(<RouterProvider router={router} />)
    await screen.findByRole('heading', { name: 'Task' })
    // The phone tab bar is gone (the desktop sidebar, hidden by CSS on phones, stays).
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  })

  it('form with validation errors showing', async () => {
    const { container } = withApp(<FormsPage />)
    screen.getByRole('button', { name: 'Create' }).click()
    await screen.findAllByRole('alert')
    await expectNoViolations(container)
  })

  it('data table with toolbar, rows and pagination', async () => {
    const { container } = withApp(<DataTablePage />, '/design/data-table')
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(2), {
      timeout: 3000,
    })
    await expectNoViolations(container)
  })

  it('empty and error states', async () => {
    const { container } = withApp(
      <main>
        <EmptyState
          icon={ClipboardList}
          title="You’re all caught up."
          description="No pending tasks for today."
        />
        <ErrorState
          error={new ApiError(500, 'INTERNAL_ERROR', 'x', undefined, 'abc')}
          onRetry={() => {}}
        />
      </main>,
    )
    await expectNoViolations(container)
  })
})

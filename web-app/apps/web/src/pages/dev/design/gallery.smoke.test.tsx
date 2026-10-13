/**
 * Loads every gallery route through the real (lazy) route config and checks
 * that it renders and passes axe. Catches broken imports, runtime errors and
 * accessibility regressions across all design-system components at once.
 */
import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '@/app/providers'
import i18n from '@/i18n'
import { designRoutes } from '@/routes/design.routes'

async function expectAccessible(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([])
}

function renderAt(path: string) {
  const router = createMemoryRouter(designRoutes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

const PAGES: Array<[string, string | RegExp]> = [
  ['/design', 'Colour & type'],
  ['/design/components', 'Buttons & inputs'],
  ['/design/forms', 'Forms'],
  ['/design/data-table', 'Data table'],
  ['/design/overlays', 'Overlays'],
  ['/design/feedback', 'Feedback & states'],
  ['/design/worker', /Good morning/],
  ['/design/worker/tasks', 'My Tasks'],
  ['/design/worker/schedule', 'Schedule'],
  ['/design/worker/notifications', 'Notifications'],
  ['/design/worker/more', 'More'],
]

describe('design gallery', () => {
  it.each(PAGES)('%s renders and is accessible', async (path, heading) => {
    const { container } = renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    await expectAccessible(container)
  })

  it('worker task flow: start → checklist → complete enabled', async () => {
    const user = userEvent.setup()
    const { container } = renderAt('/design/worker/tasks/3')
    await screen.findByRole('heading', { level: 1, name: 'WO-001058' })
    // Focused flow: no tab bar.
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Start task/ }))
    const groups = screen.getAllByRole('radiogroup')
    expect(groups).toHaveLength(4)
    const complete = screen.getByRole('button', { name: 'Complete task' })
    expect(complete).toBeDisabled()

    for (const radio of screen.getAllByRole('radio', { name: 'Pass' })) await user.click(radio)
    expect(complete).toBeEnabled()
    await expectAccessible(container)
  })
})

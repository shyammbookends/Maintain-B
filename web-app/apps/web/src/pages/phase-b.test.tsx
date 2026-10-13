import {
  type AuthUser,
  type ChecklistItemDto,
  type CustomFieldDto,
  type LabelWithUsage,
  type PartDetail,
} from '@maintainx/shared'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '@/app/providers'
import { Checklist } from '@/components/checklists/Checklist'
import i18n from '@/i18n'
import { appRoutes } from '@/routes/app.routes'
import { setAccessToken } from '@/services/http'
import { installFakeAuthApi, json, makeUser } from '@/test/fake-auth-api'

/* Phase B in the browser: sections & conditions, library, labels, custom fields, stock transfer. */

const R1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Restaurant 1' }
const R2 = { id: '22222222-2222-4222-8222-222222222222', name: 'Restaurant 2' }
const PART_ID = '55555555-5555-4555-8555-555555555555'

const admin = makeUser({
  firstName: 'Priya',
  restaurants: [
    { id: R1.id, code: 'R1', name: R1.name },
    { id: R2.id, code: 'R2', name: R2.name },
  ],
  permissions: [
    'work_orders:view',
    'work_orders:create',
    'procedures:view',
    'procedures:create',
    'settings:view',
    'settings:edit',
    'parts:view',
    'inventory:view',
    'inventory:edit',
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
  render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
})
afterEach(() => setAccessToken(null))

const item = (o: Partial<ChecklistItemDto>): ChecklistItemDto => ({
  id: 'x',
  position: 1,
  title: 'Step',
  instruction: null,
  inputType: 'PASS_FAIL_NA',
  unit: null,
  minValue: null,
  maxValue: null,
  required: true,
  options: [],
  requirePhoto: false,
  showIf: null,
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

describe('checklist sections and conditional steps', () => {
  const steps = (sealResult: ChecklistItemDto['result']) => [
    item({ id: 's1', position: 1, title: 'Condition', inputType: 'SECTION', required: false }),
    item({ id: 's2', position: 2, title: 'Door seals OK', result: sealResult }),
    item({
      id: 's3',
      position: 3,
      title: 'Photo of the damaged seal',
      inputType: 'PHOTO',
      showIf: { step: 2, answer: 'FAIL' },
    }),
  ]

  it('shows section headings and hides a follow-up until its answer matches', () => {
    const { rerender } = render(
      <MemoryRouter>
        <Checklist items={steps('PASS')} editable={false} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Condition' })).toBeInTheDocument()
    expect(screen.queryByText(/Photo of the damaged seal/)).not.toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <Checklist items={steps('FAIL')} editable={false} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Photo of the damaged seal/)).toBeInTheDocument()
    expect(screen.getByText('Shown because step 2 is “Fail”.')).toBeInTheDocument()
  })
})

describe('procedure library', () => {
  it('adds a ready-made restaurant procedure in the current language', async () => {
    let sent: { path: string; body: unknown } | undefined
    renderAt('/procedures', admin, (method, path, body) => {
      if (method === 'POST' && path.startsWith('/procedures/library/')) {
        sent = { path, body }
        return json({ data: { id: 'p1', name: 'Gas line safety check' } }, 201)
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Add from library/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Restaurant procedure library' })
    await user.click(within(dialog).getByRole('button', { name: 'Add Gas line safety check' }))
    await waitFor(() =>
      expect(sent).toEqual({
        path: '/procedures/library/gas-safety',
        body: { locale: 'en', restaurantId: R1.id },
      }),
    )
    expect(await within(dialog).findByRole('button', { name: /Open/ })).toBeInTheDocument()
  })
})

describe('labels and custom fields', () => {
  it('creates a label in settings', async () => {
    let labels: LabelWithUsage[] = []
    let posted: unknown
    renderAt('/settings?tab=labels', admin, (method, path, body) => {
      if (path === '/labels' && method === 'GET') return json({ data: labels })
      if (path === '/labels' && method === 'POST') {
        posted = body
        labels = [{ id: 'l1', name: 'Guest complaint', color: 'red', workOrders: 0 }]
        return json({ data: labels }, 201)
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add label' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add label' })
    await user.type(within(dialog).getByLabelText(/Name/), 'Guest complaint')
    await user.click(within(dialog).getByRole('radio', { name: 'Red' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posted).toEqual({ name: 'Guest complaint', color: 'red' }))
    expect(await screen.findByText('Guest complaint')).toBeInTheDocument()
  })

  it('sends labels and custom field values with a new work order', async () => {
    const fields: CustomFieldDto[] = [
      {
        id: '77777777-7777-4777-8777-777777777777',
        entity: 'WORK_ORDER',
        label: 'Bill number',
        type: 'TEXT',
        options: [],
        required: true,
        position: 0,
      },
    ]
    let sent: Record<string, unknown> | undefined
    renderAt('/work-orders', admin, (method, path, body, query) => {
      if (path === '/restaurants') return json({ data: [{ ...R1, code: 'R1' }] })
      if (path === '/custom-fields' && query.get('entity') === 'WORK_ORDER')
        return json({ data: fields })
      if (path === '/labels')
        return json({ data: [{ id: '88888888-8888-4888-8888-888888888888', name: 'Health inspection', color: 'blue', workOrders: 0 }] })
      if (method === 'POST' && path === '/work-orders') {
        sent = body
        return json({ error: { code: 'VALIDATION_ERROR', message: 'stop' } }, 400)
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /New work order/ }))
    const sheet = await screen.findByRole('dialog')
    await user.type(within(sheet).getByLabelText(/Title/), 'Hood fan noisy')
    // Required custom fields stay in view; labels live under "More options".
    await user.type(await within(sheet).findByLabelText(/Bill number/), 'B-17')
    await user.click(within(sheet).getByRole('button', { name: /More options/ }))
    await user.click(within(sheet).getByRole('checkbox', { name: 'Health inspection' }))
    await user.click(within(sheet).getByRole('button', { name: 'Create work order' }))
    await waitFor(() =>
      expect(sent).toMatchObject({
        customFields: { [fields[0]!.id]: 'B-17' },
        labelIds: ['88888888-8888-4888-8888-888888888888'],
      }),
    )
  })
})

describe('stock transfer', () => {
  it('moves stock from one restaurant to another', async () => {
    const level = (r: typeof R1, quantity: number) => ({
      restaurant: r,
      quantity,
      minStock: 0,
      minOverride: null,
      storageLocation: null,
      low: false,
      reserved: 0,
      available: quantity,
    })
    const p: PartDetail = {
      id: PART_ID,
      publicId: 'PARTQR123456',
      name: 'Door gasket',
      partNumber: 'GSK-200',
      sku: null,
      reorderQty: null,
      reservations: [],
      category: null,
      unit: 'pcs',
      unitCost: 450,
      minStock: 0,
      preferredVendor: null,
      totalQuantity: 5,
      lowCount: 0,
      stock: null,
      description: null,
      storageLocation: null,
      stockLevels: [level(R1, 5), level(R2, 0)],
      transactions: [],
      can: { edit: true, delete: false, adjust: true },
    }
    let body: unknown
    renderAt(`/inventory/parts/${PART_ID}`, admin, (method, path, b) => {
      if (method === 'GET' && path === `/parts/${PART_ID}`) return json({ data: p })
      if (path === '/restaurants')
        return json({ data: [{ ...R1, code: 'R1' }, { ...R2, code: 'R2' }] })
      if (method === 'POST' && path === `/parts/${PART_ID}/transfer`) {
        body = b
        return json({ data: p })
      }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Move' }))
    const dialog = await screen.findByRole('dialog', { name: 'Move stock to another restaurant' })
    // Only the other restaurant can be picked, and it's preselected.
    await user.type(within(dialog).getByLabelText(/Quantity/), '2')
    await user.click(within(dialog).getByRole('button', { name: 'Move stock' }))
    await waitFor(() =>
      expect(body).toEqual({
        fromRestaurantId: R1.id,
        toRestaurantId: R2.id,
        quantity: 2,
        reason: '',
      }),
    )
  })
})

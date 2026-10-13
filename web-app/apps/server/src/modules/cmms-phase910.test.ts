import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type LowStockOrderResult,
  type PartDetail,
  type PurchaseOrderDetail,
  type StockCountDetail,
  type VendorContractDto,
  type VendorDetail,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { contractExpiryAlerts } from '../jobs/alerts.js'
import { prisma } from '../core/prisma.js'
import { LOW_STOCK_PO_NOTE } from '../core/purchasing.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'

/*
 * Phases 9–10: stock movements (issue / return / damaged), reservations for
 * planned jobs, cycle counts, low-stock purchase requests, PO receipt
 * notifications, vendor contracts and vendor performance.
 */

const app = createApp()
let fx: Fixture
let R: string[]
let admin: ReturnType<typeof api>
let buyer: ReturnType<typeof api>
let worker: ReturnType<typeof api>
let ids: Record<'admin' | 'buyer' | 'worker', string>

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}

function api(token: string) {
  const h = { Authorization: `Bearer ${token}` }
  return {
    get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
    post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b),
    put: (u: string, b?: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
    del: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
  }
}

const part = (o: Record<string, unknown> = {}) => ({
  name: 'Door gasket',
  partNumber: 'GSK-200',
  sku: '',
  category: 'Refrigeration',
  unit: 'pcs',
  unitCost: 450,
  minStock: 2,
  preferredVendorId: '',
  storageLocation: 'Shelf A',
  description: '',
  ...o,
})

const vendorBody = (o: Record<string, unknown> = {}) => ({
  name: 'CoolTech Services',
  contactName: 'Mehul',
  email: '',
  phone: '+91 98765 11111',
  altPhone: '',
  address: '',
  city: 'Ahmedabad',
  categories: ['REFRIGERATION'],
  taxId: '',
  notes: '',
  restaurantIds: [R[0]],
  ...o,
})

const wo = (o: Record<string, unknown> = {}) => ({
  title: 'Fridge door seal',
  description: '',
  category: 'REFRIGERATION',
  priority: 'HIGH',
  restaurantId: R[0],
  locationId: '',
  assetId: '',
  dueDate: '',
  assignedUserId: ids.worker,
  assignedTeamId: '',
  requestId: '',
  ...o,
})

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  const users = {
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    buyer: await fx.createUser({ role: 'ADMIN', username: 'buyer', restaurants: [R[0]!] }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  admin = api(await tokenFor('admin'))
  buyer = api(await tokenFor('buyer'))
  worker = api(await tokenFor('worker'))
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function newPart(o: Record<string, unknown> = {}, stock = 0) {
  const res = await admin.post('/parts', part(o))
  expect(res.status).toBe(201)
  const p = res.body.data as PartDetail
  if (stock)
    await admin.post(`/parts/${p.id}/adjust`, {
      restaurantId: R[0],
      mode: 'RECEIVE',
      quantity: stock,
      reason: 'Opening stock',
    })
  return p
}

const getPart = async (id: string) => (await admin.get(`/parts/${id}`)).body.data as PartDetail
const onHand = async (id: string) => (await getPart(id)).stockLevels[0]!.quantity

// ---------------------------------------------------------------------------

describe('Phase 9 — parts and stock movements', () => {
  it('keeps SKUs unique and finds parts by SKU', async () => {
    await newPart({ sku: 'SKU-001', reorderQty: 10 })
    const dup = await admin.post('/parts', part({ partNumber: 'GSK-201', sku: 'sku-001' }))
    expect(dup.body.error.fieldErrors).toEqual({ sku: ['validation.alreadyInUse'] })
    const found = (await admin.get('/parts?q=SKU-001')).body
    expect(found.data).toHaveLength(1)
    expect(found.data[0]).toMatchObject({ sku: 'SKU-001', reorderQty: 10 })
  })

  it('records stock issued to a person, returned and written off as damaged', async () => {
    const p = await newPart({}, 10)
    const noOne = await admin.post(`/parts/${p.id}/adjust`, {
      restaurantId: R[0],
      mode: 'ISSUE',
      quantity: 3,
      reason: 'For the walk-in',
    })
    expect(noOne.body.error.fieldErrors).toEqual({ issuedToId: ['validation.required'] })

    await admin.post(`/parts/${p.id}/adjust`, {
      restaurantId: R[0],
      mode: 'ISSUE',
      quantity: 3,
      issuedToId: ids.worker,
      reason: 'For the walk-in',
    })
    await admin.post(`/parts/${p.id}/adjust`, {
      restaurantId: R[0],
      mode: 'RETURN',
      quantity: 1,
      reason: 'One not needed',
    })
    const d = (
      await admin.post(`/parts/${p.id}/adjust`, {
        restaurantId: R[0],
        mode: 'DAMAGED',
        quantity: 2,
        reason: 'Torn in transit',
      })
    ).body.data as PartDetail
    expect(d.stockLevels[0]!.quantity).toBe(6)
    expect(d.transactions.slice(0, 3).map((t) => [t.type, t.quantityDelta])).toEqual([
      ['DAMAGED', -2],
      ['RETURN', 1],
      ['ISSUE', -3],
    ])
    expect(d.transactions[2]!.issuedTo).toMatchObject({ id: ids.worker })
    const actions = await prisma.auditLog.findMany({
      where: { entityId: p.id, action: { startsWith: 'inventory.' } },
      select: { action: true },
    })
    expect(actions.map((a) => a.action).sort()).toEqual([
      'inventory.damaged',
      'inventory.issued',
      'inventory.returned',
      'inventory.stock_in',
    ])
  })
})

describe('Phase 9 — reservations', () => {
  it('reserves stock for a planned job, uses it, and frees the rest on cancel', async () => {
    const p = await newPart({}, 5)
    const job = (await admin.post('/work-orders', wo())).body.data as WorkOrderDetail
    expect(job.actions.reserve).toBe(true)

    let d = (await admin.post(`/work-orders/${job.id}/reservations`, { partId: p.id, quantity: 3 }))
      .body.data as WorkOrderDetail
    expect(d.reservations).toMatchObject([{ part: { id: p.id }, quantity: 3 }])
    let level = (await getPart(p.id)).stockLevels[0]!
    expect(level).toMatchObject({ quantity: 5, reserved: 3, available: 2 })

    // Another job can't take what is set aside.
    const other = (await admin.post('/work-orders', wo({ title: 'Second fridge' }))).body
      .data as WorkOrderDetail
    const tooMuch = await admin.post(`/work-orders/${other.id}/reservations`, {
      partId: p.id,
      quantity: 3,
    })
    expect(tooMuch.status).toBe(409)
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK')

    // Workers can't reserve.
    expect(
      (await worker.post(`/work-orders/${job.id}/reservations`, { partId: p.id, quantity: 1 }))
        .status,
    ).toBe(403)

    // Using 1 draws the reservation down to 2.
    await worker.post(`/work-orders/${job.id}/start`)
    d = (await worker.post(`/work-orders/${job.id}/parts`, { partId: p.id, quantity: 1 })).body.data
    expect(d.reservations).toMatchObject([{ quantity: 2 }])
    level = (await getPart(p.id)).stockLevels[0]!
    expect(level).toMatchObject({ quantity: 4, reserved: 2, available: 2 })

    // Cancelling the job frees the rest.
    await worker.post(`/work-orders/${job.id}/hold`, { reason: 'Waiting for the manager' })
    await admin.post(`/work-orders/${job.id}/cancel`, { reason: 'Fridge replaced instead' })
    level = (await getPart(p.id)).stockLevels[0]!
    expect(level).toMatchObject({ quantity: 4, reserved: 0, available: 4 })
    expect(
      await prisma.partReservation.findMany({
        where: { workOrderId: job.id },
        select: { status: true },
      }),
    ).toEqual([{ status: 'RELEASED' }])
  })

  it('releases a reservation by hand', async () => {
    const p = await newPart({}, 5)
    const job = (await admin.post('/work-orders', wo())).body.data as WorkOrderDetail
    const d = (
      await admin.post(`/work-orders/${job.id}/reservations`, { partId: p.id, quantity: 2 })
    ).body.data as WorkOrderDetail
    const after = (await admin.del(`/work-orders/${job.id}/reservations/${d.reservations[0]!.id}`))
      .body.data as WorkOrderDetail
    expect(after.reservations).toEqual([])
    expect((await getPart(p.id)).stockLevels[0]!.available).toBe(5)
  })
})

describe('Phase 9 — cycle counts', () => {
  it('books the counted difference into stock with a ledger line and an audit entry', async () => {
    const gasket = await newPart({}, 98)
    const relay = await newPart(
      { name: 'Start relay', partNumber: 'RLY-1', category: 'Electrical' },
      4,
    )

    // Only parts stocked here are counted; a category narrows it down.
    const narrow = (
      await admin.post('/stock-counts', {
        restaurantId: R[0],
        name: 'Refrigeration shelf',
        category: 'refrigeration',
        storageLocation: '',
        notes: '',
      })
    ).body.data as StockCountDetail
    expect(narrow.lines.map((l) => l.part.id)).toEqual([gasket.id])
    await admin.post(`/stock-counts/${narrow.id}/cancel`)

    let c = (
      await admin.post('/stock-counts', {
        restaurantId: R[0],
        name: 'Monthly count',
        category: '',
        storageLocation: '',
        notes: '',
      })
    ).body.data as StockCountDetail
    expect(c).toMatchObject({ code: 'SC-000002', status: 'IN_PROGRESS', lineCount: 2 })
    expect(c.actions).toEqual({ count: true, complete: false, cancel: true })

    const line = (id: string) => c.lines.find((l) => l.part.id === id)!
    c = (
      await admin.put(`/stock-counts/${c.id}/lines`, {
        lines: [
          { lineId: line(gasket.id).id, countedQty: 95 },
          { lineId: line(relay.id).id, countedQty: 4 },
        ],
      })
    ).body.data
    expect(line(gasket.id)).toMatchObject({ systemQty: 98, countedQty: 95, variance: -3 })
    expect(c.summary).toEqual({ varianceLines: 1, netQuantity: -3, varianceValue: -1350 })

    c = (await admin.post(`/stock-counts/${c.id}/complete`)).body.data
    expect(c.status).toBe('COMPLETED')
    expect(await onHand(gasket.id)).toBe(95)
    expect(await onHand(relay.id)).toBe(4)
    const ledger = (await getPart(gasket.id)).transactions[0]!
    expect(ledger).toMatchObject({
      type: 'CYCLE_COUNT',
      quantityDelta: -3,
      balanceAfter: 95,
      reference: { type: 'STOCK_COUNT', code: c.code },
    })
    expect(
      await prisma.auditLog.count({
        where: { action: 'inventory.cycle_count', entityId: gasket.id },
      }),
    ).toBe(1)
    expect(
      await prisma.auditLog.count({ where: { action: 'stock_count.completed', entityId: c.id } }),
    ).toBe(1)

    // A finished count can't be changed.
    expect((await admin.post(`/stock-counts/${c.id}/complete`)).status).toBe(409)
    const list = (await admin.get('/stock-counts?status=COMPLETED')).body
    expect(list.data).toMatchObject([{ id: c.id, countedCount: 2, lineCount: 2 }])
  })

  it('ignores stock used after a shelf was counted', async () => {
    const p = await newPart({}, 10)
    let c = (
      await admin.post('/stock-counts', {
        restaurantId: R[0],
        name: 'Spot check',
        category: '',
        storageLocation: 'shelf a',
        notes: '',
      })
    ).body.data as StockCountDetail
    // Two used before the shelf is counted: the system figure follows.
    await admin.post(`/parts/${p.id}/adjust`, {
      restaurantId: R[0],
      mode: 'REMOVE',
      quantity: 2,
      reason: 'Used on a job',
    })
    c = (
      await admin.put(`/stock-counts/${c.id}/lines`, {
        lines: [{ lineId: c.lines[0]!.id, countedQty: 8 }],
      })
    ).body.data
    expect(c.lines[0]).toMatchObject({ systemQty: 8, variance: 0 })
    await admin.post(`/stock-counts/${c.id}/complete`)
    expect(await onHand(p.id)).toBe(8)
  })

  it('needs inventory edit rights', async () => {
    await newPart({}, 1)
    const res = await worker.post('/stock-counts', {
      restaurantId: R[0],
      name: 'Count',
      category: '',
      storageLocation: '',
      notes: '',
    })
    expect(res.status).toBe(403)
    expect((await worker.get('/stock-counts')).status).toBe(200)
  })
})

describe('Phase 9 — low stock purchase requests', () => {
  it('drafts one purchase request per preferred vendor and skips parts already on order', async () => {
    const v = (await admin.post('/vendors', vendorBody())).body.data as VendorDetail
    const a = await newPart({ preferredVendorId: v.id, minStock: 5, reorderQty: 20 }, 2)
    const b = await newPart(
      { name: 'Fan motor', partNumber: 'FAN-1', preferredVendorId: v.id, minStock: 4 },
      1,
    )
    const orphan = await newPart({ name: 'Bulb', partNumber: 'BLB-1', minStock: 3 }, 1)

    const res = await admin.post('/purchase-orders/from-low-stock', { restaurantId: R[0] })
    expect(res.status).toBe(201)
    const r = res.body.data as LowStockOrderResult
    expect(r.created).toMatchObject([{ vendor: { id: v.id }, itemCount: 2 }])
    expect(r.withoutVendor).toMatchObject([{ id: orphan.id }])
    const po = (await admin.get(`/purchase-orders/${r.created[0]!.id}`)).body
      .data as PurchaseOrderDetail
    expect(po).toMatchObject({ status: 'DRAFT', notes: LOW_STOCK_PO_NOTE })
    const qty = Object.fromEntries(po.items.map((i) => [i.part.id, i.qtyOrdered]))
    // Reorder quantity when set, else top up to twice the minimum.
    expect(qty).toEqual({ [a.id]: 20, [b.id]: 7 })

    const again = (await admin.post('/purchase-orders/from-low-stock', { restaurantId: R[0] })).body
      .data as LowStockOrderResult
    expect(again).toMatchObject({ created: [], alreadyOrdered: 2 })
  })

  it('never drafts twice on a double click, nor for a vendor that does not serve the restaurant', async () => {
    const v = (await admin.post('/vendors', vendorBody())).body.data as VendorDetail
    await newPart({ preferredVendorId: v.id, minStock: 5 }, 1)
    const both = await Promise.all([
      admin.post('/purchase-orders/from-low-stock', { restaurantId: R[0] }),
      admin.post('/purchase-orders/from-low-stock', { restaurantId: R[0] }),
    ])
    expect(both.map((r) => r.status)).toEqual([201, 201])
    expect(await prisma.purchaseOrder.count()).toBe(1)

    // A preferred vendor that only serves another restaurant can't be ordered from here.
    const far = (await admin.post('/vendors', vendorBody({ name: 'Far Away Co' }))).body
      .data as VendorDetail
    await prisma.vendorRestaurant.deleteMany({ where: { vendorId: far.id } })
    await prisma.vendorRestaurant.create({ data: { vendorId: far.id, restaurantId: R[1]! } })
    const bulb = await newPart(
      { name: 'Bulb', partNumber: 'BLB-9', preferredVendorId: far.id, minStock: 3 },
      1,
    )
    const r = (await admin.post('/purchase-orders/from-low-stock', { restaurantId: R[0] })).body
      .data as LowStockOrderResult
    expect(r.created).toEqual([])
    expect(r.withoutVendor).toMatchObject([{ id: bulb.id }])
  })

  it('drafts a purchase request automatically when the setting is on', async () => {
    const v = (await admin.post('/vendors', vendorBody())).body.data as VendorDetail
    const p = await newPart({ preferredVendorId: v.id, minStock: 2 }, 5)
    expect((await admin.get('/inventory/settings')).body.data).toEqual({
      autoPurchaseRequest: false,
    })
    // Off: crossing the minimum only notifies.
    await admin.post(`/parts/${p.id}/adjust`, {
      restaurantId: R[0],
      mode: 'REMOVE',
      quantity: 3,
      reason: 'Used',
    })
    expect(await prisma.purchaseOrder.count()).toBe(0)

    await admin.post(`/parts/${p.id}/adjust`, {
      restaurantId: R[0],
      mode: 'RECEIVE',
      quantity: 3,
      reason: 'Back up',
    })
    expect(
      (await admin.put('/inventory/settings', { autoPurchaseRequest: true })).body.data,
    ).toEqual({ autoPurchaseRequest: true })
    expect((await worker.put('/inventory/settings', { autoPurchaseRequest: false })).status).toBe(
      403,
    )
    await admin.post(`/parts/${p.id}/adjust`, {
      restaurantId: R[0],
      mode: 'REMOVE',
      quantity: 3,
      reason: 'Used',
    })
    const pos = await prisma.purchaseOrder.findMany({ include: { items: true } })
    expect(pos).toHaveLength(1)
    expect(pos[0]).toMatchObject({ status: 'DRAFT', vendorId: v.id, restaurantId: R[0] })
    expect(Number(pos[0]!.items[0]!.qtyOrdered)).toBe(2)
    expect(
      await prisma.notification.count({
        where: { recipientId: ids.buyer, entityType: 'PURCHASE_ORDER', type: 'LOW_STOCK' },
      }),
    ).toBe(1)
  })
})

describe('Phase 10 — vendors, purchase orders and costs', () => {
  it('tells the requester when goods are received', async () => {
    const v = (await admin.post('/vendors', vendorBody())).body.data as VendorDetail
    const p = await newPart({ preferredVendorId: v.id })
    const po = (
      await admin.post('/purchase-orders', {
        vendorId: v.id,
        restaurantId: R[0],
        expectedAt: '',
        tax: 0,
        notes: '',
        items: [{ partId: p.id, qtyOrdered: 4, unitCost: 400, description: '' }],
      })
    ).body.data as PurchaseOrderDetail
    await admin.post(`/purchase-orders/${po.id}/submit`)
    await buyer.post(`/purchase-orders/${po.id}/approve`)
    await admin.post(`/purchase-orders/${po.id}/order`)
    // The buyer receives: the requester (admin) is told.
    await buyer.post(`/purchase-orders/${po.id}/receive`, {
      lines: [{ itemId: po.items[0]!.id, quantity: 4 }],
      notes: '',
    })
    const n = await prisma.notification.findMany({
      where: { type: 'PO_RECEIVED', recipientId: ids.admin },
    })
    expect(n).toHaveLength(1)
    expect(n[0]!.title).toContain(`${po.code} received`)
    expect(await onHand(p.id)).toBe(4)

    // Goods received count as purchases from the vendor.
    const d = (await admin.get(`/vendors/${v.id}`)).body.data as VendorDetail
    expect(d.performance.spend).toMatchObject({ purchases: 1600, total: 1600 })
    expect(d.parts).toMatchObject([{ id: p.id }])
  })

  it('keeps vendor contracts and measures the vendor on its jobs', async () => {
    const v = (await admin.post('/vendors', vendorBody())).body.data as VendorDetail
    const today = new Date().toISOString().slice(0, 10)
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
    const bad = await admin.post(`/vendors/${v.id}/contracts`, {
      title: 'AMC',
      contractNumber: '',
      startDate: today,
      endDate: '2020-01-01',
      restaurantId: '',
      terms: '',
    })
    expect(bad.body.error.fieldErrors).toEqual({ endDate: ['validation.endBeforeStart'] })

    let contracts = (
      await admin.post(`/vendors/${v.id}/contracts`, {
        title: 'Refrigeration AMC',
        contractNumber: 'AMC-24',
        startDate: today,
        endDate: soon,
        value: 60000,
        responseHours: 4,
        restaurantId: R[0],
        terms: 'Quarterly service, 4h emergency response',
      })
    ).body.data as VendorContractDto[]
    expect(contracts).toMatchObject([
      { title: 'Refrigeration AMC', state: 'expiring', value: 60000, responseHours: 4 },
    ])
    expect(await prisma.auditLog.count({ where: { action: 'vendor_contract.created' } })).toBe(1)

    // Expiry alert goes out once.
    expect(await contractExpiryAlerts()).toBe(1)
    expect(await contractExpiryAlerts()).toBe(0)
    expect(
      await prisma.notification.count({
        where: { type: 'CONTRACT_EXPIRY', recipientId: ids.admin },
      }),
    ).toBe(1)

    // A vendor job: started 2h after creation, finished 5h after creation, on time.
    const job = (
      await admin.post('/work-orders', wo({ vendorId: v.id, assignedUserId: ids.worker }))
    ).body.data as WorkOrderDetail
    const created = new Date(Date.now() - 6 * 3_600_000)
    await prisma.workOrder.update({
      where: { id: job.id },
      data: {
        createdAt: created,
        startedAt: new Date(created.getTime() + 2 * 3_600_000),
        completedAt: new Date(created.getTime() + 5 * 3_600_000),
        dueDate: new Date(created.getTime() + 24 * 3_600_000),
        status: 'CLOSED',
      },
    })
    await admin.post(`/work-orders/${job.id}/costs`, {
      type: 'VENDOR',
      description: 'Call-out',
      amount: 1500,
      vendorId: v.id,
    })
    const d = (await admin.get(`/vendors/${v.id}`)).body.data as VendorDetail
    expect(d.performance).toMatchObject({
      workOrders: { total: 1, open: 0, completed: 1 },
      avgResponseHours: 2,
      avgCompletionHours: 5,
      onTimeRate: 1,
      contractResponseHours: 4,
    })
    expect(d.recentWorkOrders).toMatchObject([{ id: job.id }])

    contracts = (await admin.del(`/vendors/${v.id}/contracts/${contracts[0]!.id}`)).body.data
    expect(contracts).toEqual([])
  })
})

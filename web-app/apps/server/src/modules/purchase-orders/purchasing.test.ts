import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type PartDetail,
  type PurchaseOrderDetail,
  type VendorDetail,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'

const app = createApp()
let fx: Fixture
let R: string[]
let ids: Record<'boss' | 'admin' | 'admin2' | 'buyer' | 'worker', string>
let boss: ReturnType<typeof api>
let admin: ReturnType<typeof api>
let admin2: ReturnType<typeof api>
let buyer: ReturnType<typeof api>
let worker: ReturnType<typeof api>

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
  category: 'Refrigeration',
  unit: 'pcs',
  unitCost: 450,
  minStock: 2,
  preferredVendorId: '',
  storageLocation: '',
  description: '',
  ...o,
})

const vendor = (o: Record<string, unknown> = {}) => ({
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

const adjust = (o: Record<string, unknown> = {}) => ({
  restaurantId: R[0],
  mode: 'RECEIVE',
  quantity: 5,
  reason: 'Opening stock',
  ...o,
})

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 2 })
  R = fx.restaurantIds
  const users = {
    boss: await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' }),
    admin: await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: [R[0]!] }),
    admin2: await fx.createUser({ role: 'ADMIN', username: 'admin2', restaurants: [R[1]!] }),
    buyer: await fx.createUser({ role: 'ADMIN', username: 'buyer', restaurants: [R[0]!] }),
    worker: await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: [R[0]!] }),
  }
  ids = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.id])) as typeof ids
  boss = api(await tokenFor('boss'))
  admin = api(await tokenFor('admin'))
  admin2 = api(await tokenFor('admin2'))
  buyer = api(await tokenFor('buyer'))
  worker = api(await tokenFor('worker'))
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function newPart(o: Record<string, unknown> = {}) {
  const res = await admin.post('/parts', part(o))
  expect(res.status).toBe(201)
  return res.body.data as PartDetail
}

describe('parts and stock', () => {
  it('keeps part numbers unique and tracks stock per restaurant with a ledger', async () => {
    const p = await newPart()
    expect((await admin.post('/parts', part({ name: 'Other' }))).body.error.fieldErrors).toEqual({
      partNumber: ['validation.alreadyInUse'],
    })
    expect((await worker.post('/parts', part({ partNumber: 'X1' }))).status).toBe(403)

    let d = (await admin.post(`/parts/${p.id}/adjust`, adjust())).body.data as PartDetail
    expect(d.stockLevels).toEqual([
      expect.objectContaining({
        restaurant: { id: R[0], name: 'Restaurant R1' },
        quantity: 5,
        low: false,
      }),
    ])
    d = (
      await admin.post(
        `/parts/${p.id}/adjust`,
        adjust({ mode: 'COUNT', quantity: 3.5, reason: 'Stock take' }),
      )
    ).body.data
    expect(d.stockLevels[0]!.quantity).toBe(3.5)
    expect(d.transactions.map((t) => [t.type, t.quantityDelta, t.balanceAfter])).toEqual([
      ['ADJUSTMENT', -1.5, 3.5],
      ['RECEIPT', 5, 5],
    ])

    const tooMuch = await admin.post(
      `/parts/${p.id}/adjust`,
      adjust({ mode: 'REMOVE', quantity: 10, reason: 'Broken' }),
    )
    expect(tooMuch.status).toBe(409)
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK')

    // Other restaurants' stock is out of scope.
    expect(
      (await admin.post(`/parts/${p.id}/adjust`, adjust({ restaurantId: R[1] }))).body.error
        .fieldErrors,
    ).toEqual({
      restaurantId: ['validation.restaurantOutOfScope'],
    })
    await boss.post(`/parts/${p.id}/adjust`, adjust({ restaurantId: R[1], quantity: 7 }))
    expect((await admin.get(`/parts/${p.id}`)).body.data.totalQuantity).toBe(3.5)
    expect((await boss.get(`/parts/${p.id}`)).body.data.totalQuantity).toBe(10.5)
  })

  it('flags low stock, filters it, and notifies once when crossing the minimum', async () => {
    const p = await newPart({ minStock: 3 })
    await newPart({ name: 'Fuse 10A', partNumber: 'FUSE-10', minStock: 0 })
    await admin.post(`/parts/${p.id}/adjust`, adjust({ quantity: 5 }))
    await admin.post(
      `/parts/${p.id}/adjust`,
      adjust({ mode: 'REMOVE', quantity: 3, reason: 'Used' }),
    )
    // 2 left ≤ 3: low. buyer (other admin of R1) is notified, not the actor.
    expect(
      await prisma.notification.count({ where: { type: 'LOW_STOCK', recipientId: ids.buyer } }),
    ).toBe(1)
    expect(
      await prisma.notification.count({ where: { type: 'LOW_STOCK', recipientId: ids.admin } }),
    ).toBe(0)
    await admin.post(
      `/parts/${p.id}/adjust`,
      adjust({ mode: 'REMOVE', quantity: 1, reason: 'Used' }),
    )
    expect(
      await prisma.notification.count({ where: { type: 'LOW_STOCK', recipientId: ids.buyer } }),
    ).toBe(1)

    const low = (await admin.get(`/parts?low=1&restaurantId=${R[0]}`)).body
    expect(low.meta.total).toBe(1)
    expect(low.data[0]).toMatchObject({ partNumber: 'GSK-200', stock: { quantity: 1, low: true } })

    // A restaurant-level minimum overrides the default.
    const d = (
      await admin.put(`/parts/${p.id}/stock-settings`, {
        restaurantId: R[0],
        minStock: 0.5,
        storageLocation: 'Shelf B2',
      })
    ).body.data as PartDetail
    expect(d.stockLevels[0]).toMatchObject({
      minStock: 0.5,
      minOverride: 0.5,
      low: false,
      storageLocation: 'Shelf B2',
    })
    expect((await admin.get('/dashboard')).body.data.counts.lowStock).toBe(0)
  })

  it('cannot archive a part that still has stock', async () => {
    const p = await newPart()
    await admin.post(`/parts/${p.id}/adjust`, adjust({ quantity: 1 }))
    expect((await admin.del(`/parts/${p.id}`)).body.error.code).toBe('PART_IN_USE')
    await admin.post(
      `/parts/${p.id}/adjust`,
      adjust({ mode: 'COUNT', quantity: 0, reason: 'Count' }),
    )
    expect((await admin.del(`/parts/${p.id}`)).status).toBe(204)
    expect((await admin.post('/parts', part())).status).toBe(201)
  })
})

describe('parts used on work orders', () => {
  it('deducts stock while working and returns it when removed', async () => {
    const p = await newPart({ minStock: 0 })
    await admin.post(`/parts/${p.id}/adjust`, adjust({ quantity: 4 }))
    const w = (
      await admin.post('/work-orders', {
        title: 'Replace door gasket',
        description: '',
        category: 'REFRIGERATION',
        priority: 'MEDIUM',
        restaurantId: R[0],
        locationId: '',
        assetId: '',
        dueDate: '',
        assignedUserId: ids.worker,
        assignedTeamId: '',
        requestId: '',
      })
    ).body.data as WorkOrderDetail
    expect(
      (await worker.post(`/work-orders/${w.id}/parts`, { partId: p.id, quantity: 1 })).status,
    ).toBe(403)
    await worker.post(`/work-orders/${w.id}/start`)

    let d = (await worker.post(`/work-orders/${w.id}/parts`, { partId: p.id, quantity: 1 })).body
      .data as WorkOrderDetail
    d = (await worker.post(`/work-orders/${w.id}/parts`, { partId: p.id, quantity: 2 })).body.data
    expect(d.parts).toEqual([
      expect.objectContaining({
        qtyUsed: 3,
        unitCost: 450,
        part: expect.objectContaining({ partNumber: 'GSK-200' }),
      }),
    ])
    expect((await admin.get(`/parts/${p.id}`)).body.data.stockLevels[0].quantity).toBe(1)

    const short = await worker.post(`/work-orders/${w.id}/parts`, { partId: p.id, quantity: 2 })
    expect(short.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      fieldErrors: { quantity: ['validation.notEnoughStock'] },
    })

    d = (await worker.del(`/work-orders/${w.id}/parts/${d.parts[0]!.id}`)).body.data
    expect(d.parts).toEqual([])
    const after = (await admin.get(`/parts/${p.id}`)).body.data as PartDetail
    expect(after.stockLevels[0]!.quantity).toBe(4)
    expect(after.transactions[0]).toMatchObject({
      type: 'RETURN',
      quantityDelta: 3,
      reference: { type: 'WORK_ORDER', code: w.code },
    })
  })
})

describe('vendors', () => {
  it('scopes vendors to restaurants and records invoices', async () => {
    const res = await admin.post('/vendors', vendor())
    expect(res.status).toBe(201)
    const v = res.body.data as VendorDetail
    expect(v).toMatchObject({ restaurants: [{ id: R[0] }], can: { edit: true } })
    expect(
      (await admin.post('/vendors', vendor({ name: 'Global', restaurantIds: [] }))).body.error
        .fieldErrors,
    ).toEqual({
      restaurantIds: ['validation.restaurantRequired'],
    })
    expect((await admin2.get(`/vendors/${v.id}`)).status).toBe(404)
    const shared = (
      await boss.post('/vendors', vendor({ name: 'Everyone Electricals', restaurantIds: [] }))
    ).body.data
    expect((await admin2.get('/vendors')).body.data.map((x: { id: string }) => x.id)).toEqual([
      shared.id,
    ])
    expect((await admin2.get(`/vendors/${shared.id}`)).body.data.can.edit).toBe(false)

    const inv = await admin.post(`/vendors/${v.id}/invoices`, {
      invoiceNumber: 'INV-77',
      amount: 1250.5,
      invoiceDate: '2026-09-15',
      dueDate: '2026-09-30',
      restaurantId: R[0],
      purchaseOrderId: '',
      notes: '',
    })
    expect(inv.status).toBe(201)
    expect(inv.body.data).toMatchObject({ amount: 1250.5, overdue: true, paidAt: null })
    const dup = await admin.post(`/vendors/${v.id}/invoices`, {
      ...inv.body.data,
      invoiceNumber: 'inv-77',
      restaurantId: R[0],
      purchaseOrderId: '',
      dueDate: '',
      notes: '',
    })
    expect(dup.body.error.fieldErrors).toMatchObject({ invoiceNumber: ['validation.alreadyInUse'] })
    let d = (await admin.get(`/vendors/${v.id}`)).body.data as VendorDetail
    expect(d).toMatchObject({ spend12m: 1250.5, unpaidAmount: 1250.5 })
    await admin.put(`/vendors/${v.id}/invoices/${inv.body.data.id}/paid`, { paid: true })
    d = (await admin.get(`/vendors/${v.id}`)).body.data
    expect(d.unpaidAmount).toBe(0)

    // Organization-level records of a shared vendor are the Super Admin's: a
    // restaurant Admin can see them but not pay, delete or archive them.
    const orgInvoice = (
      await boss.post(`/vendors/${shared.id}/invoices`, {
        invoiceNumber: 'HQ-1',
        amount: 99000,
        invoiceDate: '2026-09-15',
        dueDate: '',
        restaurantId: '',
        purchaseOrderId: '',
        notes: '',
      })
    ).body.data
    const orgContract = (
      await boss.post(`/vendors/${shared.id}/contracts`, {
        title: 'Annual AMC',
        contractNumber: '',
        startDate: '2026-01-01',
        endDate: '',
        restaurantId: '',
        terms: '',
      })
    ).body.data[0]
    expect(
      (await admin2.put(`/vendors/${shared.id}/invoices/${orgInvoice.id}/paid`, { paid: true }))
        .status,
    ).toBe(403)
    expect((await admin2.del(`/vendors/${shared.id}/invoices/${orgInvoice.id}`)).status).toBe(403)
    expect((await admin2.del(`/vendors/${shared.id}/contracts/${orgContract.id}`)).status).toBe(403)
    expect(
      (
        await admin2.put(`/vendors/${shared.id}/contracts/${orgContract.id}`, {
          title: 'Mine now',
          contractNumber: '',
          startDate: '2026-01-01',
          endDate: '',
          restaurantId: R[1],
          terms: '',
        })
      ).status,
    ).toBe(403)
    // The picker list is for people who order or plan, not Users.
    expect((await worker.get('/vendors/options')).status).toBe(403)
    expect((await admin.get('/vendors/options')).status).toBe(200)
    expect(await prisma.vendorInvoice.count({ where: { id: orgInvoice.id, paidAt: null } })).toBe(1)
    expect(
      await prisma.vendorContract.count({
        where: { id: orgContract.id, archivedAt: null, restaurantId: null },
      }),
    ).toBe(1)
  })

  it('links a service vendor to an asset', async () => {
    const v = (await admin.post('/vendors', vendor())).body.data
    const cat = await prisma.assetCategory.create({
      data: { organizationId: fx.orgId, name: 'Refrigerator' },
    })
    const a = await admin.post('/assets', {
      name: 'Walk-in freezer',
      categoryId: cat.id,
      restaurantId: R[0],
      locationId: '',
      manufacturer: '',
      model: '',
      serialNumber: '',
      purchaseDate: '',
      purchaseCost: '',
      warrantyStart: '',
      warrantyEnd: '',
      notes: '',
      vendorId: v.id,
    })
    expect(a.body.data.vendor).toMatchObject({ id: v.id, name: 'CoolTech Services' })
  })
})

describe('purchase orders', () => {
  async function draft() {
    const v = (await admin.post('/vendors', vendor())).body.data as VendorDetail
    const p1 = await newPart({ minStock: 0 })
    const p2 = await newPart({
      name: 'Compressor relay',
      partNumber: 'RLY-9',
      unit: 'pcs',
      unitCost: 300,
      minStock: 0,
    })
    const res = await admin.post('/purchase-orders', {
      vendorId: v.id,
      restaurantId: R[0],
      expectedAt: '',
      tax: 135,
      notes: '',
      items: [
        { partId: p1.id, qtyOrdered: 4, unitCost: 400, description: '' },
        { partId: p2.id, qtyOrdered: 2, unitCost: 325.5, description: '' },
      ],
    })
    expect(res.status).toBe(201)
    return { po: res.body.data as PurchaseOrderDetail, v, p1, p2 }
  }

  it('an approver who edited and submitted another person’s draft cannot approve it', async () => {
    const { po, p1 } = await draft()
    // The buyer (an approver) rewrites the admin's draft and submits it.
    const edited = await buyer.put(`/purchase-orders/${po.id}`, {
      vendorId: po.vendor.id,
      restaurantId: R[0],
      expectedAt: '',
      tax: 0,
      notes: '',
      items: [{ partId: p1.id, qtyOrdered: 400, unitCost: 4000, description: '' }],
    })
    expect(edited.status).toBe(200)
    expect((await buyer.post(`/purchase-orders/${po.id}/submit`)).status).toBe(200)
    const self = await buyer.post(`/purchase-orders/${po.id}/approve`)
    expect(self.status).toBe(403)
    expect(self.body.error.code).toBe('SELF_APPROVAL_NOT_ALLOWED')
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe(
      'PENDING_APPROVAL',
    )
  })

  it('totals the order and runs approval → order → partial and full receipt', async () => {
    const { po, p1, p2 } = await draft()
    expect(po).toMatchObject({
      code: 'PO-000001',
      status: 'DRAFT',
      subtotal: 2251,
      tax: 135,
      total: 2386,
    })
    expect(po.actions).toMatchObject({ edit: true, submit: true, approve: false, receive: false })

    let d = (await admin.post(`/purchase-orders/${po.id}/submit`)).body.data as PurchaseOrderDetail
    expect(d.status).toBe('PENDING_APPROVAL')
    expect(
      await prisma.notification.count({ where: { type: 'PO_APPROVAL', recipientId: ids.buyer } }),
    ).toBe(1)

    // The requester can't approve their own order.
    expect(d.selfApprovalBlocked).toBe(true)
    const self = await admin.post(`/purchase-orders/${po.id}/approve`)
    expect(self.body.error.code).toBe('SELF_APPROVAL_NOT_ALLOWED')

    // Rejected → back to draft with the reason noted; resubmit; approved by someone else.
    d = (await buyer.post(`/purchase-orders/${po.id}/reject`, { reason: 'Check the relay price' }))
      .body.data
    expect(d).toMatchObject({ status: 'DRAFT' })
    expect(d.notes).toContain('Returned for changes: Check the relay price')
    await admin.post(`/purchase-orders/${po.id}/submit`)
    d = (await buyer.post(`/purchase-orders/${po.id}/approve`)).body.data
    expect(d).toMatchObject({ status: 'APPROVED', approvedBy: { id: ids.buyer } })
    expect((await buyer.post(`/purchase-orders/${po.id}/approve`)).status).toBe(403)

    d = (await admin.post(`/purchase-orders/${po.id}/order`)).body.data
    expect(d.status).toBe('ORDERED')

    // Lines are created together (same timestamp): pick them by part, not position.
    const i1 = d.items.find((i) => i.part.id === p1.id)
    const i2 = d.items.find((i) => i.part.id === p2.id)
    const over = await admin.post(`/purchase-orders/${po.id}/receive`, {
      lines: [{ itemId: i1!.id, quantity: 5 }],
      notes: '',
    })
    expect(over.body.error.fieldErrors).toEqual({
      'lines.0.quantity': ['validation.receiveTooMuch'],
    })

    d = (
      await admin.post(`/purchase-orders/${po.id}/receive`, {
        lines: [
          { itemId: i1!.id, quantity: 3 },
          { itemId: i2!.id, quantity: 0 },
        ],
        notes: 'First box',
      })
    ).body.data
    expect(d.status).toBe('PARTIALLY_RECEIVED')
    expect(d.actions.cancel).toBe(false)
    d = (
      await admin.post(`/purchase-orders/${po.id}/receive`, {
        lines: [
          { itemId: i1!.id, quantity: 1 },
          { itemId: i2!.id, quantity: 2 },
        ],
        notes: '',
      })
    ).body.data
    expect(d.status).toBe('RECEIVED')
    expect(d.receipts).toHaveLength(2)

    const s1 = (await admin.get(`/parts/${p1.id}`)).body.data as PartDetail
    expect(s1.stockLevels[0]!.quantity).toBe(4)
    expect(s1.unitCost).toBe(400) // latest purchase price
    expect(s1.transactions[0]).toMatchObject({
      type: 'RECEIPT',
      unitCost: 400,
      reference: { type: 'PURCHASE_ORDER', code: 'PO-000001' },
    })
    expect((await admin.get(`/parts/${p2.id}`)).body.data.stockLevels[0].quantity).toBe(2)
    expect(
      (
        await admin.post(`/purchase-orders/${po.id}/receive`, {
          lines: [{ itemId: i1!.id, quantity: 1 }],
          notes: '',
        })
      ).status,
    ).toBe(403)
  })

  it('validates vendor coverage and duplicate parts; edits only drafts; cancels with a reason', async () => {
    const { po, v, p1 } = await draft()
    const bad = await boss.post('/purchase-orders', {
      vendorId: v.id,
      restaurantId: R[1],
      expectedAt: '',
      tax: 0,
      notes: '',
      items: [
        { partId: p1.id, qtyOrdered: 1, unitCost: 1, description: '' },
        { partId: p1.id, qtyOrdered: 1, unitCost: 1, description: '' },
      ],
    })
    expect(bad.body.error.fieldErrors).toEqual({ 'items.1.partId': ['validation.duplicatePart'] })
    const wrongVendor = await boss.post('/purchase-orders', {
      vendorId: v.id,
      restaurantId: R[1],
      expectedAt: '',
      tax: 0,
      notes: '',
      items: [{ partId: p1.id, qtyOrdered: 1, unitCost: 1, description: '' }],
    })
    expect(wrongVendor.body.error.fieldErrors).toEqual({
      vendorId: ['validation.vendorNotForRestaurant'],
    })

    const edited = await admin.put(`/purchase-orders/${po.id}`, {
      vendorId: v.id,
      restaurantId: R[0],
      expectedAt: '2026-10-20',
      tax: 0,
      notes: 'Urgent',
      items: [{ partId: p1.id, qtyOrdered: 10, unitCost: 400, description: 'Large size' }],
    })
    expect(edited.body.data).toMatchObject({ total: 4000, itemCount: 1, expectedAt: '2026-10-20' })

    expect((await admin2.get(`/purchase-orders/${po.id}`)).status).toBe(404)
    expect((await worker.get('/purchase-orders')).status).toBe(403)

    const cancelled = (
      await admin.post(`/purchase-orders/${po.id}/cancel`, { reason: 'Found stock elsewhere' })
    ).body.data
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'Found stock elsewhere',
    })
    expect(
      (
        await admin.put(`/purchase-orders/${po.id}`, {
          vendorId: v.id,
          restaurantId: R[0],
          expectedAt: '',
          tax: 0,
          notes: '',
          items: [{ partId: p1.id, qtyOrdered: 1, unitCost: 1, description: '' }],
        })
      ).status,
    ).toBe(403)
    expect((await buyer.get('/purchase-orders?view=approval')).body.meta.total).toBe(0)
  })
})

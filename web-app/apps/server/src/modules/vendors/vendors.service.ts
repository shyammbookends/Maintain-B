import {
  ERROR_CODES,
  WORK_ORDER_DONE_STATUSES,
  contractState,
  type ListVendorsQuery,
  type VendorContractDto,
  type VendorContractInput,
  type VendorPerformance,
  type PagedResponse,
  type VendorDetail,
  type VendorInput,
  type VendorInvoiceDto,
  type VendorInvoiceInput,
  type VendorListItem,
  type VendorOption,
} from '@maintainx/shared'
import { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Vendors are organization-wide. A vendor either serves every restaurant (no
 * restaurant links) or a chosen set. Admins see vendors that serve at least
 * one of their restaurants and may only link vendors to their own restaurants.
 */

const OPEN_PO = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'] as const
const blank = (v: string) => (v === '' ? null : v)

/** Vendors the user may see: unlinked ones, or ones serving a restaurant in scope. */
export function visibleWhere(auth: AuthContext): Prisma.VendorWhereInput {
  return {
    organizationId: auth.organizationId,
    archivedAt: null,
    ...(auth.isSuperAdmin
      ? {}
      : {
          OR: [
            { vendorRestaurants: { none: {} } },
            { vendorRestaurants: { some: { restaurantId: restaurantScope(auth) } } },
          ],
        }),
  }
}

const include = {
  vendorRestaurants: { include: { restaurant: { select: { id: true, name: true } } } },
  _count: { select: { purchaseOrders: { where: { status: { in: [...OPEN_PO] } } } } },
} satisfies Prisma.VendorInclude

type Row = Prisma.VendorGetPayload<{ include: typeof include }>

const toListItem = (v: Row): VendorListItem => ({
  id: v.id,
  name: v.name,
  contactName: v.contactName,
  phone: v.phone,
  email: v.email,
  city: v.city,
  categories: v.categories,
  restaurants: v.vendorRestaurants
    .map((r) => r.restaurant)
    .sort((a, b) => a.name.localeCompare(b.name)),
  openOrders: v._count.purchaseOrders,
})

export async function listVendors(
  auth: AuthContext,
  q: ListVendorsQuery,
): Promise<PagedResponse<VendorListItem>> {
  const and: Prisma.VendorWhereInput[] = [visibleWhere(auth)]
  if (q.category) and.push({ categories: { has: q.category } })
  if (q.restaurantId)
    and.push({
      OR: [
        { vendorRestaurants: { none: {} } },
        { vendorRestaurants: { some: { restaurantId: q.restaurantId } } },
      ],
    })
  if (q.q)
    and.push({
      OR: [
        { name: { contains: q.q, mode: 'insensitive' } },
        { contactName: { contains: q.q, mode: 'insensitive' } },
        { phone: { contains: q.q } },
        { city: { contains: q.q, mode: 'insensitive' } },
      ],
    })
  const where = { AND: and }
  const sort = q.sort ?? { field: 'name', direction: 'asc' as const }
  const [rows, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      include,
      orderBy: [{ [sort.field]: sort.direction }, { id: 'asc' }],
      ...toSkipTake(q),
    }),
    prisma.vendor.count({ where }),
  ])
  return toPagedResponse(rows.map(toListItem), q, total)
}

/** Compact list for pickers; `restaurantId` keeps vendors that serve it. */
export async function vendorOptions(
  auth: AuthContext,
  restaurantId?: string,
): Promise<VendorOption[]> {
  return prisma.vendor.findMany({
    where: {
      AND: [
        visibleWhere(auth),
        restaurantId
          ? {
              OR: [
                { vendorRestaurants: { none: {} } },
                { vendorRestaurants: { some: { restaurantId } } },
              ],
            }
          : {},
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 500,
  })
}

async function load(auth: AuthContext, id: string): Promise<Row> {
  const v = await prisma.vendor.findFirst({ where: { AND: [visibleWhere(auth), { id }] }, include })
  if (!v) throw new NotFoundError('Vendor')
  return v
}

/** Invoices limited to restaurants the user can see (unlinked ones are shared). */
const invoiceScope = (auth: AuthContext): Prisma.VendorInvoiceWhereInput =>
  auth.isSuperAdmin ? {} : { OR: [{ restaurantId: null }, { restaurantId: restaurantScope(auth) }] }

/** Admins can manage a vendor only when it isn't shared with restaurants they can't see. */
function canManage(auth: AuthContext, v: Row) {
  if (auth.isSuperAdmin) return true
  return (
    v.vendorRestaurants.length > 0 &&
    v.vendorRestaurants.every((r) => canAccessRestaurant(auth, r.restaurantId))
  )
}

const HOUR = 3_600_000
const avg = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null
const money = (n: number) => Math.round(n * 100) / 100

/**
 * How the vendor performs on the jobs given to it (last 12 months, visible
 * restaurants) and what it cost: invoices + vendor cost lines on work orders
 * + goods received on purchase orders.
 */
async function vendorPerformance(
  auth: AuthContext,
  vendorId: string,
  since: Date,
  invoices: number,
): Promise<VendorPerformance> {
  const scope = restaurantScope(auth)
  const [jobs, costLines, received, contracts] = await Promise.all([
    prisma.workOrder.findMany({
      where: { vendorId, archivedAt: null, restaurantId: scope, createdAt: { gte: since } },
      select: { status: true, createdAt: true, startedAt: true, completedAt: true, dueDate: true },
      take: 5000,
    }),
    prisma.workOrderCost.aggregate({
      where: {
        vendorId,
        createdAt: { gte: since },
        workOrder: { restaurantId: scope, archivedAt: null },
      },
      _sum: { amount: true },
    }),
    prisma.$queryRaw<Array<{ value: Prisma.Decimal | null }>>`
      SELECT SUM(i.qty_received * i.unit_cost) AS value
        FROM purchase_order_items i JOIN purchase_orders p ON p.id = i.purchase_order_id
       WHERE p.vendor_id = ${vendorId}::uuid
         AND p.created_at >= ${since}
         ${scope ? Prisma.sql`AND p.restaurant_id IN (${Prisma.join(scope.in.length ? scope.in.map((r) => Prisma.sql`${r}::uuid`) : [Prisma.sql`NULL::uuid`])})` : Prisma.empty}`,
    prisma.vendorContract.findMany({
      where: { vendorId, archivedAt: null, responseHours: { not: null }, ...contractScope(auth) },
      select: { startDate: true, endDate: true, responseHours: true },
    }),
  ])
  const done = jobs.filter((j) =>
    (WORK_ORDER_DONE_STATUSES as readonly string[]).includes(j.status),
  )
  const withDue = done.filter((j) => j.dueDate && j.completedAt)
  const today = new Date().toISOString().slice(0, 10)
  const live = contracts.filter((c) => {
    const st = contractState(
      c.startDate.toISOString().slice(0, 10),
      c.endDate?.toISOString().slice(0, 10) ?? null,
      today,
    )
    return st === 'active' || st === 'expiring'
  })
  const workOrderCosts = Number(costLines._sum.amount ?? 0)
  const purchases = Number(received[0]?.value ?? 0)
  return {
    workOrders: {
      total: jobs.length,
      open: jobs.filter((j) => j.status !== 'CANCELLED' && !done.includes(j)).length,
      completed: done.length,
    },
    avgResponseHours: avg(
      jobs
        .filter((j) => j.startedAt)
        .map((j) => (j.startedAt!.getTime() - j.createdAt.getTime()) / HOUR),
    ),
    avgCompletionHours: avg(
      done
        .filter((j) => j.completedAt)
        .map((j) => (j.completedAt!.getTime() - j.createdAt.getTime()) / HOUR),
    ),
    onTimeRate: withDue.length
      ? Math.round(
          (withDue.filter((j) => j.completedAt! <= j.dueDate!).length / withDue.length) * 100,
        ) / 100
      : null,
    contractResponseHours: live.length ? Math.min(...live.map((c) => c.responseHours!)) : null,
    spend: {
      invoices: money(invoices),
      workOrderCosts: money(workOrderCosts),
      purchases: money(purchases),
      total: money(invoices + workOrderCosts + purchases),
    },
  }
}

export async function getVendor(auth: AuthContext, id: string): Promise<VendorDetail> {
  const v = await load(auth, id)
  const since = new Date(Date.now() - 365 * 86_400_000)
  const [spend, unpaid, partCount, assetCount] = await Promise.all([
    prisma.vendorInvoice.aggregate({
      where: { vendorId: id, invoiceDate: { gte: since }, ...invoiceScope(auth) },
      _sum: { amount: true },
    }),
    prisma.vendorInvoice.aggregate({
      where: { vendorId: id, paidAt: null, ...invoiceScope(auth) },
      _sum: { amount: true },
    }),
    prisma.part.count({ where: { preferredVendorId: id, archivedAt: null } }),
    prisma.asset.count({
      where: { vendorId: id, archivedAt: null, restaurantId: restaurantScope(auth) },
    }),
  ])
  const manage = canManage(auth, v)
  const [performance, recent, parts] = await Promise.all([
    vendorPerformance(auth, id, since, Number(spend._sum.amount ?? 0)),
    prisma.workOrder.findMany({
      where: { vendorId: id, archivedAt: null, restaurantId: restaurantScope(auth) },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        createdAt: true,
        completedAt: true,
        restaurant: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.part.findMany({
      where: { preferredVendorId: id, archivedAt: null },
      select: { id: true, name: true, partNumber: true },
      orderBy: { name: 'asc' },
      take: 50,
    }),
  ])
  return {
    ...toListItem(v),
    altPhone: v.altPhone,
    address: v.address,
    taxId: v.taxId,
    notes: v.notes,
    spend12m: Number(spend._sum.amount ?? 0),
    unpaidAmount: Number(unpaid._sum.amount ?? 0),
    partCount,
    assetCount,
    performance,
    recentWorkOrders: recent.map((w) => ({
      id: w.id,
      code: w.code,
      title: w.title,
      status: w.status,
      restaurant: w.restaurant,
      createdAt: w.createdAt.toISOString(),
      completedAt: w.completedAt?.toISOString() ?? null,
    })),
    parts,
    can: {
      edit: manage && hasPermission(auth, 'vendors:edit'),
      delete: manage && hasPermission(auth, 'vendors:delete'),
    },
  }
}

async function validate(auth: AuthContext, input: VendorInput, exceptId?: string) {
  const errors: Record<string, string[]> = {}
  if (!auth.isSuperAdmin) {
    if (input.restaurantIds.length === 0) errors.restaurantIds = ['validation.restaurantRequired']
    else if (input.restaurantIds.some((r) => !canAccessRestaurant(auth, r)))
      errors.restaurantIds = ['validation.restaurantOutOfScope']
  }
  const clash = await prisma.vendor.findFirst({
    where: {
      organizationId: auth.organizationId,
      name: { equals: input.name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) errors.name = ['validation.alreadyInUse']
  if (input.restaurantIds.length) {
    const found = await prisma.restaurant.count({
      where: {
        id: { in: input.restaurantIds },
        organizationId: auth.organizationId,
        archivedAt: null,
      },
    })
    if (found !== new Set(input.restaurantIds).size)
      errors.restaurantIds = ['validation.invalidValue']
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
}

const vendorData = (input: VendorInput) => ({
  name: input.name,
  contactName: blank(input.contactName),
  email: blank(input.email),
  phone: blank(input.phone),
  altPhone: blank(input.altPhone),
  address: blank(input.address),
  city: blank(input.city),
  categories: [...new Set(input.categories)],
  taxId: blank(input.taxId),
  notes: blank(input.notes),
})

const auditVendor = (auth: AuthContext, id: string, action: string, extra: object = {}) => ({
  organizationId: auth.organizationId,
  restaurantId: null,
  actorId: auth.userId,
  action,
  entityType: 'VENDOR' as const,
  entityId: id,
  ...extra,
})

export async function createVendor(auth: AuthContext, input: VendorInput, req: Request) {
  await validate(auth, input)
  const v = await prisma.vendor.create({
    data: {
      ...vendorData(input),
      organizationId: auth.organizationId,
      vendorRestaurants: {
        create: [...new Set(input.restaurantIds)].map((restaurantId) => ({ restaurantId })),
      },
    },
  })
  await recordAudit(auditVendor(auth, v.id, 'vendor.created', { newValue: { name: v.name } }), req)
  return getVendor(auth, v.id)
}

export async function updateVendor(
  auth: AuthContext,
  id: string,
  input: VendorInput,
  req: Request,
) {
  const before = await getVendor(auth, id)
  if (!before.can.edit) throw new NotFoundError('Vendor')
  await validate(auth, input, id)
  await prisma.$transaction(async (tx) => {
    await tx.vendorRestaurant.deleteMany({ where: { vendorId: id } })
    await tx.vendor.update({
      where: { id },
      data: {
        ...vendorData(input),
        vendorRestaurants: {
          create: [...new Set(input.restaurantIds)].map((restaurantId) => ({ restaurantId })),
        },
      },
    })
  })
  await recordAudit(
    auditVendor(auth, id, 'vendor.updated', {
      oldValue: { name: before.name },
      newValue: { name: input.name, restaurants: input.restaurantIds.length },
    }),
    req,
  )
  return getVendor(auth, id)
}

export async function archiveVendor(auth: AuthContext, id: string, req: Request) {
  const v = await getVendor(auth, id)
  if (!v.can.delete) throw new NotFoundError('Vendor')
  if (v.openOrders > 0) {
    throw new ConflictError('This vendor has open purchase orders.', ERROR_CODES.VENDOR_IN_USE)
  }
  await prisma.$transaction([
    prisma.vendor.update({
      where: { id },
      data: { archivedAt: new Date(), name: `${v.name} (archived ${id.slice(0, 8)})` },
    }),
    prisma.part.updateMany({ where: { preferredVendorId: id }, data: { preferredVendorId: null } }),
  ])
  await recordAudit(auditVendor(auth, id, 'vendor.archived', { oldValue: { name: v.name } }), req)
}

// ---------------------------------------------------------------- invoices

const invoiceInclude = {
  restaurant: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, code: true } },
} satisfies Prisma.VendorInvoiceInclude

type InvoiceRow = Prisma.VendorInvoiceGetPayload<{ include: typeof invoiceInclude }>

function toInvoice(i: InvoiceRow): VendorInvoiceDto {
  const due = i.dueDate?.toISOString().slice(0, 10) ?? null
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    amount: Number(i.amount),
    invoiceDate: i.invoiceDate.toISOString().slice(0, 10),
    dueDate: due,
    paidAt: i.paidAt?.toISOString() ?? null,
    overdue: !i.paidAt && due !== null && due < new Date().toISOString().slice(0, 10),
    restaurant: i.restaurant,
    purchaseOrder: i.purchaseOrder,
    notes: i.notes,
  }
}

export async function listInvoices(
  auth: AuthContext,
  vendorId: string,
): Promise<VendorInvoiceDto[]> {
  await load(auth, vendorId)
  const rows = await prisma.vendorInvoice.findMany({
    where: { vendorId, ...invoiceScope(auth) },
    include: invoiceInclude,
    orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })
  return rows.map(toInvoice)
}

export async function createInvoice(
  auth: AuthContext,
  vendorId: string,
  input: VendorInvoiceInput,
  req: Request,
): Promise<VendorInvoiceDto> {
  const vendor = await load(auth, vendorId)
  const errors: Record<string, string[]> = {}
  const serves = (rid: string) =>
    vendor.vendorRestaurants.length === 0 ||
    vendor.vendorRestaurants.some((r) => r.restaurantId === rid)
  if (
    input.restaurantId &&
    (!canAccessRestaurant(auth, input.restaurantId) || !serves(input.restaurantId))
  )
    errors.restaurantId = ['validation.restaurantOutOfScope']
  if (!input.restaurantId && !auth.isSuperAdmin) errors.restaurantId = ['validation.selectOption']
  if (input.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, vendorId, organizationId: auth.organizationId },
      select: { restaurantId: true },
    })
    if (!po || (input.restaurantId && po.restaurantId !== input.restaurantId))
      errors.purchaseOrderId = ['validation.invalidValue']
  }
  const dup = await prisma.vendorInvoice.count({
    where: { vendorId, invoiceNumber: { equals: input.invoiceNumber, mode: 'insensitive' } },
  })
  if (dup) errors.invoiceNumber = ['validation.alreadyInUse']
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const inv = await prisma.vendorInvoice.create({
    data: {
      organizationId: auth.organizationId,
      vendorId,
      invoiceNumber: input.invoiceNumber,
      amount: input.amount,
      invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
      dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
      restaurantId: blank(input.restaurantId),
      purchaseOrderId: blank(input.purchaseOrderId),
      notes: blank(input.notes),
    },
    include: invoiceInclude,
  })
  await recordAudit(
    auditVendor(auth, vendorId, 'vendor.invoice_added', {
      restaurantId: inv.restaurantId,
      newValue: { invoiceNumber: inv.invoiceNumber, amount: input.amount },
    }),
    req,
  )
  return toInvoice(inv)
}

/** An invoice to change: organization-level ones (no restaurant) are Super Admin's, like creating them. */
async function loadInvoice(auth: AuthContext, vendorId: string, invoiceId: string) {
  await load(auth, vendorId)
  const inv = await prisma.vendorInvoice.findFirst({
    where: { id: invoiceId, vendorId, ...invoiceScope(auth) },
  })
  if (!inv) throw new NotFoundError('Invoice')
  if (inv.restaurantId === null && !auth.isSuperAdmin) throw new ForbiddenError()
  return inv
}

export async function setInvoicePaid(
  auth: AuthContext,
  vendorId: string,
  invoiceId: string,
  paid: boolean,
  req: Request,
): Promise<VendorInvoiceDto> {
  const inv = await loadInvoice(auth, vendorId, invoiceId)
  const updated = await prisma.vendorInvoice.update({
    where: { id: inv.id },
    data: { paidAt: paid ? (inv.paidAt ?? new Date()) : null },
    include: invoiceInclude,
  })
  await recordAudit(
    auditVendor(auth, vendorId, paid ? 'vendor.invoice_paid' : 'vendor.invoice_unpaid', {
      restaurantId: inv.restaurantId,
      metadata: { invoiceNumber: inv.invoiceNumber },
    }),
    req,
  )
  return toInvoice(updated)
}

export async function deleteInvoice(
  auth: AuthContext,
  vendorId: string,
  invoiceId: string,
  req: Request,
) {
  const inv = await loadInvoice(auth, vendorId, invoiceId)
  await prisma.vendorInvoice.delete({ where: { id: inv.id } })
  await recordAudit(
    auditVendor(auth, vendorId, 'vendor.invoice_deleted', {
      restaurantId: inv.restaurantId,
      oldValue: { invoiceNumber: inv.invoiceNumber, amount: Number(inv.amount) },
    }),
    req,
  )
}

// ------------------------------------------------------------------ contracts

const contractInclude = {
  restaurant: { select: { id: true, name: true } },
} satisfies Prisma.VendorContractInclude
type ContractRow = Prisma.VendorContractGetPayload<{ include: typeof contractInclude }>

const isoDate = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null
const asDate = (s: string) => new Date(`${s}T00:00:00Z`)

function toContract(c: ContractRow, today: string): VendorContractDto {
  const startDate = isoDate(c.startDate)!
  const endDate = isoDate(c.endDate)
  return {
    id: c.id,
    title: c.title,
    contractNumber: c.contractNumber,
    startDate,
    endDate,
    value: c.value === null ? null : Number(c.value),
    responseHours: c.responseHours,
    restaurant: c.restaurant,
    terms: c.terms,
    state: contractState(startDate, endDate, today),
  }
}

/** Contracts limited to restaurants the user can see (unlinked ones cover the vendor). */
const contractScope = (auth: AuthContext): Prisma.VendorContractWhereInput =>
  auth.isSuperAdmin ? {} : { OR: [{ restaurantId: null }, { restaurantId: restaurantScope(auth) }] }

export async function listContracts(auth: AuthContext, vendorId: string) {
  await load(auth, vendorId)
  const rows = await prisma.vendorContract.findMany({
    where: { vendorId, archivedAt: null, ...contractScope(auth) },
    include: contractInclude,
    orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }, { startDate: 'desc' }],
  })
  const today = new Date().toISOString().slice(0, 10)
  return rows.map((r) => toContract(r, today))
}

async function contractData(auth: AuthContext, v: Row, input: VendorContractInput) {
  const restaurantId = blank(input.restaurantId)
  if (restaurantId) {
    const serves =
      v.vendorRestaurants.length === 0 ||
      v.vendorRestaurants.some((r) => r.restaurantId === restaurantId)
    if (!canAccessRestaurant(auth, restaurantId) || !serves)
      throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  } else if (!canManage(auth, v)) {
    throw new ValidationError({ restaurantId: ['validation.restaurantRequired'] })
  }
  return {
    title: input.title,
    contractNumber: blank(input.contractNumber),
    startDate: asDate(input.startDate),
    endDate: input.endDate ? asDate(input.endDate) : null,
    value: input.value ?? null,
    responseHours: input.responseHours ?? null,
    restaurantId,
    terms: blank(input.terms),
  }
}

const auditContract = (
  auth: AuthContext,
  id: string,
  restaurantId: string | null,
  action: string,
  extra: object = {},
) => ({
  organizationId: auth.organizationId,
  restaurantId,
  actorId: auth.userId,
  action,
  entityType: 'VENDOR_CONTRACT' as const,
  entityId: id,
  ...extra,
})

export async function createContract(
  auth: AuthContext,
  vendorId: string,
  input: VendorContractInput,
  req: Request,
) {
  const v = await load(auth, vendorId)
  const data = await contractData(auth, v, input)
  const c = await prisma.vendorContract.create({
    data: { ...data, organizationId: auth.organizationId, vendorId },
  })
  await recordAudit(
    auditContract(auth, c.id, data.restaurantId, 'vendor_contract.created', {
      newValue: { vendor: v.name, title: input.title, endDate: input.endDate || null },
    }),
    req,
  )
  return listContracts(auth, vendorId)
}

/**
 * A contract to change. One covering the whole vendor (no restaurant) may only
 * be changed by someone who manages the vendor everywhere it works, the same
 * rule as creating one.
 */
async function loadContract(auth: AuthContext, v: Row, id: string) {
  const c = await prisma.vendorContract.findFirst({
    where: { id, vendorId: v.id, archivedAt: null, ...contractScope(auth) },
  })
  if (!c) throw new NotFoundError('Contract')
  if (c.restaurantId && !canAccessRestaurant(auth, c.restaurantId))
    throw new NotFoundError('Contract')
  if (c.restaurantId === null && !canManage(auth, v)) throw new ForbiddenError()
  return c
}

export async function updateContract(
  auth: AuthContext,
  vendorId: string,
  id: string,
  input: VendorContractInput,
  req: Request,
) {
  const v = await load(auth, vendorId)
  const before = await loadContract(auth, v, id)
  const data = await contractData(auth, v, input)
  await prisma.vendorContract.update({ where: { id }, data })
  await recordAudit(
    auditContract(auth, id, data.restaurantId, 'vendor_contract.updated', {
      oldValue: { title: before.title, endDate: isoDate(before.endDate) },
      newValue: { title: input.title, endDate: input.endDate || null },
    }),
    req,
  )
  return listContracts(auth, vendorId)
}

export async function archiveContract(
  auth: AuthContext,
  vendorId: string,
  id: string,
  req: Request,
) {
  const c = await loadContract(auth, await load(auth, vendorId), id)
  await prisma.vendorContract.update({ where: { id }, data: { archivedAt: new Date() } })
  await recordAudit(
    auditContract(auth, id, c.restaurantId, 'vendor_contract.archived', {
      oldValue: { title: c.title },
    }),
    req,
  )
  return listContracts(auth, vendorId)
}

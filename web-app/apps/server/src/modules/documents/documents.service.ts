import { randomUUID } from 'node:crypto'
import {
  DOCUMENT_EXPIRING_DAYS,
  DOCUMENT_MIME_TYPES,
  ERROR_CODES,
  documentExpiry,
  type DocumentDto,
  type DocumentMetaInput,
  type DocumentOwnerType,
  type ListDocumentsQuery,
  type PagedResponse,
  type UploadDocumentInput,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request, RequestHandler } from 'express'
import multer from 'multer'
import { env } from '../../config/env.js'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import {
  AppError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from '../../core/errors.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import { storage } from '../../storage/index.js'
import type { AuthContext } from '../auth/auth.context.js'
import { visibleWhere as visibleVendors } from '../vendors/vendors.service.js'
import { visibleWhere as visibleWorkOrders } from '../work-orders/work-orders.service.js'

const MB = 1024 * 1024
const DAY = 86_400_000
const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.MAX_UPLOAD_MB * MB, fields: 10 },
}).single('file')

/** Parses one `file` plus form fields; multer limits become friendly errors. */
export const parseDocumentUpload: RequestHandler = (req, res, next) => {
  parser(req, res, (err: unknown) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return next(new PayloadTooLargeError('This file is too large.'))
      return next(new ValidationError({ file: ['validation.tooManyFiles'] }))
    }
    next(err)
  })
}

/**
 * Documents of restaurants the user can see (organization-wide ones are shared).
 * Documents hang off records the user must be able to see too: a User (worker)
 * only sees work-order documents of their own work, and vendor documents
 * (contracts, invoices) need vendors:view.
 */
async function visibleWhere(auth: AuthContext): Promise<Prisma.DocumentWhereInput> {
  const and: Prisma.DocumentWhereInput[] = []
  if (!hasPermission(auth, 'vendors:view')) and.push({ NOT: { ownerType: 'VENDOR' } })
  else if (!auth.isSuperAdmin) {
    // Vendor documents are stored without a restaurant: limit them to vendors
    // this user can see (unlinked, or serving one of their restaurants).
    const vendors = await prisma.vendor.findMany({
      where: visibleVendors(auth),
      select: { id: true },
    })
    and.push({
      OR: [{ NOT: { ownerType: 'VENDOR' } }, { ownerId: { in: vendors.map((v) => v.id) } }],
    })
  }
  if (auth.user.roleKind === 'WORKER') {
    const mine = await prisma.workOrder.findMany({
      where: await visibleWorkOrders(auth),
      select: { id: true },
    })
    and.push({
      OR: [{ NOT: { ownerType: 'WORK_ORDER' } }, { ownerId: { in: mine.map((w) => w.id) } }],
    })
  }
  return {
    organizationId: auth.organizationId,
    archivedAt: null,
    ...(auth.isSuperAdmin
      ? {}
      : { OR: [{ restaurantId: null }, { restaurantId: restaurantScope(auth) }] }),
    ...(and.length ? { AND: and } : {}),
  }
}

/** Checks the owner exists and is in scope; returns its restaurant and display name. */
async function resolveOwner(
  auth: AuthContext,
  type: DocumentOwnerType,
  id: string,
): Promise<{ restaurantId: string | null; name: string }> {
  const org = auth.organizationId
  const fail = () => new ValidationError({ ownerId: ['validation.invalidValue'] })
  switch (type) {
    case 'RESTAURANT': {
      const r = await prisma.restaurant.findFirst({
        where: { id, organizationId: org, archivedAt: null },
      })
      if (!r || !canAccessRestaurant(auth, r.id)) throw fail()
      return { restaurantId: r.id, name: r.name }
    }
    case 'ASSET': {
      const a = await prisma.asset.findFirst({
        where: { id, organizationId: org, archivedAt: null },
      })
      if (!a || !canAccessRestaurant(auth, a.restaurantId)) throw fail()
      return { restaurantId: a.restaurantId, name: `${a.name} · ${a.assetCode}` }
    }
    case 'WORK_ORDER': {
      // Same visibility as the work order itself (a worker: only their own work).
      const w = await prisma.workOrder.findFirst({
        where: { AND: [await visibleWorkOrders(auth), { id }] },
      })
      if (!w) throw fail()
      return { restaurantId: w.restaurantId, name: `${w.code} · ${w.title}` }
    }
    case 'VENDOR': {
      const v = await prisma.vendor.findFirst({
        where: { id, organizationId: org, archivedAt: null },
        include: { vendorRestaurants: { select: { restaurantId: true } } },
      })
      const visible =
        v &&
        (auth.isSuperAdmin ||
          v.vendorRestaurants.length === 0 ||
          v.vendorRestaurants.some((r) => canAccessRestaurant(auth, r.restaurantId)))
      if (!visible || !hasPermission(auth, 'vendors:view')) throw fail()
      return { restaurantId: null, name: v.name }
    }
  }
}

async function ownerNames(rows: Array<{ ownerType: DocumentOwnerType; ownerId: string }>) {
  const ids = (t: DocumentOwnerType) => rows.filter((r) => r.ownerType === t).map((r) => r.ownerId)
  const [restaurants, assets, vendors, wos] = await Promise.all([
    prisma.restaurant.findMany({
      where: { id: { in: ids('RESTAURANT') } },
      select: { id: true, name: true },
    }),
    prisma.asset.findMany({
      where: { id: { in: ids('ASSET') } },
      select: { id: true, name: true, assetCode: true },
    }),
    prisma.vendor.findMany({
      where: { id: { in: ids('VENDOR') } },
      select: { id: true, name: true },
    }),
    prisma.workOrder.findMany({
      where: { id: { in: ids('WORK_ORDER') } },
      select: { id: true, code: true, title: true },
    }),
  ])
  return new Map<string, string>([
    ...restaurants.map((r) => [r.id, r.name] as const),
    ...assets.map((a) => [a.id, `${a.name} · ${a.assetCode}`] as const),
    ...vendors.map((v) => [v.id, v.name] as const),
    ...wos.map((w) => [w.id, `${w.code} · ${w.title}`] as const),
  ])
}

const include = {
  restaurant: { select: { id: true, name: true } },
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.DocumentInclude

type Row = Prisma.DocumentGetPayload<{ include: typeof include }>

async function toDtos(auth: AuthContext, rows: Row[]): Promise<DocumentDto[]> {
  const names = await ownerNames(rows)
  const canEdit = hasPermission(auth, 'documents:edit')
  const canDelete = hasPermission(auth, 'documents:delete')
  return Promise.all(
    rows.map(async (d) => {
      const expiresAt = d.expiresAt?.toISOString().slice(0, 10) ?? null
      const link = (disposition: 'inline' | 'attachment') =>
        storage.getSignedUrl(d.storageKey, {
          expiresInSeconds: 3600,
          mimeType: d.mimeType,
          fileName: d.fileName,
          disposition,
        })
      return {
        id: d.id,
        title: d.title,
        docType: d.docType,
        ownerType: d.ownerType,
        owner: { id: d.ownerId, name: names.get(d.ownerId) ?? '—' },
        restaurant: d.restaurant,
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        issuedAt: d.issuedAt?.toISOString().slice(0, 10) ?? null,
        expiresAt,
        expiry: documentExpiry(expiresAt),
        uploadedBy: d.uploadedBy,
        createdAt: d.createdAt.toISOString(),
        url: await link('inline'),
        downloadUrl: await link('attachment'),
        // Uploaders may fix their own documents; editors may change any.
        can: {
          edit: canEdit || d.uploadedById === auth.userId,
          delete: canDelete || d.uploadedById === auth.userId,
        },
      }
    }),
  )
}

export async function listDocuments(
  auth: AuthContext,
  q: ListDocumentsQuery,
): Promise<PagedResponse<DocumentDto>> {
  if (q.ownerType && q.ownerId) await resolveOwner(auth, q.ownerType, q.ownerId)
  if (q.restaurantId && !canAccessRestaurant(auth, q.restaurantId)) return toPagedResponse([], q, 0)
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
  const and: Prisma.DocumentWhereInput[] = [await visibleWhere(auth)]
  if (q.ownerType) and.push({ ownerType: q.ownerType })
  if (q.ownerId) and.push({ ownerId: q.ownerId })
  if (q.restaurantId) and.push({ restaurantId: q.restaurantId })
  if (q.docType) and.push({ docType: q.docType })
  if (q.expiry === 'expired') and.push({ expiresAt: { lt: today } })
  if (q.expiry === 'expiring')
    and.push({
      expiresAt: { gte: today, lte: new Date(today.getTime() + DOCUMENT_EXPIRING_DAYS * DAY) },
    })
  if (q.q)
    and.push({
      OR: [
        { title: { contains: q.q, mode: 'insensitive' } },
        { fileName: { contains: q.q, mode: 'insensitive' } },
      ],
    })
  const where = { AND: and }
  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include,
      orderBy: q.expiry ? [{ expiresAt: 'asc' }] : [{ createdAt: 'desc' }],
      ...toSkipTake(q),
    }),
    prisma.document.count({ where }),
  ])
  return toPagedResponse(await toDtos(auth, rows), q, total)
}

async function load(auth: AuthContext, id: string): Promise<Row> {
  const d = await prisma.document.findFirst({
    where: { AND: [await visibleWhere(auth), { id }] },
    include,
  })
  if (!d) throw new NotFoundError('Document')
  return d
}

const toDate = (v: string) => (v ? new Date(`${v}T00:00:00Z`) : null)

export async function uploadDocument(
  auth: AuthContext,
  input: UploadDocumentInput,
  file: Express.Multer.File | undefined,
  req: Request,
): Promise<DocumentDto> {
  if (!file) throw new ValidationError({ file: ['validation.required'] })
  const owner = await resolveOwner(auth, input.ownerType, input.ownerId)
  const { fileTypeFromBuffer } = await import('file-type') // loaded on first upload
  const detected = await fileTypeFromBuffer(file.buffer)
  if (!detected || !(DOCUMENT_MIME_TYPES as readonly string[]).includes(detected.mime)) {
    throw new AppError(
      415,
      ERROR_CODES.FILE_TYPE_NOT_ALLOWED,
      'Only PDF, photos, Word and Excel files.',
    )
  }
  const now = new Date()
  const ext = EXT[detected.mime]!
  const key = `documents/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`
  await storage.put(key, file.buffer, { mimeType: detected.mime })
  const base = file.originalname
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 80)
  const doc = await prisma.document.create({
    data: {
      organizationId: auth.organizationId,
      restaurantId: owner.restaurantId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      docType: input.docType,
      title: input.title,
      storageKey: key,
      fileName: `${base || 'document'}.${ext}`,
      mimeType: detected.mime,
      sizeBytes: file.size,
      issuedAt: toDate(input.issuedAt),
      expiresAt: toDate(input.expiresAt),
      uploadedById: auth.userId,
    },
    include,
  })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: owner.restaurantId,
      actorId: auth.userId,
      action: 'document.uploaded',
      entityType: 'DOCUMENT',
      entityId: doc.id,
      newValue: {
        title: doc.title,
        docType: doc.docType,
        owner: `${input.ownerType}:${owner.name}`,
      },
    },
    req,
  )
  return (await toDtos(auth, [doc]))[0]!
}

export async function updateDocument(
  auth: AuthContext,
  id: string,
  input: DocumentMetaInput,
  req: Request,
): Promise<DocumentDto> {
  const d = await load(auth, id)
  if (!(await toDtos(auth, [d]))[0]!.can.edit) throw new NotFoundError('Document')
  const updated = await prisma.document.update({
    where: { id },
    data: {
      title: input.title,
      docType: input.docType,
      issuedAt: toDate(input.issuedAt),
      expiresAt: toDate(input.expiresAt),
    },
    include,
  })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: d.restaurantId,
      actorId: auth.userId,
      action: 'document.updated',
      entityType: 'DOCUMENT',
      entityId: id,
      oldValue: { title: d.title, expiresAt: d.expiresAt },
      newValue: { title: input.title, expiresAt: input.expiresAt || null },
    },
    req,
  )
  return (await toDtos(auth, [updated]))[0]!
}

/** Archived documents disappear from lists; the file is kept for the audit trail. */
export async function archiveDocument(auth: AuthContext, id: string, req: Request) {
  const d = await load(auth, id)
  if (!(await toDtos(auth, [d]))[0]!.can.delete) throw new NotFoundError('Document')
  await prisma.document.update({ where: { id }, data: { archivedAt: new Date() } })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: d.restaurantId,
      actorId: auth.userId,
      action: 'document.archived',
      entityType: 'DOCUMENT',
      entityId: id,
      oldValue: { title: d.title },
    },
    req,
  )
}

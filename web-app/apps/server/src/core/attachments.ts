import { randomUUID } from 'node:crypto'
import {
  ERROR_CODES,
  UPLOAD_ALLOWED_TYPES,
  UPLOAD_IMAGE_TYPES,
  UPLOAD_MAX_FILES,
  UPLOAD_MAX_IMAGE_MB,
  type AttachmentDto,
  type AttachmentOwnerType,
  type EvidenceStage,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { RequestHandler } from 'express'
import multer from 'multer'
import { env } from '../config/env.js'
import { storage } from '../storage/index.js'
import { AppError, PayloadTooLargeError, ValidationError } from './errors.js'
import { optimizePhoto, type OptimizedPhoto } from './images.js'
import { logger } from './logger.js'
import { prisma } from './prisma.js'

const MB = 1024 * 1024
const SIGNED_URL_SECONDS = 3600

/**
 * Express middleware that parses `files` (kept in memory, bounded by count and
 * size, until validated) and maps multer limits to friendly errors.
 */
export function uploadParser(
  maxFiles: number,
  maxBytes: number,
  /** Largest text field (bytes); multer's default is 1 MB per field. */
  maxFieldBytes?: number,
): RequestHandler {
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: maxFiles,
      fileSize: maxBytes,
      fields: 10,
      ...(maxFieldBytes ? { fieldSize: maxFieldBytes } : {}),
    },
  }).array('files', maxFiles)
  return (req, res, next) => {
    parser(req, res, (err: unknown) => {
      if (!err) return next()
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE')
          return next(new PayloadTooLargeError('This file is too large.'))
        if (err.code === 'LIMIT_FIELD_VALUE')
          return next(new PayloadTooLargeError('A form field is too long.'))
        return next(new ValidationError({ files: ['validation.tooManyFiles'] }))
      }
      next(err)
    })
  }
}

export const parseUploads = uploadParser(UPLOAD_MAX_FILES, env.MAX_UPLOAD_MB * MB)

/** Public portal: a few photos only, so strangers can't make the server buffer videos. */
export const MAX_GUEST_PHOTOS = 3
export const parseGuestUploads = uploadParser(MAX_GUEST_PHOTOS, UPLOAD_MAX_IMAGE_MB * MB)

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/webm': 'weba',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
}

/** Removes path parts and odd characters; keeps something readable for downloads. */
function safeFileName(name: string, ext: string): string {
  const base = name
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 80)
  return `${base || 'file'}.${ext}`
}

/**
 * Validates by content (magic bytes), not by the name or the browser-supplied
 * type, then writes to private storage and records the attachment rows.
 */
export async function saveAttachments(
  files: Express.Multer.File[] | undefined,
  owner: { type: AttachmentOwnerType; id: string },
  uploadedById: string | null,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  /**
   * Evidence stage and caption for work-order photos; `audioOnly` accepts
   * voice notes only (team chat), with the recorder's duration.
   */
  meta: {
    stage?: EvidenceStage | null
    caption?: string | null
    audioOnly?: boolean
    durationSec?: number | null
  } = {},
): Promise<string[]> {
  if (!files || files.length === 0) throw new ValidationError({ files: ['validation.required'] })

  const checked = await Promise.all(
    files.map(async (f) => {
      const { fileTypeFromBuffer } = await import('file-type') // loaded on first upload
      const found = await fileTypeFromBuffer(f.buffer)
      // "audio/ogg; codecs=opus" (Firefox voice notes) is plain audio/ogg here.
      const detected = found && { ...found, mime: found.mime.split(';')[0]!.trim() }
      if (!detected || !UPLOAD_ALLOWED_TYPES.includes(detected.mime)) {
        throw new AppError(
          415,
          ERROR_CODES.FILE_TYPE_NOT_ALLOWED,
          'Only photos, videos and voice notes can be uploaded.',
        )
      }
      const isImage = (UPLOAD_IMAGE_TYPES as readonly string[]).includes(detected.mime)
      if (isImage && f.size > UPLOAD_MAX_IMAGE_MB * MB) {
        throw new AppError(413, ERROR_CODES.FILE_TOO_LARGE, 'This photo is too large.')
      }
      // webm/mp4 containers look the same with or without a picture; a voice
      // note recorded in the browser says so in its declared type. Where only
      // voice notes are taken (chat), such a container is always the recording.
      const audio =
        detected.mime.startsWith('audio/') ||
        ((meta.audioOnly || f.mimetype.startsWith('audio/')) &&
          /^video\/(webm|mp4)$/.test(detected.mime))
      const mime = audio ? detected.mime.replace(/^video\//, 'audio/') : detected.mime
      if (meta.audioOnly && !audio) {
        throw new AppError(
          415,
          ERROR_CODES.FILE_TYPE_NOT_ALLOWED,
          'Only voice recordings can be sent here.',
        )
      }
      return {
        file: f,
        mime,
        kind: isImage ? ('PHOTO' as const) : audio ? ('AUDIO' as const) : ('VIDEO' as const),
      }
    }),
  )

  // Photos are always re-encoded small (WebP, metadata such as GPS dropped)
  // with a thumbnail for lists. One that can't be decoded is refused, never
  // stored as sent (it would keep its EXIF). Done for every file before
  // anything is written, so a bad photo leaves nothing behind.
  const prepared: Array<(typeof checked)[number] & { photo: OptimizedPhoto | null }> = []
  for (const c of checked) {
    const photo = c.kind === 'PHOTO' ? await optimizePhoto(c.file.buffer) : null
    if (c.kind === 'PHOTO' && !photo) {
      throw new ValidationError(
        { files: ['validation.invalidValue'] },
        'This photo could not be read. Please take it again or choose another photo.',
      )
    }
    prepared.push({ ...c, photo })
  }

  const now = new Date()
  const folder = `attachments/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const ids: string[] = []
  const written: string[] = []
  try {
    for (const c of prepared) {
      const { photo } = c
      const mime = photo ? 'image/webp' : c.mime
      const ext = EXTENSION[mime]!
      const id = randomUUID()
      const key = `${folder}/${id}.${ext}`
      const body = photo ? photo.main : c.file.buffer
      await storage.put(key, body, { mimeType: mime })
      written.push(key)
      const thumbKey = photo ? `${folder}/${id}-thumb.webp` : null
      if (photo && thumbKey) {
        await storage.put(thumbKey, photo.thumb, { mimeType: 'image/webp' })
        written.push(thumbKey)
      }
      const row = await db.attachment.create({
        data: {
          ownerType: owner.type,
          ownerId: owner.id,
          kind: c.kind,
          storageKey: key,
          thumbKey,
          width: photo?.width ?? null,
          height: photo?.height ?? null,
          fileName: safeFileName(c.file.originalname, ext),
          mimeType: mime,
          sizeBytes: body.length + (photo?.thumb.length ?? 0),
          durationSec: c.kind === 'AUDIO' ? (meta.durationSec ?? null) : null,
          stage: meta.stage ?? null,
          caption: meta.caption || null,
          uploadedById,
        },
        select: { id: true },
      })
      ids.push(row.id)
    }
  } catch (err) {
    // Don't leave files behind that no record points to.
    await removeStoredFiles(written)
    throw err
  }
  return ids
}

/** Best-effort removal of stored files (cleanup after a failed save). */
export async function removeStoredFiles(keys: string[]): Promise<void> {
  for (const key of keys)
    await storage.delete(key).catch((err: unknown) => {
      logger.warn({ err, key }, 'stored file could not be removed')
    })
}

/** Attachments of one or more owners, each with a short-lived signed link. */
export async function listAttachments(
  owners: Array<{ type: AttachmentOwnerType; id: string }>,
): Promise<Map<string, AttachmentDto[]>> {
  const out = new Map<string, AttachmentDto[]>()
  if (owners.length === 0) return out
  const rows = await prisma.attachment.findMany({
    where: { OR: owners.map((o) => ({ ownerType: o.type, ownerId: o.id })) },
    include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  })
  for (const r of rows) {
    const dto: AttachmentDto = {
      id: r.id,
      kind: r.kind,
      stage: r.stage,
      caption: r.caption,
      fileName: r.fileName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      url: r.fileRemovedAt
        ? ''
        : await storage.getSignedUrl(r.storageKey, {
            expiresInSeconds: SIGNED_URL_SECONDS,
            mimeType: r.mimeType,
            fileName: r.fileName,
            disposition: 'inline',
          }),
      thumbUrl:
        r.thumbKey && !r.fileRemovedAt
          ? await storage.getSignedUrl(r.thumbKey, {
              expiresInSeconds: SIGNED_URL_SECONDS,
              mimeType: 'image/webp',
              fileName: r.fileName,
              disposition: 'inline',
            })
          : null,
      removed: !!r.fileRemovedAt,
      uploadedBy: r.uploadedBy,
      createdAt: r.createdAt.toISOString(),
    }
    const key = `${r.ownerType}:${r.ownerId}`
    out.set(key, [...(out.get(key) ?? []), dto])
  }
  return out
}

export function attachmentsOf(
  map: Map<string, AttachmentDto[]>,
  type: AttachmentOwnerType,
  id: string,
) {
  return map.get(`${type}:${id}`) ?? []
}

import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { ForbiddenError, NotFoundError } from '../../core/errors.js'
import { parseQuery } from '../../core/validate.js'
import { storage } from '../../storage/index.js'
import { verifyFileLink } from '../../storage/signing.js'

const fileQuerySchema = z.object({
  key: z.string().min(1).max(512),
  exp: z.coerce.number().int(),
  type: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  dl: z.enum(['0', '1']),
  sig: z.string().min(16).max(128),
})

/** Encode a filename for Content-Disposition (ASCII fallback + RFC 5987). */
function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(fileName)
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Only media and PDFs open in the browser; anything else (a future type, or a
 * stored file whose type looks like markup) is downloaded instead.
 */
const INLINE_TYPE = /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|application\/pdf)$/
/** A downloaded file can never run as a page on this origin. */
const FILE_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"
// Chrome's PDF viewer refuses to render under `sandbox`; PDFs keep their own script-less viewer.
const PDF_CSP = "default-src 'none'; object-src 'self'; frame-ancestors 'self'"

export const filesRouter = Router()

/**
 * Serves a file previously authorized through StorageProvider.getSignedUrl.
 * The signature covers key, expiry, content type, file name and disposition,
 * so none of them can be altered by the client.
 */
filesRouter.get('/files', async (req, res) => {
  const q = parseQuery(fileQuerySchema, req)
  if (!verifyFileLink(q, env.FILE_SIGNING_SECRET)) {
    throw new ForbiddenError('This file link is invalid or has expired.')
  }

  const info = await storage.head(q.key)
  if (!info) throw new NotFoundError('File')

  const type = q.type.toLowerCase().split(';')[0]!.trim()
  const inline = q.dl !== '1' && INLINE_TYPE.test(type)
  res.setHeader('Content-Type', inline || /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream')
  res.setHeader('Content-Length', String(info.size))
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', q.name))
  res.setHeader('Cache-Control', 'private, max-age=0, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', type === 'application/pdf' ? PDF_CSP : FILE_CSP)
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')

  const stream = await storage.getStream(q.key)
  stream.on('error', (err) => {
    if (!res.headersSent) res.status(500)
    res.destroy(err)
  })
  stream.pipe(res)
})

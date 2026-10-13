import { UPLOAD_ALLOWED_TYPES, UPLOAD_MAX_FILES } from '@maintainx/shared'

/** Longest side after resizing. Enough to read a model plate; small on mobile data. */
const MAX_SIDE = 1600
const QUALITY = 0.8

/**
 * Shrinks a camera photo on the device before upload (a 4 MB phone photo
 * becomes ~300 KB). Videos, small images and anything the browser can't
 * decode are returned unchanged; the server validates every file anyway.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 300 * 1024) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]*$/, '') || 'photo'
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}

/** Keeps only photo/video files, at most UPLOAD_MAX_FILES, compressed. */
export async function prepareUploads(files: Iterable<File>): Promise<File[]> {
  const usable = [...files]
    .filter((f) => !f.type || UPLOAD_ALLOWED_TYPES.includes(f.type) || f.type.startsWith('image/'))
    .slice(0, UPLOAD_MAX_FILES)
  return Promise.all(usable.map(compressImage))
}

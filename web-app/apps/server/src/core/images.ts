import { logger } from './logger.js'

/*
 * Photos are stored small so years of evidence fit in the storage plan:
 *   new photo   longest side 1280px, WebP q72   (~60–120 KB)
 *   thumbnail   longest side 320px,  WebP q60   (~8–15 KB) for lists and galleries
 *   after 6 months the full photo is re-saved at 800px, WebP q55 (~30–50 KB)
 * EXIF orientation is applied and metadata (GPS etc.) dropped.
 */

export const PHOTO = { side: 1280, quality: 72 }
export const THUMB = { side: 320, quality: 60 }
export const COMPACT = { side: 800, quality: 55 }

export interface OptimizedPhoto {
  main: Buffer
  thumb: Buffer
  width: number
  height: number
}

/**
 * Decoding is capped (a small PNG can declare 16k×16k pixels and expand to
 * gigabytes; the portal accepts photos from anyone). 120 MP still covers the
 * largest phone cameras.
 */
const MAX_INPUT_PIXELS = 120_000_000

async function toWebp(input: Buffer, side: number, quality: number) {
  // Loaded on first use: the native module adds ~60 ms to every cold start.
  const { default: sharp } = await import('sharp')
  const { data, info } = await sharp(input, {
    failOn: 'none',
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Resized WebP + thumbnail; null when the image can't be decoded. Callers must
 * then refuse the upload: the original would still carry its EXIF (GPS etc.).
 */
export async function optimizePhoto(input: Buffer): Promise<OptimizedPhoto | null> {
  try {
    const main = await toWebp(input, PHOTO.side, PHOTO.quality)
    const thumb = await toWebp(main.data, THUMB.side, THUMB.quality)
    // Always the re-encoded copy, even when it's a little bigger than a small
    // original: the original still carries its EXIF (GPS location, device).
    return {
      main: main.data,
      thumb: thumb.data,
      width: main.width,
      height: main.height,
    }
  } catch (err) {
    logger.warn({ err }, 'photo could not be decoded; upload refused')
    return null
  }
}

/** Smaller copy for photos older than the compaction age. */
export async function compactPhoto(input: Buffer): Promise<Buffer | null> {
  try {
    const out = await toWebp(input, COMPACT.side, COMPACT.quality)
    return out.data.length < input.length ? out.data : null
  } catch (err) {
    logger.warn({ err }, 'photo could not be compacted')
    return null
  }
}

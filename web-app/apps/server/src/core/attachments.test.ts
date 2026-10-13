import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import sharp from 'sharp'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { storage } from '../storage/index.js'
import { resetDatabase } from '../test/db.js'
import { saveAttachments } from './attachments.js'
import { AppError } from './errors.js'
import { prisma } from './prisma.js'

/* Uploaded photos are always re-encoded: undecodable ones are refused, metadata is dropped. */

const file = (buffer: Buffer, originalname: string, mimetype = 'image/jpeg') =>
  ({ buffer, originalname, mimetype, size: buffer.length }) as Express.Multer.File

/** Every file in the test storage folder (relative paths). */
async function storedFiles(): Promise<string[]> {
  const root = process.env.STORAGE_LOCAL_DIR!
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name))
  } catch {
    return []
  }
}

async function readStored(key: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of (await storage.getStream(key)) as Readable) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

/** A real camera-style JPEG carrying a device name and a GPS position in its EXIF. */
async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: '#c33' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestCam', Model: 'Pocket 1' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '12/1 58/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '77/1 35/1 0/1',
      },
    })
    .toBuffer()
}

/** JPEG magic bytes followed by garbage: passes the type sniffing, can't be decoded. */
const BROKEN_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(800, 7)])

beforeEach(async () => {
  await resetDatabase()
})
afterAll(async () => {
  await prisma.$disconnect()
})

describe('saveAttachments photo handling', () => {
  it('refuses a photo that cannot be decoded and stores nothing', async () => {
    const before = await storedFiles()
    const owner = { type: 'REQUEST' as const, id: randomUUID() }
    const err = await saveAttachments([file(BROKEN_JPEG, 'broken.jpg')], owner, null).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).status).toBe(400)
    expect((err as AppError).message).toMatch(/could not be read/)
    expect((err as AppError).fieldErrors).toEqual({ files: ['validation.invalidValue'] })
    expect(await prisma.attachment.count()).toBe(0)
    expect(await storedFiles()).toEqual(before)
  })

  it('a bad photo in a batch stops the whole batch before anything is written', async () => {
    const before = await storedFiles()
    const good = await jpegWithGps()
    const owner = { type: 'REQUEST' as const, id: randomUUID() }
    await expect(
      saveAttachments([file(good, 'good.jpg'), file(BROKEN_JPEG, 'broken.jpg')], owner, null),
    ).rejects.toMatchObject({ status: 400 })
    expect(await prisma.attachment.count()).toBe(0)
    expect(await storedFiles()).toEqual(before)
  })

  it('stores a camera JPEG as WebP without its EXIF (GPS, device)', async () => {
    const original = await jpegWithGps()
    // The test photo really carries EXIF with a GPS block (tag 0x8825).
    const exif = (await sharp(original).metadata()).exif!
    expect(exif.toString('latin1')).toContain('TestCam')
    expect(
      exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])),
    ).toBe(true)

    const owner = { type: 'REQUEST' as const, id: randomUUID() }
    const [id] = await saveAttachments([file(original, 'IMG_0001.jpg')], owner, null)
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: id! } })
    expect(row).toMatchObject({ kind: 'PHOTO', mimeType: 'image/webp', width: 64, height: 48 })
    expect(row.fileName).toBe('IMG_0001.webp')

    for (const key of [row.storageKey, row.thumbKey!]) {
      const stored = await readStored(key)
      expect(stored.includes(Buffer.from('TestCam'))).toBe(false)
      const meta = await sharp(stored).metadata()
      expect(meta.format).toBe('webp')
      expect(meta.exif).toBeUndefined()
      expect(meta.xmp).toBeUndefined()
    }
  })
})

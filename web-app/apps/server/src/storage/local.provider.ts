import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { buildSignedFilePath } from './signing.js'
import {
  assertValidStorageKey,
  type ObjectInfo,
  type PutOptions,
  type SignedUrlOptions,
  type StorageProvider,
  type StoredObject,
} from './storage.provider.js'

/** Files on the API server's disk. Suitable for development and single-server deployments. */
export class LocalStorageProvider implements StorageProvider {
  private readonly root: string

  constructor(
    rootDir: string,
    private readonly signingSecret: string,
  ) {
    this.root = path.resolve(rootDir)
  }

  private resolve(key: string): string {
    assertValidStorageKey(key)
    const full = path.resolve(this.root, key)
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`)
    return full
  }

  async put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject> {
    const full = this.resolve(key)
    await mkdir(path.dirname(full), { recursive: true })
    if (Buffer.isBuffer(body)) {
      await writeFile(full, body)
    } else {
      await pipeline(body, createWriteStream(full))
    }
    const info = await stat(full)
    return { key, size: info.size, mimeType: options.mimeType }
  }

  async getStream(key: string): Promise<Readable> {
    const full = this.resolve(key)
    await stat(full) // throws ENOENT early instead of on first read
    return createReadStream(full)
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const info = await stat(this.resolve(key))
      return info.isFile() ? { size: info.size } : null
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true })
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    assertValidStorageKey(key)
    return buildSignedFilePath(
      {
        key,
        exp: Math.floor(Date.now() / 1000) + options.expiresInSeconds,
        type: options.mimeType,
        name: options.fileName,
        dl: options.disposition === 'attachment' ? '1' : '0',
      },
      this.signingSecret,
    )
  }
}

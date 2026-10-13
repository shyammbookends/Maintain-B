import type { Readable } from 'node:stream'

export interface PutOptions {
  mimeType: string
}

export interface StoredObject {
  key: string
  size: number
  mimeType: string
}

export interface ObjectInfo {
  size: number
}

export interface SignedUrlOptions {
  expiresInSeconds: number
  mimeType: string
  fileName: string
  /** inline = open in the browser (images, PDFs); attachment = force download. */
  disposition?: 'inline' | 'attachment'
}

/**
 * Storage abstraction. Files are private: nothing is served without a
 * permission check followed by a short-lived signed URL.
 *
 * Implementations: LocalStorageProvider (dev / single server),
 * SupabaseStorageProvider (Supabase Storage bucket) and S3StorageProvider
 * (AWS S3, Cloudflare R2) — chosen by STORAGE_DRIVER.
 */
export interface StorageProvider {
  put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject>
  getStream(key: string): Promise<Readable>
  head(key: string): Promise<ObjectInfo | null>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  /** Returns a URL (absolute, or API-relative for the local driver) valid for a limited time. */
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/

/** Keys are opaque paths like `attachments/2026/10/abc123.jpg`. No traversal, no absolute paths. */
export function assertValidStorageKey(key: string): void {
  if (
    !KEY_PATTERN.test(key) ||
    key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new Error(`Invalid storage key: ${key}`)
  }
}

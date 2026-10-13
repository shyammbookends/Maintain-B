import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import {
  assertValidStorageKey,
  type ObjectInfo,
  type PutOptions,
  type SignedUrlOptions,
  type StorageProvider,
  type StoredObject,
} from './storage.provider.js'

export interface SupabaseStorageConfig {
  /** https://<project-ref>.supabase.co */
  url: string
  /** Service-role key: server only, never sent to the browser. */
  serviceKey: string
  bucket: string
}

/**
 * Supabase Storage through its REST API. The bucket is private: the server
 * checks permissions, then hands out short-lived signed links.
 */
export class SupabaseStorageProvider implements StorageProvider {
  private readonly base: string

  constructor(private readonly cfg: SupabaseStorageConfig) {
    this.base = `${cfg.url.replace(/\/+$/, '')}/storage/v1`
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.cfg.serviceKey}`,
      apikey: this.cfg.serviceKey,
      ...extra,
    }
  }

  private path(key: string) {
    assertValidStorageKey(key)
    return `${encodeURIComponent(this.cfg.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`
  }

  private async fail(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase storage ${what} failed (${res.status}): ${text.slice(0, 200)}`)
  }

  async put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject> {
    const buffer = Buffer.isBuffer(body) ? body : await streamToBuffer(body)
    const upload = () =>
      fetch(`${this.base}/object/${this.path(key)}`, {
        method: 'POST',
        headers: this.headers({
          'Content-Type': options.mimeType,
          'x-upsert': 'true',
          'Cache-Control': 'max-age=31536000',
        }),
        body: new Uint8Array(buffer),
      })
    let res = await upload()
    // First upload to a new project: create the private bucket, then retry once.
    if (!res.ok && (await isBucketMissing(res)) && (await this.createBucket())) res = await upload()
    if (!res.ok) await this.fail(res, 'upload')
    return { key, size: buffer.length, mimeType: options.mimeType }
  }

  /** Creates the bucket as private; true when it exists afterwards. */
  private async createBucket(): Promise<boolean> {
    const res = await fetch(`${this.base}/bucket`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: this.cfg.bucket, name: this.cfg.bucket, public: false }),
    })
    // 409 / "already exists": someone created it in the meantime.
    return res.ok || res.status === 409 || res.status === 400
  }

  async getStream(key: string): Promise<Readable> {
    const res = await fetch(`${this.base}/object/authenticated/${this.path(key)}`, {
      headers: this.headers(),
    })
    if (!res.ok || !res.body) await this.fail(res, 'download')
    return Readable.fromWeb(res.body as unknown as WebReadableStream)
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const res = await fetch(`${this.base}/object/info/authenticated/${this.path(key)}`, {
      headers: this.headers(),
    })
    if (res.status === 400 || res.status === 404) return null
    if (!res.ok) await this.fail(res, 'info')
    const info = (await res.json()) as { size?: number; metadata?: { size?: number } }
    return { size: info.size ?? info.metadata?.size ?? 0 }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key)
    const res = await fetch(`${this.base}/object/${encodeURIComponent(this.cfg.bucket)}`, {
      method: 'DELETE',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: [key] }),
    })
    if (!res.ok && res.status !== 404) await this.fail(res, 'delete')
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const res = await fetch(`${this.base}/object/sign/${this.path(key)}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: options.expiresInSeconds }),
    })
    if (!res.ok) await this.fail(res, 'sign')
    const { signedURL } = (await res.json()) as { signedURL: string }
    const url = `${this.base}${signedURL.startsWith('/') ? '' : '/'}${signedURL}`
    return options.disposition === 'attachment'
      ? `${url}&download=${encodeURIComponent(options.fileName)}`
      : url
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** Supabase answers a missing bucket with 400/404 and "Bucket not found". */
async function isBucketMissing(res: Response): Promise<boolean> {
  if (res.status !== 400 && res.status !== 404) return false
  const text = await res.clone().text().catch(() => '')
  return /bucket not found/i.test(text)
}

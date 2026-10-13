import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  assertValidStorageKey,
  type ObjectInfo,
  type PutOptions,
  type SignedUrlOptions,
  type StorageProvider,
  type StoredObject,
} from './storage.provider.js'

export interface S3StorageConfig {
  bucket: string
  region: string
  /** Custom endpoint for S3-compatible services (Cloudflare R2, DigitalOcean Spaces). */
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle?: boolean
  /** Optional prefix so several environments can share a bucket. */
  prefix?: string
}

function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

const isNotFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404
}

/**
 * Private bucket storage. Objects are never public: downloads use pre-signed
 * GET URLs that carry the content type and file name and expire quickly.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly prefix: string

  constructor(config: S3StorageConfig, client?: S3Client) {
    this.bucket = config.bucket
    this.prefix = config.prefix ? config.prefix.replace(/\/+$/, '') + '/' : ''
    const options: S3ClientConfig = {
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
    }
    this.client = client ?? new S3Client(options)
  }

  private objectKey(key: string): string {
    assertValidStorageKey(key)
    return this.prefix + key
  }

  async put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject> {
    const buffer = Buffer.isBuffer(body) ? body : await streamToBuffer(body)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: buffer,
        ContentType: options.mimeType,
        ServerSideEncryption: 'AES256',
      }),
    )
    return { key, size: buffer.length, mimeType: options.mimeType }
  }

  async getStream(key: string): Promise<Readable> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    )
    const body = out.Body
    if (!body) throw new Error(`Empty object: ${key}`)
    return body instanceof Readable ? body : Readable.fromWeb(body as never)
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      )
      return { size: out.ContentLength ?? 0 }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    )
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        ResponseContentType: options.mimeType,
        ResponseContentDisposition: contentDisposition(
          options.disposition ?? 'inline',
          options.fileName,
        ),
        ResponseCacheControl: 'private, max-age=0, no-store',
      }),
      { expiresIn: options.expiresInSeconds },
    )
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

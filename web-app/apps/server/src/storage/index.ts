import { env } from '../config/env.js'
import { LocalStorageProvider } from './local.provider.js'
import { SupabaseStorageProvider } from './supabase.provider.js'
import type { StorageProvider } from './storage.provider.js'

/**
 * The AWS SDK takes ~100 ms to load, so the S3 provider is imported on the
 * first storage call instead of on every (serverless) cold start.
 */
function lazyProvider(load: () => Promise<StorageProvider>): StorageProvider {
  let provider: Promise<StorageProvider> | undefined
  const get = () => (provider ??= load())
  return {
    put: async (...args) => (await get()).put(...args),
    getStream: async (...args) => (await get()).getStream(...args),
    head: async (...args) => (await get()).head(...args),
    exists: async (...args) => (await get()).exists(...args),
    delete: async (...args) => (await get()).delete(...args),
    getSignedUrl: async (...args) => (await get()).getSignedUrl(...args),
  }
}

function createStorage(): StorageProvider {
  if (env.STORAGE_DRIVER === 'local') {
    return new LocalStorageProvider(env.STORAGE_LOCAL_DIR, env.FILE_SIGNING_SECRET)
  }
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3')
    const bucket = env.S3_BUCKET
    return lazyProvider(async () => {
      const { S3StorageProvider } = await import('./s3.provider.js')
      return new S3StorageProvider({
        bucket,
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        prefix: env.S3_PREFIX,
      })
    })
  }
  if (env.STORAGE_DRIVER === 'supabase') {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_DRIVER=supabase',
      )
    return new SupabaseStorageProvider({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_BUCKET,
    })
  }
  throw new Error(`Unsupported STORAGE_DRIVER: ${String(env.STORAGE_DRIVER)}`)
}

export const storage: StorageProvider = createStorage()
export type { StorageProvider, SignedUrlOptions, StoredObject } from './storage.provider.js'

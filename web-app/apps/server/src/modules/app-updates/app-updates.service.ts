import { z } from 'zod'
import { env } from '../../config/env.js'
import { logger } from '../../core/logger.js'
import { SupabaseStorageProvider } from '../../storage/supabase.provider.js'

/**
 * Phone app updates. Release builds (mobile-app/tool/release_android.mjs) are
 * uploaded to the private `app-releases` bucket next to `latest.json`. A
 * signed-in phone asks whether a newer build exists and gets a short-lived
 * download link; the APK itself is never public.
 */
export const RELEASES_BUCKET = 'app-releases'
const MANIFEST_KEY = 'latest.json'
const LINK_SECONDS = 60 * 60
const CACHE_MS = 60_000

const notesSchema = z.array(z.string().max(200)).max(10)

const androidReleaseSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  build: z.number().int().positive(),
  /** Builds below this must update before the app can be used. */
  minBuild: z.number().int().nonnegative(),
  file: z.string().regex(/^android\/[A-Za-z0-9._-]+\.apk$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(),
  notes: z.object({ en: notesSchema, hi: notesSchema, gu: notesSchema }).partial().default({}),
  publishedAt: z.string(),
})

export const manifestSchema = z.object({ android: androidReleaseSchema.nullable().default(null) })

export type ReleaseManifest = z.output<typeof manifestSchema>
type AndroidRelease = NonNullable<ReleaseManifest['android']>

export type UpdateDecision =
  | { available: false }
  | { available: true; required: boolean; release: AndroidRelease }

/** Whether a phone running [build] on [platform] should update. */
export function decideUpdate(
  manifest: ReleaseManifest | null,
  platform: 'android' | 'ios',
  build: number,
): UpdateDecision {
  const release = platform === 'android' ? manifest?.android : null
  if (!release || build >= release.build) return { available: false }
  return { available: true, required: build < release.minBuild, release }
}

let releases: SupabaseStorageProvider | null | undefined
function releasesStorage(): SupabaseStorageProvider | null {
  if (releases === undefined) {
    releases =
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseStorageProvider({
            url: env.SUPABASE_URL,
            serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
            bucket: RELEASES_BUCKET,
          })
        : null
  }
  return releases
}

let cached: { at: number; manifest: ReleaseManifest | null } | undefined

async function loadManifest(storage: SupabaseStorageProvider): Promise<ReleaseManifest | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.manifest
  let manifest: ReleaseManifest | null = null
  try {
    if (await storage.exists(MANIFEST_KEY)) {
      const chunks: Buffer[] = []
      for await (const chunk of await storage.getStream(MANIFEST_KEY)) chunks.push(Buffer.from(chunk))
      manifest = manifestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    }
  } catch (err) {
    // A broken or unreachable manifest must never stop the app: just no update offer.
    logger.warn({ err }, 'app release manifest unavailable')
  }
  cached = { at: Date.now(), manifest }
  return manifest
}

export interface UpdateInfo {
  available: boolean
  required?: boolean
  version?: string
  build?: number
  notes?: string[]
  sha256?: string
  size?: number
  url?: string
}

export async function getUpdate(
  platform: 'android' | 'ios',
  build: number,
  locale: string,
): Promise<UpdateInfo> {
  const storage = releasesStorage()
  if (!storage) return { available: false }
  const decision = decideUpdate(await loadManifest(storage), platform, build)
  if (!decision.available) return { available: false }
  const { release } = decision
  const notes = release.notes[locale as 'en' | 'hi' | 'gu'] ?? release.notes.en ?? []
  const url = await storage.getSignedUrl(release.file, {
    expiresInSeconds: LINK_SECONDS,
    mimeType: 'application/vnd.android.package-archive',
    fileName: `BookendsMaintenance-${release.version}.apk`,
    disposition: 'attachment',
  })
  return {
    available: true,
    required: decision.required,
    version: release.version,
    build: release.build,
    notes,
    sha256: release.sha256,
    size: release.size,
    url,
  }
}

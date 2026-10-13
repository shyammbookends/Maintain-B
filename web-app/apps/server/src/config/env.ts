import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

// Loads apps/server/.env when present. Real environment variables always win.
loadDotenv({ quiet: true })

// On Vercel, fill in what the platform already knows so a fresh deployment
// works with only the secrets and DATABASE_URL configured.
if (process.env.VERCEL) {
  // A Vercel deployment always runs as production: test-only routes and
  // development conveniences must never be reachable there.
  process.env.NODE_ENV ??= 'production'
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  if (host) {
    process.env.APP_URL ??= `https://${host}`
    process.env.CORS_ORIGIN ??= `https://${host}`
  }
  process.env.TRUST_PROXY ??= 'true'
  // Only /tmp is writable on Vercel and it isn't shared: use STORAGE_DRIVER=s3 for real files.
  process.env.STORAGE_LOCAL_DIR ??= '/tmp/maintainx-storage'
  // Vercel functions accept request bodies up to 4.5 MB.
  process.env.MAX_UPLOAD_MB ??= '4'
}

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const commaSeparated = z
  .string()
  .min(1)
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: booleanString.default(false),

    DATABASE_URL: z
      .string()
      .min(1)
      .refine((s) => s.startsWith('postgresql://') || s.startsWith('postgres://'), {
        message: 'must be a postgresql:// connection string',
      }),

    APP_URL: z.url(),
    CORS_ORIGIN: commaSeparated,

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    COOKIE_SECURE: booleanString.optional(),

    STORAGE_DRIVER: z.enum(['local', 's3', 'supabase']).default('local'),
    /** Supabase Storage (STORAGE_DRIVER=supabase): project URL, service-role key, private bucket. */
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    SUPABASE_BUCKET: z.string().min(3).default('maintenance-files'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('./storage'),
    FILE_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** S3-compatible storage (AWS S3, Cloudflare R2). Used when STORAGE_DRIVER=s3. */
    S3_BUCKET: z.string().min(3).optional(),
    S3_REGION: z.string().min(1).default('ap-south-1'),
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: booleanString.optional(),
    S3_PREFIX: z.string().max(100).optional(),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
    /** Plan limits used for the storage meter and alerts (Supabase free: 1 GB files, 500 MB database). */
    STORAGE_QUOTA_MB: z.coerce.number().positive().default(1024),
    DATABASE_QUOTA_MB: z.coerce.number().positive().default(500),

    /** Protects GET /api/v1/jobs/run (Vercel Cron sends it as a Bearer token). */
    CRON_SECRET: z.string().min(16).optional(),

    /** Email notifications (optional), e.g. smtps://user:pass@smtp.example.com:465 */
    SMTP_URL: z.string().min(8).optional(),
    MAIL_FROM: z.string().min(3).optional(),
    /** Web Push (optional): generate with `npm run push:keys` (see docs/DEPLOYMENT.md). */
    VAPID_PUBLIC_KEY: z.string().min(20).optional(),
    VAPID_PRIVATE_KEY: z.string().min(20).optional(),
    VAPID_SUBJECT: z.string().min(5).optional(),

    /** Sign in with Google (optional): OAuth client from console.cloud.google.com. */
    GOOGLE_CLIENT_ID: z.string().min(10).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
    /** Sign in with Microsoft (optional): app registration in Microsoft Entra ID. */
    MICROSOFT_CLIENT_ID: z.string().min(10).optional(),
    MICROSOFT_CLIENT_SECRET: z.string().min(10).optional(),
    /** Your directory (tenant) id; only accounts from it can sign in. */
    MICROSOFT_TENANT_ID: z
      .string()
      .min(3)
      .refine((t) => !['common', 'organizations', 'consumers'].includes(t.toLowerCase()), {
        message: 'must be your own tenant id or domain (not common/organizations/consumers)',
      })
      .optional(),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    // Per IP: staff on one restaurant Wi-Fi share an address, and chat polls every few seconds.
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1500),
  })
  .transform((e) => ({
    ...e,
    COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    isProduction: e.NODE_ENV === 'production',
    isDevelopment: e.NODE_ENV === 'development',
    isTest: e.NODE_ENV === 'test',
  }))
  .superRefine((e, ctx) => {
    if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      })
    }
    if (!!e.VAPID_PUBLIC_KEY !== !!e.VAPID_PRIVATE_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PRIVATE_KEY'],
        message: 'set both VAPID keys (or neither)',
      })
    }
    if (e.SMTP_URL && !/^smtps?:\/\//.test(e.SMTP_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'must start with smtp:// or smtps://',
      })
    }
    if (e.isProduction && !e.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production',
      })
    }
  })

/** Values copied from .env.example / docs: never valid as real secrets. */
const PLACEHOLDER_SECRET = /replace-with|change[-_]?me|example|placeholder|^(.)\1+$/i

/**
 * Production must fail closed: obviously fake secrets, wildcard origins, plain
 * HTTP URLs or a test/dev NODE_ENV on a hosting platform stop the server.
 */
export function productionIssues(e: Record<string, unknown>): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = []
  const hosted = !!e.VERCEL
  if (hosted && e.NODE_ENV !== 'production') {
    issues.push({ path: 'NODE_ENV', message: 'must be production on Vercel' })
  }
  if (e.NODE_ENV !== 'production') return issues
  const secrets = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'FILE_SIGNING_SECRET', 'CRON_SECRET']
  for (const key of secrets) {
    const v = e[key]
    if (typeof v === 'string' && PLACEHOLDER_SECRET.test(v)) {
      issues.push({ path: key, message: 'is a placeholder value: generate a random secret' })
    }
  }
  const values = secrets.map((k) => e[k]).filter((v): v is string => typeof v === 'string')
  if (new Set(values).size !== values.length) {
    issues.push({ path: 'FILE_SIGNING_SECRET', message: 'every secret must be different' })
  }
  if (typeof e.CORS_ORIGIN === 'string' && e.CORS_ORIGIN.split(',').some((o) => o.trim() === '*')) {
    issues.push({ path: 'CORS_ORIGIN', message: 'must list exact origins (no *) in production' })
  }
  if (typeof e.APP_URL === 'string' && !e.APP_URL.startsWith('https://')) {
    issues.push({ path: 'APP_URL', message: 'must be https:// in production' })
  }
  return issues
}

const parsed = envSchema.safeParse(process.env)
const extraIssues = productionIssues(process.env)

if (!parsed.success || extraIssues.length > 0) {
  const lines = [
    ...(parsed.success ? [] : parsed.error.issues).map(
      (i) => `  - ${i.path.map(String).join('.') || '(root)'}: ${i.message}`,
    ),
    ...extraIssues.map((i) => `  - ${i.path}: ${i.message}`),
  ]
  // The logger depends on env, so write directly to stderr here.
  process.stderr.write(
    `\nInvalid environment configuration (see apps/server/.env.example):\n${lines.join('\n')}\n\n`,
  )
  process.exit(1)
}

export const env = parsed.data!
export type Env = typeof env

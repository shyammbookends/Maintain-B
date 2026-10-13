#!/usr/bin/env node
/**
 * Sets up Supabase for photos/files and (optionally) the database — no Docker.
 *
 * A) Existing project: create the private bucket only.
 *      SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/supabase-setup.mjs
 *
 * B) From scratch with a personal access token (supabase.com → Account → Access Tokens):
 *      SUPABASE_ACCESS_TOKEN=sbp_... node scripts/supabase-setup.mjs
 *    Creates the free project "bookends-maintenance" in Mumbai (or reuses it), waits until
 *    it is ready, creates the bucket and prints the environment variables to set.
 *    Delete the access token afterwards; nothing here writes it to disk.
 *
 * Options (env): SUPABASE_PROJECT_NAME, SUPABASE_REGION (ap-south-1), SUPABASE_BUCKET
 * (maintenance-files), SUPABASE_DB_PASSWORD (generated when creating a project).
 */
import { randomBytes } from 'node:crypto'

const API = 'https://api.supabase.com/v1'
const NAME = process.env.SUPABASE_PROJECT_NAME ?? 'bookends-maintenance'
const REGION = process.env.SUPABASE_REGION ?? 'ap-south-1'
const BUCKET = process.env.SUPABASE_BUCKET ?? 'maintenance-files'
/** Phone photos are compressed before upload; 25 MB leaves room for short videos. */
const FILE_LIMIT = 25 * 1024 * 1024

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(url, init = {}, token) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  const text = await res.text()
  const body = text ? (() => { try { return JSON.parse(text) } catch { return text } })() : null
  if (!res.ok) {
    const err = new Error(`${init.method ?? 'GET'} ${url} → ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

async function ensureBucket(url, serviceKey) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  const buckets = await call(`${url}/storage/v1/bucket`, { headers })
  if (buckets.some((b) => b.id === BUCKET)) {
    console.log(`✔ Bucket "${BUCKET}" already exists`)
    return
  }
  await call(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: FILE_LIMIT }),
  })
  console.log(`✔ Created private bucket "${BUCKET}"`)
}

async function fromAccessToken(token) {
  const projects = await call(`${API}/projects`, {}, token)
  let project = projects.find((p) => p.name === NAME)
  let dbPassword = process.env.SUPABASE_DB_PASSWORD
  if (project) {
    console.log(`✔ Using existing project "${NAME}" (${project.id})`)
  } else {
    const orgs = await call(`${API}/organizations`, {}, token)
    if (!orgs.length) throw new Error('No Supabase organization found for this token.')
    dbPassword ??= randomBytes(18).toString('base64url')
    project = await call(
      `${API}/projects`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: NAME,
          organization_id: orgs[0].id,
          region: REGION,
          db_pass: dbPassword,
          plan: 'free',
        }),
      },
      token,
    )
    console.log(`✔ Created project "${NAME}" (${project.id}) in ${REGION} on the free plan`)
  }
  const ref = project.id

  process.stdout.write('… waiting for the project to be ready')
  for (let i = 0; i < 90; i++) {
    const p = await call(`${API}/projects/${ref}`, {}, token)
    if (p.status === 'ACTIVE_HEALTHY') break
    process.stdout.write('.')
    await sleep(5000)
  }
  console.log(' ready')

  const keys = await call(`${API}/projects/${ref}/api-keys?reveal=true`, {}, token)
  const service = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!service?.api_key) throw new Error('Could not read the service_role key.')
  const url = `https://${ref}.supabase.co`
  await ensureBucket(url, service.api_key)

  // Vercel functions use IPv4: the session pooler connection string works there.
  let databaseUrl = null
  try {
    const pooler = await call(`${API}/projects/${ref}/config/database/pooler`, {}, token)
    const session = (Array.isArray(pooler) ? pooler : [pooler]).find(
      (p) => p.pool_mode === 'session' || p.database_type === 'PRIMARY',
    )
    if (session?.connection_string)
      databaseUrl = session.connection_string
        .replace(':6543/', ':5432/')
        .replace('[YOUR-PASSWORD]', dbPassword ? encodeURIComponent(dbPassword) : '[YOUR-PASSWORD]')
  } catch {
    /* older API: fall back to the direct host below */
  }
  databaseUrl ??= `postgresql://postgres:${dbPassword ? encodeURIComponent(dbPassword) : '[YOUR-PASSWORD]'}@db.${ref}.supabase.co:5432/postgres`

  console.log('\nSet these on the server / in Vercel (Settings → Environment Variables):\n')
  console.log(`STORAGE_DRIVER=supabase`)
  console.log(`SUPABASE_URL=${url}`)
  console.log(`SUPABASE_SERVICE_ROLE_KEY=${service.api_key}`)
  console.log(`SUPABASE_BUCKET=${BUCKET}`)
  console.log(`DATABASE_URL=${databaseUrl}`)
  if (!dbPassword)
    console.log('\n(Replace [YOUR-PASSWORD] with the database password from the Supabase dashboard.)')
  console.log('\nThen run the migrations against it:  npm run db:deploy')
  console.log('Keep the service_role key secret, and delete the access token now.')
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN } = process.env
try {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    await ensureBucket(SUPABASE_URL.replace(/\/+$/, ''), SUPABASE_SERVICE_ROLE_KEY)
  } else if (SUPABASE_ACCESS_TOKEN) {
    await fromAccessToken(SUPABASE_ACCESS_TOKEN)
  } else {
    console.error(
      'Set SUPABASE_ACCESS_TOKEN (new project), or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (bucket only).',
    )
    process.exit(1)
  }
} catch (err) {
  console.error(`✖ ${err.message}`)
  process.exit(1)
}

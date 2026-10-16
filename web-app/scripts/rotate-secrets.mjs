#!/usr/bin/env node
/**
 * Changes a production secret without pasting it anywhere: asks for it in this
 * terminal (hidden), checks that it works, then updates apps/server/.env and the
 * Vercel production variables and redeploys.
 *
 *   npm run secrets:rotate
 *
 * 1  Database password  (after "Reset database password" in Supabase)
 * 2  Supabase secret key (a new sb_secret_… key from Project Settings → API Keys)
 * 3  CRON_SECRET (generated here; also paste it into the GitHub Actions secret)
 *
 * Needs the Vercel CLI signed in (`vercel whoami`) and the project linked (.vercel/).
 */
import { execFileSync, execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(root, 'apps', 'server', '.env')
const win = process.platform === 'win32'

const fail = (m) => {
  console.error(`\n✖ ${m}`)
  process.exit(1)
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })
    if (hidden)
      rl._writeToOutput = (s) =>
        rl.output.write(s.startsWith(question) ? s : '*'.repeat(s.length ? 1 : 0))
    rl.question(question, (a) => {
      rl.close()
      if (hidden) process.stdout.write('\n')
      resolve(a.trim())
    })
  })
}

const readEnv = () => readFileSync(envFile, 'utf8')
const getEnv = (name) => {
  const m = new RegExp(`^${name}=(.*)$`, 'm').exec(readEnv())
  return m ? m[1].replace(/^"(.*)"$/, '$1') : undefined
}
function setEnv(name, value) {
  let s = readEnv()
  const line = `${name}=${value}`
  s = new RegExp(`^${name}=.*$`, 'm').test(s)
    ? s.replace(new RegExp(`^${name}=.*$`, 'm'), () => line)
    : `${s.trimEnd()}\n${line}\n`
  writeFileSync(envFile, s)
}

function vercel(args, input) {
  const cmd = win ? 'cmd' : 'vercel'
  const full = win ? ['/c', 'vercel', ...args] : args
  return execFileSync(cmd, full, {
    cwd: root,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}
const setVercel = (name, value) => vercel(['env', 'add', name, 'production', '--force'], value)

function redeploy() {
  const line = vercel(['ls', 'maintain-b'])
    .split('\n')
    .find((l) => /https:\/\/maintain-\S+ .*Ready.*Production/.test(l))
  const url = line?.match(/https:\/\/maintain-\S+/)?.[0]
  if (!url) return console.log('⚠ Could not find the live deployment: push any commit to redeploy.')
  console.log(`▶ Redeploying ${url} with the new value (2–4 min)…`)
  vercel(['redeploy', url, '--target', 'production'])
  console.log('✔ Redeployed')
}

/** postgresql://user:<password>@host:port/db?params with the password swapped (URL-encoded). */
function withPassword(url, password, port, params = '') {
  const u = new URL(url)
  u.password = password // the URL setter percent-encodes @ : / and friends
  u.port = String(port)
  u.search = params
  return u.toString()
}

async function dbPassword() {
  const current = getEnv('DATABASE_URL')
  if (!current?.includes('pooler.supabase.com'))
    fail('DATABASE_URL in apps/server/.env is not a Supabase pooler URL')
  const pw = await ask('New database password (hidden): ', { hidden: true })
  if (pw.length < 12) fail('Use at least 12 characters')
  const session = withPassword(current, pw, 5432)
  const transaction = withPassword(
    current,
    pw,
    6543,
    '?pgbouncer=true&connection_limit=2&pool_timeout=30',
  )
  console.log('▶ Checking the new password…')
  try {
    execSync('npx prisma migrate status', {
      cwd: join(root, 'apps', 'server'),
      env: { ...process.env, DATABASE_URL: session },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    if (!/up to date|following migration/i.test(out))
      fail(
        `The database refused it:\n${out
          .split('\n')
          .filter((l) => /Error|FATAL/.test(l))
          .join('\n')}`,
      )
  }
  setEnv('DATABASE_URL', session)
  setVercel('MIGRATE_DATABASE_URL', session)
  setVercel('DATABASE_URL', transaction)
  console.log('✔ Saved in .env and Vercel')
  redeploy()
}

async function supabaseKey() {
  const url = getEnv('SUPABASE_URL')?.replace(/\/+$/, '')
  if (!url) fail('SUPABASE_URL missing in apps/server/.env')
  const key = await ask('New Supabase secret key sb_secret_… (hidden): ', { hidden: true })
  if (!key.startsWith('sb_secret_')) fail('That is not a secret key (it starts with sb_secret_)')
  console.log('▶ Checking the key against the private buckets…')
  const res = await fetch(`${url}/storage/v1/bucket/maintenance-files`, {
    headers: { apikey: key },
  })
  if (!res.ok) fail(`Supabase refused the key (${res.status})`)
  setEnv('SUPABASE_SERVICE_ROLE_KEY', key)
  setVercel('SUPABASE_SERVICE_ROLE_KEY', key)
  console.log('✔ Saved in .env and Vercel')
  redeploy()
  console.log('\nWhen the site works (sign in, open a photo), disable the legacy keys in Supabase:')
  console.log('Project Settings → API Keys → "Legacy anon, service_role API keys" → Disable.')
}

async function cronSecret() {
  const value = randomBytes(48).toString('hex')
  setVercel('CRON_SECRET', value)
  console.log('✔ New CRON_SECRET saved in Vercel.')
  console.log(
    '\nNow paste it into GitHub → Settings → Secrets and variables → Actions → CRON_SECRET → Update:\n',
  )
  console.log(`   ${value}\n`)
  redeploy()
}

try {
  vercel(['whoami'])
} catch {
  fail('The Vercel CLI is not signed in: run "vercel login" first')
}
const choice = await ask(
  'What do you want to change?  1 = database password, 2 = Supabase secret key, 3 = CRON_SECRET : ',
)
if (choice === '1') await dbPassword()
else if (choice === '2') await supabaseKey()
else if (choice === '3') await cronSecret()
else fail('Choose 1, 2 or 3')

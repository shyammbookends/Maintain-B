#!/usr/bin/env node
/**
 * Publishes a new Android build as an in-app update (lib/core/updater.dart).
 *
 *   node tool/release_android.mjs              # build, upload, phones are offered the update
 *   node tool/release_android.mjs --required   # phones must update before they can continue
 *   node tool/release_android.mjs --skip-build # upload the APK that is already built
 *
 * Before running: bump `version:` in pubspec.yaml and write tool/release_notes.json
 * ({ "en": [...], "hi": [...], "gu": [...] }, up to 10 short lines each).
 *
 * Needs android/key.properties (the release key: a debug-signed APK could never
 * update the installed app) and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, read
 * from ../web-app/apps/server/.env unless set in the environment. The APK goes
 * to the private `app-releases` bucket; the server hands out one-hour links.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const BUCKET = 'app-releases'
const SERVER = process.env.API_SERVER ?? 'https://maintain-b.vercel.app'
/** Where the user picks up the APK on this PC (next to the repository folder). */
const COPY_TO = resolve(app, '..', '..', 'BookendsMaintenance.apk')
const KEEP = 2 // newest APKs kept in the bucket (current + previous)

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function serverEnv() {
  const file = join(app, '..', 'web-app', 'apps', 'server', '.env')
  const out = {}
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    }
  }
  return out
}

const [, version, build] =
  /^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$/m.exec(readFileSync(join(app, 'pubspec.yaml'), 'utf8')) ??
  fail('pubspec.yaml has no "version: X.Y.Z+N" line')
const buildNo = Number(build)
if (buildNo >= 1000) fail('build number must stay below 1000 (split APK version codes add 1000 × ABI)')

if (!existsSync(join(app, 'android', 'key.properties')))
  fail('android/key.properties is missing: without the release key the update cannot be installed')

const notesFile = join(app, 'tool', 'release_notes.json')
const notes = existsSync(notesFile) ? JSON.parse(readFileSync(notesFile, 'utf8')) : {}
for (const lang of ['en', 'hi', 'gu']) {
  const list = notes[lang] ?? []
  if (!Array.isArray(list) || list.length > 10 || list.some((n) => typeof n !== 'string' || n.length > 200))
    fail(`release_notes.json: "${lang}" must be up to 10 lines of at most 200 characters`)
}

const env = { ...serverEnv(), ...process.env }
const url = env.SUPABASE_URL?.replace(/\/+$/, '')
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) fail('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found')

const apk = join(app, 'build', 'app', 'outputs', 'flutter-apk', 'app-arm64-v8a-release.apk')
if (!args.has('--skip-build')) {
  console.log(`▶ Building ${version}+${build} for ${SERVER}`)
  const flutter = [
    'build', 'apk', '--release', '--split-per-abi', '--target-platform', 'android-arm64',
    `--dart-define=API_SERVER=${SERVER}`,
    // Smaller APK: debug symbols are kept on this PC (for crash traces), not shipped.
    `--split-debug-info=build/symbols/${version}+${build}`,
  ]
  // flutter is a .bat on Windows, which only cmd can run.
  if (process.platform === 'win32') execFileSync('cmd', ['/c', 'flutter', ...flutter], { cwd: app, stdio: 'inherit' })
  else execFileSync('flutter', flutter, { cwd: app, stdio: 'inherit' })
}
if (!existsSync(apk)) fail(`APK not found: ${apk}`)

const bytes = readFileSync(apk)
const sha256 = createHash('sha256').update(bytes).digest('hex')
// Storage keys allow only letters, digits and . _ - (no "+").
const file = `android/BookendsMaintenance-${version}-b${build}.apk`

const headers = (extra = {}) => ({ Authorization: `Bearer ${key}`, apikey: key, ...extra })
async function storage(path, init = {}) {
  const res = await fetch(`${url}/storage/v1/${path}`, { ...init, headers: headers(init.headers) })
  if (!res.ok) fail(`${init.method ?? 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res
}
const put = (path, body, type) =>
  storage(`object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': type, 'x-upsert': 'true', 'Cache-Control': 'no-cache' },
    body,
  })

// Keep minBuild from the last release unless this one is required.
let minBuild = 0
const prev = await fetch(`${url}/storage/v1/object/authenticated/${BUCKET}/latest.json`, { headers: headers() })
if (prev.ok) minBuild = (await prev.json())?.android?.minBuild ?? 0
if (args.has('--required')) minBuild = buildNo

console.log(`▶ Uploading ${file} (${(bytes.length / 1048576).toFixed(1)} MB)`)
await put(file, bytes, 'application/vnd.android.package-archive')

const manifest = {
  android: {
    version,
    build: buildNo,
    minBuild,
    file,
    sha256,
    size: bytes.length,
    notes: { en: notes.en ?? [], hi: notes.hi ?? [], gu: notes.gu ?? [] },
    publishedAt: new Date().toISOString(),
  },
}
await put('latest.json', JSON.stringify(manifest, null, 2), 'application/json')

// Old builds: keep the newest KEEP so the free storage stays free.
const listed = await (
  await storage(`object/list/${BUCKET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: 'android/', limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
  })
).json()
const old = listed
  .map((o) => `android/${o.name}`)
  .filter((p) => p.endsWith('.apk') && p !== file)
  .slice(KEEP - 1)
if (old.length) {
  await storage(`object/${BUCKET}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: old }),
  })
}

copyFileSync(apk, COPY_TO)
console.log(`\n✔ Released ${version}+${build}${minBuild >= buildNo ? ' (required)' : ''}`)
console.log(`  sha256 ${sha256}`)
console.log(`  copied to ${COPY_TO}`)
if (old.length) console.log(`  removed old: ${old.join(', ')}`)

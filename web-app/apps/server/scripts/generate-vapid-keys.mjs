#!/usr/bin/env node
/**
 * Generates a free Web Push key pair (VAPID) and prints the env lines:
 *   npm run push:keys                 print them (copy into Vercel → Settings → Environment Variables)
 *   npm run push:keys -- --write-env  also add them to apps/server/.env for local development
 *                                     (only when the keys aren't there yet and .env is git-ignored)
 *
 * Generate once per environment: changing the keys later means every browser
 * has to allow notifications again. Keep the private key secret (server only).
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import webpush from 'web-push'

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(serverDir, '.env')

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
const lines = [
  `VAPID_PUBLIC_KEY=${publicKey}`,
  `VAPID_PRIVATE_KEY=${privateKey}`,
  'VAPID_SUBJECT=mailto:you@example.com',
]
console.log(lines.join('\n'))
console.log('\nSet VAPID_SUBJECT to a contact address. Keep the private key secret (server only).')

if (process.argv.includes('--write-env')) {
  const ignored = (() => {
    try {
      execFileSync('git', ['check-ignore', '-q', envFile], { cwd: serverDir })
      return true
    } catch {
      return false
    }
  })()
  const current = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
  if (!ignored) {
    console.error(`\nNot writing: ${envFile} is not git-ignored.`)
    process.exitCode = 1
  } else if (/^VAPID_PUBLIC_KEY=\S/m.test(current)) {
    console.log(`\n${envFile} already has VAPID keys; left unchanged.`)
  } else {
    const prefix = current && !current.endsWith('\n') ? '\n' : ''
    appendFileSync(envFile, `${prefix}\n# Web Push (npm run push:keys)\n${lines.join('\n')}\n`)
    console.log(`\nAdded the keys to ${envFile}.`)
  }
}

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Migrates and re-seeds the e2e database before the run (never a real database). */
export default function globalSetup() {
  const serverDir = fileURLToPath(new URL('../../server', import.meta.url))
  let url = process.env.E2E_DATABASE_URL
  if (!url) {
    const line = readFileSync(`${serverDir}/.env`, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('E2E_DATABASE_URL='))
    url = line?.slice('E2E_DATABASE_URL='.length)
  }
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('E2E_DATABASE_URL must point to a database whose name ends in _test')
  }
  const env = { ...process.env, DATABASE_URL: url }
  execSync('npx prisma migrate deploy', { cwd: serverDir, env, stdio: 'inherit' })
  execSync('npx tsx src/test/e2e-seed.ts', { cwd: serverDir, env, stdio: 'inherit' })
}

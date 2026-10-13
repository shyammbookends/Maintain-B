import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import base from '../e2e/global-setup'

/** e2e seed plus realistic volume (7 restaurants, 1,500 work orders) for layout checks. */
export default function globalSetup() {
  base()
  const serverDir = fileURLToPath(new URL('../../server', import.meta.url))
  const url =
    process.env.E2E_DATABASE_URL ??
    readFileSync(`${serverDir}/.env`, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('E2E_DATABASE_URL='))
      ?.slice('E2E_DATABASE_URL='.length)
  execSync('npx tsx src/test/load-seed.ts', {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
}

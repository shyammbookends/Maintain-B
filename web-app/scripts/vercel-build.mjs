#!/usr/bin/env node
/**
 * Build for Vercel (also runnable locally):
 *   1. shared package  2. Prisma client  3. database migrations + seed
 *   4. API (for the serverless function)  5. web app (static files)
 *
 * Step 3 runs only when DATABASE_URL is set, so a build without a database
 * still produces the site (the API then reports the missing setting).
 */
import { execSync } from 'node:child_process'

const run = (cmd, cwd = '.', env = process.env) => {
  console.log(`\n▶ ${cmd}${cwd === '.' ? '' : `   (${cwd})`}`)
  execSync(cmd, { cwd, stdio: 'inherit', env })
}

// The API uses Supabase's transaction pooler (port 6543: many short connections from
// serverless functions); migrations need a session connection: MIGRATE_DATABASE_URL.
const migrateEnv = {
  ...process.env,
  DATABASE_URL: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL,
}

run('npm run build -w @maintainx/shared')
run('npx prisma generate', 'apps/server')

/** The session pooler can be briefly full (the previous deployment still holds clients). */
function runWithRetry(cmd, cwd, env, attempts = 6) {
  for (let i = 1; ; i++) {
    try {
      return run(cmd, cwd, env)
    } catch (err) {
      if (i >= attempts) throw err
      console.warn(`\n⚠ attempt ${i} failed, retrying in 15 s…`)
      execSync(process.platform === 'win32' ? 'timeout /t 15 /nobreak >nul' : 'sleep 15', { shell: true })
    }
  }
}

if (process.env.DATABASE_URL) {
  runWithRetry('npx prisma migrate deploy', 'apps/server', migrateEnv)
  // Idempotent: permissions, roles, categories, and the first Super Admin
  // (only when SEED_ADMIN_PASSWORD is set).
  runWithRetry('npx tsx prisma/seed.ts', 'apps/server', migrateEnv)
} else {
  console.warn('\n⚠ DATABASE_URL is not set: skipping migrations and seed.')
}

run('npm run build -w @maintainx/server')
run('npm run build -w @maintainx/web')
console.log('\n✔ Vercel build complete')

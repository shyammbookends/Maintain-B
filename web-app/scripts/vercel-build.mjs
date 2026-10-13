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

const run = (cmd, cwd = '.') => {
  console.log(`\n▶ ${cmd}${cwd === '.' ? '' : `   (${cwd})`}`)
  execSync(cmd, { cwd, stdio: 'inherit', env: process.env })
}

run('npm run build -w @maintainx/shared')
run('npx prisma generate', 'apps/server')

if (process.env.DATABASE_URL) {
  run('npx prisma migrate deploy', 'apps/server')
  // Idempotent: permissions, roles, categories, and the first Super Admin
  // (only when SEED_ADMIN_PASSWORD is set).
  run('npx tsx prisma/seed.ts', 'apps/server')
} else {
  console.warn('\n⚠ DATABASE_URL is not set: skipping migrations and seed.')
}

run('npm run build -w @maintainx/server')
run('npm run build -w @maintainx/web')
console.log('\n✔ Vercel build complete')

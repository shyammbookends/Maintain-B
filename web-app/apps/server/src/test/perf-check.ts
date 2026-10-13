/**
 * Times the heavier read endpoints on the load-test data (run after
 * e2e-seed + load-seed). Fails when one is slower than its budget.
 *
 *   DATABASE_URL=…/maintainx_e2e_test npx tsx src/test/perf-check.ts
 */
import { AUTH_CSRF_HEADER, AUTH_CSRF_VALUE } from '@maintainx/shared'
import request from 'supertest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { TEST_PASSWORD, assertTestDatabase } from './db.js'

const BUDGET_MS = 1500

async function main() {
  assertTestDatabase()
  const app = createApp()
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: 'boss', password: TEST_PASSWORD })
  const token = login.body.data.accessToken as string
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 364 * 86_400_000).toISOString().slice(0, 10)
  const wo = await prisma.workOrder.findFirstOrThrow({ select: { id: true } })
  const paths = [
    `/reports/analytics/trends?from=${from}&to=${to}`,
    ...[
      'maintenance-mix',
      'labour',
      'reliability',
      'repeat-failures',
      'failure-analysis',
      'cost-breakdown',
      'vendor-performance',
      'work-order-summary',
    ].map((k) => `/reports/${k}?from=${from}&to=${to}`),
    '/dashboard',
    `/work-orders/${wo.id}`,
    '/work-orders?page=1&pageSize=25',
    '/automations',
  ]
  let slow = 0
  for (const p of paths) {
    const started = performance.now()
    const res = await request(app).get(`/api/v1${p}`).set('Authorization', `Bearer ${token}`)
    const ms = Math.round(performance.now() - started)
    const flag = res.status !== 200 ? `HTTP ${res.status}` : ms > BUDGET_MS ? 'SLOW' : 'ok'
    if (flag !== 'ok') slow++
    console.log(`${String(ms).padStart(6)} ms  ${flag.padEnd(8)} ${p.split('?')[0]}`)
  }
  await prisma.$disconnect()
  if (slow) process.exit(1)
}

void main()

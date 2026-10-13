#!/usr/bin/env node
/**
 * API load test. Signs in, then hammers the screens people open most.
 *
 *   LOAD_URL=http://localhost:4100 LOAD_USER=admin LOAD_PASSWORD=… node scripts/load-test.mjs
 *
 * Budget: p95 latency per endpoint under P95_BUDGET_MS with 20 concurrent
 * connections, and zero non-2xx responses. Exits 1 when over budget.
 */
import autocannon from 'autocannon'

const BASE = process.env.LOAD_URL ?? 'http://localhost:4100'
const USER = process.env.LOAD_USER ?? 'admin'
const PASSWORD = process.env.LOAD_PASSWORD ?? 'Correct-Horse-9'
const WORKER = process.env.LOAD_WORKER ?? 'ravi'
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 20)
const DURATION = Number(process.env.LOAD_SECONDS ?? 10)
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 250)

async function token(identifier) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'maintainx' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`Sign-in failed for ${identifier}: ${res.status}`)
  return (await res.json()).data.accessToken
}

const today = new Date().toISOString().slice(0, 10)
const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

const adminToken = await token(USER)
const workerToken = await token(WORKER)
const SCENARIOS = [
  ['Admin dashboard', '/api/v1/dashboard', adminToken],
  ['Work order list (page 1)', '/api/v1/work-orders?pageSize=25', adminToken],
  ['Work orders: overdue view', '/api/v1/work-orders?view=overdue&pageSize=25', adminToken],
  ['Worker home', '/api/v1/me/home', workerToken],
  ['Worker tasks', '/api/v1/me/tasks?view=today', workerToken],
  ['Unread count (polled)', '/api/v1/notifications/unread-count', workerToken],
  ['Parts with stock', '/api/v1/parts?pageSize=25', adminToken],
  [
    'Report: work order summary',
    `/api/v1/reports/work-order-summary?from=${monthAgo}&to=${today}`,
    adminToken,
  ],
]

let failed = false
const rows = []
for (const [name, path, auth] of SCENARIOS) {
  const r = await autocannon({
    url: BASE + path,
    connections: CONNECTIONS,
    duration: DURATION,
    headers: { authorization: `Bearer ${auth}`, 'accept-encoding': 'gzip' },
  })
  const p95 = r.latency.p97_5 ?? r.latency.p99 // autocannon reports p97.5; use it as a conservative p95
  const bad = r.non2xx + r.errors + r.timeouts
  const ok = p95 <= P95_BUDGET_MS && bad === 0
  if (!ok) failed = true
  rows.push({
    scenario: name,
    'req/s': Math.round(r.requests.average),
    'p50 ms': r.latency.p50,
    'p97.5 ms': p95,
    'max ms': r.latency.max,
    errors: bad,
    ok: ok ? '✔' : '✖',
  })
}
console.table(rows)
console.log(
  `${CONNECTIONS} connections × ${DURATION}s per scenario, budget p97.5 ≤ ${P95_BUDGET_MS} ms`,
)
if (failed) process.exit(1)

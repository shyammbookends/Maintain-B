import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  type Permission,
  type SystemRole,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { prisma } from './core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase } from './test/db.js'

/*
 * Every protected endpoint × every system role. Expectations are derived from
 * DEFAULT_ROLE_PERMISSIONS (the same table the role editor shows), so a route
 * guard that drifts from the declared matrix fails here.
 *
 * "Allowed" means the guard let the request through (anything but 401/403 —
 * an empty body may still be rejected with 400, which is fine).
 */

const app = createApp()
const tokens = {} as Record<SystemRole, string>
const ZERO = '00000000-0000-4000-8000-000000000000'
const RANGE = 'from=2026-01-01&to=2026-01-31'

type Case = [
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  needs: Permission[] | 'superAdmin',
  /** Admin-kind roles only (workers have their own screens for this). */
  adminKind?: boolean,
]

const CASES: Case[] = [
  ['get', '/dashboard', ['dashboard:view'], true],
  ['get', '/restaurants', ['restaurants:view']],
  ['post', '/restaurants', 'superAdmin'],
  ['get', '/locations', ['locations:view']],
  ['post', '/locations', ['locations:create']],
  ['get', '/users', ['users:view']],
  ['post', '/users', ['users:create']],
  ['get', '/roles', ['roles:view']],
  ['get', '/teams', ['teams:view']],
  ['post', '/teams', ['teams:create']],
  ['get', '/assets', ['assets:view']],
  ['post', '/assets', ['assets:create']],
  ['delete', `/assets/${ZERO}`, ['assets:delete']],
  ['get', '/requests', ['requests:view']],
  ['post', '/requests', ['requests:create']],
  ['post', `/requests/${ZERO}/reject`, ['requests:approve']],
  ['get', '/work-orders', ['work_orders:view']],
  ['post', '/work-orders', ['work_orders:create']],
  ['post', `/work-orders/${ZERO}/assign`, ['work_orders:assign']],
  ['post', `/work-orders/${ZERO}/verify`, ['work_orders:approve']],
  ['post', `/work-orders/${ZERO}/reject`, ['work_orders:approve']],
  ['post', `/work-orders/${ZERO}/cancel`, ['work_orders:close']],
  ['post', `/work-orders/${ZERO}/complete`, ['work_orders:complete']],
  ['post', `/work-orders/${ZERO}/costs`, ['work_orders:edit']],
  ['get', `/work-orders/workload?restaurantId=${ZERO}`, ['work_orders:assign']],
  ['post', `/requests/${ZERO}/approve`, ['requests:approve']],
  ['post', `/assets/${ZERO}/transfer`, ['assets:edit']],
  ['get', `/restaurants/${ZERO}/stats`, ['restaurants:view']],
  ['delete', `/restaurants/${ZERO}`, 'superAdmin'],
  ['get', '/pm-schedules', ['maintenance:view']],
  ['post', '/pm-schedules', ['maintenance:create']],
  ['get', '/procedures', ['procedures:view']],
  ['post', '/procedures', ['procedures:create']],
  ['get', '/inspection-templates', ['inspections:view']],
  ['get', '/inspections', ['inspections:view']],
  ['post', '/inspections', ['inspections:create']],
  ['get', '/parts', ['parts:view']],
  ['post', '/parts', ['parts:create']],
  ['post', `/parts/${ZERO}/adjust`, ['inventory:edit']],
  ['get', '/vendors', ['vendors:view']],
  ['post', '/vendors', ['vendors:create']],
  ['get', '/purchase-orders', ['purchase_orders:view']],
  ['post', '/purchase-orders', ['purchase_orders:create']],
  ['get', '/documents', ['documents:view']],
  ['post', '/documents', ['documents:create']],
  ['get', `/reports/work-order-summary?${RANGE}`, ['reports:view']],
  ['get', `/reports/low-stock/csv?${RANGE}`, ['reports:view', 'reports:export']],
  ['get', `/reports/low-stock/pdf?${RANGE}`, ['reports:view', 'reports:export']],
  ['get', '/report-schedules', ['reports:view', 'reports:export']],
  ['post', '/report-schedules', ['reports:view', 'reports:export']],
  ['get', '/audit-logs', ['audit_logs:view']],
  ['get', '/audit-logs/csv', ['audit_logs:view', 'audit_logs:export']],
  ['get', '/notifications', []],
  ['get', '/me/home', ['work_orders:view']],
]

/** request(app)[method](…) without a multi-line computed member access. */
function send(method: Case[0], path: string) {
  const agent = request(app)
  const url = `/api/v1${path}`
  return method === 'get'
    ? agent.get(url)
    : method === 'post'
      ? agent.post(url)
      : method === 'put'
        ? agent.put(url)
        : agent.delete(url)
}

function allowed(role: SystemRole, needs: Case[2], adminKind = false): boolean {
  if (role === SYSTEM_ROLES.SUPER_ADMIN) return true
  if (adminKind && role === SYSTEM_ROLES.WORKER) return false
  if (needs === 'superAdmin') return false
  const granted = new Set<string>(DEFAULT_ROLE_PERMISSIONS[role])
  return needs.every((p) => granted.has(p))
}

beforeAll(async () => {
  await resetDatabase()
  const fx = await createFixture({ restaurants: 1 })
  for (const role of Object.values(SYSTEM_ROLES)) {
    const username = role.toLowerCase().replace('_', '')
    await fx.createUser({ role, username, restaurants: fx.restaurantIds })
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
      .send({ identifier: username, password: TEST_PASSWORD })
    tokens[role] = res.body.data.accessToken
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('permission matrix', () => {
  for (const role of Object.values(SYSTEM_ROLES)) {
    describe(role, () => {
      it.each(CASES)('%s %s', async (method, path, needs, adminKind) => {
        const res = await send(method, path).set('Authorization', `Bearer ${tokens[role]}`).send({})
        if (allowed(role, needs, adminKind))
          expect([401, 403], `${role} ${method} ${path}`).not.toContain(res.status)
        else expect(res.status, `${role} ${method} ${path}`).toBe(403)
      })
    })
  }

  it('everything requires sign-in', async () => {
    for (const [method, path, needs] of CASES) {
      if (path.startsWith('/me') && needs.length === 0) continue
      const res = await send(method, path).send({})
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })
})

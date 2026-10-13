import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  DEFAULT_WORKFLOW,
  type WorkOrderDetail,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../test/db.js'

/* MaintainX-style defaults: one-tap completion; strict rules are switches. */

const app = createApp()
let fx: Fixture
let tokens: Record<string, string>
let workerId: string

async function tokenFor(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: username, password: TEST_PASSWORD })
  return res.body.data.accessToken as string
}
const as = (who: string) => {
  const h = { Authorization: `Bearer ${tokens[who]}` }
  return {
    get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
    post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b),
    put: (u: string, b?: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
  }
}

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 1, workflow: 'simple' })
  await fx.createUser({ role: 'SUPER_ADMIN', username: 'boss' })
  await fx.createUser({ role: 'ADMIN', username: 'admin', restaurants: fx.restaurantIds })
  workerId = (
    await fx.createUser({ role: 'WORKER', username: 'worker', restaurants: fx.restaurantIds })
  ).id
  tokens = {
    boss: await tokenFor('boss'),
    admin: await tokenFor('admin'),
    worker: await tokenFor('worker'),
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function started() {
  const w = (
    await as('admin').post('/work-orders', {
      title: 'Leaking tap',
      description: '',
      category: 'PLUMBING',
      priority: 'MEDIUM',
      restaurantId: fx.restaurantIds[0],
      locationId: '',
      assetId: '',
      dueDate: '',
      assignedUserId: workerId,
      assignedTeamId: '',
      requestId: '',
    })
  ).body.data as WorkOrderDetail
  await as('worker').post(`/work-orders/${w.id}/start`)
  return w
}

describe('workflow settings', () => {
  it('defaults to one-tap completion that closes the job', async () => {
    expect((await as('worker').get('/settings/workflow')).body.data).toEqual(DEFAULT_WORKFLOW)
    const w = await started()
    const res = await as('worker').post(`/work-orders/${w.id}/complete`, {
      notes: 'Washer replaced',
    })
    expect(res.status).toBe(200)
    const d = res.body.data as WorkOrderDetail
    expect(d.status).toBe('CLOSED')
    expect(d.completion).toMatchObject({
      workPerformed: 'Washer replaced',
      finalCondition: 'FULLY_WORKING',
    })
    expect(d.completionCheck).toMatchObject({ reportRequired: false, verificationRequired: false })
    // The person who raised it hears it is done.
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } })
    expect(
      await prisma.notification.count({ where: { recipientId: admin.id, type: 'TASK_COMPLETED' } }),
    ).toBe(1)
  })

  it('turning rules on makes photos, the report and verification required again', async () => {
    expect((await as('admin').put('/settings/workflow', DEFAULT_WORKFLOW)).status).toBe(403)
    const strict = {
      ...DEFAULT_WORKFLOW,
      requireAfterPhoto: true,
      requireRepairReport: true,
      requireVerification: true,
    }
    expect((await as('boss').put('/settings/workflow', strict)).body.data).toEqual(strict)
    const w = await started()
    const missing = await as('worker').post(`/work-orders/${w.id}/complete`, { notes: 'done' })
    expect(missing.status).toBe(409)
    expect(missing.body.error.code).toBe('EVIDENCE_REQUIRED')

    await request(app)
      .post(`/api/v1/work-orders/${w.id}/attachments`)
      .set('Authorization', `Bearer ${tokens.worker}`)
      .field('stage', 'AFTER')
      .attach(
        'files',
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'base64',
        ),
        'after.png',
      )
    const noReport = await as('worker').post(`/work-orders/${w.id}/complete`, { notes: 'done' })
    expect(noReport.status).toBe(400)
    expect(Object.keys(noReport.body.error.fieldErrors).sort()).toEqual([
      'confirmed',
      'finalCondition',
      'noPartsUsed',
      'problemFound',
      'workPerformed',
    ])
    const ok = await as('worker').post(`/work-orders/${w.id}/complete`, {
      problemFound: 'Washer worn',
      workPerformed: 'Replaced washer',
      finalCondition: 'FULLY_WORKING',
      noPartsUsed: true,
      confirmed: true,
      assetStatus: '',
    })
    expect(ok.body.data.status).toBe('REVIEW')
    expect(
      await prisma.auditLog.count({ where: { action: 'setting.updated', entityType: 'SETTING' } }),
    ).toBe(1)
  })
})

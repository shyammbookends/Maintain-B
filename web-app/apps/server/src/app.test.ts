import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from './app.js'
import { NotFoundError } from './core/errors.js'
import { parseBody } from './core/validate.js'

const app = createApp({
  testRoutes: (router) => {
    router.get('/boom', () => {
      throw new Error('internal detail: db password is hunter2')
    })
    router.get('/missing', () => {
      throw new NotFoundError('Asset')
    })
    router.post('/validate', (req, res) => {
      const body = parseBody(
        z.object({ name: z.string().min(2), nested: z.object({ qty: z.number().int() }) }),
        req,
      )
      res.json({ data: body })
    })
  },
})

describe('GET /api/v1/health', () => {
  it('reports liveness with a version and a request id', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      status: 'ok',
      service: 'maintainx-api',
      environment: 'test',
    })
    expect(typeof res.body.data.version).toBe('string')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('echoes a well-formed incoming x-request-id', async () => {
    const res = await request(app).get('/api/v1/health').set('x-request-id', 'client-trace-0001')
    expect(res.headers['x-request-id']).toBe('client-trace-0001')
  })

  it('replaces an unsafe incoming x-request-id', async () => {
    const res = await request(app).get('/api/v1/health').set('x-request-id', 'bad id <script>')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('GET /api/v1/ready', () => {
  it('reports a database check and matching status code', async () => {
    const res = await request(app).get('/api/v1/ready')
    expect([200, 503]).toContain(res.status)
    expect(res.body.data.checks.database.status).toMatch(/^(up|down)$/)
    expect(res.body.data.status).toBe(res.status === 200 ? 'ready' : 'degraded')
  })
})

describe('error handling', () => {
  it('unknown routes return a JSON 404 with an error code', async () => {
    const res = await request(app).get('/api/v1/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(res.body.error.requestId).toBeTruthy()
  })

  it('malformed JSON returns 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/v1/__test/validate')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('schema failures return field errors keyed by path', async () => {
    const res = await request(app)
      .post('/api/v1/__test/validate')
      .send({ name: 'a', nested: { qty: 1.5 } })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['name', 'nested.qty'])
  })

  it('valid input passes through parseBody', async () => {
    const res = await request(app)
      .post('/api/v1/__test/validate')
      .send({ name: 'Walk-in freezer', nested: { qty: 2 } })
    expect(res.status).toBe(200)
    expect(res.body.data.nested.qty).toBe(2)
  })

  it('AppError subclasses map to their status and message', async () => {
    const res = await request(app).get('/api/v1/__test/missing')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Asset not found.' })
  })

  it('unexpected errors become a generic 500 and never leak details', async () => {
    const res = await request(app).get('/api/v1/__test/boom')
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
    const raw = JSON.stringify(res.body)
    expect(raw).not.toContain('hunter2')
    expect(raw).not.toContain('internal detail')
    expect(raw).not.toMatch(/\.ts:\d+/)
  })
})

describe('security', () => {
  it('sets hardening headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBeDefined()
  })

  it('allows the configured origin with credentials', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('does not allow unknown origins', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})

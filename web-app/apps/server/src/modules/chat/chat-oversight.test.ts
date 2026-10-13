import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type ChatMessagesPage,
  type ConversationListItem,
} from '@maintainx/shared'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { TEST_PASSWORD, createFixture, resetDatabase } from '../../test/db.js'

/* Chat: admin oversight (read-only) and group management by admins only. */

const app = createApp()
let tokens: Record<string, string>
let ids: Record<string, string>

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
    delete: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
  }
}
const list = async (who: string, scope = '') =>
  (await as(who).get(`/chats${scope ? `?scope=${scope}` : ''}`)).body.data as ConversationListItem[]
const direct = async (who: string, other: string) =>
  (await as(who).post('/chats', { userIds: [ids[other]] })).body.data.id as string

beforeEach(async () => {
  await resetDatabase()
  const fx = await createFixture({ restaurants: 2, workflow: 'simple' })
  const [r1, r2] = fx.restaurantIds as [string, string]
  const users = {
    boss: { role: 'SUPER_ADMIN', restaurants: [] as string[] },
    admin: { role: 'ADMIN', restaurants: [r1] },
    admin2: { role: 'ADMIN', restaurants: [r2] },
    worker: { role: 'WORKER', restaurants: [r1] },
    cook: { role: 'WORKER', restaurants: [r1] },
    far: { role: 'WORKER', restaurants: [r2] },
  } as const
  ids = {}
  tokens = {}
  for (const [username, u] of Object.entries(users)) {
    ids[username] = (
      await fx.createUser({
        role: u.role,
        username,
        email: `${username}@bookends.in`,
        restaurants: [...u.restaurants],
      })
    ).id
    tokens[username] = await tokenFor(username)
  }
})
afterAll(async () => {
  await prisma.$disconnect()
})

describe('chat oversight', () => {
  it('a Super Admin sees every chat, view-only where they are not a member', async () => {
    const r1 = await direct('worker', 'cook')
    const r2 = await direct('far', 'admin2')
    const mine = await direct('boss', 'admin')
    await as('worker').post(`/chats/${r1}/messages`, { body: 'Oven is hot' })

    expect((await list('boss')).map((c) => c.id)).toEqual([mine])
    const all = await list('boss', 'all')
    expect(all.map((c) => c.id).sort()).toEqual([r1, r2, mine].sort())
    const seen = all.find((c) => c.id === r1)!
    expect(seen).toMatchObject({ viewOnly: true, unread: 0, type: 'DIRECT' })
    expect(seen.members.map((m) => m.id).sort()).toEqual([ids.worker, ids.cook].sort())
    expect(seen.title).toContain('&')
    expect(all.find((c) => c.id === mine)!.viewOnly).toBe(false)

    const page = (await as('boss').get(`/chats/${r1}/messages`)).body.data as ChatMessagesPage
    expect(page.messages.map((m) => m.body)).toEqual(['Oven is hot'])
    expect(page.messages[0]!.mine).toBe(false)
  })

  it('an Admin oversees only chats among people they can see, never with a Super Admin', async () => {
    const inScope = await direct('worker', 'cook')
    const otherRestaurant = await direct('far', 'admin2')
    const withBoss = await direct('worker', 'boss')
    const own = await direct('admin', 'boss')
    const g = (await as('admin2').post('/chats', { userIds: [ids.far, ids.boss], name: 'R2 crew' }))
      .body.data.id as string

    const all = await list('admin', 'all')
    expect(all.map((c) => c.id).sort()).toEqual([inScope, own].sort())
    expect(all.find((c) => c.id === own)!.viewOnly).toBe(false)
    expect(all.find((c) => c.id === inScope)!.viewOnly).toBe(true)

    expect((await as('admin').get(`/chats/${inScope}/messages`)).status).toBe(200)
    for (const id of [otherRestaurant, withBoss, g])
      expect((await as('admin').get(`/chats/${id}/messages`)).status).toBe(404)
  })

  it('a Super Admin never sees or acts in chats of another organization', async () => {
    const org2 = await prisma.organization.create({
      data: { name: 'Other Org', slug: 'other-org' },
    })
    const mk = (n: string) =>
      prisma.user.create({
        data: { organizationId: org2.id, firstName: n, lastName: 'Other', passwordHash: 'x' },
      })
    const [a, b] = [await mk('Ann'), await mk('Bob')]
    const foreign = await prisma.conversation.create({
      data: {
        organizationId: org2.id,
        type: 'GROUP',
        name: 'Elsewhere',
        createdById: a.id,
        members: { create: [{ userId: a.id }, { userId: b.id }] },
      },
    })
    const msg = await prisma.chatMessage.create({
      data: { conversationId: foreign.id, authorId: a.id, body: 'secret' },
    })
    expect((await list('boss', 'all')).map((c) => c.id)).not.toContain(foreign.id)
    for (const who of ['boss', 'admin', 'worker']) {
      const f = `/chats/${foreign.id}`
      expect((await as(who).get(`${f}/messages`)).status).toBe(404)
      expect((await as(who).post(`${f}/messages`, { body: 'hi' })).status).toBe(404)
      expect((await as(who).post(`${f}/read`)).status).toBe(404)
      expect((await as(who).post(`${f}/members`, { userIds: [ids.cook] })).status).toBe(404)
      expect((await as(who).delete(`${f}/members/${b.id}`)).status).toBe(404)
      expect((await as(who).delete(`${f}/messages/${msg.id}`)).status).toBe(404)
    }
    // Nor can anyone pull a person from another organization into a chat.
    expect((await as('boss').post('/chats', { userIds: [a.id] })).status).toBe(400)
    const g = (await as('boss').post('/chats', { userIds: [ids.admin, ids.cook], name: 'HQ' })).body
      .data.id as string
    expect((await as('boss').post(`/chats/${g}/members`, { userIds: [a.id] })).status).toBe(400)
    expect(await prisma.conversationMember.count({ where: { userId: { in: [a.id, b.id] } } })).toBe(
      2,
    )
    expect(await prisma.chatMessage.count({ where: { conversationId: foreign.id } })).toBe(1)
  })

  it('workers get 403 for all chats and 404 for chats they are not in', async () => {
    const theirs = await direct('admin', 'cook')
    expect((await as('worker').get('/chats?scope=all')).status).toBe(403)
    expect((await as('worker').get('/chats?scope=nope')).status).toBe(400)
    expect((await as('worker').get(`/chats/${theirs}/messages`)).status).toBe(404)
    expect((await as('worker').post(`/chats/${theirs}/messages`, { body: 'hi' })).status).toBe(404)
  })

  it('oversight is read-only and leaves no trace', async () => {
    const g = (
      await as('admin').post('/chats', { userIds: [ids.worker, ids.cook], name: 'R1 kitchen' })
    ).body.data.id as string
    await as('admin').post(`/chats/${g}/leave`)
    const msg = (await as('worker').post(`/chats/${g}/messages`, { body: 'Fryer done' })).body.data
      .id as string
    const before = await prisma.notification.count()

    for (const who of ['boss', 'admin']) {
      expect((await as(who).get(`/chats/${g}/messages`)).status).toBe(200)
      expect((await as(who).post(`/chats/${g}/messages`, { body: 'x' })).status).toBe(403)
      expect((await as(who).delete(`/chats/${g}/messages/${msg}`)).status).toBe(403)
      expect((await as(who).post(`/chats/${g}/read`)).status).toBe(403)
      expect((await as(who).post(`/chats/${g}/leave`)).status).toBe(403)
      expect((await as(who).post(`/chats/${g}/members`, { userIds: [ids.admin2] })).status).toBe(
        403,
      )
      expect((await as(who).delete(`/chats/${g}/members/${ids.cook}`)).status).toBe(403)
      expect((await as(who).get('/chats/unread')).body.data.count).toBe(0)
    }
    expect(await prisma.notification.count()).toBe(before)
    expect(
      await prisma.conversationMember.count({ where: { conversationId: g, leftAt: null } }),
    ).toBe(2)
    expect((await list('cook'))[0]).toMatchObject({ id: g, unread: 1, viewOnly: false })
  })
})

describe('group management', () => {
  it('only admins create groups; workers can still start direct chats', async () => {
    expect(
      (await as('worker').post('/chats', { userIds: [ids.cook, ids.admin], name: 'Mine' })).status,
    ).toBe(403)
    expect((await as('worker').post('/chats', { userIds: [ids.cook], name: 'Solo' })).status).toBe(
      403,
    )
    expect((await as('worker').post('/chats', { userIds: [ids.cook] })).status).toBe(201)
    expect(
      (await as('admin').post('/chats', { userIds: [ids.worker, ids.cook], name: 'Team' })).status,
    ).toBe(201)
  })

  it('admins in the group add and remove members; workers cannot', async () => {
    const g = (
      await as('admin').post('/chats', { userIds: [ids.worker, ids.boss], name: 'R1 kitchen' })
    ).body.data.id as string
    // Workers in the group can't change who's in it.
    expect((await as('worker').post(`/chats/${g}/members`, { userIds: [ids.cook] })).status).toBe(
      403,
    )
    expect((await as('worker').delete(`/chats/${g}/members/${ids.admin}`)).status).toBe(403)
    // Admins only add people they can reach.
    expect((await as('admin').post(`/chats/${g}/members`, { userIds: [ids.far] })).status).toBe(400)
    expect((await as('admin').post(`/chats/${g}/members`, { userIds: [ids.cook] })).status).toBe(
      204,
    )
    expect((await list('cook')).map((c) => c.id)).toEqual([g])

    // Remove: not yourself (leave instead), not a Super Admin (for an Admin), only current members.
    expect((await as('admin').delete(`/chats/${g}/members/${ids.admin}`)).status).toBe(400)
    expect((await as('admin').delete(`/chats/${g}/members/${ids.boss}`)).status).toBe(403)
    expect((await as('admin').delete(`/chats/${g}/members/${ids.far}`)).status).toBe(404)
    expect((await as('admin').delete(`/chats/${g}/members/${ids.cook}`)).status).toBe(204)
    expect(await list('cook')).toEqual([])
    expect((await as('cook').get(`/chats/${g}/messages`)).status).toBe(404)
    // A Super Admin may remove an Admin.
    expect((await as('boss').delete(`/chats/${g}/members/${ids.admin}`)).status).toBe(204)
    expect((await list('admin')).map((c) => c.id)).not.toContain(g)
  })

  it('direct chats have no members to manage', async () => {
    const d = await direct('admin', 'worker')
    expect((await as('admin').post(`/chats/${d}/members`, { userIds: [ids.cook] })).status).toBe(
      403,
    )
    expect((await as('admin').delete(`/chats/${d}/members/${ids.worker}`)).status).toBe(403)
  })

  it('an Admin only removes people they can see, even from a group a Super Admin made', async () => {
    const g = (
      await as('boss').post('/chats', {
        userIds: [ids.admin, ids.far, ids.cook],
        name: 'All sites',
      })
    ).body.data.id as string
    // `far` works at a restaurant this Admin doesn't run.
    expect((await as('admin').delete(`/chats/${g}/members/${ids.far}`)).status).toBe(403)
    expect((await as('admin').delete(`/chats/${g}/members/${ids.cook}`)).status).toBe(204)
    expect((await as('boss').delete(`/chats/${g}/members/${ids.far}`)).status).toBe(204)
    expect(
      (await prisma.conversationMember.findMany({ where: { conversationId: g, leftAt: null } }))
        .map((m) => m.userId)
        .sort(),
    ).toEqual([ids.boss, ids.admin].sort())
  })
})

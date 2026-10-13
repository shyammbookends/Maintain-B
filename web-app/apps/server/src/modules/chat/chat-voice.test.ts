import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  CHAT_VOICE_MAX_MB,
  type ChatMessageDto,
  type ChatMessagesPage,
  type ConversationListItem,
} from '@maintainx/shared'
import request from 'supertest'
import { readdir } from 'node:fs/promises'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { expireOldFiles, storageUsage } from '../../jobs/storage.js'
import { CHAT_VOICE_DAILY_BYTES } from './chat.service.js'
import { storage } from '../../storage/index.js'
import { TEST_PASSWORD, createFixture, resetDatabase } from '../../test/db.js'

/* Team chat voice messages: upload, checks, permissions, delete and retention. */

const app = createApp()
let tokens: Record<string, string>
let ids: Record<string, string>
let orgId: string

/** A WebM (EBML) header as Chrome's MediaRecorder writes it. */
const WEBM = Buffer.concat([
  Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
    0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84,
  ]),
  Buffer.from('webm'),
  Buffer.from([0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02]),
  Buffer.alloc(2000, 7),
])
/** An AAC .m4a (the Flutter app and iPhone Safari). */
const M4A = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypM4A '),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('M4A isom'),
  Buffer.alloc(2000, 3),
])
/** AAC in a plain MP4 container (Android's MediaMuxer). */
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from('isomiso2'),
  Buffer.alloc(2000, 5),
])
/** Ogg Opus (Firefox). */
const OGG = (() => {
  const head = Buffer.alloc(28)
  head.write('OggS', 0)
  head[5] = 2
  head[26] = 1
  head[27] = 19
  return Buffer.concat([head, Buffer.from('OpusHead'), Buffer.alloc(2000, 1)])
})()
/** A well-formed id of a chat that doesn't exist. */
const randomUUIDLike = () => '7d1c6f7e-2b9a-4f1e-9a51-3c0b2f6d8e41'
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(3000, 9)])

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
    voice: (
      chatId: string,
      file: Buffer,
      name = 'voice.webm',
      contentType = 'audio/webm',
      fields: Record<string, string> = { durationSec: '12' },
    ) => {
      let r = request(app).post(`/api/v1/chats/${chatId}/voice`).set(h)
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v)
      return r.attach('files', file, { filename: name, contentType })
    },
  }
}
const direct = async (who: string, other: string) =>
  (await as(who).post('/chats', { userIds: [ids[other]] })).body.data.id as string
const messages = async (who: string, chatId: string) =>
  ((await as(who).get(`/chats/${chatId}/messages`)).body.data as ChatMessagesPage).messages

beforeEach(async () => {
  await resetDatabase()
  const fx = await createFixture({ restaurants: 2, workflow: 'simple' })
  orgId = fx.orgId
  const [r1, r2] = fx.restaurantIds as [string, string]
  const users = {
    boss: { role: 'SUPER_ADMIN', restaurants: [] as string[] },
    admin: { role: 'ADMIN', restaurants: [r1] },
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

/** Number of files in the test storage folder. */
async function storedCount(): Promise<number> {
  try {
    const all = await readdir(process.env.STORAGE_LOCAL_DIR!, {
      recursive: true,
      withFileTypes: true,
    })
    return all.filter((e) => e.isFile()).length
  } catch {
    return 0
  }
}

describe('chat voice messages', () => {
  it('a member sends a voice note; the other member gets a playable link, duration and type', async () => {
    const chat = await direct('worker', 'cook')
    const res = await as('worker').voice(chat, WEBM)
    expect(res.status).toBe(201)
    const sent = res.body.data as ChatMessageDto
    expect(sent.body).toBe('')
    expect(sent.voice).toMatchObject({ mimeType: 'audio/webm', durationSec: 12, removed: false })
    expect(sent.voice!.url).toContain('/files?')

    const [got] = await messages('cook', chat)
    expect(got!.id).toBe(sent.id)
    expect(got!.voice).toMatchObject({ mimeType: 'audio/webm', durationSec: 12 })
    // The signed link serves the recording.
    const file = await request(app).get(got!.voice!.url.replace(/^.*\/api\/v1/, '/api/v1'))
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('audio/webm')
    expect(Buffer.from(file.body as Buffer).length).toBe(WEBM.length)

    const row = await prisma.attachment.findFirstOrThrow({ where: { ownerId: sent.id } })
    expect(row).toMatchObject({ ownerType: 'CHAT_MESSAGE', kind: 'AUDIO', durationSec: 12 })

    // Chat list preview and the notification name it a voice message.
    const list = (await as('cook').get('/chats')).body.data as ConversationListItem[]
    expect(list[0]!.lastMessage).toMatchObject({ body: '', voiceSec: 12 })
    const n = await prisma.notification.findFirstOrThrow({
      where: { recipientId: ids.cook, type: 'CHAT_MESSAGE' },
    })
    expect(n.body).toBe('🎤 Voice message (0:12)')
  })

  it('accepts AAC (.m4a), MP4 and Ogg Opus, with an optional caption', async () => {
    const chat = await direct('worker', 'cook')
    const a = await as('worker').voice(chat, M4A, 'voice.m4a', 'audio/mp4', {
      durationSec: '75',
      body: 'Fridge noise',
    })
    expect(a.status).toBe(201)
    expect(a.body.data).toMatchObject({
      body: 'Fridge noise',
      voice: { mimeType: 'audio/x-m4a', durationSec: 75 },
    })
    // Android's recorder writes a plain MP4 container; phones may send no type.
    const mp4 = await as('worker').voice(chat, MP4, 'voice.m4a', 'application/octet-stream')
    expect(mp4.status).toBe(201)
    expect(mp4.body.data.voice.mimeType).toBe('audio/mp4')
    const o = await as('worker').voice(chat, OGG, 'voice.ogg', 'audio/ogg')
    expect(o.status).toBe(201)
    expect(o.body.data.voice.mimeType).toBe('audio/ogg')
    const text = (await as('worker').get('/chats')).body.data[0].lastMessage
    expect(text.voiceSec).toBe(12)
  })

  it('rejects files that are not recordings, whatever their name says', async () => {
    const chat = await direct('worker', 'cook')
    const exe = await as('worker').voice(chat, EXE, 'voice.webm', 'audio/webm')
    expect(exe.status).toBe(415)
    expect(exe.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED')
    // A photo is not a voice note either.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500)])
    const photo = await as('worker').voice(chat, jpeg, 'voice.webm', 'audio/webm')
    expect(photo.status).toBe(415)
    // No message is left behind.
    expect(await prisma.chatMessage.count()).toBe(0)
    expect(await prisma.attachment.count()).toBe(0)
  })

  it('rejects recordings that are too big or too long, and missing files', async () => {
    const chat = await direct('worker', 'cook')
    const big = Buffer.concat([WEBM, Buffer.alloc(CHAT_VOICE_MAX_MB * 1024 * 1024)])
    expect((await as('worker').voice(chat, big)).status).toBe(413)
    const long = await as('worker').voice(chat, WEBM, 'v.webm', 'audio/webm', {
      durationSec: '181',
    })
    expect(long.status).toBe(400)
    const none = await as('worker').post(`/chats/${chat}/voice`).field('durationSec', '5')
    expect(none.status).toBe(400)
    expect(await prisma.chatMessage.count()).toBe(0)
  })

  it('only members can send: others get 404, overseeing admins 403 but can play', async () => {
    const chat = await direct('worker', 'cook')
    expect((await as('far').voice(chat, WEBM)).status).toBe(404)
    expect((await as('admin').voice(chat, WEBM)).status).toBe(403)
    expect((await as('boss').voice(chat, WEBM)).status).toBe(403)
    expect(await prisma.attachment.count()).toBe(0)

    await as('worker').voice(chat, WEBM)
    for (const who of ['admin', 'boss']) {
      const [m] = await messages(who, chat)
      expect(m!.voice!.url).toContain('/files?')
      const file = await request(app).get(m!.voice!.url.replace(/^.*\/api\/v1/, '/api/v1'))
      expect(file.status).toBe(200)
    }
    expect((await as('far').get(`/chats/${chat}/messages`)).status).toBe(404)
  })

  it('deleting the message deletes its recording', async () => {
    const chat = await direct('worker', 'cook')
    const sent = (await as('worker').voice(chat, WEBM)).body.data as ChatMessageDto
    const row = await prisma.attachment.findFirstOrThrow({ where: { ownerId: sent.id } })
    expect(await storage.exists(row.storageKey)).toBe(true)

    // Only the author can delete it.
    expect((await as('cook').delete(`/chats/${chat}/messages/${sent.id}`)).status).toBe(404)
    expect((await as('worker').delete(`/chats/${chat}/messages/${sent.id}`)).status).toBe(204)
    expect(await storage.exists(row.storageKey)).toBe(false)
    expect(await prisma.attachment.count()).toBe(0)
    const [m] = await messages('cook', chat)
    expect(m).toMatchObject({ deleted: true, voice: null, body: '' })
  })

  it('counts in storage usage and is removed by the retention job like other files', async () => {
    const chat = await direct('worker', 'cook')
    const sent = (await as('worker').voice(chat, WEBM)).body.data as ChatMessageDto
    const usage = await storageUsage(orgId)
    expect(usage.counts.audio).toBe(1)
    expect(usage.files.audio).toBe(WEBM.length)

    const row = await prisma.attachment.findFirstOrThrow({ where: { ownerId: sent.id } })
    await prisma.attachment.update({
      where: { id: row.id },
      data: { createdAt: new Date('2000-01-01T00:00:00Z') },
    })
    const done = await expireOldFiles()
    expect(done.files).toBe(1)
    expect(await storage.exists(row.storageKey)).toBe(false)
    const [m] = await messages('cook', chat)
    expect(m!.voice).toMatchObject({ removed: true, url: '', durationSec: 12 })
  })

  it('caps the voice notes one person sends per day (storage abuse)', async () => {
    const chat = await direct('worker', 'cook')
    // Earlier today: recordings adding up to the daily budget.
    await prisma.attachment.create({
      data: {
        ownerType: 'CHAT_MESSAGE',
        ownerId: ids.worker!,
        kind: 'AUDIO',
        storageKey: 'attachments/test/earlier.weba',
        fileName: 'earlier.weba',
        mimeType: 'audio/webm',
        sizeBytes: CHAT_VOICE_DAILY_BYTES - 1000,
        uploadedById: ids.worker!,
      },
    })
    const files = await storedCount()
    const res = await as('worker').voice(chat, WEBM)
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
    expect(await prisma.chatMessage.count()).toBe(0)
    expect(await prisma.attachment.count()).toBe(1)
    expect(await storedCount()).toBe(files)
    // Someone else still can; and yesterday's recordings don't count.
    expect((await as('cook').voice(chat, WEBM)).status).toBe(201)
    await prisma.attachment.updateMany({
      where: { storageKey: 'attachments/test/earlier.weba' },
      data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) },
    })
    expect((await as('worker').voice(chat, WEBM)).status).toBe(201)
  })

  it('removes the stored recording when the message itself cannot be saved', async () => {
    const chat = await direct('worker', 'cook')
    const files = await storedCount()
    // The message write fails after the recording was stored. (A plain own
    // property shadows the client's method; deleting it brings the real one back.)
    Object.defineProperty(prisma, '$transaction', {
      value: () => Promise.reject(new Error('database went away')),
      configurable: true,
    })
    let res
    try {
      res = await as('worker').voice(chat, WEBM)
    } finally {
      delete (prisma as { $transaction?: unknown }).$transaction
    }
    expect(typeof prisma.$transaction).toBe('function')
    expect(res.status).toBe(500)
    expect(await prisma.chatMessage.count()).toBe(0)
    expect(await prisma.attachment.count()).toBe(0)
    expect(await storedCount()).toBe(files)
  })

  it('refuses an oversized caption field and non-members before reading the upload', async () => {
    const chat = await direct('worker', 'cook')
    const huge = await as('worker').voice(chat, WEBM, 'v.webm', 'audio/webm', {
      durationSec: '5',
      body: 'x'.repeat(20 * 1024),
    })
    expect(huge.status).toBe(413)
    const long = await as('worker').voice(chat, WEBM, 'v.webm', 'audio/webm', {
      durationSec: '5',
      body: 'x'.repeat(2001),
    })
    expect(long.status).toBe(400)
    expect((await as('far').voice(chat, WEBM)).status).toBe(404)
    expect((await as('far').voice(randomUUIDLike(), WEBM)).status).toBe(404)
    expect((await as('worker').voice('not-a-uuid', WEBM)).status).toBe(400)
    expect(await prisma.chatMessage.count()).toBe(0)
    expect(await prisma.attachment.count()).toBe(0)
  })

  it('a removed member can no longer read, play, send or delete in the group', async () => {
    const g = (
      await as('admin').post('/chats', { userIds: [ids.worker, ids.cook], name: 'Kitchen' })
    ).body.data.id as string
    const sent = (await as('cook').voice(g, WEBM)).body.data as ChatMessageDto
    expect((await as('admin').delete(`/chats/${g}/members/${ids.cook}`)).status).toBe(204)
    expect((await as('cook').get(`/chats/${g}/messages`)).status).toBe(404)
    expect((await as('cook').voice(g, WEBM)).status).toBe(404)
    expect((await as('cook').post(`/chats/${g}/messages`, { body: 'still here?' })).status).toBe(
      404,
    )
    expect((await as('cook').delete(`/chats/${g}/messages/${sent.id}`)).status).toBe(404)
    expect((await as('cook').post(`/chats/${g}/read`)).status).toBe(404)
    expect((await as('cook').get('/chats')).body.data).toEqual([])
    // The others still get the recording.
    const [m] = await messages('worker', g)
    expect(m!.voice!.url).toContain('/files?')
  })
})

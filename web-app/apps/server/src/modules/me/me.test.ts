import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type WorkerHome,
  type WorkerRestaurant,
  type WorkerSchedule,
  type WorkerTask,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { dateKeyInZone, dayRangeInZone, startOfDateInZone } from '../../core/time.js'
import { TEST_PASSWORD, createFixture, resetDatabase, type Fixture } from '../../test/db.js'

const app = createApp()
const HOUR = 3_600_000
const TZ = 'Asia/Kolkata'

let fx: Fixture
let R: string[]
let me: string
let colleague: string
let teamId: string
let tok: string
let seq = 0

function wo(data: Partial<Prisma.WorkOrderUncheckedCreateInput>) {
  seq++
  return prisma.workOrder.create({
    data: {
      organizationId: fx.orgId,
      restaurantId: R[0]!,
      code: `WO-${String(seq).padStart(6, '0')}`,
      title: `Task ${seq}`,
      createdById: colleague,
      status: 'ASSIGNED',
      ...data,
    },
  })
}

const get = (url: string) => request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${tok}`)

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture({ restaurants: 3 })
  R = fx.restaurantIds
  me = (await fx.createUser({ role: 'WORKER', username: 'ravi', restaurants: [R[0]!, R[1]!] })).id
  colleague = (await fx.createUser({ role: 'WORKER', username: 'suresh', restaurants: [R[0]!] })).id
  teamId = (
    await prisma.team.create({
      data: {
        organizationId: fx.orgId,
        restaurantId: R[0]!,
        name: 'Kitchen crew',
        members: { create: [{ userId: me }, { userId: colleague }] },
      },
    })
  ).id
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE)
    .send({ identifier: 'ravi', password: TEST_PASSWORD })
  tok = login.body.data.accessToken
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('date helpers', () => {
  it('day keys and day starts in India', () => {
    expect(dateKeyInZone(TZ, new Date('2026-10-02T20:00:00Z'))).toBe('2026-10-03')
    expect(startOfDateInZone(TZ, '2026-10-03').toISOString()).toBe('2026-10-02T18:30:00.000Z')
  })
})

describe('worker endpoints', () => {
  it('only my tasks: assigned to me, or to my team with no individual assignee, in my restaurants', async () => {
    const now = Date.now()
    await wo({ title: 'mine', assignedUserId: me, dueDate: new Date(now - HOUR) })
    await wo({ title: 'team', assignedTeamId: teamId, dueDate: new Date(now - HOUR) })
    await wo({
      title: 'colleague via team',
      assignedTeamId: teamId,
      assignedUserId: colleague,
      dueDate: new Date(now - HOUR),
    })
    await wo({ title: 'colleague', assignedUserId: colleague, dueDate: new Date(now - HOUR) })
    await wo({
      title: 'out of scope',
      assignedUserId: me,
      restaurantId: R[2]!,
      dueDate: new Date(now - HOUR),
    })
    await wo({
      title: 'archived',
      assignedUserId: me,
      archivedAt: new Date(),
      dueDate: new Date(now - HOUR),
    })

    const res = await get('/me/tasks?view=today')
    expect(res.status).toBe(200)
    const titles = (res.body.data as WorkerTask[]).map((t) => t.title).sort()
    expect(titles).toEqual(['mine', 'team'])
    const teamTask = (res.body.data as WorkerTask[]).find((t) => t.title === 'team')!
    expect(teamTask.team).toEqual({ id: teamId, name: 'Kitchen crew' })
  })

  it('splits today, upcoming and done', async () => {
    const now = Date.now()
    const { end } = dayRangeInZone(TZ, new Date())
    await wo({ title: 'overdue', assignedUserId: me, dueDate: new Date(now - 30 * HOUR) })
    await wo({
      title: 'later today',
      assignedUserId: me,
      dueDate: new Date(end.getTime() - 60_000),
    })
    await wo({ title: 'tomorrow', assignedUserId: me, dueDate: new Date(end.getTime() + HOUR) })
    await wo({ title: 'no date', assignedUserId: me })
    await wo({
      title: 'done recently',
      assignedUserId: me,
      status: 'CLOSED',
      completedAt: new Date(now - 2 * 24 * HOUR),
    })
    await wo({
      title: 'done long ago',
      assignedUserId: me,
      status: 'CLOSED',
      completedAt: new Date(now - 60 * 24 * HOUR),
    })

    const titles = async (view: string) =>
      ((await get(`/me/tasks?view=${view}`)).body.data as WorkerTask[]).map((t) => t.title)
    expect(await titles('today')).toEqual(['overdue', 'later today'])
    expect(await titles('upcoming')).toEqual(['tomorrow', 'no date'])
    expect(await titles('done')).toEqual(['done recently'])
  })

  it('home: counts and next-up with work in progress first', async () => {
    const now = Date.now()
    await wo({ title: 'overdue', assignedUserId: me, dueDate: new Date(now - 2 * HOUR) })
    await wo({
      title: 'started',
      assignedUserId: me,
      status: 'IN_PROGRESS',
      dueDate: new Date(now + 48 * HOUR),
    })
    await wo({
      title: 'done',
      assignedUserId: me,
      status: 'COMPLETED',
      completedAt: new Date(now - HOUR),
    })

    const home = (await get('/me/home')).body.data as WorkerHome
    expect(home.counts).toMatchObject({ today: 1, overdue: 1, inProgress: 1, doneThisWeek: 1 })
    expect(home.next.map((t) => t.title)).toEqual(['started', 'overdue'])
  })

  it('schedule groups tasks by local day', async () => {
    const todayKey = dateKeyInZone(TZ, new Date())
    const dayStart = startOfDateInZone(TZ, todayKey)
    await wo({
      title: 'day 0',
      assignedUserId: me,
      dueDate: new Date(dayStart.getTime() + 10 * HOUR),
    })
    await wo({
      title: 'day 2',
      assignedUserId: me,
      dueDate: new Date(dayStart.getTime() + 2 * 24 * HOUR + HOUR),
    })
    await wo({
      title: 'beyond',
      assignedUserId: me,
      dueDate: new Date(dayStart.getTime() + 20 * 24 * HOUR),
    })

    const s = (await get('/me/schedule?days=7')).body.data as WorkerSchedule
    expect(s.timeZone).toBe(TZ)
    expect(s.days).toHaveLength(7)
    expect(s.days[0]!.date).toBe(todayKey)
    expect(s.days[0]!.tasks.map((t) => t.title)).toEqual(['day 0'])
    expect(s.days[2]!.tasks.map((t) => t.title)).toEqual(['day 2'])
    expect(s.days.flatMap((d) => d.tasks)).toHaveLength(2)

    expect((await get('/me/schedule?days=99')).status).toBe(400)
  })

  it('my restaurants with my open task counts', async () => {
    await wo({ assignedUserId: me })
    await wo({ assignedUserId: me, restaurantId: R[1]! })
    await wo({ assignedUserId: me, restaurantId: R[1]!, status: 'CLOSED' })
    const list = (await get('/me/restaurants')).body.data as WorkerRestaurant[]
    expect(list.map((r) => [r.code, r.openTasks])).toEqual([
      ['R1', 1],
      ['R2', 1],
    ])
  })

  it('requires sign-in', async () => {
    expect((await request(app).get('/api/v1/me/home')).status).toBe(401)
  })
})

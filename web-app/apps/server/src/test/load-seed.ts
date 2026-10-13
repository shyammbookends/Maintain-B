/**
 * Adds realistic volume to the e2e database for load testing (run after
 * e2e-seed): 7 restaurants, ~350 assets, ~1,500 work orders, 150 parts with
 * stock, ~3,000 notifications. Refuses anything but a *_test database.
 *
 *   DATABASE_URL=…/maintainx_e2e_test npx tsx src/test/load-seed.ts
 */
import { randomUUID } from 'node:crypto'
import { PRIORITY, WORK_ORDER_CATEGORY, WORK_ORDER_STATUS } from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../core/prisma.js'
import { assertTestDatabase } from './db.js'

const pick = <T>(xs: readonly T[], i: number) => xs[i % xs.length]!
const DAY = 86_400_000

async function main() {
  assertTestDatabase()
  const org = await prisma.organization.findFirstOrThrow()
  const users = await prisma.user.findMany({ select: { id: true, username: true } })
  const adminId = users.find((u) => u.username === 'admin')!.id
  const workerId = users.find((u) => u.username === 'ravi')!.id
  const category = await prisma.assetCategory.findFirstOrThrow({
    where: { organizationId: org.id },
  })

  const existing = await prisma.restaurant.count()
  const restaurants = [...(await prisma.restaurant.findMany({ select: { id: true } }))]
  for (let i = existing; i < 7; i++) {
    restaurants.push(
      await prisma.restaurant.create({
        data: { organizationId: org.id, code: `L${i + 1}`, name: `Load Restaurant ${i + 1}` },
        select: { id: true },
      }),
    )
  }
  // Admin and worker work everywhere, so their lists see all the volume.
  await prisma.userRestaurant.createMany({
    data: restaurants.flatMap((r) => [
      { userId: adminId, restaurantId: r.id },
      { userId: workerId, restaurantId: r.id },
    ]),
    skipDuplicates: true,
  })

  const assets: Prisma.AssetCreateManyInput[] = []
  for (const [ri, r] of restaurants.entries()) {
    for (let i = 0; i < 50; i++) {
      assets.push({
        id: randomUUID(),
        organizationId: org.id,
        restaurantId: r.id,
        categoryId: category.id,
        name: `Machine ${ri + 1}-${i + 1}`,
        assetCode: `LT-${ri + 1}-${String(i + 1).padStart(3, '0')}`,
        publicId: randomUUID().replace(/-/g, '').slice(0, 12),
      })
    }
  }
  await prisma.asset.createMany({ data: assets, skipDuplicates: true })

  const now = Date.now()
  const wos = Array.from({ length: 1500 }, (_, i) => {
    const status = pick(WORK_ORDER_STATUS, i)
    const created = new Date(now - (i % 120) * DAY)
    const done = ['COMPLETED', 'REVIEW', 'CLOSED'].includes(status)
    return {
      id: randomUUID(),
      organizationId: org.id,
      code: `LT-${String(i + 1).padStart(6, '0')}`,
      title: `Load test job ${i + 1}`,
      category: pick(WORK_ORDER_CATEGORY, i),
      priority: pick(PRIORITY, i),
      status,
      restaurantId: pick(restaurants, i).id,
      assetId: pick(assets, i).id,
      assignedUserId: status === 'OPEN' ? null : workerId,
      dueDate: new Date(created.getTime() + 3 * DAY),
      createdById: adminId,
      createdAt: created,
      completedAt: done ? new Date(created.getTime() + 2 * DAY) : null,
      actualMinutes: done ? 30 + (i % 90) : null,
    }
  })
  await prisma.workOrder.createMany({ data: wos })

  const parts = Array.from({ length: 150 }, (_, i) => ({
    id: randomUUID(),
    organizationId: org.id,
    name: `Spare part ${i + 1}`,
    partNumber: `LT-P-${i + 1}`,
    unitCost: 50 + i,
    minStock: 5,
  }))
  await prisma.part.createMany({ data: parts })
  await prisma.inventory.createMany({
    data: parts.flatMap((p, i) =>
      restaurants.map((r) => ({
        organizationId: org.id,
        partId: p.id,
        restaurantId: r.id,
        quantity: i % 12,
      })),
    ),
  })

  await prisma.notification.createMany({
    data: Array.from({ length: 3000 }, (_, i) => ({
      organizationId: org.id,
      recipientId: i % 2 ? adminId : workerId,
      type: 'TASK_ASSIGNED' as const,
      title: `Load notification ${i + 1}`,
      entityType: 'WORK_ORDER',
      entityId: pick(wos, i).id,
      actionUrl: `/work-orders/${pick(wos, i).id}`,
      readAt: i % 3 ? new Date() : null,
      createdAt: new Date(now - i * 60_000),
    })),
  })
  console.log(
    `load data: ${restaurants.length} restaurants, ${assets.length} assets, ${wos.length} work orders, ${parts.length} parts`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

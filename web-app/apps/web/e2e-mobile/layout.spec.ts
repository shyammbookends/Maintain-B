import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { signIn } from '../e2e/helpers'

/*
 * Every screen at phone width: no sideways scrolling, list cards open their
 * record, and a screenshot of each screen in test-results/mobile for a
 * visual check. Run with `npm run test:mobile -w @maintainx/web`.
 */

const OUT = 'test-results/mobile'
mkdirSync(OUT, { recursive: true })

const ADMIN_PAGES = [
  '/',
  '/work-orders',
  '/calendar',
  '/requests',
  '/maintenance',
  '/inspections',
  '/procedures',
  '/automations',
  '/analytics',
  '/inventory',
  '/stock-counts',
  '/purchase-orders',
  '/vendors',
  '/assets',
  '/reports',
  '/reports/reliability',
  '/restaurants',
  '/teams',
  '/documents',
  '/users',
  '/audit',
  '/roles',
  '/notifications',
  '/account',
]

const WORKER_PAGES = ['/w', '/w/tasks', '/w/notifications', '/w/reports', '/w/more', '/w/report']

async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const extra = doc.scrollWidth - doc.clientWidth
    if (extra <= 1) return null
    // Elements reaching past the edge, to know what to fix.
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`)
    return { extra, wide }
  })
}

async function visit(page: Page, path: string, name: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  return overflow(page)
}

const fileName = (path: string) => path.replace(/\//g, '_') || '_home'

test('admin screens fit a phone', async ({ page }) => {
  await signIn(page, 'boss')
  const problems: string[] = []
  for (const path of ADMIN_PAGES) {
    const o = await visit(page, path, `admin${fileName(path)}`)
    if (o) problems.push(`${path}: ${o.extra}px too wide (${o.wide.join(' | ')})`)
  }
  // Tapping the first card of each main list opens its record, which fits too.
  for (const [list, name] of [
    ['/work-orders', 'wo-detail'],
    ['/assets', 'asset-detail'],
    ['/inventory', 'part-detail'],
    ['/vendors', 'vendor-detail'],
  ] as const) {
    await page.goto(list)
    await page.waitForLoadState('networkidle')
    // Lists are cards on phones (Flutter design); tables elsewhere.
    const first = page
      .locator('[data-m="cards"] a, [data-m="cards"] [role="link"], tbody tr[data-clickable]')
      .first()
    if (!(await first.isVisible())) continue
    await first.click()
    await page.waitForURL((url) => url.pathname !== list)
    await page.waitForLoadState('networkidle')
    const path = new URL(page.url()).pathname
    const o = await visit(page, path, `admin_${name}`)
    if (o) problems.push(`${name}: ${o.extra}px too wide (${o.wide.join(' | ')})`)
  }
  expect(problems).toEqual([])
})

test('worker screens fit a phone', async ({ page }) => {
  await signIn(page, 'ravi')
  const problems: string[] = []
  for (const path of WORKER_PAGES) {
    const o = await visit(page, path, `worker${fileName(path)}`)
    if (o) problems.push(`${path}: ${o.extra}px too wide (${o.wide.join(' | ')})`)
  }
  expect(problems).toEqual([])
})

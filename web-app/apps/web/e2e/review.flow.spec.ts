import { expect, test } from '@playwright/test'
import { JOB_TITLE, signIn } from './helpers'

test.describe('admin review (desktop)', () => {
  test('is notified, reads the worker’s note and approves the job', async ({ page }) => {
    await signIn(page, 'admin')

    // The worker's message and completion arrived as notifications.
    await page.getByRole('button', { name: /Notifications, \d+ unread/ }).click()
    const popover = page.getByRole('dialog')
    await expect(popover.getByText('Task completed').first()).toBeVisible()
    await popover.getByRole('link', { name: 'See all notifications' }).click()
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Work orders' })
      .click()
    await page.getByRole('button', { name: 'To review' }).click()
    await page.getByText(JOB_TITLE).click()

    await expect(page.getByText('Waiting for your verification')).toBeVisible()
    await expect(page.getByText('Old gasket was torn, replacing now')).toBeVisible()
    await page.getByRole('button', { name: 'Approve work' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Approve work' }).click()
    await expect(page.getByText('Verified by')).toBeVisible()
  })

  test('the reported problem waits in Requests', async ({ page }) => {
    await signIn(page, 'admin')
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Requests' })
      .click()
    await expect(page.getByText('Sink leaking').first()).toBeVisible()
  })
})

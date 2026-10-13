import { devices, expect, test } from '@playwright/test'
import { signIn } from './helpers'

/*
 * Phases 11–16 end to end:
 *   admin adds a runtime meter to the fridge and an automation
 *   "every 100 h → preventive job for Ravi"; a reading crosses 100 h and the
 *   job appears; the technician answers it while offline, and the queued
 *   message is delivered once the phone is back online; the admin records the
 *   root cause on the earlier repair and the analytics page shows the KPIs.
 */

const JOB = 'E2E: Fridge 100 h service'

test('meter → automation → job; offline message syncs; root cause; analytics', async ({
  page: admin,
  browser,
}) => {
  test.setTimeout(180_000)
  await signIn(admin, 'admin')

  // Meter on the fridge, first reading 50 h.
  await admin.goto('/assets')
  await admin.getByText('Reach-in refrigerator').first().click()
  await expect(
    admin.getByRole('heading', { name: 'Reach-in refrigerator', level: 1 }),
  ).toBeVisible()
  await admin.getByRole('button', { name: 'Add meter' }).click()
  let dialog = admin.getByRole('dialog')
  await dialog.getByLabel(/^Name/).fill('Compressor hours')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(admin.getByText('Compressor hours')).toBeVisible()
  await admin.getByRole('button', { name: 'Record reading' }).click()
  dialog = admin.getByRole('dialog')
  await dialog.getByLabel(/^Reading/).fill('50')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(admin.getByText('50 h')).toBeVisible()
  const assetUrl = admin.url()

  // Automation: every 100 h → preventive job assigned to Ravi.
  await admin.goto('/automations')
  await admin.getByRole('button', { name: 'New automation' }).first().click()
  const sheet = admin.getByRole('dialog')
  await sheet.getByLabel('Name').fill('Fridge service every 100 h')
  await sheet.getByRole('combobox', { name: 'When' }).click()
  await admin.getByRole('option', { name: 'A meter reading is recorded' }).click()
  await sheet.getByRole('combobox', { name: 'Meter' }).click()
  await admin.getByRole('option', { name: /Compressor hours/ }).click()
  await sheet.getByRole('combobox', { name: 'Fires when' }).click()
  await admin.getByRole('option', { name: 'Passes every' }).click()
  await sheet.getByLabel('Value').fill('100')
  await sheet.getByRole('combobox', { name: 'Action' }).click()
  await admin.getByRole('option', { name: 'Create a work order' }).click()
  await sheet.getByLabel('Work order title').fill(JOB)
  await sheet.getByRole('combobox', { name: 'Assign to' }).click()
  await admin.getByRole('option', { name: /Ravi Kumar/ }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(admin.getByText('Fridge service every 100 h')).toBeVisible()

  // The reading that crosses 100 h creates the job.
  await admin.goto(assetUrl)
  await admin.getByRole('button', { name: 'Record reading' }).click()
  dialog = admin.getByRole('dialog')
  await dialog.getByLabel(/^Reading/).fill('130')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(admin.getByText('130 h')).toBeVisible()
  await admin.goto('/automations')
  await expect(admin.getByText(/1 run\b/)).toBeVisible()

  // The technician opens the job, then loses the connection and replies.
  const phone = await browser.newContext({ ...devices['Pixel 7'] })
  const tech = await phone.newPage()
  await signIn(tech, 'ravi')
  // Undated work sits under Upcoming; the assignment notification links straight to it.
  await tech.goto('/w/notifications')
  await tech.getByText(JOB).first().click()
  await expect(tech.getByRole('heading', { name: JOB })).toBeVisible()
  await phone.setOffline(true)
  await tech.getByRole('textbox', { name: 'Message' }).fill('Compressor checked, all good')
  await tech.getByRole('button', { name: 'Send' }).click()
  await expect(tech.getByText(/saved on this device/i).first()).toBeVisible()
  await phone.setOffline(false)
  await expect(tech.getByText('Compressor checked, all good')).toBeVisible({ timeout: 20_000 })
  await expect(tech.getByText(/saved on this device/i)).toHaveCount(0, { timeout: 20_000 })
  await phone.close()

  // The admin sees the message once (sent exactly once despite the retry path).
  await admin.goto('/work-orders')
  await admin.getByText(JOB).first().click()
  await expect(admin.getByText('Compressor checked, all good')).toHaveCount(1)

  // Root cause on the earlier fridge repair.
  await admin.goto('/work-orders')
  await admin.getByText('E2E: Fridge not cooling, 12°C inside').first().click()
  await admin.getByRole('button', { name: 'Record root cause' }).click()
  dialog = admin.getByRole('dialog')
  await dialog.getByLabel(/^Root cause/).fill('Start relay worn out after 6 years')
  await dialog.getByRole('combobox', { name: /Category/ }).click()
  await admin.getByRole('option', { name: 'Wear and tear' }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(admin.getByText('Start relay worn out after 6 years')).toBeVisible()

  // Analytics shows the period's KPIs.
  await admin.goto('/analytics')
  await expect(admin.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible()
  await expect(admin.getByText('MTTR').first()).toBeVisible()
  await expect(admin.getByText('Work created vs completed').first()).toBeVisible()
})

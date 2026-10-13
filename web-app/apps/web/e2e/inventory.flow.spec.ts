import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

/*
 * Inventory control after the CMMS job used one relay (10 → 9):
 * a cycle count finds 8 on the shelf, completing it books the -1 into stock
 * with a ledger line, and the part page shows where the change came from.
 */

test('cycle count corrects stock and leaves a ledger line', async ({ page }) => {
  await signIn(page, 'admin')
  await page.goto('/stock-counts')
  await expect(page.getByRole('heading', { name: 'Stock counts', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'New count' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Name/).fill('E2E shelf check')
  await dialog.getByRole('button', { name: 'Start counting' }).click()

  await expect(page.getByRole('heading', { name: 'E2E shelf check' })).toBeVisible()
  const relay = page.getByRole('spinbutton', {
    name: 'Counted quantity for Compressor start relay',
  })
  await relay.fill('8')
  await page.getByRole('button', { name: 'Save counts' }).click()
  await expect(page.getByText('1 count saved.')).toBeVisible()

  await page.getByRole('button', { name: 'Complete count' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Complete count' }).click()
  await expect(page.getByText('Count completed. Stock updated.')).toBeVisible()

  await page.goto('/inventory')
  const row = page.getByRole('row', { name: /Compressor start relay/ })
  await expect(row).toContainText('8 pcs')
  await row.click()
  await expect(page.getByRole('cell', { name: /Stock count/ }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /^SC-\d+$/ }).first()).toBeVisible()
})

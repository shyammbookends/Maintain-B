import { expect, test } from '@playwright/test'
import { JOB_TITLE, signIn } from './helpers'

test.describe('admin (desktop)', () => {
  test('signs in, creates a work order and assigns it to a worker', async ({ page }) => {
    await signIn(page, 'admin')
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Work orders' })
      .click()
    await expect(page.getByRole('heading', { name: 'Work orders', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'New work order' }).first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByLabel(/^Title/).fill(JOB_TITLE)
    await sheet.getByRole('combobox', { name: /^Category/ }).click()
    await page.getByRole('option', { name: 'Refrigeration' }).click()
    await sheet.getByRole('combobox', { name: /^Priority/ }).click()
    await page.getByRole('option', { name: 'High' }).click()
    await sheet.getByRole('combobox', { name: /^Assign to/ }).click()
    await page.getByRole('option', { name: /Ravi Kumar/ }).click()
    // Due today, so it shows on the worker's Today list.
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    await sheet.getByLabel(/^Due date/).fill(today)
    await sheet.getByRole('button', { name: 'Create work order' }).click()

    await expect(page.getByRole('heading', { name: JOB_TITLE, level: 1 })).toBeVisible()
    await expect(page.getByText('Assigned', { exact: true }).first()).toBeVisible()
  })

  test('switches the interface to Hindi and back', async ({ page }) => {
    await signIn(page, 'admin')
    await page.getByRole('combobox', { name: 'Language' }).first().selectOption('hi')
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'वर्क ऑर्डर' }),
    ).toBeVisible()
    await page.getByRole('combobox', { name: 'भाषा' }).first().selectOption('en')
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'Work orders' }),
    ).toBeVisible()
  })
})

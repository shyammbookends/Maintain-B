import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'Correct-Horse-9'
/** Shared between the specs (they run in order: admin → worker → review). */
export const JOB_TITLE = 'E2E: Replace walk-in freezer gasket'

export async function signIn(page: Page, identifier: string) {
  await page.goto('/login')
  await page.getByLabel(/Email, username or phone/).fill(identifier)
  await page.getByLabel(/^Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** 1×1 PNG standing in for a camera photo. */
export const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

/** Before and after photos through the evidence pickers. */
export async function addEvidence(page: Page) {
  for (const stage of ['BEFORE', 'AFTER'] as const) {
    await page.getByTestId(`evidence-input-${stage}`).setInputFiles({
      name: `${stage.toLowerCase()}.png`,
      mimeType: 'image/png',
      buffer: PHOTO,
    })
    await expect(
      page.getByText(new RegExp(`${stage === 'BEFORE' ? 'Before' : 'After'} evidence added`)),
    ).toBeVisible()
  }
}

/** Opens Complete, fills the repair report and sends it for verification. */
export async function completeWithReport(
  page: Page,
  r: { problem: string; work: string; noParts?: boolean },
) {
  await page.getByRole('button', { name: 'Complete' }).click()
  const sheet = page.getByRole('dialog', { name: 'Repair report' })
  await sheet.getByLabel(/Problem found/).fill(r.problem)
  await sheet.getByLabel(/Work performed/).fill(r.work)
  if (r.noParts) await sheet.getByRole('checkbox', { name: 'No parts used' }).check()
  await sheet.getByRole('combobox', { name: /Final condition/ }).click()
  await page.getByRole('option', { name: 'Fully working' }).click()
  await sheet.getByRole('checkbox', { name: /I confirm/ }).check()
  await sheet.getByRole('button', { name: 'Send for verification' }).click()
}

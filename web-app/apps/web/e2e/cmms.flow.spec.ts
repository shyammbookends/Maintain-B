import { devices, expect, test, type Page } from '@playwright/test'
import { addEvidence, completeWithReport, signIn } from './helpers'

/*
 * The maintenance lifecycle end to end, as one story:
 *   scan the fridge's QR → report with a photo → admin converts it into a work
 *   order and assigns a technician → technician starts, uses a spare part and
 *   completes → supervisor verifies → asset history, cost, stock and audit
 *   all reflect the job.
 */

const PROBLEM = 'E2E: Fridge not cooling, 12°C inside'
/** 1×1 PNG standing in for a camera photo (the file input uses capture="environment"). */
const REPORT_PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

/** The worker app has a Notifications tab instead of the bell. */
async function openFromWorkerNotifications(page: Page, text: RegExp) {
  await page.goto('/w/notifications')
  await page.getByText(text).first().click()
}

test('request → work order → repair with a part → verification → history and cost', async ({
  page: admin,
  browser,
}) => {
  test.setTimeout(180_000)
  const phone = await browser.newContext({ ...devices['Pixel 7'] })
  const tech = await phone.newPage()

  // 1–6. Technician scans the fridge QR, reports the cooling problem with a photo.
  await signIn(tech, 'ravi')
  await tech.goto('/a/FridgeQr0001')
  await expect(tech.getByRole('heading', { name: 'Reach-in refrigerator' })).toBeVisible()
  await tech.getByRole('link', { name: /Report a problem with this/ }).click()
  await tech.getByLabel(/What kind of problem/).fill(PROBLEM)
  await tech.getByLabel(/What’s wrong/).fill(PROBLEM)
  await tech.getByRole('radio', { name: 'Urgent' }).click()
  await tech.getByTestId('report-photo-input').setInputFiles({
    name: 'fridge.png',
    mimeType: 'image/png',
    buffer: REPORT_PHOTO,
  })
  await tech.getByRole('button', { name: 'Send report' }).click()
  await expect(tech).toHaveURL(/\/w\/reports$/)
  await expect(tech.getByText(PROBLEM)).toBeVisible()

  // 7–10. Admin is notified, reviews the request and converts it, assigning Ravi.
  await signIn(admin, 'admin')
  await admin.getByRole('button', { name: /Notifications, \d+ unread/ }).click()
  await expect(admin.getByRole('dialog').getByText('New problem reported').first()).toBeVisible()
  await admin.keyboard.press('Escape')
  await admin
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Requests' })
    .click()
  await admin.getByText(PROBLEM).first().click()
  await admin.getByRole('button', { name: 'Create work order' }).click()
  await admin.getByRole('combobox', { name: /Assign to/ }).click()
  await admin.getByRole('option', { name: /Ravi Kumar/ }).click()
  await admin.getByRole('button', { name: 'Create work order' }).click()
  await expect(admin.getByRole('heading', { name: PROBLEM })).toBeVisible()
  await expect(admin.getByText('Assigned').first()).toBeVisible()
  const workOrderUrl = admin.url()

  // 11–25. Technician gets the task, starts (timer), uses a relay, completes.
  await openFromWorkerNotifications(tech, /Task assigned/)
  await expect(tech.getByRole('heading', { name: PROBLEM })).toBeVisible()
  await tech.getByRole('button', { name: 'Start task' }).click()
  await expect(tech.getByText(/Timer running/)).toBeVisible()
  await tech.getByRole('button', { name: 'Add part used' }).click()
  await tech.getByRole('combobox', { name: 'Part' }).click()
  await tech.getByRole('option', { name: /Compressor start relay/ }).click()
  await tech.getByRole('button', { name: 'Use part' }).click()
  await expect(tech.getByText('Parts cost: ₹450')).toBeVisible()
  // 16, 20, 22. Before / after evidence, then the structured repair report.
  await addEvidence(tech)
  await completeWithReport(tech, {
    problem: 'Compressor start relay failed',
    work: 'Replaced the start relay. Cooling back to 4°C.',
  })
  await expect(tech.getByText('Sent for review', { exact: true }).first()).toBeVisible()
  await phone.close()

  // 26–29. Supervisor sees it pending verification and approves: closed.
  const supervisorContext = await browser.newContext()
  const supervisor = await supervisorContext.newPage()
  await signIn(supervisor, 'meera')
  await supervisor.goto(workOrderUrl)
  await expect(supervisor.getByText('Waiting for your verification')).toBeVisible()
  await supervisor.getByRole('button', { name: 'Approve work' }).click()
  await supervisor.getByRole('dialog').getByRole('button', { name: 'Approve work' }).click()
  await expect(supervisor.getByText('Verified by')).toBeVisible()
  await supervisorContext.close()

  // 30–33. The asset carries the history and the cost; stock went down; audit kept it.
  await admin.goto(workOrderUrl)
  await expect(admin.getByText('Closed').first()).toBeVisible()
  await admin
    .getByRole('link', { name: /Reach-in refrigerator/ })
    .first()
    .click()
  await expect(admin.getByText('Maintenance cost (lifetime)')).toBeVisible()
  await expect(admin.getByText('₹450').first()).toBeVisible()
  await expect(admin.getByText(/Work order completed|Part replaced/).first()).toBeVisible()

  await admin.goto('/inventory')
  await expect(admin.getByRole('row', { name: /Compressor start relay/ })).toContainText('9')

  // 34. The dashboard counts the finished job.
  await admin.goto('/')
  await expect(admin.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  await expect(admin.getByText('Technician workload')).toBeVisible()
})

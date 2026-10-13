import { devices, defineConfig } from '@playwright/test'
import base from './playwright.config'

/*
 * Phone layout check: every admin and worker screen on a phone, with
 * screenshots, failing on sideways scrolling. Run with `npm run test:mobile`.
 */
export default defineConfig({
  ...base,
  testDir: './e2e-mobile',
  globalSetup: './e2e-mobile/global-setup.ts',
  timeout: 180_000,
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

/*
 * End-to-end tests: the real API (port 4100) on a dedicated *_test database,
 * the real web app (port 5174), a desktop browser for admins and a phone for
 * workers. Run with `npm run test:e2e -w @maintainx/web`.
 */

const serverDir = fileURLToPath(new URL('../server', import.meta.url))

function readServerEnv(): Record<string, string> {
  try {
    const text = readFileSync(`${serverDir}/.env`, 'utf8')
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    )
  } catch {
    return {}
  }
}

const serverEnv = readServerEnv()
const E2E_DB = process.env.E2E_DATABASE_URL ?? serverEnv.E2E_DATABASE_URL
if (!E2E_DB) throw new Error('Set E2E_DATABASE_URL (a database whose name ends in _test).')

const API_PORT = 4100
const WEB_PORT = 5174

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testMatch: /admin\..*spec\.ts/ },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /worker\..*spec\.ts/,
      dependencies: ['desktop'],
    },
    {
      name: 'review',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /review\..*spec\.ts/,
      dependencies: ['mobile'],
    },
    {
      // The full CMMS lifecycle; opens its own phone context for the technician.
      name: 'cmms',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /cmms\..*spec\.ts/,
      dependencies: ['review'],
    },
    {
      // Stock control after the CMMS job used a part.
      name: 'inventory',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /inventory\..*spec\.ts/,
      dependencies: ['cmms'],
    },
    {
      // Meters, automations, offline sync, root cause and analytics.
      name: 'automation',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /automation\..*spec\.ts/,
      dependencies: ['inventory'],
    },
  ],
  webServer: [
    {
      command: 'npx tsx src/server.ts',
      cwd: serverDir,
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...serverEnv,
        DATABASE_URL: E2E_DB,
        PORT: String(API_PORT),
        // "test" turns rate limits off and keeps logs quiet.
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        APP_URL: `http://localhost:${WEB_PORT}`,
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        COOKIE_SECURE: 'false',
      },
    },
    {
      command: 'npx vite',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_PORT: String(WEB_PORT), VITE_API_PROXY: `http://localhost:${API_PORT}` },
    },
  ],
})

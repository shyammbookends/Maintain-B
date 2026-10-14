import os from 'node:os'
import path from 'node:path'
import { config as loadDotenv } from 'dotenv'

// Runs before every test file. Provides safe defaults so the suite works
// without a .env file (CI) while still honouring real values when present.
loadDotenv({ quiet: true })

process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
process.env.APP_URL ??= 'http://localhost:5173'
process.env.CORS_ORIGIN ??= 'http://localhost:5173'
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret-test-access-secret'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret-test-refresh-secret'
process.env.FILE_SIGNING_SECRET ??= 'test-file-signing-secret-test-file-signing-secret'
// Files always go to a temp folder, never to the real bucket a local .env may point at.
process.env.STORAGE_DRIVER = 'local'
process.env.STORAGE_LOCAL_DIR = path.join(os.tmpdir(), `maintainx-test-storage-${process.pid}`)
process.env.COOKIE_SECURE = 'false'

// Database tests always run against a dedicated *_test database (see test/db.ts).
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

// Email and Web Push stay off in tests even when the local .env configures them
// (tests that need email switch it on with a mocked transport).
const { env } = await import('../config/env.js')
env.SMTP_URL = undefined
env.VAPID_PUBLIC_KEY = undefined
env.VAPID_PRIVATE_KEY = undefined

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Resolves to apps/server/package.json from both src/config and dist/config.
const pkg = require('../../package.json') as { version: string }

export const appInfo = {
  name: 'maintainx-api',
  version: pkg.version,
  startedAt: new Date(),
} as const

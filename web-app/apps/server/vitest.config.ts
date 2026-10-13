import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 15_000,
    // Integration tests share one test database; run files one at a time.
    fileParallelism: false,
  },
})

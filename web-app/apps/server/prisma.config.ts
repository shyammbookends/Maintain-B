// Prisma CLI configuration (replaces the deprecated package.json#prisma block).
// The CLI does not auto-load .env once this file exists, so load it here.
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
})

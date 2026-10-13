# Bookends Maintenance

Restaurant Maintenance & Operations Management platform for a 7-restaurant group.
Super Admin / Admin (desktop) and Worker (mobile-first) web application.

- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS v4, shadcn/ui, React Router 7, TanStack Query, React Hook Form + Zod, Recharts
- **Backend:** Node.js 20+, Express 5, TypeScript, Prisma, PostgreSQL
- **Languages:** English, Hindi, Gujarati

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and [docs/ROADMAP.md](docs/ROADMAP.md) for phase status.

## Folder layout

This folder (`web-app/`) is the website and the API. The phone app is in `../mobile-app/`.

```
apps/
  web/        React SPA (admin + worker UIs)
  server/     Express REST API, Prisma schema, migrations, seed
packages/
  shared/     Enums, permission keys, state transitions, Zod schemas shared by both
docs/         Architecture, roadmap
```

## Prerequisites

- Node.js ≥ 20.19 (24 recommended) and npm ≥ 10
- PostgreSQL 14+: installed on your machine (Windows/macOS installer or your package manager),
  or a free [Supabase](https://supabase.com) project (use its connection string as `DATABASE_URL`).
  No Docker needed.

## First-time setup

```bash
cd web-app                                    # everything below runs in this folder
npm install                                   # installs all workspaces, builds packages/shared
cp apps/server/.env.example apps/server/.env  # then edit DATABASE_URL and the secrets
npm run db:migrate                            # creates the database schema
npm run db:seed                               # organization, permissions, roles, first Super Admin
# optional: demo restaurant + Admin (manager) + Worker (technician), password Demo@1234
# SEED_DEMO_USERS=true npm run db:seed
npm run dev                                   # API on :4000, web on :5173
```

Open http://localhost:5173. The seed prints the Super Admin credentials; you must change the password on first login.

## Deploy on Vercel

The repository deploys as **one Vercel project**: the React app as static files and the
Express API as a serverless function (`api/index.js`). Everything is configured in
`vercel.json` and `scripts/vercel-build.mjs`.

1. **Database:** create a PostgreSQL database (Neon, Supabase or Vercel Postgres) and copy its
   **direct (non-pooled)** connection string.
2. **Import:** in Vercel, import this GitHub repository, set **Root Directory** to `web-app`
   and keep the detected settings (Framework: Other). `vercel.json` provides the build command
   and output folder. (An existing project: Settings → General → Root Directory → `web-app`.)
3. **Environment variables** (Settings → Environment Variables):

   | Name                                                             | Value                                                                           |
   | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
   | `DATABASE_URL`                                                   | the PostgreSQL connection string                                                |
   | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FILE_SIGNING_SECRET` | three different random strings, 32+ characters                                  |
   | `CRON_SECRET`                                                    | a random string (protects the daily background job)                             |
   | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`                        | the first Super Admin (password change forced at first sign-in)                 |
   | `STORAGE_DRIVER=supabase` + `SUPABASE_*`                         | permanent storage for photos and documents in a private Supabase bucket           |

4. **Deploy.** The build:
   - applies migrations and runs the idempotent seed;
   - fills in `APP_URL`, `CORS_ORIGIN` and `TRUST_PROXY` from Vercel automatically.

Notes:

- **Files:** without Supabase Storage, uploads work but are temporary, because Vercel's disk is
  not persistent. Set `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
  `SUPABASE_BUCKET` (a private bucket, default `maintenance-files`). AWS S3 / Cloudflare R2 also
  work with `STORAGE_DRIVER=s3`.
- **Background jobs:** Vercel Cron calls `/api/v1/jobs/run` daily (the Hobby plan limit), and a
  GitHub Actions workflow calls it every 15 minutes. Email (SMTP) and Web Push keys are optional.
  See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the secrets to set.
- **Upload size:** uploads are limited to 4 MB on Vercel (platform limit). Photos are compressed
  on the phone first.

## Scripts

| Command              | What it does                                                 |
| -------------------- | ------------------------------------------------------------ |
| `npm run dev`        | Runs shared (watch), API (tsx watch) and web (Vite) together |
| `npm run build`      | Production build of all workspaces                           |
| `npm run lint`       | ESLint across the monorepo                                   |
| `npm run typecheck`  | `tsc --noEmit` in every workspace                            |
| `npm test`           | Vitest in every workspace                                    |
| `npm run db:migrate` | `prisma migrate dev` (creates/apply migrations in dev)       |
| `npm run db:deploy`  | `prisma migrate deploy` (CI / production)                    |
| `npm run db:seed`    | Idempotent seed                                              |
| `npm run db:studio`  | Prisma Studio                                                |

## Environment

All server configuration is validated at boot (`apps/server/src/config/env.ts`); the process refuses to start with a clear message if anything is missing. Secrets live only in `apps/server/.env` (git-ignored). The web app has no secrets.

## API conventions

- Base path `/api/v1`. Success: `{ data }` or `{ data, meta }` for pages.
- Errors: `{ error: { code, message, fieldErrors?, requestId } }`. Codes are stable identifiers the web app translates; stack traces never leave the server.
- Every response carries `x-request-id`; quote it when reporting a problem.

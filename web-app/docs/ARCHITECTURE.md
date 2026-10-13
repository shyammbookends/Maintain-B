# Architecture

Single-organization, multi-restaurant (7 sites) maintenance management system. Every record carries `organization_id` so the schema is multi-tenant-ready; restaurant-scoped records carry `restaurant_id`, which drives authorization.

## Principles

1. **Complexity inside the system, never in front of the user.** Workers see one primary action per screen. Advanced fields sit behind "More options".
2. **Backend is the authority.** Permissions and restaurant scope are enforced in services/repositories; the UI only hides controls.
3. **State machines with side effects are transactional.** A work-order transition writes status history, audit log, notifications and inventory in one DB transaction.
4. **Nothing is deleted.** Business entities are archived; history, ledger and audit tables are append-only.
5. **Shared source of truth.** `packages/shared` holds enums, permission keys, transition maps and Zod schemas used by both apps. A server test asserts Prisma enums match.

## System

```
Browser (admin desktop / worker mobile)
   │  HTTPS · short-lived access JWT (memory) + rotating refresh token (httpOnly cookie)
   ▼
apps/web (Vite SPA) ──► apps/server (Express 5)
                          ├─ middleware: request-id, pino-http, helmet, cors, rate-limit, json, cookies
                          ├─ modules/<name>/{routes,schemas,service,repository}
                          ├─ core: errors, validate (Zod), pagination, prisma, authz (Phase 4)
                          ├─ storage: StorageProvider → Local (dev) | S3 (Phase 15)
                          └─ Prisma ──► PostgreSQL
                        jobs (pg-boss, Phase 10+): PM generation, overdue/warranty/low-stock scans
```

## Backend module pattern

- `routes.ts` – Express router; parses input with `parseBody/parseQuery/parseParams`, calls the service, sends `{ data }`.
- `schemas.ts` – Zod schemas (often re-exported from `@maintainx/shared`).
- `service.ts` – business rules, transactions, audit + notification calls. Never imports Express types.
- `repository.ts` – Prisma queries only, always scoped by organization and the actor's restaurant set.

Errors: throw `AppError` subclasses (`ValidationError`, `NotFoundError`, …). The global handler maps them to `{ error: { code, message, fieldErrors?, requestId } }`; anything unexpected becomes a generic 500 and is logged with its stack.

## Authentication (Phase 3)

| Piece                  | Where                  | Notes                                                                                                                                                        |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login                  | `POST /auth/login`     | Email, username or phone in one field; Argon2id; same error for unknown user and wrong password (timing equalised)                                           |
| Lockout                | `auth.service.ts`      | 5 failures → 423 `ACCOUNT_LOCKED` for 15 min; per-IP limiter (20 / 15 min) on top                                                                            |
| Access token           | `core/tokens.ts`       | HS256 JWT, 15 min, claims sub / org / tv / jti; kept in browser memory only                                                                                  |
| Refresh token          | `refresh_tokens`       | 384-bit random, HMAC-hashed in DB, httpOnly SameSite=Strict cookie on `/api/v1/auth`, rotated on every use; reuse after a 30 s grace revokes the whole login |
| CSRF                   | `requireCsrfHeader`    | Cookie endpoints require `x-requested-with: maintainx`                                                                                                       |
| Revocation             | `users.token_version`  | Bumped by password change and "sign out of all devices"; checked on every request, so disabling a user takes effect immediately                              |
| Forced password change | `must_change_password` | API answers 403 `PASSWORD_CHANGE_REQUIRED` everywhere except `/auth/*`; UI redirects to `/change-password`                                                   |
| Audit                  | `core/audit.ts`        | auth.login, login_failed, login_blocked, login_denied, logout, logout_all, password_changed, refresh_token_reuse                                             |

Web: `services/auth.service.ts` (single-flight refresh, silent retry of expired requests; network errors never sign the user out), `contexts/AuthContext.tsx` (state, cross-tab sign-out via BroadcastChannel, language saved to the account), `routes/guards.tsx` (RequireAuth, RequireRoleKind, GuestOnly). Workers live under `/w`, everyone else under `/`.

Server integration tests run against a separate `*_test` database (`TEST_DATABASE_URL`); the helpers refuse any other database name.

## Authorization (Phase 4)

`permission = resource:action` (`work_orders:assign`). An action is allowed when all three pass:

1. **Permission** – one of the user's roles grants it.
2. **Restaurant scope** – record's `restaurant_id` ∈ user's `user_restaurants` (Super Admin bypasses). Out-of-scope single records return 404.
3. **Ownership (workers)** – only tasks assigned to them or their team.

Exactly three roles, all with fixed permissions: `SUPER_ADMIN` (everything, every restaurant), `ADMIN` (operations, restaurant-scoped, admin app) and `WORKER`, shown as **User** (assigned work and problem reports, worker app). There are no custom roles; a role's `kind` decides the shell (admin vs worker).

## Internationalisation

- Web: `react-i18next`, bundles `en` / `hi` / `gu` under `apps/web/src/i18n/locales`. Typed keys via `i18next.d.ts`.
- API: returns stable error **codes**; the client translates. User-facing strings generated server-side (notifications) use the recipient's `preferred_locale` (Phase 15).
- Numbers/dates formatted with `Intl` using the active locale.

## Database

See `apps/server/prisma/schema.prisma` (fully commented). Highlights:

- UUID keys, `timestamptz`, snake_case tables, `archived_at` on business entities.
- Human codes (`WO-000123`) from the `counters` table; assets also get a random `public_id` for QR links.
- `work_orders` has `UNIQUE(pm_schedule_id, pm_due_date)` so PM generation is idempotent.
- `inventory` is the current balance; `inventory_transactions` is the ledger (balance = Σ deltas).
- Checklist items are **snapshots** of procedure steps; editing a procedure never rewrites history.
- `settings.scope_key` (`org` or restaurant id) makes the unique key work with nullable `restaurant_id`.

## Security

Argon2id hashing · access JWT 15 min + rotating refresh (hashed in DB, reuse detection by family) · httpOnly/SameSite cookies · login throttling and lockout · Helmet · strict CORS · Zod on every input · MIME sniffing and size caps on uploads · private storage with signed, time-limited links · secrets only in server env (validated at boot) · append-only audit log.

## Performance

Route-level code splitting, vendor chunking, TanStack Query caching, server-side pagination/filtering with debounced search, image compression + thumbnails, memoised table rows, optimistic updates only for safe actions.

## Frontend layout

```
apps/web/src
  app/          providers, query client
  components/   ui (shadcn), forms, tables, charts, common, worker
  layouts/      AdminLayout, WorkerLayout, AuthLayout, navigation types
  pages/        auth, admin/<module>, worker, public-asset, dev/design (gallery)
  routes/       route tree + guards
  services/     typed API client per module
  hooks/        queries/mutations per module, utilities
  contexts/     auth, restaurant scope
  i18n/         locales + setup
  styles/       tokens
```

## Design system (Phase 2)

Review it live at **http://localhost:5173/design** (development builds only; excluded from production bundles).

**Tokens** (`styles/index.css`): slate neutrals, one blue accent, 6px radius, 12–24px type scale. Status colours come in triples per tone (`--danger`, `--danger-soft`, `--danger-fg`). `styles/tokens.test.ts` computes WCAG contrast from the CSS and fails the build below 4.5:1.

**Rules of use**

| Need                     | Use                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Any status or priority   | `<StatusBadge kind="workOrderStatus" value={…} />`. Colour mapping lives only in `utils/status.ts`                                           |
| List page                | `useTableState` (URL state) + TanStack Query (`placeholderData: keepPreviousData`) + `<DataTable>` with `SearchInput` / `FilterSelect`       |
| Form                     | `useZodForm(schema)` + field components (`TextField`, `SelectField`…); `applyServerErrors(form, err)` in the catch                           |
| Advanced fields          | Wrap in `<MoreOptions forceOpen={hasErrorInside}>`                                                                                           |
| Empty / failed / loading | `EmptyState` (always with a next step), `ErrorState` (shows request reference), `Skeleton` shaped like the content                           |
| Destructive confirm      | `ConfirmDialog tone="destructive"` (async-aware)                                                                                             |
| Create/edit on desktop   | `Sheet` (right); on phones `Sheet side="bottom"`                                                                                             |
| Worker screen            | `WorkerPageHeader`, `TaskCard`, `ResultToggle`, one primary action in `BottomActionBar`; `handle: { hideWorkerNav: true }` for focused flows |
| Dates, money, durations  | `utils/format.ts` (`describeDue`, `formatCurrency`, …). Never format by hand                                                                 |

**Accessibility**: Radix primitives (focus trapping, roving focus, ARIA), skip link in every shell, 48px worker targets, `hidden` (not just CSS) for collapsed content. axe-core runs against every gallery route in `gallery.smoke.test.tsx`.

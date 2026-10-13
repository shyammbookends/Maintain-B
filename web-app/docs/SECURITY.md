# Security

How the application protects data, and what to configure when it is hosted.

## Identity and sessions

- Passwords are hashed with **Argon2id**. Minimum 8 characters, with at least one letter and one number.
- **Lockout:** 5 failed sign-ins lock the account for 15 minutes. Every attempt is audited (`auth.login`, `auth.login_failed`, `auth.login_blocked`).
- **Access token:** a short-lived JWT (15 min) kept in memory only, never in `localStorage`.
- **Refresh cookie:** HttpOnly, `SameSite=Strict`, path `/api/v1/auth`. It rotates on every use, and reuse of an old token revokes the whole session family.
- **Revocation:** changing a password, being disabled, or a role change bumps `tokenVersion`, which ends existing sessions. "Sign out everywhere" does the same.
- **CSRF:** cookie-authenticated endpoints (refresh, logout) require the `x-requested-with: maintainx` header. Every other endpoint uses a Bearer token, which browsers never attach on their own.

## Authorization

- **Permissions** are checked on the server for every route. The UI hides buttons only for convenience.
- **Restaurant scope:** users only see records of their own restaurants. Records outside their scope return **404**, not 403, so their existence isn't revealed.
- **Worker rules:** workers only see their own tasks (or unclaimed tasks of their team), their own reports and their own inspections.
- **Admin limits:**
  - Admins can't grant roles or permissions they don't hold.
  - Roles and settings are Super-Admin-only.
  - The last active Super Admin can't be removed.
  - A purchase-order requester can't approve their own order (Super Admins excepted).
- **Tests:** `apps/server/src/permission-matrix.test.ts` checks 43 endpoints × 3 roles against the declared permission table on every run.

## Input, files and output

- Every request body, query and parameter is validated with **Zod**, so unknown fields are dropped.
- Database access goes through **Prisma**. The few raw SQL statements are parameterised.
- **Uploads:**
  - Every upload is checked by **file content (magic bytes)**, not by its name or browser-supplied type.
  - Size and count are limited, and uploads are rate-limited.
  - Stored file names are sanitised.
  - Storage keys are random UUIDs and are validated against path traversal.
- **Downloads:** files are private and served only through **signed links that expire after 1 hour**:
  - The local driver uses HMAC-signed `/files` URLs.
  - The S3 driver uses pre-signed GET URLs.
  - The signature also covers the content type and file name.
- **CSV exports** (reports, audit log) neutralise spreadsheet formulas (`=`, `+`, `-`, `@` …) and are themselves audited.
- **Logs** redact the `Authorization` header, cookies and password fields.

## HTTP hardening

- **Headers:** helmet sets HSTS, `X-Content-Type-Options: nosniff`, frame protection and a strict referrer policy.
- **API responses** also carry:
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
  - `Cache-Control: no-store`, so proxies never cache signed-in data.
- **CORS** allows only `CORS_ORIGIN`, with credentials.
- **Rate limits:** a general API limit, stricter limits on sign-in, uploads and reports, and a 1 MB JSON body limit.
- **Errors:** never return stack traces. Each response carries a request ID that can be matched to the server logs.

## Audit trail

- **What's recorded:** every change, with actor, IP, device, request ID and before/after values. This includes sign-ins, permission changes, stock movements, approvals and exports.
- **Who can see it:** Super Admins see it at **Administration → Audit log**, with filters and CSV export.

## Background jobs

The background jobs are idempotent and safe to run on several servers at once:

- **Preventive maintenance:** a unique key per occurrence.
- **Alerts:** each one is sent once per record.

They also clean up expired sessions (after 7 days) and read notifications (after 90 days).

## Checklist for hosting (Phase 20)

1. **Secrets:**
   - Generate strong random values (32+ characters) for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `FILE_SIGNING_SECRET`.
   - Never reuse them between environments.
   - Keep `.env` out of git; it already is.
2. **Transport:**
   - Serve over HTTPS only.
   - Set `COOKIE_SECURE=true`. It is the default when `NODE_ENV=production`.
   - Set `TRUST_PROXY=true` behind a load balancer so rate limits see real client IPs.
3. **Web app headers:** serve the SPA with a CSP. Recommended starting point:
   `default-src 'self'; img-src 'self' data: blob: https://<your-s3-host>; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'`
   Add `Permissions-Policy: camera=(self)`, since the QR scanner needs the camera.
4. **Database:**
   - Use a dedicated user with access to the `maintainx` database only.
   - Use TLS if the database is remote.
   - Take daily backups and test restoring them.
5. **Files:**
   - Use `STORAGE_DRIVER=s3` with a **private** bucket: block all public access and enable default encryption.
   - The access key should only allow Get/Put/Delete/Head on that bucket.
6. Run `npm audit --omit=dev` before each release.

## Known and accepted

- **`deepmerge-ts` advisory (GHSA-ggr8-5vv4-36mx):**
  - It is reached through `prisma` → `@prisma/config` and only runs inside the Prisma CLI at build/migrate time, on our own config files. User input never reaches it.
  - Prisma 6 pins the affected version. The fix is the Prisma 7 upgrade (breaking changes), scheduled for Phase 20.
- **No email:** there's no self-service password reset, so admins reset passwords. Email delivery is a later decision by the owner.

## Go-live hardening (2026-10)

- **Sign-in answers are uniform:** unknown user, wrong password and a locked account all return `401 INVALID_CREDENTIALS` ("…sign-in pauses for a few minutes"), so the response can't be used to find accounts.
- **Organizations are sealed:** a Super Admin reaches every restaurant of *their* organization (archived ones too) and never another organization's, even with a guessed id (`canAccessRestaurant`, `orgRestaurantIds`).
- **Route inventory test:** `src/security-hardening.test.ts` walks every mounted route and fails if one answers without a session unless it is on the explicit public list.
- **Shared rate limits:** sign-in, SSO, the public portal and report downloads count in Postgres (`rate_limit_hits`), so limits hold across Vercel's many function instances.
- **Phone device keys** are removed on sign-out-everywhere, password change/reset, disable and archive.
- **Files** served by `/files` get `Content-Security-Policy: sandbox`, `nosniff`, `Cross-Origin-Resource-Policy: same-site`; anything that isn't a photo, video, voice note or PDF is downloaded, never rendered.
- **Webhooks** resolve the host once and check the address at connect time (no DNS-rebinding window); private, loopback, link-local and metadata addresses are refused.
- **Microsoft SSO** only accepts tokens from the configured tenant (not `common`/`organizations`), refuses guests, and uses the tenant sign-in name unless Entra marks the email verified.
- **Production config fails closed:** placeholder or reused secrets, `CORS_ORIGIN=*`, a non-https `APP_URL`, or a non-production `NODE_ENV` on Vercel stop the server at start-up.
- **Seeds:** on a hosted database (production, Vercel, or any non-local `DATABASE_URL`) the first Super Admin is only created with an explicit `SEED_ADMIN_PASSWORD` of 12+ characters that isn't a published default, its password is never printed, and demo logins are refused (`ALLOW_DEMO_SEED=yes-i-understand` for a throwaway demo site).
- **Abuse limits:** guests can trigger at most 3 unmutable CRITICAL pages per restaurant per hour; at most 10 report schedules per person and 50 per organization; counter meters can't go backwards or jump absurdly for people without `meters:edit`; whoever completed a job can't verify it (Super Admin may); Users don't see costs or other people's work on asset pages.
- **Web app headers** (`vercel.json`): strict CSP (no inline scripts), HSTS 2 years, `frame-ancestors 'none'`, `Permissions-Policy` camera/microphone for this site only.
- **Phone app:** release builds are HTTPS-only (Android network security config, iOS ATS, and the app itself); plain http only to private LAN addresses in debug builds or builds made with `--dart-define=ALLOW_LAN_HTTP=true`. App data is excluded from Android backups.

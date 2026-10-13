# Development roadmap

Each phase ends with working, tested, non-placeholder functionality. Order: explain → dependencies → implement → test → fix → confirm → wait for approval.

| #   | Phase                              | Status  | Notes                                                                                                                                                 |
| --- | ---------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Project setup & architecture       | Done    | Monorepo, shared package, Express API skeleton, full Prisma schema, web shell, i18n, CI                                                               |
| 2   | Design system                      | Done    | Tokens (AA-tested), shadcn/ui, DataTable + URL state, forms kit, layouts, gallery `/design`                                                           |
| 3   | Authentication                     | Done    | Argon2id, access JWT + rotating refresh cookie, lockout, route guards                                                                                 |
| 4   | Super Admin                        | Done    | Permission engine, roles matrix, users, restaurant scope, teams                                                                                       |
| 5   | Admin                              | Done    | Dashboard API + page (live counts, scoped), restaurant switcher, activity feed                                                                        |
| 6   | Worker                             | Done    | Home, My Tasks, Schedule, My Restaurants, More; /me API. Task actions arrive in Phase 9                                                               |
| 7   | Restaurants & locations            | Done    | Locations CRUD, restaurant page (details, locations, assets, people, teams)                                                                           |
| 8   | Assets & QR                        | Done    | Categories, assets, history + downtime, QR codes/labels, scan, /a/:publicId landing                                                                   |
| 9   | Requests & work orders             | Done    | Report Problem (photos, on-device compression), requests convert/reject, work-order state machine, timer, messages, uploads, worker task page         |
| 10  | Preventive maintenance             | Done    | Schedules (daily/weekly/monthly/quarterly/every N days), in-process generator every 5 min, lead time, pause/resume, create-next-now, compliance       |
| 11  | Procedures & inspections           | Done    | Procedure builder, work-order checklists (range-checked readings), inspection checklists, worker runner, corrective work orders                       |
| 12  | Inventory                          | Done    | Parts catalogue, per-restaurant stock with minimums, atomic ledger, adjustments/counts, parts used on work orders, low-stock alerts                   |
| 13  | Vendors                            | Done    | Vendors with services and restaurants served, invoices (paid/overdue), asset service vendor, preferred vendor for parts                               |
| 14  | Purchase orders                    | Done    | Draft → approval (no self-approval) → ordered → partial/full receiving into stock, return for changes, cancel                                         |
| 15  | Notifications, messages, documents | Done    | Notification centre (bell, worker tab, preferences), overdue / warranty / document-expiry alerts, message notifications, documents, S3 storage driver |
| 16  | Reports & analytics                | Done    | 16 reports across work, assets, inspections, inventory and purchasing; restaurant/date filters; CSV export (formula-safe, audited)                    |
| 17  | Audit logs & security hardening    | Done    | Audit log viewer + CSV, strict API CSP / no-store, dependency audit, docs/SECURITY.md                                                                 |
| 18  | Testing                            | Done    | Permission matrix (43 endpoints × 3 roles), Playwright E2E: admin desktop → worker phone → admin review                                               |
| 19  | Performance                        | Done    | Lazy Hindi/Gujarati bundles (−40 KB), bundle budget check, gzip API, overdue index, load test (p97.5 ≤ 58 ms)                                         |
| 20  | Deployment & polish                | Pending | Hosting decided later by the owner                                                                                                                    |

## Decisions log

- 2026-10-02 — Backend framework: **Express 5** (owner preference). Database: local PostgreSQL 18.
- 2026-10-02 — UI languages: **English, Hindi, Gujarati**. API returns error codes; the client translates.
- 2026-10-02 — Demo defaults (owner: "change later"): in-app notifications only; stock per restaurant; workers may report problems for any assigned restaurant; COMPLETED → REVIEW automatic on worker submit; login by email, username or phone.
- 2026-10-02 — Hosting deferred until the application is complete.
- 2026-10-02 — Light theme only (no dark mode): not in the requirements. Tokens are structured so one can be added later.
- 2026-10-02 — Fonts self-hosted (Inter + Noto Sans Devanagari/Gujarati), no Google CDN. Indic files load only when those scripts render.
- 2026-10-02 — Auth: access JWT 15 min in memory + rotating refresh cookie (30 days, SameSite=Strict, path /api/v1/auth) with family reuse detection (30 s grace for two-tab races); 5 failed sign-ins lock the account for 15 min; no self-service password reset until email is configured (admin reset arrives in Phase 4).
- 2026-10-02 — Phone numbers are normalised to +91XXXXXXXXXX for login and storage (shared `normalizePhone`).
- 2026-10-02 — Phase 4: Admins can only grant roles/restaurants within their own access; out-of-scope records return 404; last active Super Admin is protected; Super Admin and Worker roles are locked; roles/settings permissions are Super-Admin-only.
- 2026-10-02 — Phases 7–8: asset downtime counts BROKEN and UNDER_MAINTENANCE; QR codes encode {APP_URL}/a/{publicId} (12-char random id) and require sign-in + restaurant access; archiving a location is blocked while it has assets; vendor field and asset documents/photos come with Phases 13 and 15.
- 2026-10-02 — Shared Zod schemas use `validation.*` i18n keys as custom messages; the client translates them.

## Follow-ups noted for later phases

- Phase 19: main JS chunk is ~162 KB gzip after Phase 8 (scanner is a separate 60 KB chunk loaded only on the Scan tab) (Zod, Radix, three locale bundles). Lazy-load `hi`/`gu` bundles and split Zod-heavy forms if the budget needs it.
- Phase 8/9: searchable combobox (asset / user pickers) — pickers load up to 100 assets per restaurant; switch to a combobox when a restaurant passes that.
- Phase 10: the generator runs in-process (no pg-boss). Duplicates are impossible thanks to the unique (schedule, due date) key, so several server instances are safe. Missed occurrences after downtime are skipped except the latest. Move to a job queue only if more background jobs appear (Phase 15 overdue/warranty alerts).
- Phases 15–19: background jobs (PM generator, alerts, clean-up) run in-process and are idempotent. Notification types added: INSPECTION_FAILED, NEW_MESSAGE, DOCUMENT_EXPIRY; CRITICAL_ISSUE cannot be muted. Workers' tab bar is Home · My Tasks · Scan · Notifications · More (Schedule moved under More). E2E uses a separate maintainx_e2e_test database (E2E_DATABASE_URL). See docs/SECURITY.md and docs/PERFORMANCE.md.
- Phases 12–14: parts are deducted when recorded on a work order (not at completion), so stock is always current; removing a line returns it. Receiving a PO updates the part cost to the latest purchase price. Requesters cannot approve their own PO (Super Admins can, so a one-person team is not blocked). Stock transfers between restaurants are not built yet (the ledger type exists).
- Phase 8 fix (found in Phase 13): the asset form could not be saved without a location; fixed and covered by a test.
- Phase 11: photos on individual checklist steps are not supported yet (notes are); add with the documents work if needed.
- Phase 9 → 11/12/15: checklist steps (Phase 11) and parts used with stock deduction (Phase 12) attach to the work-order page; notification rows are already written (NEW_REQUEST, CRITICAL_ISSUE, TASK_ASSIGNED, TASK_COMPLETED) and the notification centre UI is Phase 15.

# Performance

## Budgets (checked)

| What                                      | Budget                                   | Now             | Check                                                                       |
| ----------------------------------------- | ---------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| JavaScript before the first screen (gzip) | ≤ 230 KB                                 | 218 KB          | `npm run build -w @maintainx/web && npm run check:bundle -w @maintainx/web` |
| Any lazy-loaded chunk (gzip)              | ≤ 80 KB (the QR scanner is allowed more) | 58 KB (scanner) | same                                                                        |
| API p97.5 latency, 20 concurrent users    | ≤ 250 ms                                 | ≤ 58 ms         | `node apps/server/scripts/load-test.mjs`                                    |
| API errors under load                     | 0                                        | 0               | same                                                                        |

## What keeps it fast

- **Web:**
  - Every page is a lazy route.
  - Hindi and Gujarati strings load only when chosen (−40 KB gzip on first load).
  - The QR scanner loads only on the Scan tab.
  - Lists are paginated on the server, and table state lives in the URL.
- **Data fetching:**
  - TanStack Query keeps previous data while filters change.
  - Live screens (worker home, unread count) poll every 1–2 minutes, not continuously.
- **API:**
  - gzip compression for JSON over 1 KB.
  - Lists always paginate (max 100 rows).
  - Reports cap at 5,000 rows.
  - Counts and lists run in parallel.
- **Database:** indexes on every scoped list (`restaurant_id`, `status`, `due_date`, `(status, due_date)` for overdue scans, notifications by `(recipient_id, read_at, created_at)`, the stock ledger by part and restaurant).
- **Stock:** each change is one atomic `UPDATE … WHERE quantity + delta >= 0`, so there are no locks held across requests.

## Load test (2026-10-02)

- **Machine:** the development laptop (Windows 11, local PostgreSQL 18).
- **Data:** 7 restaurants, 350 assets, 1,500 work orders, 150 parts × 7 stock rows, 3,000 notifications.
- **Load:** 20 connections × 8 s per scenario.

| Scenario                    | req/s | p50 ms | p97.5 ms | max ms             |
| --------------------------- | ----- | ------ | -------- | ------------------ |
| Admin dashboard             | 386   | 48     | 58       | 1061 (first, cold) |
| Work order list             | 613   | 31     | 39       | 46                 |
| Work orders – overdue view  | 607   | 32     | 39       | 57                 |
| Worker home                 | 487   | 40     | 49       | 67                 |
| Worker tasks                | 634   | 30     | 38       | 47                 |
| Unread count (polled)       | 1396  | 13     | 18       | 28                 |
| Parts with stock            | 490   | 39     | 49       | 55                 |
| Report – work order summary | 505   | 39     | 46       | 56                 |

7 restaurants with roughly 10–40 staff each make a few requests per second at peak, so one small server has well over 10× headroom.

## How to re-run

```bash
# 1. fresh e2e data + load volume (database name must end in _test)
cd apps/server
DATABASE_URL=$E2E_DATABASE_URL npx tsx src/test/e2e-seed.ts
DATABASE_URL=$E2E_DATABASE_URL npx tsx src/test/load-seed.ts
# 2. start the built API on that database
npm run build && DATABASE_URL=$E2E_DATABASE_URL PORT=4100 NODE_ENV=test node dist/server.js
# 3. in another terminal
node scripts/load-test.mjs
```

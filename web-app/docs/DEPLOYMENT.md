# Deployment: background jobs, email and Web Push

The basic Vercel setup (database, secrets, Supabase storage) is in the
[README](../README.md#deploy-on-vercel). This page covers the parts that run
on their own: background jobs every 15 minutes, email (notifications and
scheduled reports) and browser push notifications.

Never put secrets in a committed file. Locally they go in `apps/server/.env`
(git-ignored); in production they go in **Vercel → Project → Settings →
Environment Variables** (Production, and Preview if you use preview
deployments). Redeploy after changing a variable: functions read them at start.

**Region.** `vercel.json` runs the API in Mumbai (`"regions": ["bom1"]`), next to
the Supabase project that `npm run supabase:setup` creates (ap-south-1). Every
request makes several database round trips, so the function must sit in the
database's region: if your Supabase project is elsewhere, change `regions` to
the nearest [Vercel region](https://vercel.com/docs/edge-network/regions).

## Background jobs every 15 minutes

The server has these jobs: PM work orders (calendar and meter based), overdue /
due-soon / expiry alerts, scheduled email reports, cleanup and storage
retention. A long-running server runs them on timers. On Vercel there is no
long-running process, so something must call `GET /api/v1/jobs/run`:

- **Vercel Cron** (in `vercel.json`) calls it once a day; that is the Hobby plan limit.
- **GitHub Actions** (`.github/workflows/jobs-cron.yml` at the repository root)
  calls it every 15 minutes.

Each call is safe however often it comes: every job records when it last
started (`job_runs` table) and only runs when its own interval has passed
(PM and email reports every 5 minutes, alerts hourly, storage every 6 hours,
cleanup daily). Two overlapping calls never run the same job twice; work
orders, alerts and report emails are also de-duplicated individually.

### Setup

1. Pick a random secret, 16+ characters (e.g. `openssl rand -hex 32`).
2. Vercel → Settings → Environment Variables: `CRON_SECRET` = that secret. Redeploy.
   Without `CRON_SECRET` the endpoint answers 404.
3. GitHub → the repository → Settings → Secrets and variables → Actions →
   **New repository secret**:

   | Secret        | Value                                                        |
   | ------------- | ------------------------------------------------------------ |
   | `APP_URL`     | the site address, e.g. `https://your-app.vercel.app` (no `/` at the end) |
   | `CRON_SECRET` | the same value as in Vercel                                  |

4. GitHub → Actions → **Background jobs** → **Run workflow** to test it. A good
   run prints `HTTP 200` and the result of each job (`{"skipped":"ran recently"}`
   for jobs that aren't due yet).

The endpoint expects `Authorization: Bearer <CRON_SECRET>`, which is also what
Vercel Cron sends. GitHub may start scheduled runs a few minutes late, and
pauses schedules in repositories with no activity for 60 days (re-enable it
on the Actions tab).

## Email (SMTP)

Email is optional. Without it, notifications stay in the app and scheduled
reports are logged as `skipped: email not configured` (visible under the
report's **Schedule** button) instead of being sent.

| Variable    | Example                                                  |
| ----------- | -------------------------------------------------------- |
| `SMTP_URL`  | `smtps://user:password@smtp.example.com:465`              |
| `MAIL_FROM` | `Bookends Maintenance <maintenance@your-domain.com>`      |

- `SMTP_URL` must start with `smtp://` (port 587, STARTTLS) or `smtps://` (port 465).
  URL-encode special characters in the password (`@` → `%40`, `#` → `%23`, `/` → `%2F`).
- Any SMTP provider works, for example Brevo, Mailgun, Amazon SES, Zoho Mail, or
  Gmail / Google Workspace with an *app password*
  (`smtps://you%40gmail.com:app-password@smtp.gmail.com:465`).
- `MAIL_FROM` should be an address your provider lets you send from (set up SPF/DKIM
  for your domain so mail isn't marked as spam).
- Set both in Vercel → Settings → Environment Variables, then redeploy.

Who gets email: notifications go to people who turned email on for that type
in their notification settings. Scheduled reports go to the people and
addresses chosen on the schedule (people must be able to see the report's
restaurants; this is checked again at every send).

## Web Push (browser notifications)

Free, no third-party account needed. It needs a VAPID key pair:

```bash
npm run push:keys                  # prints the three lines
npm run push:keys -- --write-env   # also adds them to apps/server/.env (local only)
```

| Variable            | Value                                                    |
| ------------------- | -------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | from `npm run push:keys`                                 |
| `VAPID_PRIVATE_KEY` | from `npm run push:keys` (secret: server only)           |
| `VAPID_SUBJECT`     | `mailto:` + a contact address, e.g. `mailto:it@your-domain.com` |

- Set all three in Vercel → Settings → Environment Variables and redeploy. Set
  both keys or neither (the server refuses to start with only one).
- Use **one** key pair per environment and keep it: generating new keys means
  every browser has to allow notifications again.
- Use different keys locally and in production. Never commit them.
- Phones get push through the browser (Android Chrome; iPhone after "Add to
  Home Screen", iOS 16.4+). Each person allows notifications in their profile.

## Checklist

| Where                    | Variables                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Vercel (required)        | `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FILE_SIGNING_SECRET`    |
| Vercel (background jobs) | `CRON_SECRET`                                                                      |
| Vercel (email)           | `SMTP_URL`, `MAIL_FROM`                                                            |
| Vercel (push)            | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                           |
| GitHub Actions secrets   | `APP_URL`, `CRON_SECRET`                                                           |

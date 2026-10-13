# Bookends Maintenance

Restaurant maintenance & operations platform for a multi-restaurant group, in two parts:

| Folder | What it is | Start here |
|---|---|---|
| [`web-app/`](web-app/) | Website (Super Admin / Admin / Worker) **and** the API server + database (Node.js, Express, Prisma, PostgreSQL, React) | [web-app/README.md](web-app/README.md) |
| [`mobile-app/`](mobile-app/) | Android & iPhone app (Flutter). Talks to the API in `web-app` | [mobile-app/README.md](mobile-app/README.md) |

## Run it locally

```bash
# 1. Website + API (http://localhost:5173, API on :4000)
cd web-app
npm install
npm run dev:clean      # frees ports 4000/5173 if an old server is still running, then starts

# 2. Phone app (Android APK)
cd mobile-app
flutter pub get
flutter build apk --release --split-per-abi --target-platform android-arm64
```

The phone must be on the same Wi-Fi as the PC (or use the deployed URL); the app's
sign-in screen can find the server automatically.

## Cloud builds

- **GitHub Actions** (`.github/workflows/ci.yml`): lint, type-check, tests and build of `web-app`.
- **Vercel**: deploys `web-app` (set the project's Root Directory to `web-app`).
- **Codemagic** (`codemagic.yaml`): iPhone and Android builds of `mobile-app`.

# Bookends Maintenance — Android & iPhone app (Flutter)

The phone version of the web app: the worker app (Home · My tasks · Scan · Alerts · More)
and the admin app (Dashboard · Work orders · Requests · Assets · Menu). It talks to the same
API (`web-app/apps/server`), so logins, passwords and data are the same as on the web.

One codebase runs on Android phones and tablets, iPhones and iPads. On wide screens the app
sits in a centred column (max 840 px) and very large system font sizes are capped
(`ResponsiveFrame` in `lib/main.dart`).

## Android APK (Windows, macOS or Linux)

```bash
cd mobile-app
flutter pub get
flutter build apk --release --split-per-abi --target-platform android-arm64
# → build/app/outputs/flutter-apk/app-arm64-v8a-release.apk
```

Bump `version:` in `pubspec.yaml` for every release so it installs over the old app.

**HTTPS only in release builds.** A normal release APK only talks to an `https://` server
(the hosted site). For a test APK that uses the PC on the office Wi-Fi (`http://<LAN IP>:4000`):

```bash
flutter build apk --release --split-per-abi --target-platform android-arm64 --dart-define=ALLOW_LAN_HTTP=true
```

Debug builds (`flutter run`) always allow the LAN server. For the hosted site, set the default
address with `--dart-define=API_SERVER=https://your-app.vercel.app`.

**Release signing.** Copy `android/key.properties.example` to `android/key.properties`
(git-ignored) and point it at your upload keystore. Without that file the release build is
signed with the debug key and Gradle prints a warning — fine for sideloading, never for the
Play Store. Keep the keystore and its passwords backed up.

## iPhone / iPad app (needs a Mac or Codemagic)

Apple only allows iOS apps to be built with Xcode on macOS.

- **On a Mac** (Xcode 16+, CocoaPods):
  ```bash
  cd mobile-app
  flutter pub get
  open ios/Runner.xcworkspace   # set your Team under Signing & Capabilities
  flutter run --release          # iPhone connected by cable
  flutter build ipa --release    # for TestFlight / App Store
  ```
- **From Windows:** use [Codemagic](https://codemagic.io) with `codemagic.yaml` at the repo
  root. `ios-check` compiles without an Apple account; `ios-release` makes a signed `.ipa`
  for TestFlight and needs an Apple Developer account.

Bundle id: `in.bookends.bookendsMaintenance`, minimum iOS 15. Permissions shown to the user
(camera, photos, microphone, local network) are in `ios/Runner/Info.plist`.

## Notifications

No Firebase/APNs. The app registers the phone (`POST /push-devices`) and checks
`GET /push-feed` every 20 s (`lib/core/push.dart`):

| | Android | iPhone |
|---|---|---|
| Permission prompt | Allow / Don't allow (Android 13+) | Allow / Don't Allow |
| Sound, pop-up banner, icon badge | yes | yes |
| Alerts while the app is closed | yes (small "Task alerts are on" service) | no — needs APNs (Apple Developer account + push certificate) |

## Server address

The app's default server is set in `lib/core/session.dart` (`kDefaultServer`). It can be
changed on the sign-in screen, or found with **Find server automatically** (scans the Wi-Fi):

- same Wi-Fi as the PC running `npm run dev`: `http://<PC IP>:4000`
  (Windows Firewall must allow inbound TCP 4000)
- deployed: the Vercel URL, e.g. `https://your-app.vercel.app` (works on mobile data)

## Tests

```bash
flutter analyze
flutter test                                    # unit tests (API tests are skipped)
# Against a running API on a copy of the demo database:
flutter test test/api_contract_test.dart --dart-define=API_TEST_URL=http://localhost:4101
flutter test test/responsive_test.dart --plain-name "ipad/worker_home" --dart-define=API_TEST_URL=http://localhost:4101
```

The API allows 20 sign-ins per 15 minutes per IP; restart the test API between full runs.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import 'core/api.dart';
import 'core/i18n.dart';
import 'core/offline.dart';
import 'core/push.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'core/updater.dart';
import 'screens/admin/admin_shell.dart';
import 'screens/login_screen.dart';
import 'screens/shared/misc_screens.dart';
import 'screens/worker/worker_shell.dart';

/// Lets a tapped notification open its screen from anywhere.
final navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(kSystemBars);
  // Opened side by side so the first screen comes sooner: the language chosen on this
  // phone (the signed-in user's own choice replaces it after sign-in), the API client,
  // and saved screens / changes made without a network (sent when it returns).
  final (_, api, offline) = await (loadSavedLocale(), ApiClient.create(), _openOffline()).wait;
  api.offline = offline;
  final session = Session(api);
  onNotificationTap = (url, id) {
    // Opening an alert counts as reading it (the badge goes down).
    if (id != null && session.signedIn) unawaited(session.api.post('/notifications/$id/read').catchError((_) => null));
    final ctx = navigatorKey.currentContext;
    if (ctx != null && session.signedIn) openAppLink(ctx, url);
  };
  runApp(ChangeNotifierProvider.value(value: session, child: const BookendsApp()));
  // Alerts are set up after the first screen shows; they are optional.
  pushReady = initPush().catchError((_) {});
  await session.restore();
  // After sign-in is restored: send what waits, and watch the connection.
  api.offline?.start();
}

Future<OfflineSync?> _openOffline() async {
  try {
    return await OfflineSync.open();
  } catch (_) {
    return null; // Without storage the app still works online.
  }
}

class BookendsApp extends StatelessWidget {
  const BookendsApp({super.key});

  @override
  Widget build(BuildContext context) {
    // A language change rebuilds every open screen (no restart needed).
    return LocaleRebuilder(
      child: ValueListenableBuilder<String>(
        valueListenable: appLocale,
        builder: (context, code, _) => MaterialApp(
          title: 'Bookends Maintenance',
          debugShowCheckedModeBanner: false,
          navigatorKey: navigatorKey,
          theme: buildTheme(),
          locale: Locale(code),
          supportedLocales: [for (final c in kLocales) Locale(c)],
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          builder: (context, child) => ResponsiveFrame(child: child ?? const SizedBox()),
          home: const _Root(),
        ),
      ),
    );
  }
}

/// Picks the shell like the web app: admins get the admin app, everyone else the worker app.
class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    if (s.restoring) return const _Starting();
    if (!s.signedIn) return const LoginScreen();
    if (s.user?['mustChangePassword'] == true) return const ChangePasswordScreen();
    // Keyed by user so switching accounts starts from a fresh shell.
    final key = ValueKey(s.user?['id']);
    return _AlertsSetup(key: key, child: s.isAdmin ? const AdminShell() : const WorkerShell());
  }
}

/// Shown while the saved sign-in is checked: the same logo on blue as the phone's
/// start screen (android launch_background, iOS LaunchScreen), so there is no white flash.
class _Starting extends StatelessWidget {
  const _Starting();

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: kLogoBlue,
        body: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Image.asset('assets/brand/logo_white.png', width: 120, height: 120),
            const SizedBox(height: 28),
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
            ),
          ]),
        ),
      );
}

/// After sign-in: asks for notification permission, starts phone alerts,
/// opens the screen of a notification that launched the app and offers app updates.
class _AlertsSetup extends StatefulWidget {
  const _AlertsSetup({super.key, required this.child});
  final Widget child;
  @override
  State<_AlertsSetup> createState() => _AlertsSetupState();
}

class _AlertsSetupState extends State<_AlertsSetup> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _setup());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back in the app (e.g. the next morning): look for a newer version again.
    if (state == AppLifecycleState.resumed && mounted) {
      unawaited(checkForUpdate(context, context.read<Session>().api));
    }
  }

  Future<void> _setup() async {
    final s = context.read<Session>();
    await pushReady;
    if (!mounted) return;
    try {
      await enablePush(s.api, s.user!['id'].toString());
    } catch (_) {
      // No alerts (e.g. permission denied or server unreachable); the in-app list still works.
    }
    final url = pendingNotificationUrl;
    final id = pendingNotificationId;
    pendingNotificationUrl = pendingNotificationId = null;
    if (id != null) unawaited(s.api.post('/notifications/$id/read').catchError((_) => null));
    if (url != null && mounted) openAppLink(context, url);
    if (mounted) await checkForUpdate(context, s.api, force: true);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Same app on every screen size (Android and iPhone phones, iPads, tablets):
/// on wide screens the app sits in a centred column like the web worker layout,
/// and very large system font sizes are capped so layouts don't break.
class ResponsiveFrame extends StatelessWidget {
  const ResponsiveFrame({super.key, required this.child});
  final Widget child;

  static const maxWidth = 840.0;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final scaled = media.copyWith(textScaler: media.textScaler.clamp(minScaleFactor: 0.85, maxScaleFactor: 1.3));
    final wide = media.size.width > maxWidth + 40;
    // Keep every screen above the phone's own navigation buttons (Android 15 draws apps
    // edge-to-edge); the strip behind those buttons is white so they stay readable.
    final safe = ColoredBox(color: Colors.white, child: SafeArea(top: false, left: false, right: false, child: child));
    final content = MediaQuery(data: scaled, child: safe);
    if (!wide) return content;
    return ColoredBox(
      color: const Color(0xFFE8EBF3),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: maxWidth),
          child: DecoratedBox(
            decoration: const BoxDecoration(
              boxShadow: [BoxShadow(color: Color(0x14000000), blurRadius: 24)],
            ),
            // The column is narrower than the screen, so it needs its own size.
            child: MediaQuery(data: scaled.copyWith(size: Size(maxWidth, media.size.height)), child: safe),
          ),
        ),
      ),
    );
  }
}

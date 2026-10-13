// Main screens on Android and iPhone sizes, an iPad and large system text; fails on
// any layout overflow or exception.
//   flutter test test/responsive_test.dart --dart-define=API_TEST_URL=http://localhost:4101
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:bookends_maintenance/core/session.dart';
import 'package:bookends_maintenance/core/theme.dart';
import 'package:bookends_maintenance/main.dart' show ResponsiveFrame;
import 'package:bookends_maintenance/screens/admin/admin_shell.dart';
import 'package:bookends_maintenance/screens/admin/editors.dart';
import 'package:bookends_maintenance/screens/login_screen.dart';
import 'package:bookends_maintenance/screens/shared/misc_screens.dart';
import 'package:bookends_maintenance/screens/shared/work_order_screen.dart';
import 'package:bookends_maintenance/screens/worker/worker_shell.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'live_test_support.dart';

const server = String.fromEnvironment('API_TEST_URL');

class Device {
  const Device(this.name, this.size, this.platform, {this.textScale = 1.0});
  final String name;
  final Size size; // logical pixels
  final TargetPlatform platform;
  final double textScale;
}

const devices = [
  Device('android-small', Size(360, 640), TargetPlatform.android),
  Device('iphone-se', Size(375, 667), TargetPlatform.iOS),
  Device('iphone-pro-max', Size(430, 932), TargetPlatform.iOS),
  Device('ipad', Size(1024, 1366), TargetPlatform.iOS),
  Device('android-big-text', Size(393, 851), TargetPlatform.android, textScale: 1.5),
];

final _sessions = <String, Session>{};
Future<Session> sessionFor(String id, String pw) async {
  final cached = _sessions[id];
  if (cached != null) return cached;
  final s = Session(ApiClient.withJar(CookieJar())..server = server);
  await s.login(id, pw);
  s.restoring = false;
  return _sessions[id] = s;
}

Future<void> loadFonts() async {
  Future<ByteData> asset(String f) async => ByteData.sublistView(await File('assets/fonts/$f').readAsBytes());
  await (FontLoader('Inter')
        ..addFont(asset('Inter-Regular.ttf'))
        ..addFont(asset('Inter-Medium.ttf'))
        ..addFont(asset('Inter-SemiBold.ttf'))
        ..addFont(asset('Inter-Bold.ttf')))
      .load();
  const icons = 'C:/flutter/bin/cache/artifacts/material_fonts/materialicons-regular.otf';
  await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(icons).readAsBytesSync())))).load();
}

Future<void> render(WidgetTester t, Device d, Session s, Widget screen) async {
  debugDefaultTargetPlatformOverride = d.platform;
  t.view.devicePixelRatio = 3;
  t.view.physicalSize = d.size * 3;
  t.platformDispatcher.textScaleFactorTestValue = d.textScale;
  addTearDown(() {
    t.view.reset();
    t.platformDispatcher.clearTextScaleFactorTestValue();
  });
  await t.pumpWidget(ChangeNotifierProvider.value(
    value: s,
    child: MaterialApp(
      theme: buildTheme(),
      builder: (context, child) => ResponsiveFrame(child: child!),
      home: screen,
    ),
  ));
  for (var i = 0; i < 8; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    await t.pump();
  }
  final scrollables = find.byType(Scrollable);
  if (scrollables.evaluate().isNotEmpty) {
    for (var i = 0; i < 4; i++) {
      await t.drag(scrollables.first, const Offset(0, -600), warnIfMissed: false);
      await Future<void>.delayed(const Duration(milliseconds: 200));
      await t.pump();
    }
  }
  await t.pumpWidget(const SizedBox());
  // Must be cleared before the test ends (Flutter checks it).
  debugDefaultTargetPlatformOverride = null;
}

void main() {
  LiveTestWidgetsFlutterBinding.ensureInitialized().framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  mockPhonePlugins();
  setUpAll(() async {
    HttpOverrides.global = null;
    await loadFonts();
  });
  final skip = server.isEmpty;

  Future<String> woId(Session s, String code) async {
    final list = ((await s.api.get('/work-orders', {'q': code, 'pageSize': 5})) as Map)['data'] as List;
    return list.firstWhere((w) => w['code'] == code)['id'] as String;
  }

  final screens = <String, (String, Future<Widget> Function(Session))>{
    'login': ('', (_) async => const LoginScreen()),
    'worker_home': ('suresh.yadav', (_) async => const WorkerShell()),
    'task_detail': ('suresh.yadav', (s) async => WorkOrderScreen(id: await woId(s, 'WO-000002'))),
    'chat_room': ('suresh.yadav', (s) async {
      final chats = await s.api.getData<List>('/chats');
      return ChatRoomScreen(id: chats.first['id'] as String, title: 'Bookends Maintenance Team');
    }),
    'profile': ('suresh.yadav', (_) async => const ProfileScreen()),
    'admin_dashboard': ('admin@bookends.local', (_) async => const AdminShell()),
    'admin_create_wo': ('admin@bookends.local', (_) async => const CreateWorkOrderScreen()),
    'restaurant_form': ('admin@bookends.local', (_) async => const RestaurantForm()),
  };

  for (final d in devices) {
    for (final e in screens.entries) {
      testWidgets('${d.name}/${e.key}', (t) async {
        final (user, build) = e.value;
        final s = user.isEmpty
            ? (Session(ApiClient.withJar(CookieJar())..server = server)..restoring = false)
            : await sessionFor(user, user.contains('@') ? 'ChangeMe123' : 'Demo@1234');
        await render(t, d, s, await build(s));
        expect(t.takeException(), isNull, reason: '${d.name}/${e.key}');
      }, skip: skip);
    }
  }
}

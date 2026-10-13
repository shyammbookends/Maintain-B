// Renders the main screens with real data at phone size and fails on any
// exception (layout overflow, null data, bad casts). Saves screenshots.
//   flutter test test/ui_smoke_test.dart --dart-define=API_TEST_URL=http://localhost:4101 --update-goldens
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:bookends_maintenance/core/session.dart';
import 'package:bookends_maintenance/core/theme.dart';
import 'package:bookends_maintenance/screens/admin/admin_lists.dart';
import 'package:bookends_maintenance/screens/admin/admin_shell.dart';
import 'package:bookends_maintenance/screens/admin/editors.dart';
import 'package:bookends_maintenance/screens/login_screen.dart';
import 'package:bookends_maintenance/screens/shared/asset_screen.dart';
import 'package:bookends_maintenance/screens/shared/inspection_screens.dart';
import 'package:bookends_maintenance/screens/shared/misc_screens.dart';
import 'package:bookends_maintenance/screens/shared/report_screen.dart';
import 'package:bookends_maintenance/screens/shared/work_order_screen.dart';
import 'package:bookends_maintenance/screens/worker/worker_shell.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'live_test_support.dart';

const server = String.fromEnvironment('API_TEST_URL');
final _sessions = <String, Session>{};

Future<Session> sessionFor(WidgetTester tester, String id, String pw) async {
  final cached = _sessions[id];
  if (cached != null) return cached;
  final s = Session(ApiClient.withJar(CookieJar())..server = server);
  await s.login(id, pw);
  s.restoring = false;
  return _sessions[id] = s;
}

/// Real Roboto + Material Icons so text widths match a phone (the default test font is wider).
Future<void> loadFonts() async {
  const dir = String.fromEnvironment('FONT_DIR', defaultValue: 'C:/flutter/bin/cache/artifacts/material_fonts');
  Future<ByteData> read(String f) async => ByteData.sublistView(await File('$dir/$f').readAsBytes());
  final roboto = FontLoader('Roboto')
    ..addFont(read('roboto-regular.ttf'))
    ..addFont(read('roboto-medium.ttf'))
    ..addFont(read('roboto-bold.ttf'));
  await roboto.load();
  await (FontLoader('MaterialIcons')..addFont(read('materialicons-regular.otf'))).load();
  // The app's own font (bundled in assets/fonts).
  Future<ByteData> asset(String f) async => ByteData.sublistView(await File('assets/fonts/$f').readAsBytes());
  await (FontLoader('Inter')
        ..addFont(asset('Inter-Regular.ttf'))
        ..addFont(asset('Inter-Medium.ttf'))
        ..addFont(asset('Inter-SemiBold.ttf'))
        ..addFont(asset('Inter-Bold.ttf')))
      .load();
}

Future<void> shot(WidgetTester tester, Session s, Widget screen, String name, {bool scrollDown = false}) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ChangeNotifierProvider.value(
    value: s,
    child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(), home: screen),
  ));
  // Let the real HTTP calls (and photos) finish, then rebuild.
  for (var i = 0; i < 8; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 350));
    await tester.pump();
  }
  expect(tester.takeException(), isNull, reason: name);
  await expectLater(find.byType(MaterialApp), matchesGoldenFile('screens/$name.png'));
  if (scrollDown) {
    final scrollable = find.byType(Scrollable).first;
    for (var i = 0; i < 6; i++) {
      await tester.drag(scrollable, const Offset(0, -500));
      await Future<void>.delayed(const Duration(milliseconds: 250));
      await tester.pump();
    }
    expect(tester.takeException(), isNull, reason: '$name (scrolled)');
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('screens/${name}_2.png'));
  }
}

Future<String> woId(WidgetTester tester, Session s, String code) async {
  final res = await s.api.get('/work-orders', {'q': code, 'pageSize': 5});
  return ((res as Map)['data'] as List).firstWhere((w) => w['code'] == code)['id'] as String;
}

void main() {
  final skip = server.isEmpty;
  // Real time and real network, so the screens load like on a phone.
  LiveTestWidgetsFlutterBinding.ensureInitialized().framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  mockPhonePlugins();
  setUpAll(() async {
    HttpOverrides.global = null;
    await loadFonts();
  });

  testWidgets('login', (t) async {
    final s = Session(ApiClient.withJar(CookieJar())..server = server)..restoring = false;
    await shot(t, s, const LoginScreen(), 'login');
  }, skip: skip);

  // One test per screen keeps each run short.
  void screen(String user, String name, Future<Widget> Function(WidgetTester, Session) build, {bool scroll = false}) {
    testWidgets(name, (t) async {
      final pw = user.contains('@') ? 'ChangeMe123' : 'Demo@1234';
      try {
        final s = await sessionFor(t, user, pw);
        await shot(t, s, await build(t, s), name, scrollDown: scroll);
      } catch (e, st) {
        // ignore: avoid_print
        print('FAILED $name: $e $st');
        rethrow;
      }
    }, skip: skip);
  }

  Future<String> firstId(Session s, String path) async =>
      (((await s.api.get(path, {'pageSize': 1})) as Map)['data'] as List).first['id'] as String;

  const w = 'suresh.yadav', a = 'admin@bookends.local';
  screen(w, 'worker_home', (t, s) async => const WorkerShell(), scroll: true);
  screen(w, 'worker_tasks', (t, s) async => const WorkerTasksScreen(initialView: 'upcoming', standalone: true));
  screen(w, 'wo_closed', (t, s) async => WorkOrderScreen(id: await woId(t, s, 'WO-000001')), scroll: true);
  screen(w, 'wo_in_progress', (t, s) async => WorkOrderScreen(id: await woId(t, s, 'WO-000002')), scroll: true);
  screen(w, 'report', (t, s) async => const ReportScreen());
  screen(w, 'checklists', (t, s) async => const ChecklistsScreen());
  screen(w, 'worker_more', (t, s) async => const WorkerMoreScreen());
  screen(w, 'notifications', (t, s) async => const NotificationsScreen());
  screen(w, 'chat_list', (t, s) async => const ChatListScreen());
  screen(w, 'schedule', (t, s) async => const ScheduleScreen());
  screen(w, 'assets', (t, s) async => const AssetsScreen());
  screen(w, 'restaurants', (t, s) async => const RestaurantsScreen());
  screen(w, 'profile', (t, s) async => const ProfileScreen());
  screen('staff', 'staff_home', (t, s) async => const WorkerShell());
  screen(a, 'admin_dashboard', (t, s) async => const AdminShell(), scroll: true);
  screen(a, 'admin_work_orders', (t, s) async => const Scaffold(body: WorkOrdersScreen()));
  screen(a, 'admin_requests', (t, s) async => const RequestsScreen());
  screen(a, 'admin_request', (t, s) async => RequestScreen(id: await firstId(s, '/requests')));
  screen(a, 'admin_wo_open', (t, s) async => WorkOrderScreen(id: await woId(t, s, 'WO-000009')), scroll: true);
  screen(a, 'asset', (t, s) async => AssetScreen(id: await firstId(s, '/assets')), scroll: true);
  screen(a, 'admin_create_wo', (t, s) async => const CreateWorkOrderScreen());
  screen(a, 'admin_menu', (t, s) async => const AdminMenuScreen());
  screen(a, 'inspections', (t, s) async => const InspectionsScreen());
  screen(a, 'inspection', (t, s) async => InspectionScreen(id: await firstId(s, '/inspections')));
  screen(a, 'parts', (t, s) async => const PartsScreen());
  screen(a, 'purchase_orders', (t, s) async => const PurchaseOrdersScreen());
  screen(a, 'vendors', (t, s) async => const VendorsScreen());
  screen(a, 'teams', (t, s) async => const TeamsScreen());
  screen(a, 'documents', (t, s) async => const DocumentsScreen());
  screen(a, 'users', (t, s) async => const UsersScreen());
  screen(a, 'restaurants_admin', (t, s) async => const AdminRestaurantsScreen());
  screen(a, 'restaurant_detail', (t, s) async => RestaurantDetailScreen(id: s.restaurants.first['id'].toString()), scroll: true);
  screen(a, 'restaurant_form', (t, s) async => const RestaurantForm(), scroll: true);
  screen(a, 'location_form', (t, s) async => LocationForm(restaurantId: s.restaurants.first['id'].toString()));
  screen(a, 'asset_form', (t, s) async => const AssetForm(), scroll: true);
  screen(a, 'part_form', (t, s) async => const PartForm(), scroll: true);
  screen(a, 'part_detail', (t, s) async => PartDetailScreen(id: await firstId(s, '/parts')), scroll: true);
  screen(a, 'stock_adjust', (t, s) async {
    final id = await firstId(s, '/parts');
    return StockAdjustForm(part: await s.api.getData<Map<String, dynamic>>('/parts/$id'));
  });
  screen(a, 'vendor_form', (t, s) async => const VendorForm(), scroll: true);
  screen(a, 'team_form', (t, s) async => const TeamForm());
  screen(a, 'user_form', (t, s) async => const UserForm(), scroll: true);
  screen(a, 'user_detail', (t, s) async => UserDetailScreen(id: await firstId(s, '/users')));
  screen(a, 'document_form', (t, s) async => const DocumentForm());
  screen(a, 'po_form', (t, s) async => const PurchaseOrderForm(), scroll: true);
  screen(a, 'po_detail', (t, s) async => PurchaseOrderScreen(id: await firstId(s, '/purchase-orders')));
  screen(a, 'wo_edit', (t, s) async {
    final id = await woId(t, s, 'WO-000002');
    return WorkOrderEditForm(workOrder: await s.api.getData<Map<String, dynamic>>('/work-orders/$id'));
  });
  screen('manager', 'manager_menu', (t, s) async => const AdminMenuScreen());
  screen(a, 'chat_room', (t, s) async {
    final chats = await s.api.getData<List>('/chats');
    return ChatRoomScreen(id: chats.first['id'] as String, title: 'Team');
  });
}

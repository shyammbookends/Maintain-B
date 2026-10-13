// Restaurant remove on the detail page, content above the phone's navigation bar,
// "+ New asset" while creating a work order, and analytics on phone and iPad.
//   flutter test test/features_test.dart --plain-name <name> --dart-define=API_TEST_URL=http://localhost:4101
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:bookends_maintenance/core/session.dart';
import 'package:bookends_maintenance/core/theme.dart';
import 'package:bookends_maintenance/main.dart' show ResponsiveFrame;
import 'package:bookends_maintenance/screens/admin/admin_shell.dart';
import 'package:bookends_maintenance/screens/admin/analytics_screen.dart';
import 'package:bookends_maintenance/screens/admin/categories_screen.dart';
import 'package:bookends_maintenance/screens/admin/editors.dart';
import 'package:bookends_maintenance/screens/shared/asset_screen.dart';
import 'package:bookends_maintenance/screens/shared/chat_screens.dart';
import 'package:bookends_maintenance/screens/shared/inspection_screens.dart';
import 'package:bookends_maintenance/widgets/common.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'live_test_support.dart';

const server = String.fromEnvironment('API_TEST_URL');

Future<Session> signIn(String id, String pw) async {
  final s = Session(ApiClient.withJar(CookieJar())..server = server);
  await s.login(id, pw);
  s.restoring = false;
  return s;
}

Future<void> settle(WidgetTester t, [int ms = 2000]) async {
  for (var i = 0; i < ms ~/ 250; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    await t.pump();
  }
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

/// A phone with a 48 px system navigation bar at the bottom (edge-to-edge, like Android 15).
void phone(WidgetTester t, {Size size = const Size(390, 844), double navBar = 48}) {
  t.view.devicePixelRatio = 3;
  t.view.physicalSize = size * 3;
  t.view.padding = FakeViewPadding(top: 24 * 3, bottom: navBar * 3);
  t.view.viewPadding = FakeViewPadding(top: 24 * 3, bottom: navBar * 3);
  addTearDown(t.view.reset);
}

Widget app(Session s, Widget home) => ChangeNotifierProvider.value(
      value: s,
      child: MaterialApp(
        theme: buildTheme(),
        builder: (context, child) => ResponsiveFrame(child: child!),
        home: home,
      ),
    );

void main() {
  LiveTestWidgetsFlutterBinding.ensureInitialized().framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  mockPhonePlugins();
  setUpAll(() async {
    HttpOverrides.global = null;
    await loadFonts();
  });
  final skip = server.isEmpty;
  removeTests();

  testWidgets('restaurant-remove', (t) async {
    phone(t);
    final admin = await signIn('admin@bookends.local', 'ChangeMe123');
    final r = await admin.api.postData<Map<String, dynamic>>('/restaurants', {
      'code': 'RMV-${DateTime.now().millisecondsSinceEpoch % 1000000}', 'name': 'Remove Me', 'addressLine1': '', 'addressLine2': '', 'city': '', 'state': '',
      'postalCode': '', 'phone': '', 'email': '', 'opensAt': '', 'closesAt': '', 'status': 'ACTIVE', 'managerId': '',
      'contactName': '',
    });
    Object? popped;
    await t.pumpWidget(app(
      admin,
      Builder(
        builder: (ctx) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () async => popped = await Navigator.of(ctx)
                  .push<Object>(MaterialPageRoute(builder: (_) => RestaurantDetailScreen(id: r['id'] as String))),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await t.tap(find.text('open'));
    await settle(t);
    // On the page itself, not inside Edit.
    expect(find.text('Remove restaurant'), findsOneWidget);
    await t.tap(find.text('Remove restaurant'));
    await settle(t, 600);
    await t.tap(find.widgetWithText(FilledButton, 'Remove'));
    await settle(t, 2500);
    expect(popped, true);
    final list = await admin.api.getData<List>('/restaurants');
    expect(list.any((x) => x['id'] == r['id']), false);

    // The edit form no longer has it.
    final own = await admin.api.getData<Map<String, dynamic>>('/restaurants/${admin.restaurants.first['id']}');
    await t.pumpWidget(app(admin, RestaurantForm(existing: own)));
    await settle(t);
    await t.drag(find.byType(Scrollable).first, const Offset(0, -3000));
    await settle(t, 500);
    expect(find.text('Remove restaurant'), findsNothing);

    // Managers don't see it on the page.
    final manager = await signIn('manager', 'Demo@1234');
    await t.pumpWidget(app(manager, RestaurantDetailScreen(id: manager.restaurants.first['id'].toString())));
    await settle(t);
    expect(find.text('Remove restaurant'), findsNothing);
    await t.pumpWidget(const SizedBox());
  }, skip: skip);

  testWidgets('nav-bar-inset', (t) async {
    phone(t);
    final admin = await signIn('admin@bookends.local', 'ChangeMe123');
    await t.pumpWidget(app(admin, RestaurantDetailScreen(id: admin.restaurants.first['id'].toString())));
    await settle(t);
    final list = find.byType(Scrollable).first;
    for (var i = 0; i < 6; i++) {
      await t.drag(list, const Offset(0, -800));
      await settle(t, 300);
    }
    // The last location card ends above the 48 px system bar (screen height 844).
    final cards = find.byIcon(Icons.place_outlined);
    final lastBottom = t.getRect(cards.last).bottom;
    expect(lastBottom, lessThanOrEqualTo(844 - 48), reason: 'content must not go under the navigation bar');
    // And the dashboard's bottom tab bar sits above it too.
    await t.pumpWidget(app(admin, const AdminShell()));
    await settle(t);
    final nav = t.getRect(find.byType(NavigationBar));
    expect(nav.bottom, lessThanOrEqualTo(844 - 48 + 0.5));
    await t.pumpWidget(const SizedBox());
  }, skip: skip);

  testWidgets('wo-new-asset', (t) async {
    phone(t);
    final admin = await signIn('admin@bookends.local', 'ChangeMe123');
    await t.pumpWidget(app(admin, const CreateWorkOrderScreen()));
    await settle(t);
    expect(find.byIcon(Icons.access_time), findsNothing);
    await t.tap(find.widgetWithText(OutlinedButton, 'New'));
    await settle(t, 1500);
    expect(find.text('Add asset'), findsWidgets);
    final name = 'Tandoor ${DateTime.now().millisecondsSinceEpoch % 100000}';
    await t.enterText(find.widgetWithText(TextField, 'Asset name *'), name);
    await settle(t, 2000); // categories load
    await t.tap(find.byType(DropdownButtonFormField<String?>).first);
    await settle(t, 800);
    await t.tap(find.text('Dishwasher').last);
    await settle(t, 600);
    final save = find.widgetWithText(FilledButton, 'Add asset');
    await t.scrollUntilVisible(save, 300, scrollable: find.byType(Scrollable).first);
    await t.tap(save);
    await settle(t, 3000);
    // Back on the work order form with the new asset selected.
    expect(find.textContaining(name), findsOneWidget, reason: 'new asset should be selected');

    // Due date is date only (no time picker).
    await t.scrollUntilVisible(find.text('Set due date'), 300, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('Set due date'));
    await settle(t, 800);
    await t.tap(find.text('OK'));
    await settle(t, 800);
    expect(find.byType(TimePickerDialog), findsNothing);
    expect(find.textContaining('Due '), findsOneWidget);
    expect(find.textContaining(':'), findsNothing, reason: 'no time in the due date label');
    await t.pumpWidget(const SizedBox());
  }, skip: skip);

  for (final (name, size) in [('analytics-phone', const Size(360, 740)), ('analytics-ipad', const Size(1024, 1366))]) {
    testWidgets(name, (t) async {
      phone(t, size: size);
      final admin = await signIn('admin@bookends.local', 'ChangeMe123');
      await t.pumpWidget(app(admin, const AnalyticsScreen()));
      await settle(t, 4000);
      for (final title in ['Work orders over time', 'Reactive vs preventive', 'Open work by status', 'Where the money went']) {
        await t.scrollUntilVisible(find.text(title), 300, scrollable: find.byType(Scrollable).first);
        expect(find.text(title), findsOneWidget);
      }
      for (final title in ['Technician performance', 'Machine downtime', 'Vendor spend', 'Checklist pass rate']) {
        await t.scrollUntilVisible(find.text(title), 400, scrollable: find.byType(Scrollable).first);
        expect(find.text(title), findsOneWidget);
      }
      await t.tap(find.text('90 days'));
      await settle(t, 3000);
      expect(t.takeException(), isNull);
      await t.pumpWidget(const SizedBox());
    }, skip: skip);
  }
}


/// Every "add" has a matching "remove" (screens tapped like a user would).
void removeTests() {
  final skip = server.isEmpty;

  testWidgets('remove-category', (t) async {
    phone(t);
    final admin = await signIn('admin@bookends.local', 'ChangeMe123');
    await t.pumpWidget(app(admin, const CategoriesScreen()));
    await settle(t);
    final name = 'Temp cat ${DateTime.now().millisecondsSinceEpoch % 100000}';
    await t.tap(find.text('Add category'));
    await settle(t, 600);
    await t.enterText(find.byType(TextField).last, name);
    await settle(t, 400); // the Add button enables after typing
    await t.tap(find.widgetWithText(FilledButton, 'Add'));
    await settle(t, 2000);
    await t.scrollUntilVisible(find.text(name), 300, scrollable: find.byType(Scrollable).first);
    // Move it clear of the floating Add button at the bottom.
    await t.drag(find.byType(Scrollable).first, const Offset(0, -300));
    await settle(t, 500);
    final row = find.ancestor(of: find.text(name), matching: find.byType(AppCard)).first;
    await t.tap(find.descendant(of: row, matching: find.byIcon(Icons.delete_outline)));
    await settle(t, 600);
    await t.tap(find.widgetWithText(FilledButton, 'Remove'));
    await settle(t, 2000);
    expect(find.text(name), findsNothing);
    await t.pumpWidget(const SizedBox());
  }, skip: skip);

  testWidgets('remove-location-asset', (t) async {
    phone(t);
    final admin = await signIn('admin@bookends.local', 'ChangeMe123');
    final rid = admin.restaurants.first['id'].toString();
    final locName = 'Temp area ${DateTime.now().millisecondsSinceEpoch % 100000}';
    await admin.api.post('/locations', {'restaurantId': rid, 'name': locName, 'type': 'OTHER', 'description': ''});
    await t.pumpWidget(app(admin, RestaurantDetailScreen(id: rid)));
    await settle(t);
    await t.scrollUntilVisible(find.text(locName), 300, scrollable: find.byType(Scrollable).first);
    await t.tap(find.descendant(
        of: find.ancestor(of: find.text(locName), matching: find.byType(Row)).first, matching: find.byIcon(Icons.delete_outline)));
    await settle(t, 600);
    await t.tap(find.widgetWithText(FilledButton, 'Remove'));
    await settle(t, 2000);
    expect(find.text(locName), findsNothing);

    final cats = await admin.api.getData<List>('/asset-categories');
    final asset = await admin.api.postData<Map>('/assets', {
      'name': 'Temp machine', 'categoryId': cats.first['id'], 'restaurantId': rid, 'locationId': '', 'criticality': 'LOW',
      'installDate': '', 'manufacturer': '', 'model': '', 'serialNumber': '', 'purchaseDate': '', 'purchaseCost': '',
      'warrantyStart': '', 'warrantyEnd': '', 'notes': '', 'vendorId': '',
    });
    await t.pumpWidget(app(admin, AssetScreen(id: asset['id'] as String)));
    await settle(t);
    await t.scrollUntilVisible(find.text('Remove asset'), 300, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('Remove asset'));
    await settle(t, 600);
    await t.tap(find.widgetWithText(FilledButton, 'Remove'));
    await settle(t, 2000);
    await expectLater(admin.api.get('/assets/${asset['id']}'), throwsA(isA<ApiException>()));
    await t.pumpWidget(const SizedBox());
  }, skip: skip);

  testWidgets('remove-chat-message', (t) async {
    phone(t);
    final suresh = await signIn('suresh.yadav', 'Demo@1234');
    final chats = await suresh.api.getData<List>('/chats');
    final id = chats.first['id'] as String;
    final text = 'Delete me ${DateTime.now().millisecondsSinceEpoch}';
    await suresh.api.post('/chats/$id/messages', {'body': text, 'workOrderId': ''});
    await t.pumpWidget(app(suresh, ChatRoomScreen(id: id, title: 'Team')));
    await settle(t, 3000);
    await t.longPress(find.text(text));
    await settle(t, 600);
    await t.tap(find.widgetWithText(FilledButton, 'Delete'));
    await settle(t, 2000);
    expect(find.text(text), findsNothing);
    expect(find.text('Message deleted'), findsWidgets);
    await t.pumpWidget(const SizedBox());
  }, skip: skip);

  testWidgets('remove-checklist', (t) async {
    phone(t);
    final imran = await signIn('imran.shaikh', 'Demo@1234');
    final rid = (await imran.api.getData<List>('/me/restaurants')).first['id'];
    final tpls = await imran.api.getData<List>('/inspection-templates', {'restaurantId': rid, 'active': 'true'});
    final ins = await imran.api.postData<Map>('/inspections', {'templateId': tpls.first['id'], 'restaurantId': rid, 'assetId': ''});
    await t.pumpWidget(app(
      imran,
      Builder(
        builder: (ctx) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => InspectionScreen(id: ins['id'] as String))),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await t.tap(find.text('open'));
    await settle(t);
    await t.tap(find.text('Discard'));
    await settle(t, 600);
    await t.tap(find.widgetWithText(FilledButton, 'Discard'));
    await settle(t, 2000);
    expect(find.text('open'), findsOneWidget, reason: 'back to the previous screen');
    await expectLater(imran.api.get('/inspections/${ins['id']}'), throwsA(isA<ApiException>()));
    await t.pumpWidget(const SizedBox());
  }, skip: skip);
}

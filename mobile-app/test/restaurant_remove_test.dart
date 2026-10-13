// "Remove restaurant" on the restaurant page, not the edit form (Super Admin only).
//   flutter test test/restaurant_remove_test.dart --dart-define=API_TEST_URL=http://localhost:4101
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:bookends_maintenance/core/session.dart';
import 'package:bookends_maintenance/core/theme.dart';
import 'package:bookends_maintenance/screens/admin/editors.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/material.dart';
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

Future<void> settle(WidgetTester t, [int ms = 1500]) async {
  for (var i = 0; i < ms ~/ 250; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    await t.pump();
  }
}

void main() {
  LiveTestWidgetsFlutterBinding.ensureInitialized().framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  mockPhonePlugins();
  setUpAll(() => HttpOverrides.global = null);
  final skip = server.isEmpty;

  testWidgets('super admin removes a restaurant from its page; managers do not see it', (t) async {
    t.view.physicalSize = const Size(1170, 2532);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);

    final admin = await signIn('admin@bookends.local', 'ChangeMe123');
    final r = await admin.api.postData<Map<String, dynamic>>('/restaurants', {
      'code': 'TMP-${DateTime.now().millisecondsSinceEpoch % 1000000}',
      'name': 'Temp Outlet',
      'addressLine1': '',
      'addressLine2': '',
      'city': 'Ahmedabad',
      'state': 'Gujarat',
      'postalCode': '',
      'phone': '',
      'email': '',
      'opensAt': '',
      'closesAt': '',
      'status': 'ACTIVE',
      'managerId': '',
      'contactName': '',
    });

    Object? popped;
    await t.pumpWidget(
      ChangeNotifierProvider.value(
        value: admin,
        child: MaterialApp(
          theme: buildTheme(),
          home: Builder(
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
        ),
      ),
    );
    await t.tap(find.text('open'));
    await settle(t);

    final remove = find.text('Remove restaurant');
    await t.scrollUntilVisible(remove, 300, scrollable: find.byType(Scrollable).first);
    expect(remove, findsOneWidget);
    await t.tap(remove);
    await settle(t, 500);
    expect(find.text('Remove Temp Outlet?'), findsOneWidget);
    await t.tap(find.widgetWithText(FilledButton, 'Remove'));
    await settle(t, 2500);

    expect(popped, true);
    final list = await admin.api.getData<List>('/restaurants');
    expect(list.any((x) => x['id'] == r['id']), false, reason: 'restaurant should be archived');

    // A manager (Admin role) never sees the button.
    final manager = await signIn('manager', 'Demo@1234');
    await t.pumpWidget(
      ChangeNotifierProvider.value(
        value: manager,
        child: MaterialApp(
          theme: buildTheme(),
          home: RestaurantDetailScreen(id: manager.restaurants.first['id'].toString()),
        ),
      ),
    );
    await settle(t);
    await t.drag(find.byType(Scrollable).first, const Offset(0, -3000));
    await settle(t, 500);
    expect(find.text('Remove restaurant'), findsNothing);
    await t.pumpWidget(const SizedBox());
  }, skip: skip);
}

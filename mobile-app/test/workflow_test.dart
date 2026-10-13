// MaintainX-style work order flow: the manager creates and assigns, only the
// technician starts and completes, the manager approves.
//   flutter test test/workflow_test.dart --dart-define=API_TEST_URL=http://localhost:4101
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:bookends_maintenance/core/session.dart';
import 'package:bookends_maintenance/core/theme.dart';
import 'package:bookends_maintenance/screens/shared/misc_screens.dart';
import 'package:bookends_maintenance/screens/shared/work_order_screen.dart';
import 'package:bookends_maintenance/widgets/slide_action.dart';
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

Future<void> settle(WidgetTester t, [int ms = 2000]) async {
  for (var i = 0; i < ms ~/ 250; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    await t.pump();
  }
}

Future<void> open(WidgetTester t, Session s, String id) async {
  await t.pumpWidget(ChangeNotifierProvider.value(
    value: s,
    // A new screen each time, like opening it from a list.
    child: MaterialApp(theme: buildTheme(), home: WorkOrderScreen(key: UniqueKey(), id: id)),
  ));
  await settle(t);
}

/// Drags the knob of the "Swipe to …" button all the way to the right.
Future<void> swipe(WidgetTester t, String label) async {
  final slider = find.ancestor(of: find.text(label), matching: find.byType(SlideAction));
  final box = t.getRect(slider);
  await t.dragFrom(Offset(box.left + 29, box.center.dy), Offset(box.width, 0));
}

void main() {
  LiveTestWidgetsFlutterBinding.ensureInitialized().framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  mockPhonePlugins();
  setUpAll(() => HttpOverrides.global = null);

  testWidgets('create → assign → technician starts and completes → manager approves', (t) async {
    t.view.devicePixelRatio = 3;
    t.view.physicalSize = const Size(390, 844) * 3;
    addTearDown(t.view.reset);

    final admin = await signIn('admin@bookends.local', 'ChangeMe123');
    // Approval step on (Menu → Work order flow).
    final flow = await admin.api.getData<Map<String, dynamic>>('/settings/workflow');
    await admin.api.put('/settings/workflow', {...flow, 'requireVerification': true});
    final mahesh = await signIn('mahesh.solanki', 'Demo@1234');
    final me = (await mahesh.api.refresh())!['user'] as Map;
    final rid = (me['restaurants'] as List).first['id'];
    final wo = await admin.api.postData<Map>('/work-orders', {
      'title': 'Flow check ${DateTime.now().millisecondsSinceEpoch % 100000}',
      'description': 'Tap leaking',
      'category': 'PLUMBING',
      'priority': 'HIGH',
      'restaurantId': rid,
      'locationId': '',
      'assetId': '',
      'dueDate': '',
      'assignedUserId': me['id'],
      'assignedTeamId': '',
      'requestId': '',
    });
    final id = wo['id'] as String;

    // 1) Manager after creating: no Start / Complete, just where it stands.
    await open(t, admin, id);
    expect(find.text('Swipe to start'), findsNothing, reason: 'admins do not start work');
    expect(find.text('Swipe to complete'), findsNothing);
    expect(find.textContaining('Waiting for Mahesh Solanki to start'), findsOneWidget);
    expect(find.text('Reassign'), findsOneWidget);
    expect(find.text('Assigned'), findsWidgets); // progress step

    // 2) Technician starts, then sees Hold / Complete.
    await open(t, mahesh, id);
    expect(find.text('Swipe to start'), findsOneWidget);
    // A plain tap does nothing: it has to be swiped.
    await t.tap(find.text('Swipe to start'));
    await settle(t, 800);
    expect(find.text('Swipe to start'), findsOneWidget);
    await swipe(t, 'Swipe to start');
    await settle(t, 2500);
    expect(find.text('Swipe to complete'), findsOneWidget);
    expect(find.text('Hold'), findsOneWidget);

    // Manager while it is in progress: still no Complete.
    await open(t, admin, id);
    expect(find.text('Swipe to complete'), findsNothing);
    expect(find.textContaining('Mahesh Solanki is working on it'), findsOneWidget);

    // Technician finishes (same report the Complete screen sends).
    await mahesh.api.post('/work-orders/$id/complete', {
      'problemFound': 'Washer worn', 'rootCause': '', 'workPerformed': 'Replaced washer', 'newPartsInstalled': '',
      'oldPartsRemoved': '', 'recommendation': '', 'finalCondition': 'FULLY_WORKING', 'noPartsUsed': true, 'confirmed': true,
    });
    await open(t, mahesh, id);
    expect(find.text('Done — waiting for approval'), findsOneWidget);
    expect(find.text('Swipe to complete'), findsNothing);

    // 3) Manager approves.
    await open(t, admin, id);
    expect(find.text('Swipe to approve'), findsOneWidget);
    expect(find.text('Send back'), findsOneWidget);
    await swipe(t, 'Swipe to approve');
    await settle(t, 600);
    await t.tap(find.widgetWithText(FilledButton, 'Verify'));
    await settle(t, 2500);
    final after = await admin.api.getData<Map>('/work-orders/$id');
    expect(['VERIFIED', 'CLOSED'], contains(after['status']));
    expect(find.text('Approved'), findsWidgets);
    await t.pumpWidget(const SizedBox());
  }, skip: server.isEmpty);

  testWidgets('opening the bell marks alerts as seen, so the badge drops to 0', (t) async {
    final mahesh = await signIn('mahesh.solanki', 'Demo@1234');
    Future<int> unread() async => (await mahesh.api.getData<Map>('/notifications/unread-count'))['count'] as int;
    expect(await unread(), greaterThan(0), reason: 'the flow above left Mahesh some alerts');
    var changed = false;
    await t.pumpWidget(ChangeNotifierProvider.value(
      value: mahesh,
      child: MaterialApp(theme: buildTheme(), home: NotificationsScreen(onChanged: () => changed = true)),
    ));
    await settle(t, 2500);
    expect(await unread(), 0);
    expect(changed, true, reason: 'the shell refreshes its bell badge');
    await t.pumpWidget(const SizedBox());
  }, skip: server.isEmpty);
}

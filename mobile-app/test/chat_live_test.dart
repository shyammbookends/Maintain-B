// Live chat: a message sent by someone else appears without refreshing.
//   flutter test test/chat_live_test.dart --dart-define=API_TEST_URL=http://localhost:4101
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:bookends_maintenance/core/session.dart';
import 'package:bookends_maintenance/core/theme.dart';
import 'package:bookends_maintenance/screens/shared/chat_screens.dart';
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

Future<void> waitFor(WidgetTester t, Finder f, {int seconds = 8}) async {
  for (var i = 0; i < seconds * 4; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    await t.pump();
    if (f.evaluate().isNotEmpty) return;
  }
}

void main() {
  LiveTestWidgetsFlutterBinding.ensureInitialized().framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  mockPhonePlugins();
  setUpAll(() => HttpOverrides.global = null);
  final skip = server.isEmpty;

  testWidgets('new messages and unread counts arrive live', (t) async {
    final suresh = await signIn('suresh.yadav', 'Demo@1234');
    final priya = await signIn('manager', 'Demo@1234');
    final chats = await suresh.api.getData<List>('/chats');
    final group = chats.firstWhere((c) => c['type'] == 'GROUP') as Map;
    final id = group['id'] as String;

    Future<void> show(Widget w) => t.pumpWidget(ChangeNotifierProvider.value(
          value: suresh,
          child: MaterialApp(theme: buildTheme(), home: w),
        ));

    // 1) Open conversation: Priya's message shows up by itself.
    await show(ChatRoomScreen(id: id, title: 'Team'));
    await waitFor(t, find.byType(ListView));
    final text1 = 'Live check ${DateTime.now().millisecondsSinceEpoch}';
    expect(find.text(text1), findsNothing);
    await priya.api.post('/chats/$id/messages', {'body': text1, 'workOrderId': ''});
    await waitFor(t, find.text(text1));
    expect(find.text(text1), findsOneWidget, reason: 'message should appear without refreshing');

    // 2) Sending from this phone shows immediately and only once.
    final reply = 'Reply from Suresh ${DateTime.now().millisecondsSinceEpoch}';
    await t.enterText(find.byType(TextField), reply);
    // The mic button turns into Send once there is text (next frame).
    await waitFor(t, find.byIcon(Icons.send_rounded));
    await t.tap(find.byIcon(Icons.send_rounded));
    await waitFor(t, find.text(reply));
    await Future<void>.delayed(const Duration(seconds: 3)); // a poll runs; no duplicate
    await t.pump();
    expect(find.text(reply), findsOneWidget);

    // 3) Chat list: a new message from Priya updates the preview live.
    await show(const ChatListScreen());
    await waitFor(t, find.byType(ListTile));
    final text2 = 'List check ${DateTime.now().millisecondsSinceEpoch}';
    await priya.api.post('/chats/$id/messages', {'body': text2, 'workOrderId': ''});
    await waitFor(t, find.textContaining(text2), seconds: 10);
    expect(find.textContaining(text2), findsOneWidget, reason: 'list should refresh by itself');
    await t.pumpWidget(const SizedBox());
  }, skip: skip);
}

// Phone alerts: device registration and the /push-feed the alerts service polls.
//   flutter test test/push_contract_test.dart --dart-define=API_TEST_URL=http://localhost:4101
import 'dart:convert';
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_test/flutter_test.dart';

const server = String.fromEnvironment('API_TEST_URL');

Future<ApiClient> signIn(String id, String pw) async {
  final api = ApiClient.withJar(CookieJar())..server = server;
  await api.login(id, pw);
  return api;
}

/// Same request the background service makes (no sign-in token).
Future<(int, Map?)> feed(String key, String after, {int? wait, int? unread}) async {
  final client = HttpClient();
  try {
    final uri = Uri.parse('$server/api/v1/push-feed').replace(queryParameters: {
      'after': after,
      if (wait != null) 'wait': '$wait',
      if (unread != null) 'unread': '$unread',
    });
    final req = await client.getUrl(uri);
    req.headers.set('x-device-key', key);
    final res = await req.close();
    final text = await res.transform(utf8.decoder).join();
    return (res.statusCode, res.statusCode == 200 ? (jsonDecode(text) as Map)['data'] as Map : null);
  } finally {
    client.close(force: true);
  }
}

/// An active, published work order not assigned to [userId] right now (re-assigning
/// to the same person sends nothing, by design). If they hold them all, one goes
/// back to the admin first.
Future<Map> anyOpenWorkOrder(ApiClient admin, String restaurantId, String userId) async {
  final list = ((await admin.get('/work-orders', {'restaurantId': restaurantId, 'view': 'active', 'pageSize': 50}) as Map)['data'] as List)
      .cast<Map>()
      .where((w) => w['status'] != 'DRAFT')
      .toList();
  final free = list.where((w) => (w['assignedUser'] as Map?)?['id'] != userId);
  if (free.isNotEmpty) return free.first;
  final adminId = ((await admin.refresh())!['user'] as Map)['id'];
  await admin.post('/work-orders/${list.first['id']}/assign', {'assignedUserId': adminId, 'assignedTeamId': ''});
  return list.first;
}

void main() {
  setUpAll(() => HttpOverrides.global = null);
  final skip = server.isEmpty;

  test('assigning a task reaches the assignee phone (Rahul Desai and a technician)', () async {
    final admin = await signIn('admin@bookends.local', 'ChangeMe123');
    for (final who in ['rahul.desai', 'technician']) {
      final user = await signIn(who, 'Demo@1234');
      final me = (await user.refresh())!['user'] as Map;
      final device = await user.postData<Map>('/push-devices');
      final key = device['key'] as String;
      final before = DateTime.now().toUtc().subtract(const Duration(seconds: 2)).toIso8601String();

      // Nothing new yet.
      var (status, data) = await feed(key, DateTime.now().toUtc().toIso8601String());
      expect(status, 200);
      expect(data!['items'], isEmpty);

      // Super Admin assigns a work order in this person's restaurant to them.
      final rid = (me['restaurants'] as List).first['id'];
      final wo = await anyOpenWorkOrder(admin, rid, me['id'] as String);
      await admin.post('/work-orders/${wo['id']}/assign', {'assignedUserId': me['id'], 'assignedTeamId': ''});

      (status, data) = await feed(key, before);
      expect(status, 200);
      final items = (data!['items'] as List).cast<Map>();
      expect(items.any((n) => n['type'] == 'TASK_ASSIGNED' && (n['actionUrl'] as String).contains(wo['id'] as String)), true,
          reason: '$who should get TASK_ASSIGNED');
      expect(data['unread'], greaterThan(0));

      // Signing out removes the device; the key stops working.
      await user.delete('/push-devices/${device['deviceId']}');
      (status, _) = await feed(key, before);
      expect(status, 401);
    }
  }, skip: skip);

  test('a waiting phone hears about a new task and a read badge at once', () async {
    final admin = await signIn('admin@bookends.local', 'ChangeMe123');
    final user = await signIn('rahul.desai', 'Demo@1234');
    final me = (await user.refresh())!['user'] as Map;
    final key = (await user.postData<Map>('/push-devices'))['key'] as String;
    final wo = await anyOpenWorkOrder(admin, (me['restaurants'] as List).first['id'], me['id'] as String);
    var (_, data) = await feed(key, DateTime.now().toUtc().toIso8601String());
    final now = data!['serverTime'] as String;

    // The phone is waiting (long-poll); the admin assigns 1 s later.
    final watch = Stopwatch()..start();
    final waiting = feed(key, now, wait: 25, unread: data['unread'] as int);
    await Future.delayed(const Duration(seconds: 1));
    await admin.post('/work-orders/${wo['id']}/assign', {'assignedUserId': me['id'], 'assignedTeamId': ''});
    (_, data) = await waiting;
    expect(watch.elapsed.inSeconds, lessThan(5), reason: 'alert should arrive right away, not after the 25 s wait');
    expect((data!['items'] as List).cast<Map>().any((n) => n['type'] == 'TASK_ASSIGNED'), true, reason: '$data');
    final unread = data['unread'] as int;
    expect(unread, greaterThan(0));

    // Reading everything (e.g. opening the bell) drops the badge to 0 straight away.
    watch.reset();
    final waiting2 = feed(key, data['serverTime'] as String, wait: 25, unread: unread);
    await Future.delayed(const Duration(seconds: 1));
    await user.post('/notifications/read-all');
    (_, data) = await waiting2;
    expect(watch.elapsed.inSeconds, lessThan(5));
    expect(data!['unread'], 0);
  }, skip: skip);

  test('bad or missing keys are rejected', () async {
    expect((await feed('nonsense', '')).$1, 401);
    expect((await feed('00000000-0000-0000-0000-000000000000.abc', '')).$1, 401);
    final user = await signIn('suresh.yadav', 'Demo@1234');
    final d = await user.postData<Map>('/push-devices');
    final wrong = '${d['deviceId']}.wrong-secret';
    expect((await feed(wrong, '')).$1, 401);
    expect((await feed(d['key'] as String, '')).$1, 200);
  }, skip: skip);
}

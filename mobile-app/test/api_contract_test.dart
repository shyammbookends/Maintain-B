// Runs every call the app makes against a real API (a copy of the demo database).
//   flutter test test/api_contract_test.dart --dart-define=API_TEST_URL=http://localhost:4101
// Skipped when API_TEST_URL is not set.
import 'dart:convert';
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_test/flutter_test.dart';

const server = String.fromEnvironment('API_TEST_URL');

// A small valid JPEG (8x8 grey) so uploads pass the server's file-type check.
const _jpeg =
    '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCYBUH/2Q==';

// The API allows 20 sign-ins per 15 minutes per IP, so each user signs in once.
final _sessions = <String, ApiClient>{};
Future<ApiClient> signIn(String id, String pw) async {
  final cached = _sessions[id];
  if (cached != null) return cached;
  final api = ApiClient.withJar(CookieJar())..server = server;
  await api.login(id, pw);
  return _sessions[id] = api;
}

Future<File> photo() async {
  final f = File('${Directory.systemTemp.path}/mx_test_${DateTime.now().microsecondsSinceEpoch}.jpg');
  await f.writeAsBytes(base64Decode(_jpeg));
  return f;
}

Future<Map> woByCode(ApiClient api, String code) async {
  final list = (await api.get('/work-orders', {'q': code, 'pageSize': 5}) as Map)['data'] as List;
  return list.firstWhere((w) => w['code'] == code) as Map;
}

void main() {
  final skip = server.isEmpty ? 'set --dart-define=API_TEST_URL' : null;

  test('sign in, refresh from cookie, sign out', () async {
    final api = ApiClient.withJar(CookieJar())..server = server;
    await api.login('technician', 'Demo@1234');
    final s = await api.refresh();
    expect(s?['user']['username'], 'technician');
    await api.logout();
    expect(await api.refresh(), isNull);
    final bad = ApiClient.withJar(CookieJar())..server = server;
    expect(() => bad.login('technician', 'wrong-pass'), throwsA(isA<ApiException>()));
  }, skip: skip);

  test('all 13 demo logins work', () async {
    final users = {
      'admin@bookends.local': 'ChangeMe123',
      for (final u in ['manager', 'rahul.desai', 'neha.joshi', 'kunal.parikh', 'sneha.trivedi', 'technician',
        'suresh.yadav', 'mahesh.solanki', 'imran.shaikh', 'vikram.thakor', 'supervisor', 'staff'])
        u: 'Demo@1234',
    };
    for (final e in users.entries) {
      final api = await signIn(e.key, e.value);
      final s = await api.refresh();
      expect(s?['user']['mustChangePassword'], false, reason: e.key);
    }
  }, skip: skip);

  test('worker screens load', () async {
    final api = await signIn('suresh.yadav', 'Demo@1234');
    final home = await api.getData<Map>('/me/home');
    expect(home['counts'], isA<Map>());
    for (final v in ['today', 'upcoming', 'overdue', 'done']) {
      await api.get('/me/tasks', {'view': v, 'pageSize': 50});
    }
    await api.get('/me/tasks', {'view': 'upcoming', 'priority': 'CRITICAL', 'pm': '1', 'pageSize': 50});
    await api.getData<Map>('/me/schedule', {'days': 14});
    await api.getData<List>('/me/restaurants');
    await api.get('/notifications', {'pageSize': 50});
    await api.getData<Map>('/notifications/unread-count');
    await api.post('/notifications/read-all');
    final chats = await api.getData<List>('/chats');
    final id = chats.first['id'];
    await api.getData<Map>('/chats/$id/messages');
    await api.post('/chats/$id/messages', {'body': 'Test from the mobile app', 'workOrderId': ''});
    await api.post('/chats/$id/read');
    await api.get('/requests', {'pageSize': 50, 'mine': '1'});
    await api.get('/inspections', {'mine': '1', 'pageSize': 10});
    final assets = (await api.get('/assets', {'pageSize': 100, 'sort': 'name:asc', 'status': 'OPERATIONAL'}) as Map)['data'] as List;
    final a = await api.getData<Map>('/assets/${assets.first['id']}');
    await api.getData<Map>('/assets/by-public/${a['publicId']}');
  }, skip: skip);

  test('worker: start, checklist, photos, message, complete', () async {
    final api = await signIn('suresh.yadav', 'Demo@1234');
    // WO-000006: scheduled preventive with a 5-step checklist.
    final w = await woByCode(api, 'WO-000006');
    var d = await api.postData<Map>('/work-orders/${w['id']}/start');
    expect(d['status'], 'IN_PROGRESS');
    expect(d['actions']['checklist'], true);
    for (final item in d['checklist'] as List) {
      final id = item['id'];
      final body = switch (item['inputType']) {
        'NUMBER' => {'result': '', 'numericValue': item['unit'] == 'psi' ? 28 : 3.2, 'textValue': '', 'note': ''},
        'TEXT' => {'result': '', 'textValue': 'OK', 'note': ''},
        _ => {'result': 'PASS', 'textValue': '', 'note': ''},
      };
      d = await api.putData<Map>('/work-orders/${w['id']}/checklist/$id', body);
      if (item['requirePhoto'] == true) {
        d = await api.upload('/work-orders/${w['id']}/checklist/$id/attachments', [await photo()]);
      }
    }
    expect((d['checklist'] as List).every((i) => i['result'] == 'PASS'), true);
    d = await api.upload('/work-orders/${w['id']}/attachments', [await photo()], {'stage': 'BEFORE'});
    d = await api.upload('/work-orders/${w['id']}/attachments', [await photo()], {'stage': 'AFTER'});
    expect((d['attachments'] as List).length, greaterThanOrEqualTo(2));
    d = await api.postData<Map>('/work-orders/${w['id']}/messages', {'body': 'Service done, all OK'});
    d = await api.postData<Map>('/work-orders/${w['id']}/complete', {
      'problemFound': 'Scheduled service',
      'rootCause': '',
      'workPerformed': 'Cleaned coil, checked gasket and pressure',
      'newPartsInstalled': '',
      'oldPartsRemoved': '',
      'recommendation': '',
      'finalCondition': 'FULLY_WORKING',
      'noPartsUsed': true,
      'confirmed': true,
      'assetStatus': 'OPERATIONAL',
    });
    expect(['COMPLETED', 'REVIEW', 'VERIFIED', 'CLOSED'], contains(d['status']));
  }, skip: skip);

  test('worker: hold and resume', () async {
    final api = await signIn('vikram.thakor', 'Demo@1234');
    final w = await woByCode(api, 'WO-000007');
    var d = await api.postData<Map>('/work-orders/${w['id']}/hold', {'reason': 'Waiting for drain pump'});
    expect(d['status'], 'ON_HOLD');
    d = await api.postData<Map>('/work-orders/${w['id']}/resume');
    expect(d['status'], 'IN_PROGRESS');
  }, skip: skip);

  test('staff reports a problem with a photo; manager converts and assigns', () async {
    final staff = await signIn('staff', 'Demo@1234');
    final rid = (await staff.getData<List>('/me/restaurants')).first['id'];
    final locs = await staff.getData<List>('/locations', {'restaurantId': rid});
    final r = await staff.postData<Map>('/requests', {
      'restaurantId': rid,
      'locationId': locs.first['id'],
      'assetId': '',
      'category': 'PLUMBING',
      'title': '',
      'description': 'Tap in the cold kitchen is dripping',
      'priority': 'MEDIUM',
    });
    await staff.upload('/requests/${r['id']}/attachments', [await photo()]);

    final mgr = await signIn('manager', 'Demo@1234');
    final detail = await mgr.getData<Map>('/requests/${r['id']}');
    expect((detail['attachments'] as List).length, 1);
    expect(detail['can']['convert'], true);
    final wo = await mgr.postData<Map>('/work-orders', {
      'title': detail['title'],
      'description': detail['description'],
      'category': detail['category'],
      'priority': detail['priority'],
      'restaurantId': detail['restaurant']['id'],
      'locationId': detail['location']?['id'] ?? '',
      'assetId': detail['asset']?['id'] ?? '',
      'dueDate': '',
      'assignedUserId': '',
      'assignedTeamId': '',
      'requestId': detail['id'],
    });
    final people = await mgr.getData<List>('/work-orders/workload', {'restaurantId': rid});
    final d = await mgr.postData<Map>('/work-orders/${wo['id']}/assign', {'assignedUserId': people.first['user']['id'], 'assignedTeamId': ''});
    expect(d['assignedUser'], isNotNull);

    final r2 = await staff.postData<Map>('/requests', {
      'restaurantId': rid, 'locationId': '', 'assetId': '', 'category': 'OTHER',
      'title': 'Chair broken', 'description': 'Chair at table 4 is broken', 'priority': 'LOW',
    });
    await mgr.post('/requests/${r2['id']}/approve', {'note': 'Will fix'});
    final r3 = await staff.postData<Map>('/requests', {
      'restaurantId': rid, 'locationId': '', 'assetId': '', 'category': 'OTHER',
      'title': 'Duplicate', 'description': 'Same as the chair report', 'priority': 'LOW',
    });
    await mgr.post('/requests/${r3['id']}/reject', {'reason': 'Duplicate'});
  }, skip: skip);

  test('manager creates, verifies, sends back, reopens, cancels', () async {
    final mgr = await signIn('rahul.desai', 'Demo@1234');
    // WO-000003 is COMPLETED (awaiting review) at Sindhu Bhavan.
    final w3 = await woByCode(mgr, 'WO-000003');
    var d = await mgr.getData<Map>('/work-orders/${w3['id']}');
    if (d['actions']['verify'] == true) {
      d = await mgr.postData<Map>('/work-orders/${w3['id']}/verify', {'note': 'Checked, fine'});
      expect(['VERIFIED', 'CLOSED'], contains(d['status']));
    }
    final rid = (d['restaurant'] as Map)['id'];
    final due = DateTime.now().add(const Duration(days: 1)).toUtc().toIso8601String();
    final wo = await mgr.postData<Map>('/work-orders', {
      'title': 'Replace dining hall tube light',
      'description': 'Flickering light near entrance',
      'category': 'ELECTRICAL',
      'priority': 'LOW',
      'restaurantId': rid,
      'locationId': '',
      'assetId': '',
      'dueDate': due,
      'assignedUserId': '',
      'assignedTeamId': '',
      'requestId': '',
    });
    d = await mgr.postData<Map>('/work-orders/${wo['id']}/messages', {'body': 'Manager note', 'internal': true});
    d = await mgr.postData<Map>('/work-orders/${wo['id']}/cancel', {'reason': 'Fixed by staff already'});
    expect(d['status'], 'CANCELLED');
  }, skip: skip);

  test('worker runs a checklist (inspection) and submits it', () async {
    final api = await signIn('imran.shaikh', 'Demo@1234');
    final rid = (await api.getData<List>('/me/restaurants')).first['id'];
    final tpls = await api.getData<List>('/inspection-templates', {'restaurantId': rid, 'active': 'true'});
    final tpl = tpls.firstWhere((t) => t['type'] == 'CLOSING');
    var ins = await api.postData<Map>('/inspections', {'templateId': tpl['id'], 'restaurantId': rid, 'assetId': ''});
    for (final item in ins['items'] as List) {
      ins = await api.putData<Map>('/inspections/${ins['id']}/items/${item['id']}', {'result': 'PASS', 'textValue': '', 'note': ''});
      if (item['requirePhoto'] == true) {
        ins = await api.upload('/inspections/${ins['id']}/items/${item['id']}/attachments', [await photo()]);
      }
    }
    ins = await api.postData<Map>('/inspections/${ins['id']}/submit', {'notes': 'All closed'});
    expect(ins['status'], 'SUBMITTED');
  }, skip: skip);

  test('admin screens load', () async {
    final api = await signIn('admin@bookends.local', 'ChangeMe123');
    final dash = await api.getData<Map>('/dashboard');
    expect(dash['counts']['restaurants'], 5);
    for (final q in [
      {'view': 'active'}, {'view': 'overdue'}, {'view': 'unassigned'}, {'status': 'IN_PROGRESS'},
      {'status': 'ON_HOLD'}, {'view': 'review'}, {'view': 'done'},
    ]) {
      await api.get('/work-orders', {'pageSize': 100, 'q': '', 'sort': 'dueDate:asc', ...q});
    }
    await api.get('/requests', {'pageSize': 50, 'status': 'NEW'});
    await api.get('/inspections', {'pageSize': 50});
    for (final p in ['/parts', '/purchase-orders', '/vendors', '/documents', '/users', '/restaurants']) {
      final list = (await api.get(p, {'pageSize': 100}) as Map)['data'] as List;
      expect(list, isNotEmpty, reason: p);
    }
    expect(await api.getData<List>('/teams'), isNotEmpty);
    // Photos are served from signed links without the token.
    final wo = await woByCode(api, 'WO-000001');
    final d = await api.getData<Map>('/work-orders/${wo['id']}');
    final url = api.fileUrl((d['attachments'] as List).first['thumbUrl'] as String);
    final res = await HttpClient().getUrl(Uri.parse(url)).then((r) => r.close());
    expect(res.statusCode, 200);
  }, skip: skip);
}

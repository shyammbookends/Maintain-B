// Offline queue: order of replay, network loss, refused writes, follow-ups,
// persistence, and the API client queueing writes / serving saved screens.
// Runs without a server (a fake sender, and an address nothing listens on).
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:bookends_maintenance/core/offline.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_test/flutter_test.dart';

/// Stands in for the API: records what was sent and answers from a script.
class FakeApi {
  final sent = <String>[];

  /// Answers per path, used in order; `ok` once a path runs out.
  final answers = <String, List<SendResult>>{};

  Future<SendResult> send(QueuedWrite w) async {
    sent.add('${w.method} ${w.path}');
    final list = answers[w.path];
    if (list == null || list.isEmpty) {
      if (w.then != null) return SendResult.okThen(w.then!.withPathId('new-id'));
      return SendResult.ok;
    }
    return list.removeAt(0);
  }
}

QueuedWrite write(String id, String path, {String method = 'POST', Object? json, int? at, QueuedWrite? then}) =>
    QueuedWrite(id: id, method: method, path: path, json: json ?? const {}, createdAt: at, then: then);

void main() {
  late Directory dir;
  late OfflineSync sync;
  late FakeApi api;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('offline_test');
    sync = OfflineSync(dir, autoRetry: false);
    await sync.load();
    api = FakeApi();
    sync.sender = api.send;
  });

  tearDown(() async {
    sync.dispose();
    try {
      await dir.delete(recursive: true);
    } catch (_) {}
  });

  test('replays queued writes in the order they were made', () async {
    await sync.enqueue(write('key00000001', '/work-orders/w1/start', at: 1));
    await sync.enqueue(write('key00000002', '/work-orders/w1/checklist/s1', method: 'PUT', at: 2));
    await sync.enqueue(write('key00000003', '/work-orders/w1/complete', at: 3));
    expect(sync.pending, 3);
    final before = sync.revision.value;

    await sync.flush();

    expect(api.sent, [
      'POST /work-orders/w1/start',
      'PUT /work-orders/w1/checklist/s1',
      'POST /work-orders/w1/complete',
    ]);
    expect(sync.pending, 0);
    expect(sync.failed, isEmpty);
    expect(sync.revision.value, before + 1, reason: 'screens refetch after a sync');
  });

  test('stops at a network failure and continues from the same write later', () async {
    await sync.enqueue(write('key00000001', '/work-orders/w1/start'));
    await sync.enqueue(write('key00000002', '/work-orders/w1/messages', json: {'body': 'hi'}));
    api.answers['/work-orders/w1/messages'] = [SendResult.offline];

    await sync.flush();
    expect(api.sent, ['POST /work-orders/w1/start', 'POST /work-orders/w1/messages']);
    expect(sync.pending, 1);
    expect(sync.queue.single.id, 'key00000002', reason: 'same idempotency key on the next try');
    expect(sync.online, isFalse);

    await sync.flush();
    expect(sync.pending, 0);
    expect(api.sent.last, 'POST /work-orders/w1/messages');
  });

  test('a refused write goes to the "could not be saved" list and the rest still go', () async {
    await sync.enqueue(write('key00000001', '/work-orders/w1/start'));
    await sync.enqueue(write('key00000002', '/work-orders/w2/start'));
    api.answers['/work-orders/w1/start'] = [SendResult.refused('This task was reassigned.')];

    await sync.flush();

    expect(api.sent, ['POST /work-orders/w1/start', 'POST /work-orders/w2/start']);
    expect(sync.pending, 0);
    expect(sync.failed, hasLength(1));
    expect(sync.failed.single.write.id, 'key00000001');
    expect(sync.failed.single.error, 'This task was reassigned.');

    await sync.dismissFailed('key00000001');
    expect(sync.failed, isEmpty);
  });

  test('server errors are retried, then given up on so they do not block the queue', () async {
    await sync.enqueue(write('key00000001', '/work-orders/w1/start'));
    await sync.enqueue(write('key00000002', '/work-orders/w2/start'));
    api.answers['/work-orders/w1/start'] = [for (var i = 0; i < OfflineSync.maxServerRetries; i++) SendResult.retry('Server error')];

    for (var i = 0; i < OfflineSync.maxServerRetries - 1; i++) {
      await sync.flush();
      expect(sync.pending, 2, reason: 'kept for retry #$i');
    }
    await sync.flush();
    expect(sync.failed.single.error, 'Server error');
    expect(sync.pending, 0);
    expect(api.sent.last, 'POST /work-orders/w2/start');
  });

  test('a report is sent first, then its photos to the new report id', () async {
    final photo = File('${dir.path}/p.jpg')..writeAsBytesSync([1, 2, 3]);
    final kept = await sync.keepFiles('key00000001-p', [photo.path]);
    await sync.enqueue(write('key00000001', '/requests',
        json: {'description': 'Leak'},
        then: QueuedWrite(id: 'key00000001-p', method: 'POST', path: '/requests/{id}/attachments', files: kept)));

    await sync.flush();

    expect(api.sent, ['POST /requests', 'POST /requests/new-id/attachments']);
    expect(sync.pending, 0);
    expect(File(kept.single).existsSync(), isFalse, reason: 'copies are removed once sent');
  });

  test('the queue and the failed list survive an app restart', () async {
    await sync.enqueue(write('key00000001', '/work-orders/w1/start', at: 10));
    await sync.enqueue(write('key00000002', '/work-orders/w1/hold', json: {'reason': 'parts'}, at: 20));
    await sync.adoptUser({'id': 'u1', 'firstName': 'Ravi'});
    api.answers['/work-orders/w1/start'] = [SendResult.refused('Nope')];
    api.answers['/work-orders/w1/hold'] = [SendResult.offline];
    await sync.flush();

    final again = OfflineSync(dir, autoRetry: false);
    await again.load();
    expect(again.queue.map((w) => w.id), ['key00000002']);
    expect((again.queue.single.json as Map)['reason'], 'parts');
    expect(again.failed.single.error, 'Nope');
    expect(again.savedUser?['firstName'], 'Ravi');

    // Another person signing in on this phone starts clean.
    await again.adoptUser({'id': 'u2'});
    expect(again.pending, 0);
    expect(again.failed, isEmpty);
    again.dispose();
  });

  test('queued actions show on the saved work order (optimistic)', () {
    final saved = {
      'data': {
        'id': 'w1',
        'status': 'ASSIGNED',
        'actions': {'start': true, 'complete': false},
        'messages': [],
        'checklist': [
          {'id': 's1', 'inputType': 'PASS_FAIL_NA', 'result': null},
          {'id': 's2', 'inputType': 'SIGNATURE', 'result': null, 'attachments': [{'id': 'old', 'kind': 'PHOTO'}]},
        ],
      },
    };
    final queue = [
      write('k1', '/work-orders/w1/start'),
      write('k2', '/work-orders/w1/checklist/s1', method: 'PUT', json: {'result': 'PASS'}),
      QueuedWrite(id: 'k3', method: 'POST', path: '/work-orders/w1/checklist/s2/attachments', files: ['/x/sig.png']),
      write('k4', '/work-orders/w1/messages', json: {'body': 'On my way'}),
      write('k5', '/work-orders/w2/hold'),
    ];
    final me = {'id': 'u1', 'firstName': 'Ravi'};
    final out = applyPending('/work-orders/w1', saved, queue, me) as Map;
    final w = out['data'] as Map;
    expect(w['status'], 'IN_PROGRESS');
    expect((w['actions'] as Map)['complete'], isTrue);
    expect(((w['checklist'] as List)[0] as Map)['result'], 'PASS');
    final sig = (w['checklist'] as List)[1] as Map;
    expect(sig['result'], 'PASS');
    expect((sig['attachments'] as List).single['localPath'], '/x/sig.png', reason: 'a new signature replaces the old');
    expect(((w['messages'] as List).single as Map)['author'], me);
    expect((saved['data'] as Map)['status'], 'ASSIGNED', reason: 'the saved copy itself is not changed');

    final tasks = applyPending('/me/tasks', {
      'data': [
        {'id': 'w1', 'status': 'ASSIGNED'},
        {'id': 'w2', 'status': 'IN_PROGRESS'},
      ],
    }, queue, me) as Map;
    expect([for (final t in tasks['data'] as List) t['status']], ['IN_PROGRESS', 'ON_HOLD']);
  });

  group('API client without a network', () {
    late ApiClient client;

    setUp(() {
      // Nothing listens on port 1: every request fails like a phone with no signal.
      client = ApiClient.withJar(CookieJar())..server = 'http://127.0.0.1:1';
      client.offline = sync;
    });

    test('queues field actions with an idempotency key and shows the saved screen', () async {
      await sync.cacheWrite('/work-orders/w1', {
        'data': {'id': 'w1', 'code': 'WO-7', 'status': 'ASSIGNED', 'actions': {'start': true}, 'checklist': []},
      });

      await expectLater(
        client.post('/work-orders/w1/start'),
        throwsA(isA<ApiException>().having((e) => e.queued, 'queued', isTrue)),
      );
      expect(sync.pending, 1);
      final q = sync.queue.single;
      expect(q.path, '/work-orders/w1/start');
      expect(q.id, matches(RegExp(r'^[a-z0-9]{24}$')), reason: 'valid Idempotency-Key for the server');
      expect(q.ref, 'WO-7');

      final w = await client.getData<Json>('/work-orders/w1');
      expect(w['status'], 'IN_PROGRESS');
      expect(sync.showingSaved, isTrue);

      // Later changes queue behind the first one, without trying the network.
      await expectLater(client.post('/work-orders/w1/messages', {'body': 'x'}), throwsA(isA<ApiException>()));
      expect(sync.queue.map((w) => w.path), ['/work-orders/w1/start', '/work-orders/w1/messages']);
      // The background send attempt (still no network) keeps both.
      await sync.flush();
      expect(sync.pending, 2);
    });

    test('a part used and a reading are queued and show on the saved screens', () async {
      await sync.cacheWrite('/work-orders/w1', {
        'data': {'id': 'w1', 'code': 'WO-9', 'status': 'IN_PROGRESS', 'parts': [], 'actions': {'parts': true}},
      });
      await sync.cacheWrite('/assets/a1/meters', {
        'data': [
          {'id': 'm1', 'name': 'Hours', 'unit': 'h', 'currentValue': 10, 'readings': []},
        ],
      });

      await expectLater(
        client.postData<dynamic>('/work-orders/w1/parts', {'partId': 'p1', 'quantity': 1, 'condition': 'NEW'},
            {'part': {'id': 'p1', 'name': 'Gasket', 'unit': 'pcs'}}),
        throwsA(isA<ApiException>().having((e) => e.queued, 'queued', isTrue)),
      );
      await expectLater(
        client.postData<List>('/assets/a1/meters/m1/readings', {'value': 11, 'note': '', 'workOrderId': 'w1'}),
        throwsA(isA<ApiException>().having((e) => e.queued, 'queued', isTrue)),
      );
      expect(sync.queue.map((w) => w.path), ['/work-orders/w1/parts', '/assets/a1/meters/m1/readings']);
      expect(sync.queue.first.ref, 'WO-9');
      expect(sync.queue.first.meta?['part']['name'], 'Gasket');

      final w = await client.getData<Json>('/work-orders/w1');
      expect(((w['parts'] as List).single as Map)['part']['name'], 'Gasket');
      final meters = await client.getData<List>('/assets/a1/meters');
      expect((meters.single as Map)['currentValue'], 11);
    });

    test('photos are copied for the queue and other writes are not queued', () async {
      final photo = File('${dir.path}/before.jpg')..writeAsBytesSync([1, 2, 3]);
      await expectLater(
        client.upload('/work-orders/w1/attachments', [photo], {'stage': 'BEFORE'}),
        throwsA(isA<ApiException>().having((e) => e.queued, 'queued', isTrue)),
      );
      final q = sync.queue.single;
      expect(q.fields, {'stage': 'BEFORE'});
      expect(File(q.files.single).readAsBytesSync(), [1, 2, 3]);
      expect(q.files.single, isNot(photo.path));

      // Manager-only actions are not kept for later.
      await expectLater(
        client.post('/work-orders/w1/verify'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'NETWORK_ERROR')),
      );
      expect(sync.pending, 1);
    });

    test('a replay that still cannot connect keeps the write', () async {
      await sync.enqueue(write('key00000001', '/work-orders/w1/start'));
      await sync.flush(); // sender is the API client now
      expect(sync.pending, 1);
      expect(sync.failed, isEmpty);
    });
  });
}

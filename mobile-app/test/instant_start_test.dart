// Instant start: the app opens with the last signed-in user and saved screens
// while the server is still being asked (or never answers).
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:bookends_maintenance/core/offline.dart';
import 'package:bookends_maintenance/core/session.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  late Directory dir;
  late OfflineSync sync;
  late ServerSocket silent;
  late ApiClient client;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('instant_start_test');
    sync = OfflineSync(dir, autoRetry: false);
    await sync.load();
    // A server that accepts connections but never answers (a slow or waking-up server).
    silent = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    silent.listen((_) {});
    client = ApiClient.withJar(CookieJar())..server = 'http://127.0.0.1:${silent.port}';
    client.offline = sync;
  });

  tearDown(() async {
    await silent.close();
    sync.dispose();
    try {
      await dir.delete(recursive: true);
    } catch (_) {}
  });

  test('a screen shows its saved copy at once, without waiting for the server', () async {
    await sync.cacheWrite('/me/home', {
      'data': {'today': 3},
    });
    final hits = CacheHits();
    final watch = Stopwatch()..start();
    final home = await client.cacheFirst(() => client.getData<Json>('/me/home'), hits);
    expect(home['today'], 3);
    expect(hits.count, 1);
    expect(watch.elapsed, lessThan(const Duration(seconds: 1)));
  });

  test('without a saved copy the screen asks the server', () async {
    client.server = 'http://127.0.0.1:1'; // nothing listens: fails at once
    final hits = CacheHits();
    await expectLater(
      client.cacheFirst(() => client.getData<Json>('/me/home'), hits),
      throwsA(isA<ApiException>().having((e) => e.status, 'status', 0)),
    );
    expect(hits.count, 0);
  });

  test('the app opens with the saved user while the session check is still running', () async {
    SharedPreferences.setMockInitialValues({'server': 'http://127.0.0.1:${silent.port}'});
    await sync.adoptUser({'id': 'u1', 'firstName': 'Ravi', 'roleKind': 'WORKER', 'permissions': <String>[]});
    final session = Session(client);
    final watch = Stopwatch()..start();
    await session.restore();
    expect(watch.elapsed, lessThan(const Duration(seconds: 1)));
    expect(session.restoring, isFalse);
    expect(session.signedIn, isTrue);
    expect(session.firstName, 'Ravi');
  });
}

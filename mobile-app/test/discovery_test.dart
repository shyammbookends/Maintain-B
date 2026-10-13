// Server discovery on the local network.
//   flutter test test/discovery_test.dart --dart-define=LAN_SERVER=http://172.16.35.54:4000
import 'dart:io';

import 'package:bookends_maintenance/core/discovery.dart';
import 'package:flutter_test/flutter_test.dart';

const lan = String.fromEnvironment('LAN_SERVER');

void main() {
  setUpAll(() => HttpOverrides.global = null);

  test('recognises the API and rejects other addresses', () async {
    expect(await pingServer(lan), true);
    expect(await pingServer('http://127.0.0.1:1'), false);
    expect(await pingServer('http://example.invalid:4000', timeout: const Duration(seconds: 2)), false);
  }, skip: lan.isEmpty);

  test('a full network scan finishes in reasonable time', () async {
    final sw = Stopwatch()..start();
    var last = 0.0;
    final found = await discoverServer(onProgress: (p) => last = p);
    sw.stop();
    // ignore: avoid_print
    print('scan: found=$found in ${sw.elapsed.inSeconds}s (progress ${(last * 100).round()}%)');
    expect(sw.elapsed.inSeconds, lessThan(60));
  }, skip: lan.isEmpty, timeout: const Timeout(Duration(minutes: 2)));
}

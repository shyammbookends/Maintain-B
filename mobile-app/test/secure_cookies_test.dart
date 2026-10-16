import 'dart:io';

import 'package:bookends_maintenance/core/secure_cookies.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late Directory dir;
  final uri = Uri.parse('https://maintain-b.vercel.app/api/v1/auth/refresh');

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    dir = Directory.systemTemp.createTempSync('cookies_');
  });
  tearDown(() => dir.deleteSync(recursive: true));

  Cookie session(String v) => Cookie('mx_rt', v)
    ..path = '/api/v1/auth'
    ..httpOnly = true
    ..secure = true
    ..maxAge = 3600;

  List<File> plainFiles() => dir.listSync(recursive: true).whereType<File>().toList();

  test('a cookie saved by the old (plain file) version moves into the secure store', () async {
    final old = PersistCookieJar(storage: FileStorage(dir.path));
    await old.saveFromResponse(uri, [session('old-session')]);
    expect(plainFiles(), isNotEmpty);

    final jar = PersistCookieJar(storage: SecureCookieStorage(dir.path));
    final got = await jar.loadForRequest(uri);
    expect(got.single.value, 'old-session');
    // Nothing readable is left on disk after the move.
    for (final f in plainFiles()) {
      expect(f.readAsStringSync(), isNot(contains('old-session')));
    }
  });

  test('new cookies are written only to the secure store and survive a restart', () async {
    final jar = PersistCookieJar(storage: SecureCookieStorage(dir.path));
    await jar.saveFromResponse(uri, [session('new-session')]);
    for (final f in plainFiles()) {
      expect(f.readAsStringSync(), isNot(contains('new-session')));
    }
    final restarted = PersistCookieJar(storage: SecureCookieStorage(dir.path));
    expect((await restarted.loadForRequest(uri)).single.value, 'new-session');
  });

  test('sign-out removes the cookie everywhere', () async {
    final jar = PersistCookieJar(storage: SecureCookieStorage(dir.path));
    await jar.saveFromResponse(uri, [session('to-delete')]);
    await jar.deleteAll();
    final restarted = PersistCookieJar(storage: SecureCookieStorage(dir.path));
    expect(await restarted.loadForRequest(uri), isEmpty);
  });
}

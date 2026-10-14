import 'package:bookends_maintenance/core/updater.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final sha = 'a' * 64;
  Map<String, dynamic> offer([Map<String, dynamic> patch = const {}]) => {
        'available': true,
        'required': false,
        'version': '1.17.0',
        'build': 23,
        'notes': ['Faster reports'],
        'sha256': sha,
        'size': 31000000,
        'url': 'https://example.supabase.co/storage/v1/object/sign/app-releases/android/x.apk?token=t',
        ...patch,
      };

  test('reads an update offer', () {
    final u = AppUpdate.fromJson(offer())!;
    expect(u.version, '1.17.0');
    expect(u.build, 23);
    expect(u.notes, ['Faster reports']);
    expect(u.required, isFalse);
  });

  test('nothing to install', () {
    expect(AppUpdate.fromJson({'available': false}), isNull);
  });

  test('refuses plain http links and bad checksums', () {
    expect(AppUpdate.fromJson(offer({'url': 'http://example.com/x.apk'})), isNull);
    expect(AppUpdate.fromJson(offer({'sha256': 'not-a-hash'})), isNull);
  });

  test('split APK version codes map back to the pubspec build', () {
    expect(buildNumberOf('2022'), 22);
    expect(buildNumberOf('22'), 22);
    expect(buildNumberOf(''), 0);
  });
}

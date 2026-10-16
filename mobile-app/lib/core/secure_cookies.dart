import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Cookie storage for the sign-in session (the refresh cookie), encrypted by the
/// phone: Android Keystore (AES-GCM) / iOS Keychain (this device only, after the
/// first unlock). Cookies that older versions saved as plain files are moved in
/// on first read, so nobody is signed out by the update. If the secure store
/// fails on a phone, the plain files are used as before (never a sign-in loop).
class SecureCookieStorage implements Storage {
  SecureCookieStorage(String legacyDir, {FlutterSecureStorage? store})
      : _legacy = FileStorage(legacyDir),
        _store = store ??
            const FlutterSecureStorage(
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  final FileStorage _legacy;
  final FlutterSecureStorage _store;
  String _ns = '';

  String _key(String key) => 'cookies.$_ns.$key';

  @override
  Future<void> init(bool persistSession, bool ignoreExpires) async {
    _ns = 'ie${ignoreExpires ? 1 : 0}_ps${persistSession ? 1 : 0}';
    await _legacy.init(persistSession, ignoreExpires);
  }

  @override
  Future<String?> read(String key) async {
    try {
      final value = await _store.read(key: _key(key));
      if (value != null) return value;
      final old = await _legacy.read(key);
      if (old != null) {
        await _store.write(key: _key(key), value: old);
        await _legacy.delete(key);
      }
      return old;
    } catch (_) {
      return _legacy.read(key);
    }
  }

  @override
  Future<void> write(String key, String value) async {
    try {
      await _store.write(key: _key(key), value: value);
      await _legacy.delete(key);
    } catch (_) {
      await _legacy.write(key, value);
    }
  }

  @override
  Future<void> delete(String key) async {
    try {
      await _store.delete(key: _key(key));
    } catch (_) {
      // Removed from the plain files below either way.
    }
    await _legacy.delete(key);
  }

  @override
  Future<void> deleteAll(List<String> keys) async {
    for (final k in keys) {
      await delete(k);
    }
    await _legacy.deleteAll(keys);
  }
}

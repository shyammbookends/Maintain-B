import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'format.dart';
import 'i18n.dart';
import 'push.dart';

/// Default API address: the PC running `npm run dev` on the same Wi-Fi.
/// Change it on the sign-in screen (e.g. to the Vercel URL).
/// Build with `--dart-define=API_SERVER=https://your-site.vercel.app` for the hosted site.
const kDefaultServer = String.fromEnvironment('API_SERVER', defaultValue: 'http://172.16.35.54:4000');

/// Set for the hosted (internet) build: the app always talks to this server and
/// hides the server picker, so it works anywhere — restaurant Wi-Fi or mobile data.
const kHostedServer = String.fromEnvironment('API_SERVER');

/// Signed-in user and what they may do (mirrors the web AuthContext).
class Session extends ChangeNotifier {
  Session(this.api) {
    api.onSessionExpired = () {
      _user = null;
      notifyListeners();
    };
  }

  final ApiClient api;
  Json? _user;
  bool restoring = true;

  Json? get user => _user;
  bool get signedIn => _user != null;
  String get firstName => (_user?['firstName'] ?? '').toString();
  String get fullName => '${_user?['firstName'] ?? ''} ${_user?['lastName'] ?? ''}'.trim();
  String get roleName {
    final roles = (_user?['roles'] as List?) ?? const [];
    return roles.isEmpty ? '' : (roles.first as Map)['name'].toString();
  }

  bool get isSuperAdmin => _user?['isSuperAdmin'] == true;

  /// Admin shell for admin-kind roles; the worker app for everyone else.
  bool get isAdmin => _user?['roleKind'] == 'ADMIN';

  Set<String> get _perms => {for (final p in (_user?['permissions'] as List? ?? const [])) p.toString()};
  bool can(String permission) => isSuperAdmin || _perms.contains(permission);

  List<Json> get restaurants =>
      [for (final r in (_user?['restaurants'] as List? ?? const [])) (r as Map).cast<String, dynamic>()];

  /// Reads the organisation's status display switch; the last known value is kept for offline use.
  /// Runs unawaited, so it must never throw (a failure here would be an uncaught
  /// async error): phone storage being unavailable only skips the cached copy.
  Future<void> _loadWorkflow() async {
    SharedPreferences? prefs;
    try {
      prefs = await SharedPreferences.getInstance();
    } catch (_) {}
    try {
      final w = await api.getData<Json>('/settings/workflow');
      simpleStatuses = w['simpleStatuses'] != false;
      notifyListeners();
      await prefs?.setBool('simpleStatuses', simpleStatuses);
    } catch (_) {
      try {
        simpleStatuses = prefs?.getBool('simpleStatuses') ?? true;
      } catch (_) {}
    }
  }

  /// Shows the app in the signed-in user's language (saved on the account, as on the web).
  Future<void> _applyLocale() async {
    final l = _user?['preferredLocale'];
    if (isLocale(l) && l != appLocale.value) await setAppLocale(l as String);
  }

  /// Saves the language to the account (the web uses the same call). False when it
  /// could not be saved (e.g. offline); the language still applies on this phone.
  Future<bool> savePreferredLocale(String code) async {
    if (_user == null) return false;
    try {
      await api.patch('/auth/me/preferences', {'preferredLocale': code});
      _user = {..._user!, 'preferredLocale': code};
      notifyListeners();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    api.server = kHostedServer.isNotEmpty ? kHostedServer : (prefs.getString('server') ?? kDefaultServer);
    simpleStatuses = prefs.getBool('simpleStatuses') ?? true;
    // Started at once; screens that load meanwhile wait for this one refresh.
    final refreshing = api.refresh();
    final saved = api.offline?.savedUser;
    if (saved != null) {
      // Instant start: open with the last signed-in user and the saved screens,
      // and confirm the session with the server in the background.
      _user = saved;
      await _applyLocale();
      restoring = false;
      notifyListeners();
      unawaited(_confirm(refreshing));
      return;
    }
    try {
      // Don't hold the splash screen when the server is unreachable: show sign-in quickly.
      final s = await refreshing.timeout(const Duration(seconds: 5));
      _user = s?['user'] as Json?;
      if (_user != null) {
        await api.offline?.adoptUser(_user!);
        unawaited(_loadWorkflow());
      }
    } catch (_) {
      _user = null;
    }
    await _applyLocale();
    restoring = false;
    notifyListeners();
  }

  /// Background check after an instant start: fresh user details, or sign-in
  /// again when the session ended elsewhere. Offline, the saved user stays.
  Future<void> _confirm(Future<Json?> refreshing) async {
    try {
      final s = await refreshing;
      if (s == null) {
        _user = null;
        notifyListeners();
        return;
      }
      _user = s['user'] as Json;
      await api.offline?.adoptUser(_user!);
      await _applyLocale();
      notifyListeners();
      unawaited(_loadWorkflow());
    } catch (_) {
      // No server right now: keep working with the saved user and screens.
    }
  }

  Future<void> setServer(String url) async {
    api.server = url;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server', api.server);
    notifyListeners();
  }

  Future<void> login(String identifier, String password) async {
    final s = await api.login(identifier.trim(), password);
    _user = s['user'] as Json;
    // Another person's saved data and unsent changes are removed here.
    await api.offline?.adoptUser(_user!);
    await _applyLocale();
    unawaited(_loadWorkflow());
    notifyListeners();
  }

  /// Re-reads the user (e.g. after adding a restaurant, so it shows in every picker).
  Future<void> reloadUser() async {
    try {
      final s = await api.refresh();
      if (s != null) {
        _user = s['user'] as Json;
        await api.offline?.adoptUser(_user!);
        notifyListeners();
      }
    } catch (_) {
      // Keep the current user; the next sign-in picks the change up.
    }
  }

  void adopt(Json session) {
    api.accessToken = session['accessToken'] as String?;
    _user = session['user'] as Json;
    api.offline?.adoptUser(_user!);
    unawaited(_applyLocale());
    unawaited(_loadWorkflow());
    notifyListeners();
  }

  Future<void> logout() async {
    // Stop phone alerts for this account (needs the token, so before signing out).
    try {
      await disablePush(api);
    } catch (_) {}
    await api.logout();
    await api.offline?.clearAll();
    _user = null;
    notifyListeners();
  }
}

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart' hide NotificationVisibility;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'i18n.dart';
import 'transport_policy.dart';

/*
 * Phone notifications like a chat app: sound, pop-up banner, badge on the app
 * icon — within about a second. There is no Firebase/APNs: the phone keeps a
 * long-poll open on the server's /push-feed (the server answers the moment a
 * notification is created or read) and shows a system notification.
 *  - Android: a small foreground service ("Task alerts are on") keeps that
 *    connection while the app is closed.
 *  - Both: while the app is open, the app keeps its own connection so the bell
 *    and chat badges update live (and alerts still show if the service was killed).
 *  - iPhone: iOS doesn't allow background services, so alerts arrive while the
 *    app is open or recently used; fully closed needs APNs.
 */

AndroidNotificationChannel get _alertsChannel => AndroidNotificationChannel(
  'task_alerts',
  t('Task alerts'),
  description: t('New tasks, assignments, overdue work and messages'),
  importance: Importance.max,
  playSound: true,
  enableVibration: true,
  showBadge: true,
);

const _kServer = 'push_server';
const _kKey = 'push_key';
const _kUser = 'push_user';
const _kAfter = 'push_after';
const _kUnread = 'push_unread';
const _kShown = 'push_shown';
const _kAskedBattery = 'push_asked_battery';

/// Long-poll length (the server holds the request up to this long).
const _waitSeconds = 25;

final _plugin = FlutterLocalNotificationsPlugin();

bool get _android => Platform.isAndroid;
bool get _ios => Platform.isIOS;
bool get _supported => _android || _ios;

/// Unread notifications, updated live (bell badge).
final liveUnread = ValueNotifier<int?>(null);

/// Bumps whenever something new arrives (lists and the chat badge refresh on it).
final liveTick = ValueNotifier<int>(0);

/// Opened when a notification is tapped (set by the app): its link and notification id.
void Function(String url, String? id)? onNotificationTap;

/// A tap that launched the app, handled once the user is signed in.
String? pendingNotificationUrl;
String? pendingNotificationId;

(String?, String?) _decode(String? payload) {
  if (payload == null || payload.isEmpty) return (null, null);
  try {
    final m = jsonDecode(payload) as Map;
    return (m['url'] as String?, m['id'] as String?);
  } catch (_) {
    return (payload, null); // older alerts carried only the link
  }
}

Future<void> _initPlugin({bool main = false}) async {
  await _plugin.initialize(
    settings: const InitializationSettings(
      android: AndroidInitializationSettings('ic_stat_notify'),
      // Permission is asked after sign-in (enablePush), not at launch.
      iOS: DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      ),
    ),
    onDidReceiveNotificationResponse: main
        ? (r) {
            final (url, id) = _decode(r.payload);
            if (url != null && url.isNotEmpty) onNotificationTap?.call(url, id);
          }
        : null,
  );
  await _plugin
      .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      ?.createNotificationChannel(_alertsChannel);
}

/// Set at app start to the running [initPush]; sign-in waits for it before
/// enabling alerts or opening the screen of a notification that launched the app.
Future<void> pushReady = Future.value();

/// Call once at app start (main isolate).
Future<void> initPush() async {
  if (!_supported) return;
  if (_android) FlutterForegroundTask.initCommunicationPort();
  await _initPlugin(main: true);
  final launch = await _plugin.getNotificationAppLaunchDetails();
  if (launch?.didNotificationLaunchApp == true) {
    final (url, id) = _decode(launch!.notificationResponse?.payload);
    pendingNotificationUrl = url;
    pendingNotificationId = id;
  }
  if (!_android) return;
  FlutterForegroundTask.init(
    androidNotificationOptions: AndroidNotificationOptions(
      channelId: 'alerts_service',
      channelName: t('Alerts service'),
      channelDescription: t('Keeps task alerts arriving while the app is closed'),
      channelImportance: NotificationChannelImportance.MIN,
      priority: NotificationPriority.MIN,
      onlyAlertOnce: true,
      showWhen: false,
    ),
    iosNotificationOptions: const IOSNotificationOptions(showNotification: false, playSound: false),
    foregroundTaskOptions: ForegroundTaskOptions(
      // Watchdog: restarts the live connection if it ever stops.
      eventAction: ForegroundTaskEventAction.repeat(60000),
      autoRunOnBoot: true,
      autoRunOnMyPackageReplaced: true,
      allowWakeLock: true,
      allowWifiLock: true,
    ),
  );
}

/// Shows the system "Allow / Don't allow" prompt (first time only).
Future<bool> _askPermission() async {
  if (_android) {
    final a = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    return await a?.requestNotificationsPermission() ?? await a?.areNotificationsEnabled() ?? false;
  }
  final i = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
  return await i?.requestPermissions(alert: true, badge: true, sound: true) ?? false;
}

/// After sign-in: register this phone (live badges work even without permission),
/// ask for permission, and start the live connection / alerts service.
/// Returns false when the phone's notifications are off.
Future<bool> enablePush(ApiClient api, String userId) async {
  if (!_supported) return false;
  final prefs = await SharedPreferences.getInstance();
  if (prefs.getString(_kUser) != userId || prefs.getString(_kKey) == null || prefs.getString(_kServer) != api.server) {
    final old = prefs.getString(_kKey);
    if (old != null && prefs.getString(_kUser) == userId) {
      unawaited(api.delete('/push-devices/${old.split('.').first}').catchError((_) => null));
    }
    final d = await api.postData<Json>('/push-devices');
    await prefs.setString(_kKey, d['key'] as String);
    await prefs.setString(_kUser, userId);
    await prefs.setString(_kServer, api.server);
    await prefs.setString(_kAfter, DateTime.now().toUtc().toIso8601String());
    await prefs.remove(_kShown);
  }
  _startLive();

  final allowed = await _askPermission();
  if (!allowed || !_android) return allowed;

  // Lets alerts keep coming in the background (system dialog, asked once).
  if (prefs.getBool(_kAskedBattery) != true) {
    await prefs.setBool(_kAskedBattery, true);
    if (!await FlutterForegroundTask.isIgnoringBatteryOptimizations) {
      await FlutterForegroundTask.requestIgnoreBatteryOptimization();
    }
  }
  if (await FlutterForegroundTask.isRunningService) {
    await FlutterForegroundTask.restartService();
  } else {
    await FlutterForegroundTask.startService(
      serviceId: 410,
      serviceTypes: [ForegroundServiceTypes.remoteMessaging],
      notificationTitle: 'Bookends Maintenance',
      notificationText: t('Task alerts are on'),
      notificationIcon: const NotificationIcon(metaDataName: 'in.bookends.notification_icon'),
      callback: startAlertsService,
    );
  }
  return true;
}

// ---------------------------------------------------------------- live connection (app open)

_Live? _live;

void _startLive() {
  _live ??= _Live()..start();
}

/// Keeps one long-poll open while the app is in the foreground.
class _Live with WidgetsBindingObserver {
  bool _running = false;
  bool _foreground = true;
  int _generation = 0;

  void start() {
    WidgetsBinding.instance.addObserver(this);
    _loop();
  }

  void stop() {
    _generation++;
    WidgetsBinding.instance.removeObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground && !_running) _loop();
  }

  Future<void> _loop() async {
    final gen = _generation;
    _running = true;
    try {
      while (_foreground && gen == _generation) {
        // On Android the service shows the alerts; the app only shows them if the
        // service isn't running (the phone may have stopped it).
        final serviceOn = _android && await FlutterForegroundTask.isRunningService;
        final r = await _poll(show: !serviceOn, wait: _waitSeconds);
        if (r < 0) await Future<void>.delayed(const Duration(seconds: 5)); // offline: retry
      }
    } finally {
      _running = false;
    }
  }
}

// ---------------------------------------------------------------- sign-out, settings

/// On sign-out: stop alerts and forget this phone.
Future<void> disablePush(ApiClient api) async {
  if (!_supported) return;
  _live?.stop();
  _live = null;
  if (_android) {
    try {
      await FlutterForegroundTask.stopService();
    } catch (_) {}
  }
  final prefs = await SharedPreferences.getInstance();
  final key = prefs.getString(_kKey);
  if (key != null) {
    try {
      await api.delete('/push-devices/${key.split('.').first}');
    } catch (_) {}
  }
  for (final k in [_kKey, _kUser, _kAfter, _kUnread, _kShown]) {
    await prefs.remove(k);
  }
  liveUnread.value = null;
  await _plugin.cancelAll();
}

/// Whether the phone allows this app's notifications.
Future<bool> alertsAllowed() async {
  if (_android) {
    return await _plugin
            .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
            ?.areNotificationsEnabled() ??
        false;
  }
  if (_ios) {
    final p = await _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()?.checkPermissions();
    return p?.isEnabled ?? false;
  }
  return false;
}

/// Shows a sample alert so people can hear the sound and see the pop-up.
Future<void> showTestAlert() => _show({
      'id': 'test-${DateTime.now().millisecondsSinceEpoch}',
      'title': t('Test alert'),
      'body': t('Task alerts are working on this phone.'),
      'priority': 'HIGH',
      'actionUrl': '',
    }, 1);

/// Everything has been seen: clear the alerts in the notification bar and the badge.
Future<void> clearAlerts() async {
  liveUnread.value = 0;
  if (!_supported) return;
  await _plugin.cancelAll();
  final prefs = await SharedPreferences.getInstance();
  await prefs.setInt(_kUnread, 0);
}

/// One alert was opened in the app.
Future<void> clearAlert(String notificationId) async {
  if (_supported) await _plugin.cancel(id: notificationId.hashCode & 0x7fffffff);
}

// ---------------------------------------------------------------- background service (Android)

@pragma('vm:entry-point')
void startAlertsService() {
  FlutterForegroundTask.setTaskHandler(_AlertsTask());
}

class _AlertsTask extends TaskHandler {
  bool _looping = false;
  bool _stopped = false;

  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    // This runs apart from the app: use the language last chosen on the phone.
    await loadSavedLocale();
    await _initPlugin();
    _loop();
  }

  void _loop() async {
    if (_looping) return;
    _looping = true;
    try {
      while (!_stopped) {
        final r = await _poll(show: true, wait: _waitSeconds);
        if (r < 0) await Future<void>.delayed(const Duration(seconds: 5));
      }
    } finally {
      _looping = false;
    }
  }

  @override
  void onRepeatEvent(DateTime timestamp) => _loop(); // watchdog

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async => _stopped = true;

  @override
  void onNotificationPressed() => FlutterForegroundTask.launchApp();
}

// ---------------------------------------------------------------- one long-poll

/// Waits (up to [wait] s) for something new; shows alerts when [show].
/// Returns the number of new items, or -1 when the server can't be reached.
Future<int> _poll({required bool show, int wait = 0}) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.reload(); // shared with the other isolate
  final server = prefs.getString(_kServer);
  final key = prefs.getString(_kKey);
  if (server == null || key == null || serverUrlProblem(server) != null) {
    await Future<void>.delayed(const Duration(seconds: 3));
    return 0;
  }
  final after = prefs.getString(_kAfter) ?? DateTime.now().toUtc().toIso8601String();
  final known = prefs.getInt(_kUnread);

  final client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 8)
    ..idleTimeout = Duration(seconds: wait + 15);
  try {
    final uri = Uri.parse('$server/api/v1/push-feed').replace(queryParameters: {
      'after': after,
      'wait': '$wait',
      'unread': ?known?.toString(),
    });
    final req = await client.getUrl(uri);
    req.headers.set('x-device-key', key);
    req.headers.set('accept', 'application/json');
    final res = await req.close().timeout(Duration(seconds: wait + 15));
    final text = await res.transform(utf8.decoder).join();
    if (res.statusCode == 401) {
      // Signed out elsewhere or the device was removed: stop.
      await prefs.remove(_kKey);
      if (_android) await FlutterForegroundTask.stopService();
      return 0;
    }
    if (res.statusCode != 200) return -1;
    final data = (jsonDecode(text) as Map)['data'] as Map;
    final items = (data['items'] as List).cast<Map>();
    final unread = (data['unread'] as num?)?.toInt() ?? 0;

    await prefs.reload();
    final shown = prefs.getStringList(_kShown) ?? const [];
    final fresh = [for (final n in items) if (!shown.contains(n['id'])) n];
    if (show) {
      for (final n in fresh) {
        await _show(n, unread);
      }
    }
    if (items.isNotEmpty) {
      await prefs.setString(_kAfter, items.last['createdAt'] as String);
      if (show) {
        final next = [...shown, for (final n in fresh) n['id'] as String];
        await prefs.setStringList(_kShown, next.length > 60 ? next.sublist(next.length - 60) : next);
      }
    }
    await prefs.setInt(_kUnread, unread);
    if (liveUnread.value != unread) liveUnread.value = unread;
    if (items.isNotEmpty) liveTick.value++;
    return items.length;
  } catch (_) {
    return -1;
  } finally {
    client.close(force: true);
  }
}

Future<void> _show(Map n, int unread) async {
  final critical = n['priority'] == 'CRITICAL' || n['priority'] == 'HIGH';
  final body = (n['body'] ?? '').toString();
  await _plugin.show(
    id: (n['id'] as String).hashCode & 0x7fffffff,
    title: n['title']?.toString(),
    body: body,
    payload: jsonEncode({'url': n['actionUrl']?.toString() ?? '', 'id': n['id']}),
    notificationDetails: NotificationDetails(
      android: AndroidNotificationDetails(
        _alertsChannel.id,
        _alertsChannel.name,
        channelDescription: _alertsChannel.description,
        importance: Importance.max,
        priority: Priority.high,
        icon: 'ic_stat_notify',
        color: const Color(0xFF4F46E5),
        ticker: n['title']?.toString(),
        category: critical ? AndroidNotificationCategory.alarm : AndroidNotificationCategory.message,
        number: unread,
        onlyAlertOnce: true,
        styleInformation: BigTextStyleInformation(body),
        visibility: NotificationVisibility.public,
        groupKey: 'bookends_alerts',
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBanner: true,
        presentList: true,
        presentSound: true,
        presentBadge: true,
        badgeNumber: unread,
        threadIdentifier: 'bookends_alerts',
        interruptionLevel: critical ? InterruptionLevel.timeSensitive : InterruptionLevel.active,
      ),
    ),
  );
}

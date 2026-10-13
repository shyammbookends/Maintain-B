import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';

import 'i18n.dart';

/*
 * Offline support for technicians on the floor (same rules as the web app's
 * services/offline.ts):
 *
 *  - Reads: successful GETs of the screens a technician uses are kept as JSON
 *    files on the phone; when the network is gone the last copy is shown.
 *  - Writes: a field action that can't reach the server is queued on disk with
 *    its Idempotency-Key and replayed, in order, when the connection returns.
 *    The server applies each key once, so a retry never duplicates a photo,
 *    a part or a start.
 *  - Anything the server refuses on replay (e.g. the job was reassigned) goes
 *    to a "could not be saved" list for the user to see and discard.
 *  - Queued actions are shown straight away on the saved copies (optimistic).
 */

typedef JsonMap = Map<String, dynamic>;

/// Writes the queue accepts (technician field actions, same list as the web).
final _queueable = <(String, RegExp)>[
  ('POST', RegExp(r'^/work-orders/[^/]+/(start|hold|resume|complete|messages|parts|time)$')),
  ('POST', RegExp(r'^/work-orders/[^/]+/attachments$')),
  ('POST', RegExp(r'^/work-orders/[^/]+/checklist/[^/]+/attachments$')),
  ('PUT', RegExp(r'^/work-orders/[^/]+/checklist/[^/]+$')),
  ('POST', RegExp(r'^/assets/[^/]+/meters/[^/]+/readings$')),
  ('PUT', RegExp(r'^/inspections/[^/]+/items/[^/]+$')),
  ('POST', RegExp(r'^/inspections/[^/]+/items/[^/]+/attachments$')),
  ('POST', RegExp(r'^/inspections/[^/]+/submit$')),
  ('POST', RegExp(r'^/requests$')),
  // Photos of a problem report sent after the report itself.
  ('POST', RegExp(r'^/requests/[^/]+/attachments$')),
  // Team chat voice messages recorded without a network.
  ('POST', RegExp(r'^/chats/[^/]+/voice$')),
];

/// Reads kept for offline viewing.
final _cacheable = <RegExp>[
  RegExp(r'^/me(/|$)'),
  // Manager home screens, so the admin app also opens instantly.
  RegExp(r'^/dashboard$'),
  RegExp(r'^/work-orders$'),
  RegExp(r'^/work-orders/[^/]+$'),
  RegExp(r'^/assets/by-public/'),
  RegExp(r'^/assets/[^/]+(/meters)?$'),
  RegExp(r'^/assets$'),
  RegExp(r'^/parts/by-public/'),
  // The part picker on a job (so parts can be recorded without a network).
  RegExp(r'^/parts$'),
  RegExp(r'^/locations/by-public/'),
  RegExp(r'^/locations$'),
  RegExp(r'^/inspections/[^/]+$'),
  RegExp(r'^/procedures/[^/]+$'),
  RegExp(r'^/notifications(/unread-count)?$'),
  RegExp(r'^/restaurants$'),
  RegExp(r'^/requests(/[^/]+)?$'),
];

bool isQueueable(String method, String path) => _queueable.any((q) => q.$1 == method && q.$2.hasMatch(path));
bool isCacheable(String path) => _cacheable.any((re) => re.hasMatch(path));

/// Cache key of a GET: the path plus its query, sorted so the order doesn't matter.
String cacheKeyFor(String path, Map<String, dynamic>? query) {
  if (query == null || query.isEmpty) return path;
  final keys = query.keys.toList()..sort();
  return '$path?${keys.map((k) => '$k=${query[k]}').join('&')}';
}

/// Shown when a change is kept on the phone instead of being sent now.
const kQueuedCode = 'QUEUED_OFFLINE';
String get kQueuedMessage => t('Saved on this phone. It will be sent automatically when online.');

/// Kept for a change the server refused without giving a reason.
String get _refusedMessage => t('Refused');

/// One write waiting to be sent.
class QueuedWrite {
  QueuedWrite({
    required this.id,
    required this.method,
    required this.path,
    this.json,
    this.fields = const {},
    this.files = const [],
    this.fileField = 'files',
    this.then,
    int? createdAt,
    this.ref = '',
    this.meta,
  }) : createdAt = createdAt ?? DateTime.now().millisecondsSinceEpoch;

  /// Also the Idempotency-Key.
  final String id;
  final String method;
  final String path;
  final Object? json;

  /// Multipart form fields and files (copies kept in the offline folder).
  final Map<String, String> fields;
  final List<String> files;
  final String fileField;

  /// Sent once this one succeeds; `{id}` in its path becomes the new record's id
  /// (a problem report's photos after the report).
  final QueuedWrite? then;
  final int createdAt;

  /// What it belongs to, for the list (e.g. the work order code).
  final String ref;

  /// Kept on the phone only (never sent): what the screen needs to show the change
  /// before it is sent, e.g. the part's name for a part used.
  final Map<String, dynamic>? meta;

  bool get multipart => files.isNotEmpty;

  QueuedWrite withPathId(String newId) => QueuedWrite(
    id: id,
    method: method,
    path: path.replaceAll('{id}', newId),
    json: json,
    fields: fields,
    files: files,
    fileField: fileField,
    then: then,
    createdAt: createdAt,
    ref: ref,
    meta: meta,
  );

  JsonMap toJson() => {
    'id': id,
    'method': method,
    'path': path,
    if (json != null) 'json': json,
    if (fields.isNotEmpty) 'fields': fields,
    if (files.isNotEmpty) 'files': files,
    'fileField': fileField,
    if (then != null) 'then': then!.toJson(),
    'createdAt': createdAt,
    'ref': ref,
    if (meta != null) 'meta': meta,
  };

  factory QueuedWrite.fromJson(Map j) => QueuedWrite(
    id: j['id'].toString(),
    method: j['method'].toString(),
    path: j['path'].toString(),
    json: j['json'],
    fields: {for (final e in ((j['fields'] as Map?) ?? const {}).entries) e.key.toString(): e.value.toString()},
    files: [for (final f in (j['files'] as List?) ?? const []) f.toString()],
    fileField: (j['fileField'] ?? 'files').toString(),
    then: j['then'] is Map ? QueuedWrite.fromJson(j['then'] as Map) : null,
    createdAt: (j['createdAt'] as num?)?.toInt(),
    ref: (j['ref'] ?? '').toString(),
    meta: (j['meta'] as Map?)?.cast<String, dynamic>(),
  );

  /// Every file this write (and its follow-up) still needs.
  Iterable<String> get allFiles sync* {
    yield* files;
    if (then != null) yield* then!.allFiles;
  }
}

/// A write the server refused on replay, with its reason.
class FailedWrite {
  FailedWrite(this.write, this.error, [int? failedAt]) : failedAt = failedAt ?? DateTime.now().millisecondsSinceEpoch;
  final QueuedWrite write;
  final String error;
  final int failedAt;

  JsonMap toJson() => {'write': write.toJson(), 'error': error, 'failedAt': failedAt};
  factory FailedWrite.fromJson(Map j) =>
      FailedWrite(QueuedWrite.fromJson(j['write'] as Map), j['error'].toString(), (j['failedAt'] as num?)?.toInt());
}

enum SendOutcome { ok, offline, retry, refused }

/// What happened when a queued write was sent.
class SendResult {
  const SendResult._(this.outcome, [this.error, this.next]);
  static const ok = SendResult._(SendOutcome.ok);
  static const offline = SendResult._(SendOutcome.offline);

  /// Sent, and [next] (its follow-up, already resolved) goes right after it.
  factory SendResult.okThen(QueuedWrite next) => SendResult._(SendOutcome.ok, null, next);

  /// Try again later; [error] is set when the server answered (counts toward giving up).
  factory SendResult.retry([String? error]) => SendResult._(SendOutcome.retry, error);
  factory SendResult.refused(String error) => SendResult._(SendOutcome.refused, error);

  final SendOutcome outcome;
  final String? error;
  final QueuedWrite? next;
}

typedef Sender = Future<SendResult> Function(QueuedWrite w);

/// The offline store and sync engine: saved screens, the queue, the failed list.
class OfflineSync extends ChangeNotifier {
  OfflineSync(this.root, {this.autoRetry = true});

  /// The real one lives in the app's support folder.
  static Future<OfflineSync> open() async {
    final dir = await getApplicationSupportDirectory();
    final s = OfflineSync(Directory('${dir.path}${Platform.pathSeparator}offline'));
    await s.load();
    return s;
  }

  final Directory root;

  /// Retries on a timer after a failed sync (off in tests).
  final bool autoRetry;

  /// How a queued write is sent (installed by the API client).
  Sender? sender;

  List<QueuedWrite> _queue = [];
  List<FailedWrite> _failed = [];
  JsonMap? _user;
  String? _owner;

  /// False after a request couldn't reach the server, true after one did.
  bool online = true;

  /// A screen is showing its saved copy (shown as a banner).
  bool showingSaved = false;
  bool syncing = false;

  /// Bumps after a sync or when the connection returns, so screens refetch.
  final revision = ValueNotifier<int>(0);

  List<QueuedWrite> get queue => List.unmodifiable(_queue);
  List<FailedWrite> get failed => List.unmodifiable(_failed);
  int get pending => _queue.length;

  /// Last signed-in user (opens the app without a network).
  JsonMap? get savedUser => _user;

  File _file(String name) => File('${root.path}${Platform.pathSeparator}$name');
  Directory get _cacheDir => Directory('${root.path}${Platform.pathSeparator}cache');
  Directory get _filesDir => Directory('${root.path}${Platform.pathSeparator}files');

  // ------------------------------------------------------------------ disk

  Future<void> load() async {
    await root.create(recursive: true);
    final q = await _readJson('queue.json');
    final f = await _readJson('failed.json');
    final u = await _readJson('user.json');
    _queue = [
      for (final j in (q as List?) ?? const [])
        if (j is Map) QueuedWrite.fromJson(j),
    ]..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    _failed = [
      for (final j in (f as List?) ?? const [])
        if (j is Map) FailedWrite.fromJson(j),
    ];
    if (u is Map) {
      _owner = u['owner']?.toString();
      _user = (u['user'] as Map?)?.cast<String, dynamic>();
    }
    notifyListeners();
  }

  Future<dynamic> _readJson(String name) async {
    try {
      final f = _file(name);
      if (!await f.exists()) return null;
      return jsonDecode(await f.readAsString());
    } catch (_) {
      return null; // a damaged file is treated as empty
    }
  }

  Future<void> _lock = Future.value();

  /// Writes go through one chain so two saves never interleave.
  Future<void> _writeJson(String name, Object? data) {
    final next = _lock.then((_) async {
      await root.create(recursive: true);
      final tmp = _file('$name.tmp');
      await tmp.writeAsString(jsonEncode(data), flush: true);
      await tmp.rename(_file(name).path);
    });
    _lock = next.catchError((_) {});
    return next;
  }

  Future<void> _saveQueue() => _writeJson('queue.json', [for (final w in _queue) w.toJson()]);
  Future<void> _saveFailed() => _writeJson('failed.json', [for (final w in _failed) w.toJson()]);

  // ------------------------------------------------------------------ user

  /// Remembers the signed-in user. Another user's saved data and queue are removed first.
  Future<void> adoptUser(JsonMap user) async {
    final id = user['id']?.toString();
    if (_owner != null && _owner != id) await clearAll();
    _owner = id;
    _user = user;
    await _writeJson('user.json', {'owner': id, 'user': user});
  }

  /// Removes everything stored for the signed-in user (sign out).
  Future<void> clearAll() async {
    _queue = [];
    _failed = [];
    _user = null;
    _owner = null;
    showingSaved = false;
    await _lock;
    for (final name in ['queue.json', 'failed.json', 'user.json']) {
      try {
        await _file(name).delete();
      } catch (_) {}
    }
    for (final d in [_cacheDir, _filesDir]) {
      try {
        await d.delete(recursive: true);
      } catch (_) {}
    }
    notifyListeners();
  }

  // ------------------------------------------------------------------ reads

  static const maxCache = 300;
  int _writesSincePrune = 0;

  /// FNV-1a: a short, stable file name for a cache key.
  static String _hash(String s) {
    var h = 0xcbf29ce484222325;
    for (final c in utf8.encode(s)) {
      h ^= c;
      h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF;
    }
    return h.toUnsigned(64).toRadixString(16);
  }

  File _cacheFile(String key) => File('${_cacheDir.path}${Platform.pathSeparator}${_hash(key)}.json');

  Future<void> cacheWrite(String key, dynamic body) async {
    try {
      await _cacheDir.create(recursive: true);
      await _cacheFile(key).writeAsString(jsonEncode({'key': key, 'body': body}));
      if (++_writesSincePrune >= 25) {
        _writesSincePrune = 0;
        await _prune();
      }
    } catch (_) {
      // caching is best effort
    }
  }

  Future<dynamic> cacheRead(String key) async {
    try {
      final f = _cacheFile(key);
      if (!await f.exists()) return null;
      final j = jsonDecode(await f.readAsString()) as Map;
      return j['key'] == key ? j['body'] : null;
    } catch (_) {
      return null;
    }
  }

  /// Keeps the cache small: drops the oldest saved screens.
  Future<void> _prune() async {
    final files = await _cacheDir.list().where((e) => e is File).cast<File>().toList();
    if (files.length <= maxCache) return;
    final dated = [for (final f in files) (f, (await f.stat()).modified)]..sort((a, b) => a.$2.compareTo(b.$2));
    for (final (f, _) in dated.take(files.length - maxCache)) {
      try {
        await f.delete();
      } catch (_) {}
    }
  }

  void servedFromCache() {
    if (showingSaved && !online) return;
    showingSaved = true;
    online = false;
    notifyListeners();
  }

  void markOffline() {
    if (!online) return;
    online = false;
    notifyListeners();
  }

  /// A request reached the server: hide the banner, send what waits, refresh screens.
  void markOnline() {
    if (online && !showingSaved) return;
    final wasShowingSaved = showingSaved;
    online = true;
    showingSaved = false;
    notifyListeners();
    if (_queue.isNotEmpty) unawaited(flush());
    if (wasShowingSaved) _bumpRevision();
  }

  // ------------------------------------------------------------------ writes

  /// Copies files into the offline folder (picked photos live in a temp folder).
  Future<List<String>> keepFiles(String key, List<String> paths) async {
    await _filesDir.create(recursive: true);
    final kept = <String>[];
    for (var i = 0; i < paths.length; i++) {
      final src = File(paths[i]);
      final name = src.uri.pathSegments.isEmpty ? 'file' : src.uri.pathSegments.last;
      final dest = '${_filesDir.path}${Platform.pathSeparator}${key}_${i}_$name';
      if (src.path != dest) await src.copy(dest);
      kept.add(dest);
    }
    return kept;
  }

  Future<void> enqueue(QueuedWrite w) async {
    _queue.add(w);
    await _saveQueue();
    notifyListeners();
  }

  Future<void> _deleteFiles(Iterable<String> paths) async {
    for (final p in paths) {
      if (!p.startsWith(_filesDir.path)) continue; // only our own copies
      try {
        await File(p).delete();
      } catch (_) {}
    }
  }

  /// Drops one refused write (or all of them).
  Future<void> dismissFailed([String? id]) async {
    final gone = _failed.where((f) => id == null || f.write.id == id).toList();
    _failed.removeWhere((f) => id == null || f.write.id == id);
    await _saveFailed();
    await _deleteFiles(gone.expand((f) => f.write.allFiles));
    notifyListeners();
  }

  // ------------------------------------------------------------------ sync

  Future<void>? _flushing;
  Timer? _retryTimer;
  int _attempt = 0;

  /// Server errors in a row for the first write; after this many it is given up on.
  static const maxServerRetries = 6;
  int _serverRetries = 0;

  /// Replays the queue in order. Stops at the first network failure and tries again later.
  Future<void> flush() {
    if (sender == null || _queue.isEmpty) return _flushing ?? Future.value();
    return _flushing ??= _doFlush().whenComplete(() => _flushing = null);
  }

  Future<void> _doFlush() async {
    _retryTimer?.cancel();
    syncing = true;
    notifyListeners();
    var sent = 0;
    var stopped = false;
    try {
      while (_queue.isNotEmpty) {
        final w = _queue.first;
        SendResult r;
        try {
          r = await sender!(w);
        } catch (e) {
          r = SendResult.retry();
        }
        if (r.outcome == SendOutcome.offline) {
          markOffline();
          stopped = true;
          break;
        }
        if (r.outcome == SendOutcome.retry) {
          if (r.error != null && ++_serverRetries >= maxServerRetries) {
            // The server keeps failing on this one; don't let it block the rest.
            r = SendResult.refused(r.error!);
          } else {
            stopped = true;
            break;
          }
        }
        _serverRetries = 0;
        _queue.removeAt(0);
        if (r.outcome == SendOutcome.refused) {
          _failed.add(FailedWrite(w, r.error ?? _refusedMessage));
          await _saveFailed();
        } else {
          final next = r.next;
          if (next != null) _queue.insert(0, next);
          final keep = next?.allFiles.toSet() ?? const <String>{};
          await _deleteFiles(w.allFiles.where((f) => !keep.contains(f)));
        }
        await _saveQueue();
        sent++;
        notifyListeners();
      }
    } finally {
      syncing = false;
      if (stopped) {
        _scheduleRetry();
      } else {
        _attempt = 0;
      }
      notifyListeners();
      if (sent > 0) _bumpRevision();
    }
  }

  void _scheduleRetry() {
    if (!autoRetry) return;
    _retryTimer?.cancel();
    // 5 s, 10 s, 20 s … up to 5 minutes.
    final seconds = min(300, 5 * pow(2, min(_attempt, 6)).toInt());
    _attempt++;
    _retryTimer = Timer(Duration(seconds: seconds), () => unawaited(flush()));
  }

  StreamSubscription<List<ConnectivityResult>>? _connectivity;
  AppLifecycleListener? _lifecycle;

  /// Watches the connection and the app coming back to the front; sends what waits.
  void start() {
    _connectivity ??= Connectivity().onConnectivityChanged.listen((r) {
      final connected = r.any((c) => c != ConnectivityResult.none);
      if (!connected) {
        markOffline();
        return;
      }
      _attempt = 0;
      unawaited(flush());
      // Screens showing saved data try the server again.
      if (showingSaved || !online) _bumpRevision();
    });
    _lifecycle ??= AppLifecycleListener(onResume: () {
      _attempt = 0;
      unawaited(flush());
      if (showingSaved) _bumpRevision();
    });
    if (_queue.isNotEmpty) unawaited(flush());
  }

  @override
  void dispose() {
    _disposed = true;
    _retryTimer?.cancel();
    _connectivity?.cancel();
    _lifecycle?.dispose();
    revision.dispose();
    super.dispose();
  }

  bool _disposed = false;

  /// A send that finishes after the store was closed must not notify any more.
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  void _bumpRevision() {
    if (!_disposed) revision.value++;
  }

  // ------------------------------------------------------------------ optimistic view

  /// The saved or fresh copy of a screen with the queued actions already applied.
  dynamic overlay(String path, dynamic body) => applyPending(path, body, _queue, _user);
}

// ---------------------------------------------------------------------- optimistic updates

final _woDetail = RegExp(r'^/work-orders/([^/]+)$');
final _inspectionDetail = RegExp(r'^/inspections/([^/]+)$');
final _woAction = RegExp(r'^/work-orders/([^/]+)/(start|hold|resume|complete)$');
final _assetMeters = RegExp(r'^/assets/([^/]+)/meters$');
final _meterReading = RegExp(r'^/assets/([^/]+)/meters/([^/]+)/readings$');

String _iso(int ms) => DateTime.fromMillisecondsSinceEpoch(ms).toUtc().toIso8601String();

/// Applies queued writes to a GET response (`{data: ...}`) so the screen shows
/// what the technician already did. Pure function (tested on its own).
dynamic applyPending(String path, dynamic body, List<QueuedWrite> queue, JsonMap? me) {
  if (queue.isEmpty || body is! Map || body['data'] == null) return body;
  final wo = _woDetail.firstMatch(path)?.group(1);
  final ins = _inspectionDetail.firstMatch(path)?.group(1);
  if (wo != null) {
    final mine = queue.where((w) => w.path.startsWith('/work-orders/$wo/')).toList();
    if (mine.isEmpty) return body;
    final copy = _clone(body);
    final data = copy['data'] as Map;
    for (final w in mine) {
      _applyToWorkOrder(data, w, me);
    }
    return copy;
  }
  if (ins != null) {
    final mine = queue.where((w) => w.path.startsWith('/inspections/$ins/')).toList();
    if (mine.isEmpty) return body;
    final copy = _clone(body);
    final data = copy['data'] as Map;
    for (final w in mine) {
      final rest = w.path.substring('/inspections/$ins/'.length).split('/');
      if (rest.length >= 2 && rest[0] == 'items') _applyToStep(data['items'], rest[1], w, me);
      if (rest.length == 1 && rest[0] == 'submit') data['status'] = 'COMPLETED';
    }
    return copy;
  }
  final meters = _assetMeters.firstMatch(path)?.group(1);
  if (meters != null && body['data'] is List) {
    final mine = [
      for (final w in queue)
        if (_meterReading.firstMatch(w.path)?.group(1) == meters) w,
    ];
    if (mine.isEmpty) return body;
    final copy = _clone(body);
    for (final w in mine) {
      _applyReading(copy['data'] as List, w, me);
    }
    return copy;
  }
  if (path.startsWith('/me/')) {
    // Task lists and the home screen: show the new status on each card.
    final status = <String, String>{};
    for (final w in queue) {
      final m = _woAction.firstMatch(w.path);
      if (m != null) status[m.group(1)!] = _statusAfter(m.group(2)!);
    }
    if (status.isEmpty) return body;
    final copy = _clone(body);
    void patch(dynamic list) {
      if (list is! List) return;
      for (final item in list) {
        if (item is Map && status.containsKey(item['id']?.toString())) item['status'] = status[item['id'].toString()];
      }
    }

    final data = copy['data'];
    patch(data);
    if (data is Map) {
      for (final v in data.values) {
        patch(v);
      }
    }
    return copy;
  }
  return body;
}

Map _clone(Map body) => jsonDecode(jsonEncode(body)) as Map;

String _statusAfter(String action) => switch (action) {
  'hold' => 'ON_HOLD',
  'complete' => 'COMPLETED',
  _ => 'IN_PROGRESS',
};

void _applyToWorkOrder(Map w, QueuedWrite q, JsonMap? me) {
  final id = w['id'];
  final rest = q.path.substring('/work-orders/$id/'.length).split('/');
  final body = q.json is Map ? q.json as Map : const {};
  final actions = (w['actions'] is Map) ? w['actions'] as Map : (w['actions'] = <String, dynamic>{});
  switch (rest.first) {
    case 'start' || 'resume':
      w['status'] = 'IN_PROGRESS';
      _set(actions, {'start': false, 'resume': false, 'complete': true, 'hold': true, 'checklist': true, 'upload': true});
    case 'hold':
      w['status'] = 'ON_HOLD';
      w['holdReason'] = body['reason'];
      _set(actions, {'start': false, 'resume': true, 'complete': false, 'hold': false, 'checklist': false});
    case 'complete':
      w['status'] = 'COMPLETED';
      _set(actions, {'start': false, 'resume': false, 'complete': false, 'hold': false, 'checklist': false, 'upload': false});
    case 'messages' when rest.length == 1:
      final list = (w['messages'] is List) ? w['messages'] as List : (w['messages'] = []);
      list.add({
        'id': 'local-${q.id}',
        'body': body['body'],
        'internal': body['internal'] == true,
        'author': me,
        'mine': true,
        'createdAt': _iso(q.createdAt),
        'attachments': const [],
      });
    case 'attachments':
      final list = (w['attachments'] is List) ? w['attachments'] as List : (w['attachments'] = []);
      for (final f in q.files) {
        list.add({'id': 'local-${q.id}-$f', 'kind': 'PHOTO', 'stage': q.fields['stage'], 'localPath': f});
      }
      final check = w['completionCheck'];
      if (check is Map) {
        if (q.fields['stage'] == 'BEFORE') check['needsBeforePhoto'] = false;
        if (q.fields['stage'] == 'AFTER') check['needsAfterPhoto'] = false;
      }
    case 'parts' when rest.length == 1:
      _applyPart(w, body, q);
    case 'time' when rest.length == 1:
      final minutes = (body['minutes'] as num?)?.toInt() ?? 0;
      final list = (w['timeEntries'] is List) ? w['timeEntries'] as List : (w['timeEntries'] = []);
      final started = DateTime.tryParse(body['startedAt']?.toString() ?? '');
      list.add({
        'id': 'local-${q.id}',
        'user': q.meta?['user'] ?? {'id': body['userId']},
        'startedAt': body['startedAt'],
        'endedAt': started?.add(Duration(minutes: minutes)).toUtc().toIso8601String(),
        'minutes': minutes,
        'manual': true,
        'note': body['note'],
        'pending': true,
      });
      w['minutesWorked'] = ((w['minutesWorked'] as num?) ?? 0) + minutes;
    case 'checklist' when rest.length >= 2:
      final before = _stepsLeft(w['checklist']);
      _applyToStep(w['checklist'], rest[1], q, me);
      final check = w['completionCheck'];
      if (check is Map && check['stepsLeft'] is num) {
        check['stepsLeft'] = max(0, (check['stepsLeft'] as num).toInt() - (before - _stepsLeft(w['checklist'])));
      }
  }
}

/// A part used: the server adds to the line of the same part, or starts a new line.
void _applyPart(Map w, Map body, QueuedWrite q) {
  final list = (w['parts'] is List) ? w['parts'] as List : (w['parts'] = []);
  final partId = body['partId']?.toString();
  final qty = (body['quantity'] as num?) ?? 0;
  final line = list.whereType<Map>().where((l) => (l['part'] as Map?)?['id']?.toString() == partId).firstOrNull;
  if (line != null) {
    line['qtyUsed'] = ((line['qtyUsed'] as num?) ?? 0) + qty;
    if (body['condition'] != null) line['condition'] = body['condition'];
    line['pending'] = true;
    return;
  }
  final part = q.meta?['part'];
  list.add({
    'id': 'local-${q.id}',
    'part': part is Map ? part : {'id': partId, 'name': '', 'partNumber': '', 'unit': ''},
    'qtyUsed': qty,
    'unitCost': q.meta?['unitCost'],
    'condition': body['condition'] ?? 'NEW',
    'pending': true,
  });
}

/// A meter reading: the meter shows the new value and the reading tops its history.
void _applyReading(List meters, QueuedWrite q, JsonMap? me) {
  final meterId = _meterReading.firstMatch(q.path)?.group(2);
  final m = meters.whereType<Map>().where((x) => x['id']?.toString() == meterId).firstOrNull;
  final body = q.json is Map ? q.json as Map : const {};
  final value = body['value'];
  if (m == null || value is! num) return;
  final previous = m['currentValue'];
  m['previousValue'] = previous;
  m['currentValue'] = value;
  m['lastReadingAt'] = _iso(q.createdAt);
  final readings = (m['readings'] is List) ? m['readings'] as List : (m['readings'] = []);
  readings.insert(0, {
    'id': 'local-${q.id}',
    'value': value,
    'previousValue': previous,
    'delta': previous is num ? value - previous : null,
    'readAt': _iso(q.createdAt),
    'user': me,
    'note': body['note'],
    'workOrder': null,
    'pending': true,
  });
}

int _stepsLeft(dynamic items) {
  if (items is! List) return 0;
  var n = 0;
  for (final i in items) {
    if (i is Map && i['inputType'] != 'SECTION' && i['required'] != false && i['result'] == null && i['textValue'] == null && i['numericValue'] == null) n++;
  }
  return n;
}

/// One checklist step: an answer (PUT .../:itemId) or a photo / signature (.../attachments).
void _applyToStep(dynamic items, String itemId, QueuedWrite q, JsonMap? me) {
  if (items is! List) return;
  final item = items.whereType<Map>().where((i) => i['id']?.toString() == itemId).firstOrNull;
  if (item == null) return;
  final now = _iso(q.createdAt);
  if (q.path.endsWith('/attachments')) {
    final photos = [
      for (final f in q.files) {'id': 'local-${q.id}-$f', 'kind': 'PHOTO', 'localPath': f},
    ];
    final type = item['inputType'];
    // One signature per step: a new one replaces the old.
    item['attachments'] = type == 'SIGNATURE' ? photos : [...((item['attachments'] as List?) ?? const []), ...photos];
    if (type == 'PHOTO' || type == 'SIGNATURE') item['result'] = 'PASS';
  } else if (q.json is Map) {
    final a = q.json as Map;
    final result = a['result']?.toString();
    item['result'] = (result == null || result.isEmpty) ? null : result;
    if (a.containsKey('numericValue')) item['numericValue'] = a['numericValue'];
    final text = a['textValue']?.toString();
    if (text != null && text.isNotEmpty) item['textValue'] = text;
    final note = a['note']?.toString();
    if (note != null && note.isNotEmpty) item['note'] = note;
  }
  item['completedBy'] = me;
  item['completedAt'] = now;
}

/// Sets keys on a map whatever its generic type (JSON maps are `Map<String, dynamic>`).
void _set(Map target, Map<String, Object?> values) => values.forEach((k, v) => target[k] = v);

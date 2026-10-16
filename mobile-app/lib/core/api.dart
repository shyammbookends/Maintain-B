import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:path_provider/path_provider.dart';

import 'i18n.dart';
import 'offline.dart';
import 'secure_cookies.dart';
import 'server_errors.dart';
import 'transport_policy.dart';

/// Shown when the server can't be reached at all (the sign-in screen looks for it).
String get serverNotFoundMessage =>
    t('Server not found. Make sure the phone and PC are on the same Wi-Fi, then tap "Find server".');

/// JSON object from the API.
typedef Json = Map<String, dynamic>;

/// A failed API call with the server's error code and message.
class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, [this.fieldErrors]);
  final int status;
  final String code;
  final String message;
  final Map<String, dynamic>? fieldErrors;

  /// The change was kept on the phone and will be sent later (not an error for the user).
  bool get queued => code == kQueuedCode;

  /// First field error, if any (more useful than the generic message), else the
  /// error code's text — both in the app language, like the web app.
  String get display {
    final fe = fieldErrors;
    if (fe != null && fe.isNotEmpty) {
      final first = fe.entries.first;
      final v = first.value;
      final msg = v is List && v.isNotEmpty ? v.first.toString() : v.toString();
      final known = kValidationTexts[msg];
      if (known != null) return t(known);
      return '${first.key}: $msg';
    }
    // Status 0 = no server answer: the message was written on the phone (already translated).
    final text = status > 0 ? kErrorTexts[code] : null;
    return text != null ? t(text) : message;
  }

  @override
  String toString() => display;
}

/// How many reads a [ApiClient.cacheFirst] load answered from the saved copy.
class CacheHits {
  int count = 0;
}

/// Talks to the Express API (`/api/v1`). Same contract as the web app:
/// access token in memory, refresh token in an http-only cookie, CSRF header
/// on every call and an idempotency key on every write.
class ApiClient {
  ApiClient._(this._dio, this._jar);

  final Dio _dio;
  final CookieJar _jar;
  String? _accessToken;
  String _server = '';

  /// Called when the session can't be refreshed any more.
  void Function()? onSessionExpired;

  /// Saved screens and the queue of changes made without a network (the app sets it;
  /// tests run without it, online only).
  OfflineSync? _offline;
  OfflineSync? get offline => _offline;
  set offline(OfflineSync? value) {
    _offline = value;
    value?.sender = replay;
  }

  /// Cookies are kept (encrypted) so the session survives app restarts.
  static Future<ApiClient> create() async {
    final dir = await getApplicationSupportDirectory();
    return withJar(PersistCookieJar(storage: SecureCookieStorage('${dir.path}/cookies')));
  }

  /// Same client with a given cookie jar (tests use an in-memory one).
  static ApiClient withJar(CookieJar jar) {
    final dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 6),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 120),
      headers: {'x-requested-with': 'maintainx', 'Accept': 'application/json'},
      // Errors are read from the body below.
      validateStatus: (_) => true,
    ));
    dio.interceptors.add(CookieManager(jar));
    return ApiClient._(dio, jar);
  }

  String get server => _server;

  set server(String value) {
    _server = value.trim().replaceAll(RegExp(r'/+$'), '');
    _dio.options.baseUrl = '$_server/api/v1';
  }

  set accessToken(String? token) => _accessToken = token;

  /// Absolute URL for a file link the API returns (`/api/v1/files?...`).
  String fileUrl(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    return '$_server$path';
  }

  Future<void> clearCookies() => _jar.deleteAll();

  static final _rand = Random.secure();
  static String _key() =>
      List.generate(24, (_) => _rand.nextInt(36).toRadixString(36)).join();

  /// Runs [load] so that cacheable reads answer from the saved copy when there is
  /// one (screens open instantly); [hits] counts how many did. The caller then
  /// loads again normally to show fresh data.
  Future<T> cacheFirst<T>(Future<T> Function() load, CacheHits hits) =>
      runZoned(load, zoneValues: {#mxCacheFirst: hits});

  Future<dynamic> _send(
    String method,
    String path, {
    Object? body,
    _Multipart? multipart,
    Map<String, dynamic>? query,
    bool anonymous = false,
    bool retry = true,
    String? key,
    bool noQueue = false,
    Map<String, dynamic>? meta,
  }) async {
    // Never send credentials over plain HTTP outside the local network.
    final insecure = serverUrlProblem(_server);
    if (insecure != null) throw ApiException(0, 'INSECURE_SERVER', insecure);
    final headers = <String, dynamic>{'Accept-Language': appLocale.value};
    if (!anonymous && _accessToken != null) headers['Authorization'] = 'Bearer $_accessToken';
    // Every write carries a key, so a retry (or the offline queue) is applied once.
    final idempotencyKey = method != 'GET' && !anonymous ? (key ?? _key()) : null;
    if (idempotencyKey != null) headers['Idempotency-Key'] = idempotencyKey;
    final cleanQuery = query == null
        ? null
        : {
            for (final e in query.entries)
              if (e.value != null && e.value.toString().isNotEmpty) e.key: e.value
          };
    final off = _offline;
    final cacheKey = method == 'GET' && off != null && isCacheable(path) ? cacheKeyFor(path, cleanQuery) : null;
    final queueable = off != null && !noQueue && idempotencyKey != null && isQueueable(method, path);

    // Instant screens: the saved copy first (see [cacheFirst]).
    final hits = Zone.current[#mxCacheFirst];
    if (hits is CacheHits && cacheKey != null) {
      final cached = await off!.cacheRead(cacheKey);
      if (cached != null) {
        hits.count++;
        return off.overlay(path, cached);
      }
    }

    // The app opened before the session was confirmed: wait for that one refresh
    // instead of being refused and refreshing again.
    final starting = _refreshing;
    if (!anonymous && _accessToken == null && starting != null) {
      try {
        await starting;
      } catch (_) {
        // Offline: the request below falls back to the saved copy.
      }
      if (_accessToken != null) headers['Authorization'] = 'Bearer $_accessToken';
    }

    // Keep the order: while earlier changes wait to be sent, new ones queue behind them.
    if (queueable && off.pending > 0) {
      await _enqueue(off, idempotencyKey, method, path, body, multipart, meta);
      unawaited(off.flush());
      throw ApiException(0, kQueuedCode, kQueuedMessage);
    }

    Response<dynamic> res;
    try {
      res = await _dio.request<dynamic>(
        path,
        data: multipart != null ? await multipart.build() : body,
        queryParameters: cleanQuery,
        options: Options(method: method, headers: headers),
      );
    } on DioException catch (e) {
      off?.markOffline();
      // Offline: show the last copy of the screen, or keep the change for later.
      if (cacheKey != null) {
        final cached = await off!.cacheRead(cacheKey);
        if (cached != null) {
          off.servedFromCache();
          return off.overlay(path, cached);
        }
      }
      if (queueable) {
        await _enqueue(off, idempotencyKey, method, path, body, multipart, meta);
        throw ApiException(0, kQueuedCode, kQueuedMessage);
      }
      if (e.error is SocketException || e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.connectionError) {
        throw ApiException(0, 'NETWORK_ERROR', serverNotFoundMessage);
      }
      throw ApiException(0, 'NETWORK_ERROR', e.message ?? t('Network error'));
    }

    final status = res.statusCode ?? 0;
    final data = res.data;
    off?.markOnline();
    if (status >= 200 && status < 300) {
      if (cacheKey != null) {
        unawaited(off!.cacheWrite(cacheKey, data));
        return off.overlay(path, data);
      }
      return data;
    }

    final err = data is Map ? data['error'] as Map? : null;
    final code = (err?['code'] ?? 'INTERNAL_ERROR').toString();
    // Expired token, or none yet because the app opened offline: refresh once, then retry.
    if (status == 401 &&
        retry &&
        !anonymous &&
        (code == 'TOKEN_EXPIRED' || code == 'TOKEN_INVALID' || (_accessToken == null && code == 'UNAUTHENTICATED'))) {
      if (await refresh() != null) {
        return _send(method, path,
            body: body,
            multipart: multipart,
            query: query,
            anonymous: anonymous,
            retry: false,
            key: idempotencyKey,
            noQueue: noQueue,
            meta: meta);
      }
      onSessionExpired?.call();
    }
    throw ApiException(
      status,
      code,
      (err?['message'] ?? t('Request failed ({status})', {'status': status})).toString(),
      (err?['fieldErrors'] as Map?)?.cast<String, dynamic>(),
    );
  }

  /// Keeps a write on the phone (photos are copied so they survive cache clean-ups).
  Future<void> _enqueue(OfflineSync off, String key, String method, String path, Object? body, _Multipart? multipart,
      [Map<String, dynamic>? meta]) async {
    final files = multipart == null ? const <String>[] : await off.keepFiles(key, multipart.files);
    await off.enqueue(QueuedWrite(
      id: key,
      method: method,
      path: path,
      json: multipart == null ? body : null,
      fields: multipart?.fields ?? const {},
      files: files,
      fileField: multipart?.fileField ?? 'files',
      ref: await _refFor(off, path),
      meta: meta,
    ));
  }

  /// The work order code a queued change belongs to (shown in the unsent list).
  Future<String> _refFor(OfflineSync off, String path) async {
    final m = RegExp(r'^/work-orders/([^/]+)/').firstMatch(path);
    if (m == null) return '';
    final cached = await off.cacheRead('/work-orders/${m.group(1)}');
    return ((cached is Map ? cached['data'] : null) as Map?)?['code']?.toString() ?? '';
  }

  /// Sends one queued write again with its own key (the offline queue's sender).
  Future<SendResult> replay(QueuedWrite w) async {
    try {
      final res = await _send(
        w.method,
        w.path,
        body: w.multipart ? null : w.json,
        multipart: w.multipart ? _Multipart(w.fields, w.files, w.fileField) : null,
        key: w.id,
        noQueue: true,
      );
      final next = w.then;
      if (next == null) return SendResult.ok;
      final id = ((res is Map ? res['data'] : null) as Map?)?['id']?.toString();
      return id == null ? SendResult.ok : SendResult.okThen(next.withPathId(id));
    } on ApiException catch (e) {
      if (e.status == 0) return SendResult.offline;
      if (e.status == 401) return SendResult.retry();
      if (e.code == 'REQUEST_IN_PROGRESS' || e.status >= 500 || e.status == 429) return SendResult.retry(e.display);
      return SendResult.refused(e.display);
    } on FileSystemException {
      return SendResult.refused(t('The photo is no longer on this phone.'));
    } catch (_) {
      return SendResult.retry();
    }
  }

  Future<dynamic> get(String path, [Map<String, dynamic>? query]) =>
      _send('GET', path, query: query);
  /// [meta] stays on the phone with a queued write (what the screen shows until it is sent).
  Future<dynamic> post(String path, [Object? body, Map<String, dynamic>? meta]) =>
      _send('POST', path, body: body ?? {}, meta: meta);
  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body: body ?? {});
  Future<dynamic> patch(String path, [Object? body]) => _send('PATCH', path, body: body ?? {});
  Future<dynamic> delete(String path) => _send('DELETE', path);

  /// `data` of an `{ data: ... }` response.
  Future<T> getData<T>(String path, [Map<String, dynamic>? query]) async =>
      (await get(path, query) as Map)['data'] as T;
  Future<T> postData<T>(String path, [Object? body, Map<String, dynamic>? meta]) async =>
      (await post(path, body, meta) as Map)['data'] as T;
  Future<T> putData<T>(String path, [Object? body]) async =>
      (await put(path, body) as Map)['data'] as T;

  Future<Json> login(String identifier, String password) async {
    final res = await _send('POST', '/auth/login',
        body: {'identifier': identifier, 'password': password}, anonymous: true);
    final session = (res as Map)['data'] as Json;
    _accessToken = session['accessToken'] as String;
    return session;
  }

  Future<Json?>? _refreshing;

  /// New access token from the refresh cookie; null when signed out.
  /// Calls at the same time share one request (the server rotates the cookie,
  /// so a second parallel refresh would be refused and sign the user out).
  Future<Json?> refresh() => _refreshing ??= _refresh().whenComplete(() => _refreshing = null);

  Future<Json?> _refresh() async {
    try {
      final res = await _send('POST', '/auth/refresh', anonymous: true, retry: false);
      final session = (res as Map)['data'] as Json;
      _accessToken = session['accessToken'] as String;
      return session;
    } on ApiException catch (e) {
      if (e.status == 401 || e.status == 403) {
        _accessToken = null;
        return null;
      }
      rethrow;
    }
  }

  Future<void> logout() async {
    try {
      await _send('POST', '/auth/logout', anonymous: true, retry: false);
    } catch (_) {
      // Signing out locally must always work.
    }
    _accessToken = null;
    await clearCookies();
  }

  /// Uploads one document as multipart `file` with its form fields (POST /documents).
  Future<Json> uploadDocument(File file, Map<String, String> fields) async {
    final res = await _send('POST', '/documents', multipart: _Multipart(fields, [file.path], 'file'));
    return (res as Map)['data'] as Json;
  }

  /// Uploads photos as multipart `files` (plus extra fields first).
  /// Field photos (work order, checklist, report) are queued when offline.
  Future<Json> upload(String path, List<File> files, [Map<String, String> fields = const {}]) async {
    final res = await _send('POST', path, multipart: _Multipart(fields, [for (final f in files) f.path], 'files'));
    return (res as Map)['data'] as Json;
  }

  /// Creates a problem report, then uploads its photos. Without a network both are
  /// kept on the phone and sent later, the photos right after the report.
  Future<Json> submitRequest(Json body, List<File> photos) async {
    final off = _offline;
    final key = _key();
    Future<Never> queue() async {
      final files = await off!.keepFiles('$key-p', [for (final f in photos) f.path]);
      await off.enqueue(QueuedWrite(
        id: key,
        method: 'POST',
        path: '/requests',
        json: body,
        then: files.isEmpty
            ? null
            : QueuedWrite(id: '$key-p', method: 'POST', path: '/requests/{id}/attachments', files: files),
      ));
      unawaited(off.flush());
      throw ApiException(0, kQueuedCode, kQueuedMessage);
    }

    if (off != null && off.pending > 0) await queue();
    Json created;
    try {
      created = (await _send('POST', '/requests', body: body, key: key, noQueue: true) as Map)['data'] as Json;
    } on ApiException catch (e) {
      if (off == null || e.status != 0) rethrow;
      await queue();
    }
    if (photos.isNotEmpty) {
      try {
        await upload('/requests/${created['id']}/attachments', photos);
      } on ApiException catch (e) {
        // The report is in; its photos follow when the network is back.
        if (!e.queued) rethrow;
      }
    }
    return created;
  }
}

/// Voice recordings say they are audio (an .m4a is an MP4 container, like a video).
DioMediaType? _audioType(String name) {
  final ext = name.split('.').last.toLowerCase();
  return switch (ext) {
    'm4a' || 'aac' => DioMediaType('audio', 'mp4'),
    'ogg' || 'opus' => DioMediaType('audio', 'ogg'),
    'mp3' => DioMediaType('audio', 'mpeg'),
    _ => null,
  };
}

/// A multipart body kept as plain values, so it can be rebuilt for a retry or a replay.
class _Multipart {
  _Multipart(this.fields, this.files, this.fileField);
  final Map<String, String> fields;
  final List<String> files;
  final String fileField;

  Future<FormData> build() async {
    final form = FormData();
    fields.forEach((k, v) => form.fields.add(MapEntry(k, v)));
    for (final path in files) {
      final name = path.split(RegExp(r'[\\/]')).last;
      form.files.add(
          MapEntry(fileField, await MultipartFile.fromFile(path, filename: name, contentType: _audioType(name))));
    }
    return form;
  }
}

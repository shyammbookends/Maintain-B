import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../widgets/common.dart';
import 'api.dart';
import 'i18n.dart';

/*
 * In-app updates (Android). After sign-in the app asks the server
 * (GET /app/update) whether a newer build exists. The server answers with a
 * one-hour signed link to the APK in the private release bucket and its
 * SHA-256. The APK is downloaded, its checksum verified, then handed to
 * Android's installer — which only accepts it when it carries the same
 * signing key as the installed app. Releases: tool/release_android.mjs.
 */

const _channel = MethodChannel('in.bookends/updates');

class AppUpdate {
  AppUpdate({
    required this.required,
    required this.version,
    required this.build,
    required this.notes,
    required this.sha256,
    required this.size,
    required this.url,
  });

  final bool required;
  final String version;
  final int build;
  final List<String> notes;
  final String sha256;
  final int size;
  final String url;

  /// The server's answer, or null when there is nothing (valid) to install.
  static AppUpdate? fromJson(Map<String, dynamic> j) {
    if (j['available'] != true) return null;
    final url = Uri.tryParse('${j['url']}');
    final sha = '${j['sha256']}';
    // Only https downloads with a well-formed checksum are ever offered.
    if (url == null || url.scheme != 'https' || !RegExp(r'^[a-f0-9]{64}$').hasMatch(sha)) return null;
    return AppUpdate(
      required: j['required'] == true,
      version: '${j['version']}',
      build: (j['build'] as num?)?.toInt() ?? 0,
      notes: [for (final n in (j['notes'] as List? ?? const [])) '$n'],
      sha256: sha,
      size: (j['size'] as num?)?.toInt() ?? 0,
      url: url.toString(),
    );
  }
}

/// The pubspec build number. Split APKs add 1000 × ABI to Android's version code.
int buildNumberOf(String buildNumber) => (int.tryParse(buildNumber) ?? 0) % 1000;

DateTime? _lastCheck;
bool _showing = false;

/// Asks the server for a newer app and shows the update dialog. Quiet on any
/// error (offline, old server): updates must never get in the way of work.
/// Checks at most every [every], unless [force].
Future<void> checkForUpdate(BuildContext context, ApiClient api,
    {Duration every = const Duration(hours: 6), bool force = false}) async {
  if (!Platform.isAndroid || _showing) return;
  final now = DateTime.now();
  if (!force && _lastCheck != null && now.difference(_lastCheck!) < every) return;
  _lastCheck = now;
  AppUpdate? update;
  try {
    final info = await PackageInfo.fromPlatform();
    final data = await api.getData<Map>('/app/update', {
      'platform': 'android',
      'build': buildNumberOf(info.buildNumber),
      'locale': appLocale.value,
    });
    update = AppUpdate.fromJson(Map<String, dynamic>.from(data));
  } catch (_) {
    return;
  }
  if (update == null || !context.mounted) return;
  _showing = true;
  try {
    await showDialog<void>(
      context: context,
      barrierDismissible: !update.required,
      builder: (_) => _UpdateDialog(update!),
    );
  } finally {
    _showing = false;
  }
}

class _UpdateDialog extends StatefulWidget {
  const _UpdateDialog(this.update);
  final AppUpdate update;
  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<_UpdateDialog> {
  double? _progress; // null = not downloading
  File? _file;

  AppUpdate get u => widget.update;

  Future<void> _start() async {
    try {
      final file = _file ?? await _download();
      if (file == null) return;
      _file = file;
      if (!await _channel.invokeMethod<bool>('canInstall').then((v) => v ?? false)) {
        if (!mounted) return;
        final go = await confirm(context, t('Allow installing updates'),
            body: t('Turn on “Allow from this source” for Bookends Maintenance, then come back and tap Update now.'),
            action: t('Open settings'));
        if (go) await _channel.invokeMethod('openInstallSettings');
        return;
      }
      await _channel.invokeMethod('install', {'path': file.path});
    } on PlatformException {
      if (mounted) toast(context, t('Could not open the installer. Please try again.'), error: true);
    }
  }

  /// Downloads into cache/updates and checks the SHA-256; null on failure.
  Future<File?> _download() async {
    final dir = Directory('${(await getTemporaryDirectory()).path}/updates');
    if (await dir.exists()) await dir.delete(recursive: true);
    await dir.create(recursive: true);
    final file = File('${dir.path}/bookends-${u.build}.apk');
    setState(() => _progress = 0);
    try {
      await Dio(BaseOptions(connectTimeout: const Duration(seconds: 15), receiveTimeout: const Duration(minutes: 2)))
          .download(u.url, file.path, onReceiveProgress: (got, total) {
        final all = total > 0 ? total : u.size;
        if (mounted && all > 0) setState(() => _progress = (got / all).clamp(0, 1).toDouble());
      });
      final digest = await sha256.bind(file.openRead()).first;
      if (digest.toString() != u.sha256) {
        await file.delete();
        if (mounted) toast(context, t('The download was damaged. Please try again.'), error: true);
        return null;
      }
      return file;
    } catch (_) {
      if (await file.exists()) await file.delete();
      if (mounted) toast(context, t('Could not download the update. Check the internet and try again.'), error: true);
      return null;
    } finally {
      if (mounted) setState(() => _progress = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = _progress != null;
    final mb = u.size > 0 ? ' · ${(u.size / 1048576).toStringAsFixed(1)} MB' : '';
    return PopScope(
      canPop: !u.required && !busy,
      child: AlertDialog(
        title: Text(t('Update available')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${t('Version {version}', {'version': u.version})}$mb',
              style: const TextStyle(fontWeight: FontWeight.w600)),
          if (u.notes.isNotEmpty) ...[
            const SizedBox(height: 10),
            for (final n in u.notes) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('• $n')),
          ],
          if (u.required) ...[
            const SizedBox(height: 10),
            Text(t('This update is required to keep using the app.'),
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          if (busy) ...[
            const SizedBox(height: 14),
            LinearProgressIndicator(value: _progress),
            const SizedBox(height: 6),
            Text(t('Downloading… {percent}%', {'percent': ((_progress ?? 0) * 100).round()})),
          ],
        ]),
        actions: [
          if (!u.required)
            TextButton(onPressed: busy ? null : () => Navigator.pop(context), child: Text(t('Later'))),
          FilledButton(onPressed: busy ? null : _start, child: Text(t('Update now'))),
        ],
      ),
    );
  }
}

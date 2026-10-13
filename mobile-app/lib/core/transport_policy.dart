import 'dart:io';

import 'package:flutter/foundation.dart';

import 'i18n.dart';

/// Plain HTTP is only for a server on the local network (the office Wi-Fi PC).
/// Debug builds always allow it; a release build allows it only when built with
/// `--dart-define=ALLOW_LAN_HTTP=true` (a LAN test APK). A normal release talks
/// to the hosted site over HTTPS only, so passwords and the session cookie never
/// cross a network in clear text.
const bool kAllowLanHttp = bool.fromEnvironment('ALLOW_LAN_HTTP') || !kReleaseMode;

/// True for loopback, emulator, `.local` names and private IPv4 ranges.
bool isLanHost(String host) {
  final h = host.toLowerCase();
  if (h == 'localhost' || h.endsWith('.local') || h == '10.0.2.2') return true;
  final ip = InternetAddress.tryParse(h);
  if (ip == null || ip.type != InternetAddressType.IPv4) return false;
  final b = ip.rawAddress;
  return b[0] == 10 ||
      b[0] == 127 ||
      (b[0] == 172 && b[1] >= 16 && b[1] <= 31) ||
      (b[0] == 192 && b[1] == 168);
}

/// Why the app won't talk to [server], or null when it may.
String? serverUrlProblem(String server, {bool allowLanHttp = kAllowLanHttp}) {
  final uri = Uri.tryParse(server.trim());
  if (uri == null || uri.host.isEmpty) return t('Enter the server address, e.g. https://maintenance.example.com');
  if (uri.scheme == 'https') return null;
  if (uri.scheme == 'http' && allowLanHttp && isLanHost(uri.host)) return null;
  return t('Use a secure https:// server address.');
}

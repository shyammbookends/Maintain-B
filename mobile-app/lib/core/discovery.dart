import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Finds the Bookends API on the phone's Wi-Fi network, so a changed PC IP
/// (routers hand out new ones) doesn't stop sign-in.

const kApiPort = 4000;

/// True when [server] answers `/api/v1/health` as the Bookends API.
Future<bool> pingServer(String server, {Duration timeout = const Duration(seconds: 3)}) async {
  final client = HttpClient()..connectionTimeout = timeout;
  try {
    final uri = Uri.parse('${server.replaceAll(RegExp(r'/+$'), '')}/api/v1/health');
    final req = await client.getUrl(uri).timeout(timeout);
    final res = await req.close().timeout(timeout);
    if (res.statusCode != 200) return false;
    final body = await res.transform(utf8.decoder).join().timeout(timeout);
    return body.contains('maintainx-api');
  } catch (_) {
    return false;
  } finally {
    client.close(force: true);
  }
}

/// The phone's own Wi-Fi / LAN IPv4 address, if any.
Future<InternetAddress?> _localAddress() async {
  try {
    final interfaces = await NetworkInterface.list(type: InternetAddressType.IPv4, includeLoopback: false);
    for (final i in interfaces) {
      for (final a in i.addresses) {
        final b = a.rawAddress;
        final private = b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
        if (private) return a;
      }
    }
  } catch (_) {}
  return null;
}

Future<bool> _portOpen(String host, Duration timeout) async {
  try {
    final s = await Socket.connect(host, kApiPort, timeout: timeout);
    s.destroy();
    return true;
  } catch (_) {
    return false;
  }
}

/// Scans the phone's /24 first, then the surrounding /20 (office networks), and
/// returns `http://<ip>:4000` of the first host that answers as the API.
/// [onProgress] gets 0..1. Returns null when nothing is found (e.g. on mobile data).
Future<String?> discoverServer({void Function(double)? onProgress, bool Function()? cancelled}) async {
  final me = await _localAddress();
  if (me == null) return null;
  final b = me.rawAddress;
  final own = '${b[0]}.${b[1]}.${b[2]}';

  final hosts = <String>[
    for (var d = 1; d < 255; d++) if (d != b[3]) '$own.$d',
  ];
  // /20 block around the phone (16 × /24), skipping the one already listed.
  final base = b[2] & 0xF0;
  for (var c = base; c < base + 16; c++) {
    if (c == b[2]) continue;
    for (var d = 1; d < 255; d++) {
      hosts.add('${b[0]}.${b[1]}.$c.$d');
    }
  }

  const batch = 96;
  const timeout = Duration(milliseconds: 350);
  for (var i = 0; i < hosts.length; i += batch) {
    if (cancelled?.call() == true) return null;
    final slice = hosts.sublist(i, (i + batch).clamp(0, hosts.length));
    final open = await Future.wait(slice.map((h) async => await _portOpen(h, timeout) ? h : null));
    for (final h in open.whereType<String>()) {
      final url = 'http://$h:$kApiPort';
      if (await pingServer(url, timeout: const Duration(seconds: 2))) return url;
    }
    onProgress?.call((i + slice.length) / hosts.length);
  }
  return null;
}

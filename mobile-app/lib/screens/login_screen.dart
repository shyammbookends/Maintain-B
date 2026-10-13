import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/discovery.dart';
import '../core/i18n.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/language_picker.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.subtitle, this.size = 40, this.light = false});
  final String? subtitle;
  final double size;
  final bool light;
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            gradient: light ? null : AppColors.brand,
            color: light ? Colors.white.withValues(alpha: 0.18) : null,
            borderRadius: BorderRadius.circular(size * 0.28),
          ),
          child: Icon(Icons.build_rounded, color: Colors.white, size: size * 0.5),
        ),
        const SizedBox(width: 12),
        Flexible(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Bookends Maintenance',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17, color: light ? Colors.white : AppColors.foreground)),
            if (subtitle != null)
              Text(subtitle!,
                  style: TextStyle(fontSize: 12.5, color: light ? Colors.white.withValues(alpha: 0.8) : AppColors.muted)),
          ]),
        ),
      ]);
}

enum _Reach { checking, ok, down }

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _id = TextEditingController();
  final _pw = TextEditingController();
  late final TextEditingController _server;
  bool _busy = false;
  bool _hide = true;
  String? _error;
  _Reach _reach = _Reach.checking;
  double? _scan; // 0..1 while searching the network
  bool _cancelScan = false;

  Session get _s => context.read<Session>();

  @override
  void initState() {
    super.initState();
    _server = TextEditingController(text: _s.api.server);
    _check();
  }

  @override
  void dispose() {
    _cancelScan = true;
    super.dispose();
  }

  Future<void> _check() async {
    setState(() => _reach = _Reach.checking);
    final ok = await pingServer(_s.api.server);
    if (mounted) setState(() => _reach = ok ? _Reach.ok : _Reach.down);
  }

  Future<void> _useServer(String url) async {
    await _s.setServer(url);
    _server.text = _s.api.server;
    await _check();
  }

  Future<void> _find() async {
    setState(() {
      _scan = 0;
      _error = null;
      _cancelScan = false;
    });
    // The saved / typed address first, then the network.
    String? found;
    for (final candidate in {_server.text.trim(), kDefaultServer}) {
      if (candidate.isNotEmpty && await pingServer(candidate)) {
        found = candidate;
        break;
      }
    }
    found ??= await discoverServer(
      onProgress: (p) {
        if (mounted) setState(() => _scan = p);
      },
      cancelled: () => _cancelScan,
    );
    if (!mounted) return;
    setState(() => _scan = null);
    if (found != null) {
      await _useServer(found);
      if (mounted) toast(context, t('Server found: {url}', {'url': found}));
    } else {
      setState(() {
        _reach = _Reach.down;
        _error = t('No server found on this Wi-Fi. Check that "npm run dev" is running on the PC and the phone is on the same Wi-Fi (not mobile data).');
      });
    }
  }

  Future<void> _submit() async {
    if (_id.text.trim().isEmpty || _pw.text.isEmpty) {
      setState(() => _error = t('Enter both your login ID and password.'));
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_server.text.trim() != _s.api.server) await _s.setServer(_server.text);
      await _s.login(_id.text, _pw.text);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = errorText(e);
          if (e is ApiException && e.message == serverNotFoundMessage) _reach = _Reach.down;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.of(context).padding.top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: kSystemBarsOnColor,
      child: Scaffold(
      body: SingleChildScrollView(
        child: Column(children: [
          // Gradient header
          Container(
            width: double.infinity,
            padding: EdgeInsets.fromLTRB(24, top + 36, 24, 64),
            decoration: const BoxDecoration(gradient: AppColors.brand),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              BrandMark(size: 46, light: true, subtitle: t('Restaurant maintenance')),
              const SizedBox(height: 28),
              Text(t('Welcome back'),
                  style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(t('Sign in to see your tasks and restaurants.'),
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 15)),
            ]),
          ),
          Transform.translate(
            offset: const Offset(0, -36),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(children: [
                Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(color: AppColors.foreground.withValues(alpha: 0.08), blurRadius: 30, offset: const Offset(0, 12)),
                    ],
                  ),
                  child: AutofillGroup(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      TextField(
                        controller: _id,
                        autofillHints: const [AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        keyboardType: TextInputType.emailAddress,
                        decoration: InputDecoration(
                            labelText: t('Email, username or phone'), prefixIcon: const Icon(Icons.person_outline)),
                      ),
                      const SizedBox(height: 14),
                      TextField(
                        controller: _pw,
                        obscureText: _hide,
                        autofillHints: const [AutofillHints.password],
                        onSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: t('Password'),
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                            icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                            onPressed: () => setState(() => _hide = !_hide),
                          ),
                        ),
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 14),
                        Callout(text: _error!, tone: 'danger'),
                      ],
                      const SizedBox(height: 18),
                      FilledButton(
                        onPressed: _busy || _scan != null ? null : _submit,
                        child: _busy
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                            : Text(t('Sign in')),
                      ),
                    ]),
                  ),
                ),
                const SizedBox(height: 16),
                // The hosted (internet) build talks to its own server; no picker needed.
                if (kHostedServer.isEmpty) ...[
                  _serverCard(),
                  const SizedBox(height: 16),
                ],
                // Language before sign-in (kept on this phone; the account's choice applies after).
                const LoginLanguagePicker(),
              ]),
            ),
          ),
        ]),
      ),
      ),
    );
  }

  Widget _serverCard() {
    final (color, text, icon) = switch (_reach) {
      _Reach.ok => (AppColors.successFg, t('Connected'), Icons.check_circle),
      _Reach.down => (AppColors.dangerFg, t('Not reachable'), Icons.error),
      _Reach.checking => (AppColors.muted, t('Checking…'), Icons.sync),
    };
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Icon(Icons.dns_outlined, size: 20, color: AppColors.muted),
          const SizedBox(width: 8),
          Expanded(child: Text(t('Server'), style: const TextStyle(fontWeight: FontWeight.w600))),
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 4),
          Text(text, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: color)),
        ]),
        const SizedBox(height: 10),
        TextField(
          controller: _server,
          keyboardType: TextInputType.url,
          onSubmitted: (v) => _useServer(v),
          decoration: InputDecoration(
            isDense: true,
            hintText: 'http://192.168.1.10:4000',
            suffixIcon: IconButton(tooltip: t('Check'), icon: const Icon(Icons.refresh), onPressed: () => _useServer(_server.text)),
          ),
        ),
        const SizedBox(height: 10),
        if (_scan != null) ...[
          LinearProgressIndicator(value: _scan, minHeight: 6, borderRadius: BorderRadius.circular(3)),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(
              child: Text(t('Searching this Wi-Fi… {pct}%', {'pct': ((_scan ?? 0) * 100).round()}),
                  style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
            ),
            TextButton(onPressed: () => setState(() => _cancelScan = true), child: Text(t('Stop'))),
          ]),
        ] else
          OutlinedButton.icon(
            onPressed: _find,
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 46)),
            icon: const Icon(Icons.wifi_find),
            label: Text(t('Find server automatically')),
          ),
        const SizedBox(height: 6),
        Text(t('Phone and PC must be on the same Wi-Fi. For use on mobile data, enter the online (Vercel) address.'),
            style: const TextStyle(fontSize: 12, color: AppColors.muted)),
      ]),
    );
  }
}

/// First sign-in with a temporary password: choose a new one (same rule as the web).
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});
  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final s = context.read<Session>();
    try {
      final session = await s.api.postData<Map<String, dynamic>>(
          '/auth/change-password', {'currentPassword': _current.text, 'newPassword': _next.text});
      s.adopt(session);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(t('Choose a new password')), actions: [
        TextButton(onPressed: () => context.read<Session>().logout(), child: Text(t('Sign out'))),
      ]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Callout(text: t('For security, please set your own password before continuing.')),
        const SizedBox(height: 16),
        TextField(
            controller: _current,
            obscureText: true,
            decoration: InputDecoration(labelText: t('Current password'))),
        const SizedBox(height: 12),
        TextField(
            controller: _next,
            obscureText: true,
            decoration: InputDecoration(
                labelText: t('New password'), helperText: t('At least 8 characters with letters and numbers'))),
        if (_error != null) ...[const SizedBox(height: 12), Callout(text: _error!, tone: 'danger')],
        const SizedBox(height: 16),
        FilledButton(onPressed: _busy ? null : _save, child: Text(t('Save password'))),
      ]),
    );
  }
}

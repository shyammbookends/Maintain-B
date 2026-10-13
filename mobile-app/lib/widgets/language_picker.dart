import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/i18n.dart';
import '../core/session.dart';
import '../core/theme.dart';
import 'common.dart';

/// English / हिन्दी / ગુજરાતી, each in its own script (like the web's language menu).
class _LanguageChoice extends StatelessWidget {
  const _LanguageChoice({required this.onPick, this.compact = false});
  final ValueChanged<String> onPick;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String>(
      valueListenable: appLocale,
      builder: (context, current, _) => Wrap(
        alignment: compact ? WrapAlignment.center : WrapAlignment.start,
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final code in kLocales)
            ChoiceChip(
              key: ValueKey('lang-$code'),
              label: Text(kLocaleNames[code]!),
              selected: current == code,
              showCheckmark: false,
              onSelected: (_) {
                if (current != code) onPick(code);
              },
            ),
        ],
      ),
    );
  }
}

/// Profile card: the language is saved to the account (used on every device, as on the web)
/// and applies straight away.
class LanguageCard extends StatelessWidget {
  const LanguageCard({super.key});

  Future<void> _pick(BuildContext context, String code) async {
    final session = context.read<Session>();
    await setAppLocale(code);
    final saved = await session.savePreferredLocale(code);
    if (!context.mounted) return;
    if (saved) {
      toast(context, t('Language saved.'));
    } else {
      toast(context, t('Could not save to your account. The language still applies on this phone.'), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const IconChip(Icons.translate),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('Language'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
              Text(
                t('Saved to your account and used on every device.'),
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
            ]),
          ),
        ]),
        const SizedBox(height: 12),
        _LanguageChoice(onPick: (code) => _pick(context, code)),
      ]),
    );
  }
}

/// Sign-in screen: the language is only remembered on this phone until someone signs in.
class LoginLanguagePicker extends StatelessWidget {
  const LoginLanguagePicker({super.key});

  @override
  Widget build(BuildContext context) => _LanguageChoice(compact: true, onPick: (code) => setAppLocale(code));
}

import 'package:flutter/widgets.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../l10n/gu.dart';
import '../l10n/hi.dart';

/// App language: English, Hindi and Gujarati (same choices as the web app).
///
/// Text is written in English in the code and looked up with [t]:
/// `t('Work orders')`, `t('Overdue by {time}', {'time': x})`. The English text is the key of
/// the Hindi and Gujarati tables (lib/l10n); anything missing shows in English.
const kLocales = ['en', 'hi', 'gu'];

/// Each language's own name, as shown in the language pickers.
const kLocaleNames = {'en': 'English', 'hi': 'हिन्दी', 'gu': 'ગુજરાતી'};

const _tables = <String, Map<String, String>>{'hi': hi, 'gu': gu};

/// The current language code ('en', 'hi' or 'gu'); the app rebuilds when it changes.
final appLocale = ValueNotifier<String>('en');

bool isLocale(Object? v) => v is String && kLocales.contains(v);

final _context = RegExp(r'^[a-z]+\|');

/// [en] in the current language, with `{name}` placeholders filled from [params].
/// A word that means two things gets a context prefix, e.g. `t('verb|Open')` (a button)
/// next to `t('Open')` (a status); the English shown is the part after the `|`.
String t(String en, [Map<String, Object?>? params]) {
  var s = _tables[appLocale.value]?[en] ?? en.replaceFirst(_context, '');
  if (params != null) {
    for (final e in params.entries) {
      s = s.replaceAll('{${e.key}}', '${e.value}');
    }
  }
  return s;
}

const _prefKey = 'locale';

/// Switches the language right away (dates too) and remembers it on this phone.
Future<void> setAppLocale(String code, {bool remember = true}) async {
  if (!isLocale(code)) return;
  await initializeDateFormatting(code);
  Intl.defaultLocale = code;
  appLocale.value = code;
  if (remember) {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, code);
    } catch (_) {
      // Not saved: the language still applies until the app closes.
    }
  }
}

/// The language chosen last on this phone (before anyone signs in).
Future<void> loadSavedLocale() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final code = prefs.getString(_prefKey);
    if (isLocale(code)) await setAppLocale(code!, remember: false);
  } catch (_) {}
}

/// Rebuilds every screen (open dialogs and pages underneath included) when the
/// language changes, so the new language shows without restarting the app.
class LocaleRebuilder extends StatefulWidget {
  const LocaleRebuilder({super.key, required this.child});
  final Widget child;

  @override
  State<LocaleRebuilder> createState() => _LocaleRebuilderState();
}

class _LocaleRebuilderState extends State<LocaleRebuilder> {
  @override
  void initState() {
    super.initState();
    appLocale.addListener(_rebuildAll);
  }

  @override
  void dispose() {
    appLocale.removeListener(_rebuildAll);
    super.dispose();
  }

  void _rebuildAll() {
    void visit(Element e) {
      e.markNeedsBuild();
      e.visitChildren(visit);
    }

    if (mounted) (context as Element).visitChildren(visit);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

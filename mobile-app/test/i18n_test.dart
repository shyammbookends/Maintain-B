// Every English text the app shows through t() (and every enum label) must have a
// Hindi and a Gujarati translation with the same {placeholders}.
import 'dart:io';

import 'package:bookends_maintenance/core/format.dart';
import 'package:bookends_maintenance/core/i18n.dart';
import 'package:bookends_maintenance/core/server_errors.dart';
import 'package:bookends_maintenance/l10n/gu.dart';
import 'package:bookends_maintenance/l10n/hi.dart';
import 'package:flutter_test/flutter_test.dart';

final _literal = RegExp(r'''(?<![\w.])t\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")''');

String _unescape(String s) =>
    s.replaceAllMapped(RegExp(r'\\(.)'), (m) => switch (m[1]) { 'n' => '\n', 't' => '\t', _ => m[1]! });

/// English keys used in lib/, with the file that uses each.
Map<String, String> usedKeys() {
  final keys = <String, String>{};
  for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
    if (!f.path.endsWith('.dart') || f.path.contains('l10n')) continue;
    for (final m in _literal.allMatches(f.readAsStringSync())) {
      keys.putIfAbsent(_unescape(m[1] ?? m[2]!), () => f.path);
    }
  }
  for (final v in kEnumLabels.values) {
    keys.putIfAbsent(v, () => 'lib/core/format.dart');
  }
  // Server error texts, shown through t() by ApiException.display.
  for (final v in [...kErrorTexts.values, ...kValidationTexts.values]) {
    keys.putIfAbsent(v, () => 'lib/core/server_errors.dart');
  }
  return keys;
}

void main() {
  final keys = usedKeys();
  final placeholder = RegExp(r'\{\w+\}');
  List<String> holes(String s) => [for (final m in placeholder.allMatches(s)) m[0]!]..sort();

  test('the source has translatable text', () {
    expect(keys.length, greaterThan(500));
    // Interpolation in a key would never match the tables.
    expect(keys.keys.where((k) => k.contains(r'$')), isEmpty);
  });

  for (final (code, table) in [('hi', hi), ('gu', gu)]) {
    test('every key has a $code translation (missing = 0)', () {
      final missing = [for (final e in keys.entries) if ((table[e.key] ?? '').isEmpty) '${e.value}: ${e.key}'];
      expect(missing, isEmpty, reason: 'Missing $code translations:\n${missing.join('\n')}');
    });

    test('$code translations keep the {placeholders}', () {
      final bad = [
        for (final e in table.entries)
          if (!listEquals(holes(e.key), holes(e.value))) '${e.key} → ${e.value}'
      ];
      expect(bad, isEmpty);
    });
  }

  test('t() looks up the current language, falls back to English and fills placeholders', () async {
    addTearDown(() => setAppLocale('en', remember: false));
    expect(t('Due today, {time}', {'time': '5:00 pm'}), 'Due today, 5:00 pm');
    await setAppLocale('hi', remember: false);
    expect(t('Due today, {time}', {'time': '5:00 pm'}), 'आज, 5:00 pm तक');
    expect(label('IN_PROGRESS'), hi['In progress']);
    expect(t('Text that is not translated'), 'Text that is not translated');
    await setAppLocale('gu', remember: false);
    expect(label('ON_HOLD'), gu['On hold']);
    expect(fmtDuration(105), '1 કલાક 45 મિનિટ');
  });
}

bool listEquals(List<String> a, List<String> b) => a.length == b.length && a.join('|') == b.join('|');

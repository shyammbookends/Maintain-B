// Picking हिन्दी / ગુજરાતી changes the text on screen straight away (no restart),
// including const widgets that were built before the switch.
import 'package:bookends_maintenance/core/i18n.dart';
import 'package:bookends_maintenance/widgets/common.dart';
import 'package:bookends_maintenance/widgets/language_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Screen extends StatelessWidget {
  const _Screen();
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(t('Work orders'))),
        body: const Column(children: [
          StatusBadge('IN_PROGRESS'),
          SectionTitle('—'),
          LoginLanguagePicker(),
        ]),
      );
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  tearDown(() => setAppLocale('en', remember: false));

  testWidgets('switching to Hindi and Gujarati changes visible text', (tester) async {
    await tester.pumpWidget(const LocaleRebuilder(child: MaterialApp(home: _Screen())));
    expect(find.text('Work orders'), findsOneWidget);
    expect(find.text('In progress'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('lang-hi')));
    await tester.pumpAndSettle();
    expect(find.text('Work orders'), findsNothing);
    expect(find.text('वर्क ऑर्डर'), findsOneWidget);
    expect(find.text('चल रहा है'), findsOneWidget);
    expect(appLocale.value, 'hi');
    // Remembered on the phone for the next start.
    expect((await SharedPreferences.getInstance()).getString('locale'), 'hi');

    await tester.tap(find.byKey(const ValueKey('lang-gu')));
    await tester.pumpAndSettle();
    expect(find.text('વર્ક ઓર્ડર'), findsOneWidget);
    expect(find.text('ચાલુ છે'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('lang-en')));
    await tester.pumpAndSettle();
    expect(find.text('Work orders'), findsOneWidget);
  });

  testWidgets('a change made elsewhere (e.g. after sign-in) also rebuilds the screen', (tester) async {
    await tester.pumpWidget(LocaleRebuilder(
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(child: Text(t('Schedule'))),
          ),
        ),
      ),
    ));
    expect(find.text('Schedule'), findsOneWidget);
    await setAppLocale('hi', remember: false);
    await tester.pump();
    expect(find.text('Schedule'), findsNothing);
    expect(find.text(t('Schedule')), findsOneWidget);
  });
}

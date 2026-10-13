// Parts used, time entries and meter readings: the offline queue (kept on the
// phone with what the screen needs, shown straight away on the saved copies),
// the forms that collect them, and translated server errors.
// Runs without a server (an address nothing listens on, and fake callbacks).

import 'package:bookends_maintenance/core/api.dart';
import 'package:bookends_maintenance/core/i18n.dart';
import 'package:bookends_maintenance/core/offline.dart';
import 'package:bookends_maintenance/core/theme.dart';
import 'package:bookends_maintenance/l10n/hi.dart';
import 'package:bookends_maintenance/widgets/work_order_extras.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const me = {'id': 'u1', 'firstName': 'Ravi', 'lastName': 'Patel'};

QueuedWrite write(String id, String path, Object json, {Map<String, dynamic>? meta, int at = 1700000000000}) =>
    QueuedWrite(id: id, method: 'POST', path: path, json: json, meta: meta, createdAt: at);

Widget host(Widget child) => MaterialApp(theme: buildTheme(), home: child);

void main() {
  group('offline queue', () {
    test('parts, time and readings are queueable; the part list is kept for offline use', () {
      expect(isQueueable('POST', '/work-orders/w1/parts'), isTrue);
      expect(isQueueable('POST', '/work-orders/w1/time'), isTrue);
      expect(isQueueable('POST', '/assets/a1/meters/m1/readings'), isTrue);
      // Removing a line needs the server's answer (stock goes back): online only.
      expect(isQueueable('DELETE', '/work-orders/w1/parts/l1'), isFalse);
      expect(isCacheable('/parts'), isTrue);
      expect(isCacheable('/assets/a1/meters'), isTrue);
    });

    test('meta stays with a queued write across a restart and is never part of the body', () {
      final w = write('k1', '/work-orders/w1/parts', {'partId': 'p1', 'quantity': 2},
          meta: {'part': {'id': 'p1', 'name': 'Gasket'}});
      final back = QueuedWrite.fromJson(w.toJson());
      expect(back.meta?['part'], {'id': 'p1', 'name': 'Gasket'});
      expect(back.json, {'partId': 'p1', 'quantity': 2});
    });

    test('a queued part shows on the saved work order (new line, then added to the same part)', () {
      final body = {
        'data': {
          'id': 'w1',
          'parts': [
            {'id': 'l1', 'part': {'id': 'p2', 'name': 'Belt', 'unit': 'pcs'}, 'qtyUsed': 1, 'unitCost': 50, 'condition': 'NEW'},
          ],
        },
      };
      final queue = [
        write('k1', '/work-orders/w1/parts', {'partId': 'p1', 'quantity': 2, 'condition': 'USED'},
            meta: {'part': {'id': 'p1', 'name': 'Gasket', 'partNumber': 'G-1', 'unit': 'pcs'}, 'unitCost': 120}),
        write('k2', '/work-orders/w1/parts', {'partId': 'p2', 'quantity': 0.5}),
      ];
      final out = applyPending('/work-orders/w1', body, queue, me) as Map;
      final parts = (out['data'] as Map)['parts'] as List;
      expect(parts, hasLength(2));
      expect(parts[0]['qtyUsed'], 1.5, reason: 'the server adds to the line of the same part');
      expect(parts[0]['pending'], isTrue);
      expect(parts[1]['part']['name'], 'Gasket');
      expect(parts[1]['qtyUsed'], 2);
      expect(parts[1]['unitCost'], 120);
      expect(parts[1]['condition'], 'USED');
      expect(parts[1]['pending'], isTrue);
      // The saved copy itself is not changed.
      expect(((body['data'] as Map)['parts'] as List), hasLength(1));
    });

    test('queued time adds an entry and to the time worked', () {
      final body = {
        'data': {'id': 'w1', 'minutesWorked': 30, 'timeEntries': []},
      };
      final out = applyPending('/work-orders/w1', body, [
        write('k1', '/work-orders/w1/time', {'userId': 'u2', 'minutes': 45, 'startedAt': '2026-10-01T09:00:00.000Z', 'note': 'No timer'},
            meta: {'user': {'id': 'u2', 'firstName': 'Asha', 'lastName': 'Shah'}}),
      ], me) as Map;
      final w = out['data'] as Map;
      expect(w['minutesWorked'], 75);
      final e = (w['timeEntries'] as List).single as Map;
      expect(e['user']['firstName'], 'Asha');
      expect(e['minutes'], 45);
      expect(e['manual'], isTrue);
      expect(e['endedAt'], '2026-10-01T09:45:00.000Z');
    });

    test('a queued reading shows on the saved meters of the asset', () {
      final body = {
        'data': [
          {'id': 'm1', 'name': 'Hours', 'unit': 'h', 'currentValue': 100, 'readings': []},
          {'id': 'm2', 'name': 'Temp', 'unit': '°C', 'currentValue': null, 'readings': []},
        ],
      };
      final out = applyPending('/assets/a1/meters', body, [
        write('k1', '/assets/a1/meters/m1/readings', {'value': 112.5, 'note': ''}),
        write('k2', '/assets/other/meters/m2/readings', {'value': 4}),
      ], me) as Map;
      final meters = out['data'] as List;
      expect(meters[0]['currentValue'], 112.5);
      expect(meters[0]['previousValue'], 100);
      expect((meters[0]['readings'] as List).first['delta'], 12.5);
      expect((meters[0]['readings'] as List).first['user'], me);
      expect(meters[1]['currentValue'], isNull, reason: 'another asset’s reading');
    });
  });

  group('server errors are shown in the app language', () {
    tearDown(() => setAppLocale('en', remember: false));

    test('validation keys and error codes become text', () async {
      final stock = ApiException(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
        'quantity': ['validation.notEnoughStock'],
      });
      expect(stock.display, 'Not enough in stock.');
      expect(ApiException(403, 'FORBIDDEN', 'Forbidden').display, 'You don’t have permission to do this.');
      // Unknown messages are kept as they are, with the field name.
      expect(ApiException(400, 'VALIDATION_ERROR', 'x', {'note': ['Too small']}).display, 'note: Too small');
      // Written on the phone (no server answer): unchanged.
      expect(ApiException(0, 'NETWORK_ERROR', serverNotFoundMessage).display, serverNotFoundMessage);

      await setAppLocale('hi', remember: false);
      expect(stock.display, hi['Not enough in stock.']);
    });
  });

  group('forms', () {
    testWidgets('parts used: lines, cost, add and remove only when allowed', (tester) async {
      final removed = <Map>[];
      var added = 0;
      Widget section(bool canEdit) => host(Scaffold(
            body: ListView(children: [
              PartsUsedSection(
                canEdit: canEdit,
                parts: [
                  {'id': 'l1', 'part': {'id': 'p1', 'name': 'Gasket', 'partNumber': 'G-1', 'unit': 'pcs'}, 'qtyUsed': 2, 'unitCost': 100, 'condition': 'USED'},
                  {'id': 'local-k', 'part': {'id': 'p2', 'name': 'Belt', 'partNumber': 'B-1', 'unit': 'pcs'}, 'qtyUsed': 1, 'pending': true},
                ],
                onAdd: () => added++,
                onRemove: removed.add,
              ),
            ]),
          ));

      await tester.pumpWidget(section(false));
      expect(find.text('Gasket'), findsOneWidget);
      expect(find.text('G-1 · Used · ₹200'), findsOneWidget);
      expect(find.text('Parts cost: ₹200'), findsOneWidget);
      expect(find.text('Add part used'), findsNothing);
      expect(find.byIcon(Icons.delete_outline), findsNothing);

      await tester.pumpWidget(section(true));
      await tester.tap(find.text('Add part used'));
      expect(added, 1);
      // A line still waiting to be sent can't be removed yet.
      expect(find.byIcon(Icons.delete_outline), findsOneWidget);
      expect(find.byIcon(Icons.cloud_upload_outlined), findsOneWidget);
      await tester.tap(find.byIcon(Icons.delete_outline));
      expect(removed.single['id'], 'l1');
    });

    testWidgets('use part: out-of-stock parts are disabled; returns the body and what to show offline', (tester) async {
      PartUse? result;
      await tester.pumpWidget(host(Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: FilledButton(
              onPressed: () async => result = await Navigator.of(context).push<PartUse>(MaterialPageRoute(
                builder: (_) => UsePartScreen(
                  load: () async => [
                    {'id': 'p1', 'name': 'Gasket', 'partNumber': 'G-1', 'unit': 'pcs', 'unitCost': 120, 'stock': {'quantity': 5}},
                    {'id': 'p2', 'name': 'Belt', 'partNumber': 'B-1', 'unit': 'pcs', 'unitCost': 80, 'stock': null},
                  ],
                ),
              )),
              child: const Text('open'),
            ),
          ),
        ),
      )));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('5 pcs in stock'), findsOneWidget);
      expect(find.text('0 pcs in stock'), findsOneWidget);

      await tester.tap(find.text('Belt'));
      await tester.pumpAndSettle();
      expect(find.text('Use part'), findsNothing, reason: 'nothing in stock');

      await tester.enterText(find.byType(TextField), 'gas');
      await tester.pumpAndSettle();
      expect(find.text('Belt'), findsNothing);
      await tester.tap(find.text('Gasket'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const ValueKey('part-qty')), '9');
      await tester.pump();
      expect(find.text('Not enough in stock.'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Use part')).onPressed, isNull);

      await tester.enterText(find.byKey(const ValueKey('part-qty')), '1,5');
      await tester.tap(find.text('Refurbished'));
      await tester.pump();
      await tester.tap(find.text('Use part'));
      await tester.pumpAndSettle();
      expect(result!.body, {'partId': 'p1', 'quantity': 1.5, 'condition': 'REFURBISHED'});
      expect(result!.meta['part'], {'id': 'p1', 'name': 'Gasket', 'partNumber': 'G-1', 'unit': 'pcs'});
      expect(result!.meta['unitCost'], 120);
    });

    testWidgets('add time: who, minutes, reason; returns the API body', (tester) async {
      TimeAdd? result;
      final wo = {
        'assignedUser': {'id': 'u1', 'firstName': 'Ravi', 'lastName': 'Patel'},
        'helpers': [
          {'id': 'u1', 'firstName': 'Ravi', 'lastName': 'Patel'},
          {'id': 'u2', 'firstName': 'Asha', 'lastName': 'Shah'},
        ],
      };
      await tester.pumpWidget(host(Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: FilledButton(
              onPressed: () async => result = await Navigator.of(context).push<TimeAdd>(
                MaterialPageRoute(builder: (_) => AddTimeScreen(workOrder: wo, now: DateTime(2026, 10, 11, 15, 30))),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      )));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      Finder add() => find.widgetWithText(FilledButton, 'Add time');
      expect(tester.widget<FilledButton>(add()).onPressed, isNull);

      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Asha Shah').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('time-minutes')), '2000');
      await tester.pump();
      expect(find.text('Enter 1 to 1440 minutes.'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('time-minutes')), '45');
      await tester.enterText(find.byKey(const ValueKey('time-note')), 'Forgot the timer');
      await tester.pump();
      await tester.tap(add());
      await tester.pumpAndSettle();

      expect(result!.body['userId'], 'u2');
      expect(result!.body['minutes'], 45);
      expect(result!.body['note'], 'Forgot the timer');
      expect(result!.body['startedAt'], DateTime(2026, 10, 11, 14, 30).toUtc().toIso8601String());
      expect(result!.meta['user']['firstName'], 'Asha');
    });

    testWidgets('time: worked, timer running and entries; add only for managers', (tester) async {
      Widget section(bool canAdd) => host(Scaffold(
            body: ListView(children: [
              TimeSection(
                canAdd: canAdd,
                onAdd: () {},
                onRemove: (_) {},
                workOrder: {
                  'minutesWorked': 95,
                  'timerRunning': true,
                  'timeEntries': [
                    {'id': 'e1', 'user': me, 'startedAt': '2026-10-01T09:00:00.000Z', 'minutes': 50, 'manual': true, 'note': 'Fixed'},
                    {'id': 'e2', 'user': me, 'startedAt': '2026-10-01T11:00:00.000Z', 'minutes': null, 'manual': false},
                  ],
                },
              ),
            ]),
          ));
      await tester.pumpWidget(section(false));
      expect(find.text('Worked 1 h 35 min'), findsOneWidget);
      expect(find.text('Timer running'), findsNWidgets(2));
      expect(find.text('Add time'), findsNothing);
      expect(find.byIcon(Icons.delete_outline), findsNothing);

      await tester.pumpWidget(section(true));
      expect(find.text('Add time'), findsOneWidget);
      // Only time added by hand can be removed (the timer's own entries can't).
      expect(find.byIcon(Icons.delete_outline), findsOneWidget);
    });

    testWidgets('meters: record a reading, kept on the phone without a network', (tester) async {
      final sent = <(Map, Json)>[];
      var value = 100;
      var queued = false;
      await tester.pumpWidget(host(Scaffold(
        body: ListView(children: [
          MetersSection(
            load: () async => [
              {'id': 'm1', 'name': 'Engine hours', 'type': 'RUNTIME_HOURS', 'unit': 'h', 'currentValue': value, 'readings': [], 'can': {'read': true}},
            ],
            record: (m, body) async {
              sent.add((m, body));
              value = (body['value'] as num).toInt();
              if (queued) throw ApiException(0, kQueuedCode, kQueuedMessage);
              return null;
            },
          ),
        ]),
      )));
      await tester.pumpAndSettle();
      expect(find.text('Meters'), findsOneWidget);
      expect(find.text('100 h'), findsOneWidget);

      await tester.tap(find.text('Record reading'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('reading-value')), '1.2345');
      await tester.pump();
      expect(find.text('Use at most 3 decimal places.'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('reading-value')), '120');
      await tester.enterText(find.byKey(const ValueKey('reading-note')), 'Weekly');
      await tester.pump();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(sent.single.$1['id'], 'm1');
      expect(sent.single.$2, {'value': 120, 'note': 'Weekly'});
      expect(find.text('Reading saved.'), findsOneWidget);

      queued = true;
      await tester.tap(find.text('Record reading'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('reading-value')), '130');
      await tester.pump();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(find.text(kQueuedMessage), findsOneWidget);
      expect(find.text('130 h'), findsOneWidget, reason: 'reloaded from the saved copy');
    });

    testWidgets('meters: nothing shown without meters, unless asked to say so', (tester) async {
      Widget section(bool showEmpty) => host(Scaffold(
            body: ListView(children: [
              MetersSection(showEmpty: showEmpty, load: () async => [], record: (_, _) async => null),
            ]),
          ));
      await tester.pumpWidget(section(false));
      await tester.pumpAndSettle();
      expect(find.text('Meters'), findsNothing);
      await tester.pumpWidget(section(true));
      await tester.pumpAndSettle();
      expect(find.text('No meters on this asset yet.'), findsOneWidget);
    });
  });
}

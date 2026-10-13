// The SIGNATURE checklist step: draw with a finger, save a PNG, hand it to the
// step's upload (same call as photos: POST .../checklist/:itemId/attachments).
import 'dart:io';

import 'package:bookends_maintenance/widgets/checklist.dart';
import 'package:bookends_maintenance/widgets/signature_pad.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('signing a step uploads a PNG of the signature', (tester) async {
    final tmp = Directory.systemTemp.createTempSync('sig_test');
    SignaturePad.tempDir = () async => tmp;
    final uploads = <(String, List<File>)>[];

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ListView(children: [
          ChecklistView(
            items: const [
              {'id': 'step1', 'position': 1, 'title': 'Customer signature', 'inputType': 'SIGNATURE', 'required': true, 'attachments': []},
            ],
            editable: true,
            onAnswer: (_, _) async {},
            onUpload: (id, files) async => uploads.add((id, files)),
          ),
        ]),
      ),
    ));

    final save = find.widgetWithText(FilledButton, 'Save signature');
    expect(tester.widget<FilledButton>(save).onPressed, isNull, reason: 'nothing drawn yet');

    // The drawing area is the top 150 px of the pad.
    final pad = tester.getRect(find.byType(SignaturePad));
    await tester.dragFrom(pad.topCenter + const Offset(-60, 70), const Offset(120, 20));
    await tester.pump();
    expect(tester.widget<FilledButton>(save).onPressed, isNotNull);

    await tester.runAsync(() async {
      await tester.tap(save);
      // Rendering the PNG and writing the file happen outside the fake clock.
      for (var i = 0; i < 50 && uploads.isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
    });
    await tester.pump();

    expect(uploads, hasLength(1));
    expect(uploads.single.$1, 'step1');
    final png = uploads.single.$2.single.readAsBytesSync();
    expect(png.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47], reason: 'PNG file');
    tmp.deleteSync(recursive: true);
  });
}

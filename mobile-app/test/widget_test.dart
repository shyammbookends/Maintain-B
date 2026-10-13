import 'package:bookends_maintenance/core/format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('labels match the web app', () {
    expect(label('IN_PROGRESS'), 'In progress');
    expect(label('REVIEW'), 'Pending verification');
    expect(fmtDuration(105), '1 h 45 min');
  });
}

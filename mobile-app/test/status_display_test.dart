import 'package:bookends_maintenance/core/format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  tearDown(() => simpleStatuses = true);

  test('simple statuses fold every stage like the web', () {
    simpleStatuses = true;
    expect(woStatusShown('ASSIGNED'), 'OPEN');
    expect(woStatusShown('SCHEDULED'), 'OPEN');
    expect(woStatusShown('REOPENED'), 'OPEN');
    expect(woStatusShown('IN_PROGRESS'), 'IN_PROGRESS');
    expect(woStatusShown('ON_HOLD'), 'ON_HOLD');
    expect(woStatusShown('REVIEW'), 'REVIEW');
    expect(woStatusShown('COMPLETED'), 'DONE');
    expect(woStatusShown('CLOSED'), 'DONE');
    expect(woStatusShown('CANCELLED'), 'CANCELLED');
    expect(label(woStatusShown('VERIFIED')), 'Done');
  });

  test('detailed statuses are shown as they are when the switch is off', () {
    simpleStatuses = false;
    expect(woStatusShown('ASSIGNED'), 'ASSIGNED');
    expect(label(woStatusShown('REVIEW')), 'Pending verification');
  });
}

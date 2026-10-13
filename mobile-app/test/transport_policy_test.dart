import 'package:bookends_maintenance/core/transport_policy.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('https is always allowed', () {
    expect(serverUrlProblem('https://maint.example.com', allowLanHttp: false), isNull);
    expect(serverUrlProblem('https://maint.example.com', allowLanHttp: true), isNull);
  });

  test('plain http only to the local network, and only when allowed', () {
    for (final lan in ['http://172.16.35.54:4000', 'http://192.168.1.10:4000', 'http://10.0.2.2:4000', 'http://localhost:4000']) {
      expect(serverUrlProblem(lan, allowLanHttp: true), isNull, reason: lan);
      expect(serverUrlProblem(lan, allowLanHttp: false), isNotNull, reason: lan);
    }
    expect(serverUrlProblem('http://maint.example.com', allowLanHttp: true), isNotNull);
    expect(serverUrlProblem('http://8.8.8.8:4000', allowLanHttp: true), isNotNull);
    expect(serverUrlProblem('http://172.32.0.1', allowLanHttp: true), isNotNull);
    expect(serverUrlProblem('ftp://192.168.1.10', allowLanHttp: true), isNotNull);
    expect(serverUrlProblem('', allowLanHttp: true), isNotNull);
  });

  test('debug and test builds keep the LAN workflow', () {
    expect(kAllowLanHttp, isTrue);
  });
}

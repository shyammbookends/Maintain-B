import 'package:bookends_maintenance/screens/shared/asset_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('QR labels open assets, parts and locations', () {
    expect(parseScan('https://cmms.example.in/a/7Hq2kLmN9pQr'), (kind: ScanKind.asset, code: '7Hq2kLmN9pQr'));
    expect(parseScan('https://cmms.example.in/p/AbCdEfGh12'), (kind: ScanKind.part, code: 'AbCdEfGh12'));
    expect(parseScan('http://10.0.0.5:5173/l/ZZyyXXww99?x=1'), (kind: ScanKind.location, code: 'ZZyyXXww99'));
    expect(parseScan('7Hq2kLmN9pQr'), (kind: ScanKind.asset, code: '7Hq2kLmN9pQr'));
  });

  test('barcodes and typed numbers are looked up as part SKUs', () {
    expect(parseScan('8901234567890', barcode: true), (kind: ScanKind.barcode, code: '8901234567890'));
    expect(parseScan('FLT-0042', barcode: true), (kind: ScanKind.barcode, code: 'FLT-0042'));
    expect(parseScan(' 8901234567890 '), (kind: ScanKind.barcode, code: '8901234567890'));
    expect(parseScan('FLT-0042'), (kind: ScanKind.barcode, code: 'FLT-0042'));
  });

  test('other text is rejected', () {
    expect(parseScan(''), isNull);
    expect(parseScan('https://example.com/menu'), isNull);
    expect(parseScan('hello there friend'), isNull);
  });
}

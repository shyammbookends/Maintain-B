// Add / edit calls the admin app makes (Super Admin and managers only).
//   flutter test test/manager_contract_test.dart --dart-define=API_TEST_URL=http://localhost:4101
import 'dart:io';

import 'package:bookends_maintenance/core/api.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_test/flutter_test.dart';

const server = String.fromEnvironment('API_TEST_URL');
final _sessions = <String, ApiClient>{};

Future<ApiClient> signIn(String id, String pw) async {
  final cached = _sessions[id];
  if (cached != null) return cached;
  final api = ApiClient.withJar(CookieJar())..server = server;
  await api.login(id, pw);
  return _sessions[id] = api;
}

void main() {
  final skip = server.isEmpty;

  test('super admin adds and edits a restaurant with locations', () async {
    final api = await signIn('admin@bookends.local', 'ChangeMe123');
    final body = {
      'code': 'BKD-SAT', 'name': 'Bookends Café – Satellite', 'addressLine1': 'Satellite Road', 'addressLine2': '',
      'city': 'Ahmedabad', 'state': 'Gujarat', 'postalCode': '380015', 'phone': '+917926400606', 'email': '',
      'opensAt': '08:00', 'closesAt': '23:00', 'status': 'ACTIVE', 'managerId': '', 'contactName': 'Desk',
    };
    final r = await api.postData<Map>('/restaurants', body);
    await api.put('/restaurants/${r['id']}', {...body, 'opensAt': '09:00', 'email': 'sat@bookends.in'});
    final loc = await api.postData<Map>('/locations',
        {'restaurantId': r['id'], 'name': 'Tandoor Section', 'type': 'HOT_KITCHEN', 'description': ''});
    await api.put('/locations/${loc['id']}',
        {'restaurantId': r['id'], 'name': 'Tandoor Area', 'type': 'HOT_KITCHEN', 'description': 'Two tandoors'});
    final s = await api.refresh();
    expect((s!['user']['restaurants'] as List).any((x) => x['code'] == 'BKD-SAT'), true);
  }, skip: skip);

  test('manager adds asset, part, stock, vendor, team, user, document, PO; edits a work order', () async {
    final m = await signIn('manager', 'Demo@1234');
    final rid = (await m.getData<List>('/me/restaurants')).first['id'];
    final cat = await m.postData<Map>('/asset-categories', {'name': 'Tandoor'});
    final locs = await m.getData<List>('/locations', {'restaurantId': rid});
    final asset = await m.postData<Map>('/assets', {
      'name': 'Clay Tandoor', 'categoryId': cat['id'], 'restaurantId': rid, 'locationId': locs.first['id'],
      'criticality': 'HIGH', 'installDate': '2026-01-10', 'manufacturer': 'Desi Ovens', 'model': 'T-36',
      'serialNumber': 'T36-001', 'purchaseDate': '2026-01-05', 'purchaseCost': '45000',
      'warrantyStart': '2026-01-10', 'warrantyEnd': '2027-01-10', 'notes': '', 'vendorId': '',
    });
    await m.put('/assets/${asset['id']}/status', {'status': 'WARNING', 'note': 'Crack in the clay'});

    final vendor = await m.postData<Map>('/vendors', {
      'name': 'Desi Ovens Service', 'contactName': 'Ramesh', 'email': '', 'phone': '+919800011122', 'altPhone': '',
      'address': '', 'city': 'Ahmedabad', 'categories': ['KITCHEN_EQUIPMENT'], 'taxId': '', 'notes': '',
      'restaurantIds': [rid],
    });
    final part = await m.postData<Map>('/parts', {
      'name': 'Tandoor clay lining', 'partNumber': 'TND-CLAY', 'sku': '', 'category': 'Kitchen', 'unit': 'pcs',
      'unitCost': 2500, 'minStock': 1, 'preferredVendorId': vendor['id'], 'storageLocation': 'Store',
      'description': '',
    });
    await m.post('/parts/${part['id']}/adjust',
        {'restaurantId': rid, 'mode': 'RECEIVE', 'quantity': 3, 'unitCost': 2500, 'reason': 'Opening stock'});
    final people = await m.getData<List>('/work-orders/workload', {'restaurantId': rid});
    await m.post('/parts/${part['id']}/adjust', {
      'restaurantId': rid, 'mode': 'ISSUE', 'quantity': 1,
      'issuedToId': people.first['user']['id'], 'reason': 'For repair',
    });
    expect((await m.getData<Map>('/parts/${part['id']}'))['totalQuantity'], 2);

    final users = (await m.get('/users', {'pageSize': 100, 'status': 'ACTIVE'}) as Map)['data'] as List;
    await m.post('/teams', {
      'name': 'Tandoor crew', 'description': '', 'restaurantId': rid,
      'leadUserId': users.first['id'], 'memberIds': [users.first['id']],
    });
    final roles = await m.getData<List>('/roles/assignable');
    final worker = roles.firstWhere((r) => r['systemKey'] == 'WORKER');
    final created = await m.postData<Map>('/users', {
      'firstName': 'Kiran', 'lastName': 'Rana', 'email': '', 'username': 'kiran.rana', 'phone': '+919800022233',
      'jobTitle': 'Helper', 'hourlyRate': '150', 'roleId': worker['id'], 'restaurantIds': [rid], 'password': '',
    });
    expect(created['temporaryPassword'], isNotNull);

    final pdf = File('${Directory.systemTemp.path}/mx_doc.pdf')
      ..writeAsStringSync('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
          '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    final doc = await m.uploadDocument(pdf, {
      'ownerType': 'ASSET', 'ownerId': asset['id'].toString(), 'title': 'Tandoor warranty',
      'docType': 'WARRANTY', 'issuedAt': '2026-01-10', 'expiresAt': '2027-01-10',
    });
    expect(doc['title'], 'Tandoor warranty');

    final po = await m.postData<Map>('/purchase-orders', {
      'vendorId': vendor['id'], 'restaurantId': rid, 'expectedAt': '', 'tax': 450, 'notes': '',
      'items': [
        {'partId': part['id'], 'qtyOrdered': 2, 'unitCost': 2500, 'description': ''}
      ],
    });
    await m.post('/purchase-orders/${po['id']}/submit');
    final boss = await signIn('admin@bookends.local', 'ChangeMe123');
    await boss.post('/purchase-orders/${po['id']}/approve');
    await m.post('/purchase-orders/${po['id']}/order');
    final full = await m.getData<Map>('/purchase-orders/${po['id']}');
    final rec = await m.postData<Map>('/purchase-orders/${po['id']}/receive', {
      'lines': [
        for (final it in full['items'] as List) {'itemId': it['id'], 'quantity': it['qtyOrdered']}
      ],
      'notes': '',
    });
    expect(rec['status'], 'RECEIVED');

    final list = (await m.get('/work-orders', {'q': 'WO-000002', 'pageSize': 5}) as Map)['data'] as List;
    final d = await m.getData<Map>('/work-orders/${list.first['id']}');
    expect(d['actions']['edit'], true);
    final upd = await m.putData<Map>('/work-orders/${d['id']}', {
      'title': 'Replace cold room door gasket (urgent)', 'description': d['description'] ?? '',
      'category': d['category'], 'priority': 'CRITICAL', 'restaurantId': d['restaurant']['id'],
      'locationId': d['location']?['id'] ?? '', 'assetId': d['asset']?['id'] ?? '', 'dueDate': d['dueDate'] ?? '',
      'estimatedMinutes': ?d['estimatedMinutes'],
    });
    expect(upd['priority'], 'CRITICAL');
  }, skip: skip);

  test('there are exactly three fixed roles', () async {
    final a = await signIn('admin@bookends.local', 'ChangeMe123');
    final roles = await a.getData<List>('/roles');
    expect(roles.map((r) => r['systemKey']).toSet(), {'SUPER_ADMIN', 'ADMIN', 'WORKER'});
    expect(roles.every((r) => r['locked'] == true), true);
  }, skip: skip);

  test('managers can remove what they added', () async {
    final m = await signIn('manager', 'Demo@1234');
    final rid = (await m.getData<List>('/me/restaurants')).first['id'];
    final loc = await m.postData<Map>('/locations', {'restaurantId': rid, 'name': 'Temp area', 'type': 'OTHER', 'description': ''});
    await m.delete('/locations/${loc['id']}');
    final cats = await m.getData<List>('/asset-categories');
    final asset = await m.postData<Map>('/assets', {
      'name': 'Temp fridge', 'categoryId': cats.first['id'], 'restaurantId': rid, 'locationId': '', 'criticality': 'LOW',
      'installDate': '', 'manufacturer': '', 'model': '', 'serialNumber': '', 'purchaseDate': '', 'purchaseCost': '',
      'warrantyStart': '', 'warrantyEnd': '', 'notes': '', 'vendorId': '',
    });
    final pdf = File('${Directory.systemTemp.path}/mx_doc2.pdf')
      ..writeAsStringSync('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
          '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    final doc = await m.uploadDocument(pdf, {
      'ownerType': 'ASSET', 'ownerId': asset['id'].toString(), 'title': 'Temp doc', 'docType': 'OTHER', 'issuedAt': '', 'expiresAt': '',
    });
    await m.delete('/documents/${doc['id']}');
    await m.delete('/assets/${asset['id']}');
    final part = await m.postData<Map>('/parts', {
      'name': 'Temp part', 'partNumber': 'TMP-1', 'sku': '', 'category': '', 'unit': 'pcs', 'unitCost': 10,
      'minStock': 0, 'preferredVendorId': '', 'storageLocation': '', 'description': '',
    });
    await m.delete('/parts/${part['id']}');
    final v = await m.postData<Map>('/vendors', {
      'name': 'Temp vendor', 'contactName': '', 'email': '', 'phone': '', 'altPhone': '', 'address': '', 'city': '',
      'categories': [], 'taxId': '', 'notes': '', 'restaurantIds': [rid],
    });
    await m.delete('/vendors/${v['id']}');
    final t = await m.postData<Map>('/teams', {'name': 'Temp team', 'description': '', 'restaurantId': rid, 'leadUserId': null, 'memberIds': []});
    await m.delete('/teams/${t['id']}');
    final boss = await signIn('admin@bookends.local', 'ChangeMe123');
    final r = (await boss.getData<List>('/restaurants')).firstWhere((x) => x['code'] == 'BKD-SAT');
    await boss.delete('/restaurants/${r['id']}');
  }, skip: skip);

  test('workers cannot add or edit', () async {
    final w = await signIn('suresh.yadav', 'Demo@1234');
    final rid = (await w.getData<List>('/me/restaurants')).first['id'];
    expect(
      () => w.post('/locations', {'restaurantId': rid, 'name': 'Nope', 'type': 'OTHER', 'description': ''}),
      throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)),
    );
  }, skip: skip);
}

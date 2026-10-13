import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/work_order_extras.dart';
import '../admin/editors.dart';
import 'report_screen.dart';
import 'work_order_screen.dart';

/// Assets the user can see (worker: My assets, admin: Assets tab).
class AssetsScreen extends StatefulWidget {
  const AssetsScreen({super.key, this.embedded = false});
  final bool embedded;
  @override
  State<AssetsScreen> createState() => _AssetsScreenState();
}

class _AssetsScreenState extends State<AssetsScreen> {
  String _q = '';
  String? _status;
  final _key = GlobalKey<DataViewState<List>>();

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final list = Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: TextField(
          decoration: InputDecoration(
              hintText: t('Search assets'), prefixIcon: const Icon(Icons.search), isDense: true),
          onSubmitted: (v) {
            _q = v;
            _key.currentState?.reload();
          },
        ),
      ),
      SizedBox(
        height: 44,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), children: [
          for (final s in const [null, 'OPERATIONAL', 'WARNING', 'UNDER_MAINTENANCE', 'BROKEN'])
            Padding(
              padding: const EdgeInsets.only(right: 8, top: 6),
              child: ChoiceChip(
                label: Text(s == null ? t('All') : label(s)),
                selected: _status == s,
                onSelected: (_) {
                  setState(() => _status = s);
                  _key.currentState?.reload();
                },
              ),
            ),
        ]),
      ),
      Expanded(
        child: DataView<List>(
          key: _key,
          load: () async => (await api.get('/assets', {
            'pageSize': 100,
            'q': _q,
            'status': _status,
            'sort': 'name:asc',
          }) as Map)['data'] as List,
          builder: (context, items, _) => items.isEmpty
              ? ListView(children: [EmptyState(icon: Icons.inventory_2_outlined, title: t('No assets found'))])
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, i) => AssetCard(asset: items[i] as Map),
                ),
        ),
      ),
    ]);
    if (widget.embedded) return list;
    return Scaffold(appBar: AppBar(title: Text(t('My assets'))), body: list);
  }
}

class AssetCard extends StatelessWidget {
  const AssetCard({super.key, required this.asset});
  final Map asset;
  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: () => Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => AssetScreen(id: asset['id'].toString()))),
      child: Row(children: [
        const IconChip(Icons.kitchen_outlined, size: 42),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(asset['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
            const SizedBox(height: 2),
            Text(
              [asset['assetCode'], (asset['location'] as Map?)?['name'], (asset['restaurant'] as Map?)?['name']]
                  .whereType<String>()
                  .join(' · '),
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          ]),
        ),
        const SizedBox(width: 8),
        StatusBadge(asset['status']?.toString()),
      ]),
    );
  }
}

class AssetScreen extends StatelessWidget {
  const AssetScreen({super.key, this.id, this.publicId});
  final String? id;
  final String? publicId;

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(t('Asset'))),
      body: DataView<Json>(
        load: () => id != null
            ? api.getData<Json>('/assets/$id')
            : api.getData<Json>('/assets/by-public/$publicId'),
        builder: (context, a, reload) {
          final open = (a['openWorkOrders'] as List?) ?? const [];
          final recent = (a['recentWorkOrders'] as List?) ?? const [];
          final history = (a['history'] as List?) ?? const [];
          final restaurant = a['restaurant'] as Map?;
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Row(children: [
                const IconChip(Icons.kitchen_outlined, size: 52, brand: true),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(a['name'].toString(), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                    Text('${a['assetCode']} · ${(a['category'] as Map?)?['name'] ?? ''}',
                        style: const TextStyle(color: AppColors.muted)),
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, children: [
                      StatusBadge(a['status']?.toString()),
                      Pill(t('{level} criticality', {'level': label(a['criticality'])}), tone: priorityTone(a['criticality']?.toString())),
                    ]),
                  ]),
                ),
              ]),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => ReportScreen(
                  restaurantId: restaurant?['id']?.toString(),
                  assetId: a['id'].toString(),
                  assetName: a['name'].toString(),
                ),
              )),
              icon: const Icon(Icons.campaign_outlined),
              label: Text(t('Report a problem')),
            ),
            AssetAdminActions(asset: a, onChanged: reload),
            const SizedBox(height: 16),
            if (open.isNotEmpty) ...[
              SectionTitle(t('Open work')),
              for (final w in open)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(
                    task: w as Map,
                    onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => WorkOrderScreen(id: w['id'].toString()))),
                  ),
                ),
              const SizedBox(height: 6),
            ],
            SectionTitle(t('Details')),
            AppCard(
              child: Column(children: [
                InfoRow(t('Restaurant'), restaurant?['name']?.toString()),
                InfoRow(t('Location'), (a['location'] as Map?)?['name']?.toString()),
                InfoRow(t('Manufacturer'), a['manufacturer']?.toString()),
                InfoRow(t('Model'), a['model']?.toString()),
                InfoRow(t('Serial no.'), a['serialNumber']?.toString()),
                InfoRow(t('Installed'), fmtDate(a['installDate'])),
                InfoRow(t('Warranty till'), fmtDate(a['warrantyEnd'])),
                if (a['vendor'] != null) InfoRow(t('Vendor'), '${(a['vendor'] as Map)['name']}  ${(a['vendor'] as Map)['phone'] ?? ''}'),
                if (a['purchaseCost'] != null) InfoRow(t('Purchase cost'), fmtMoney(a['purchaseCost'])),
                if ((a['downtimeHours90d'] ?? 0) > 0) InfoRow(t('Downtime (90 d)'), '${a['downtimeHours90d']} h'),
              ]),
            ),
            if (a['notes'] != null) ...[
              const SizedBox(height: 12),
              Callout(tone: 'neutral', text: a['notes'].toString()),
            ],
            const SizedBox(height: 16),
            MetersSection(
              // A new copy of the asset (pull to refresh) reloads the meters too.
              refresh: identityHashCode(a),
              showEmpty: context.read<Session>().can('meters:edit'),
              load: () => api.getData<List>('/assets/${a['id']}/meters'),
              record: (m, body) => api.postData<List>('/assets/${a['id']}/meters/${m['id']}/readings', body),
            ),
            if (recent.isNotEmpty) ...[
              const SizedBox(height: 4),
              SectionTitle(t('Recent work')),
              for (final w in recent)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(
                    task: w as Map,
                    onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => WorkOrderScreen(id: w['id'].toString()))),
                  ),
                ),
            ],
            if (history.isNotEmpty) ...[
              const SizedBox(height: 16),
              SectionTitle(t('History')),
              AppCard(
                child: Column(children: [
                  for (final h in history)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.history, size: 20),
                      title: Text((h as Map)['note']?.toString() ?? label(h['eventType'])),
                      subtitle: Text('${label(h['eventType'])} · ${fmtDate(h['occurredAt'])}'),
                    ),
                ]),
              ),
            ],
          ]);
        },
      ),
    );
  }
}

// ---------------------------------------------------------------- scanning

// UI text for scanning (kept together).
String get _tScanHint => t('Point the camera at a QR label or a barcode');
String get _tScanManual => t('Or type the code on the label');
String get _tScanOpen => t('verb|Open');
String get _tScanNotCode => t('This is not a Bookends QR code or barcode.');
String _tNoPart(String code) => t('No part found for barcode {code}.', {'code': code});
String get _tPickPart => t('Which part?');
String get _tLocation => t('Location');
String get _tReportHere => t('Report a problem here');
String get _tEquipmentHere => t('Equipment here');
String get _tOpenWorkHere => t('Open work here');
String get _tInside => t('Inside');
String get _tNoEquipment => t('No equipment at this location.');

/// What a scanned or typed code points to.
enum ScanKind { asset, part, location, barcode }

/// Reads a printed label: `<site>/a/<id>` (asset), `/p/<id>` (part), `/l/<id>`
/// (location), a bare public id (asset), or a 1D barcode / typed SKU (part).
({ScanKind kind, String code})? parseScan(String raw, {bool barcode = false}) {
  final text = raw.trim();
  if (text.isEmpty) return null;
  final m = RegExp(r'/([alp])/([0-9A-Za-z]{8,40})(?=[/?#]|$)').firstMatch(text);
  if (m != null) {
    final kind = switch (m.group(1)) {
      'p' => ScanKind.part,
      'l' => ScanKind.location,
      _ => ScanKind.asset,
    };
    return (kind: kind, code: m.group(2)!);
  }
  // EAN-13, Code 128 and other 1D codes are part SKUs (or part numbers).
  if (barcode) return (kind: ScanKind.barcode, code: text);
  if (text.contains('://')) return null;
  // Digits only (EAN/UPC typed by hand) are part barcodes, not label codes.
  if (RegExp(r'^\d{6,14}$').hasMatch(text)) return (kind: ScanKind.barcode, code: text);
  if (RegExp(r'^[0-9A-Za-z]{8,40}$').hasMatch(text)) return (kind: ScanKind.asset, code: text);
  if (text.length <= 60 && !text.contains(' ')) return (kind: ScanKind.barcode, code: text);
  return null;
}

/// Scans asset, part and location QR labels, and part barcodes (EAN-13, Code 128…).
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key, this.embedded = false});
  final bool embedded;
  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const [
      BarcodeFormat.qrCode,
      BarcodeFormat.ean13,
      BarcodeFormat.ean8,
      BarcodeFormat.upcA,
      BarcodeFormat.upcE,
      BarcodeFormat.code128,
      BarcodeFormat.code39,
    ],
  );
  bool _handled = false;
  bool _looking = false;
  final _manual = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    _manual.dispose();
    super.dispose();
  }

  Future<void> _open(String raw, {bool barcode = false}) async {
    final target = parseScan(raw, barcode: barcode);
    if (target == null) {
      toast(context, _tScanNotCode, error: true);
      return;
    }
    _handled = true;
    try {
      final page = switch (target.kind) {
        ScanKind.asset => AssetScreen(publicId: target.code),
        ScanKind.part => PartDetailScreen(publicId: target.code),
        ScanKind.location => LocationScreen(publicId: target.code),
        ScanKind.barcode => await _partByBarcode(target.code),
      };
      if (page != null && mounted) await Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
    } finally {
      _handled = false;
    }
  }

  /// Looks the barcode up as a part SKU or part number (parts search).
  Future<Widget?> _partByBarcode(String code) async {
    setState(() => _looking = true);
    try {
      final api = apiOf(context);
      final list = (await api.get('/parts', {'q': code, 'pageSize': 10}) as Map)['data'] as List;
      final lower = code.toLowerCase();
      bool same(dynamic v) => v != null && v.toString().toLowerCase() == lower;
      final exact = [
        for (final p in list)
          if (same((p as Map)['sku']) || same(p['partNumber'])) p,
      ];
      final hits = exact.isNotEmpty ? exact : list;
      if (hits.isEmpty) {
        if (mounted) toast(context, _tNoPart(code), error: true);
        return null;
      }
      if (hits.length == 1) return PartDetailScreen(id: (hits.first as Map)['id'].toString());
      if (!mounted) return null;
      final id = await pickOption<String>(context, _tPickPart, [
        for (final p in hits) ((p as Map)['id'].toString(), '${p['name']} · ${p['sku'] ?? p['partNumber']}'),
      ]);
      return id == null ? null : PartDetailScreen(id: id);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
      return null;
    } finally {
      if (mounted) setState(() => _looking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = Column(children: [
      Expanded(
        child: Stack(children: [
          MobileScanner(
            controller: _controller,
            onDetect: (capture) {
              if (_handled) return;
              final b = capture.barcodes.firstOrNull;
              final v = b?.rawValue;
              if (v != null) _open(v, barcode: b!.format != BarcodeFormat.qrCode);
            },
            errorBuilder: (context, error) => Container(
              color: Colors.black,
              alignment: Alignment.center,
              padding: const EdgeInsets.all(24),
              child: Text(t('Could not open the camera: {error}', {'error': error.errorCode.name}),
                  textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
            ),
          ),
          Center(
            child: Container(
              width: 260,
              height: 220,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white, width: 3),
                borderRadius: BorderRadius.circular(20),
              ),
            ),
          ),
          if (_looking) const Center(child: CircularProgressIndicator(color: Colors.white)),
          Positioned(
            left: 0,
            right: 0,
            bottom: 24,
            child: Text(_tScanHint, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 14)),
          ),
        ]),
      ),
      Container(
        color: Colors.white,
        padding: const EdgeInsets.all(16),
        child: Row(children: [
          Expanded(
            child: TextField(
              controller: _manual,
              textInputAction: TextInputAction.go,
              onSubmitted: (v) => _open(v),
              decoration: InputDecoration(hintText: _tScanManual, isDense: true),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(64, 46)),
            onPressed: _looking ? null : () => _open(_manual.text),
            child: Text(_tScanOpen),
          ),
        ]),
      ),
    ]);
    if (widget.embedded) return body;
    return Scaffold(appBar: AppBar(title: Text(t('Scan'))), body: body);
  }
}

/// Where a scanned location QR lands (like the web /l/:publicId page): where you
/// are, the equipment here, open work here, and "Report a problem here".
class LocationScreen extends StatelessWidget {
  const LocationScreen({super.key, required this.publicId});
  final String publicId;

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(_tLocation)),
      body: DataView<Json>(
        load: () => api.getData<Json>('/locations/by-public/$publicId'),
        builder: (context, l, reload) {
          final restaurant = l['restaurant'] as Map?;
          final path = [
            for (final p in (l['path'] as List?) ?? const []) (p as Map)['name'].toString(),
            l['name'].toString(),
          ].join(' › ');
          final children = (l['children'] as List?) ?? const [];
          final assets = (l['assets'] as List?) ?? const [];
          final open = (l['openWorkOrders'] as List?) ?? const [];
          final canReport = (l['can'] as Map?)?['report'] == true;
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Row(children: [
                const IconChip(Icons.place_outlined, size: 52, brand: true),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(l['name'].toString(), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                    Text(
                      [restaurant?['name']?.toString(), label(l['type'])].whereType<String>().where((x) => x.isNotEmpty).join(' · '),
                      style: const TextStyle(color: AppColors.muted),
                    ),
                    if (path != l['name'].toString())
                      Text(path, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                  ]),
                ),
              ]),
            ),
            if (l['description'] != null && l['description'].toString().isNotEmpty) ...[
              const SizedBox(height: 12),
              Callout(tone: 'neutral', text: l['description'].toString()),
            ],
            if (canReport) ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => ReportScreen(
                    restaurantId: restaurant?['id']?.toString(),
                    locationId: l['id'].toString(),
                    locationName: l['name'].toString(),
                  ),
                )),
                icon: const Icon(Icons.campaign_outlined),
                label: Text(_tReportHere),
              ),
            ],
            if (children.isNotEmpty) ...[
              const SizedBox(height: 16),
              SectionTitle(_tInside),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final c in children)
                  ActionChip(
                    avatar: const Icon(Icons.place_outlined, size: 18),
                    label: Text((c as Map)['name'].toString()),
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => c['publicId'] != null
                          ? LocationScreen(publicId: c['publicId'].toString())
                          : SubLocationScreen(location: c, restaurant: restaurant, parent: l['name']?.toString(), canReport: canReport),
                    )),
                  ),
              ]),
            ],
            const SizedBox(height: 16),
            SectionTitle(_tEquipmentHere),
            if (assets.isEmpty)
              Text(_tNoEquipment, style: const TextStyle(color: AppColors.muted))
            else
              for (final a in assets) Padding(padding: const EdgeInsets.only(bottom: 10), child: AssetCard(asset: a as Map)),
            if (open.isNotEmpty) ...[
              const SizedBox(height: 6),
              SectionTitle(_tOpenWorkHere),
              for (final w in open)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(
                    task: w as Map,
                    onTap: () => Navigator.of(context)
                        .push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: w['id'].toString()))),
                  ),
                ),
            ],
          ]);
        },
      ),
    );
  }
}

/// A location inside a scanned location. The server only looks locations up by
/// their QR code, so this shows what the list of assets can: the equipment kept
/// there, and "Report a problem here".
class SubLocationScreen extends StatelessWidget {
  const SubLocationScreen({super.key, required this.location, this.restaurant, this.parent, this.canReport = false});
  final Map location;
  final Map? restaurant;
  final String? parent;
  final bool canReport;

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final name = location['name'].toString();
    return Scaffold(
      appBar: AppBar(title: Text(_tLocation)),
      body: DataView<List>(
        load: () async => (await api.get('/assets', {
          'locationId': location['id'],
          'pageSize': 100,
          'sort': 'name:asc',
        }) as Map)['data'] as List,
        builder: (context, assets, _) => ListView(padding: const EdgeInsets.all(16), children: [
          AppCard(
            child: Row(children: [
              const IconChip(Icons.place_outlined, size: 52, brand: true),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                  Text(
                    [restaurant?['name']?.toString(), if (location['type'] != null) label(location['type'])]
                        .whereType<String>()
                        .where((x) => x.isNotEmpty)
                        .join(' · '),
                    style: const TextStyle(color: AppColors.muted),
                  ),
                  if (parent != null) Text('$parent › $name', style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                ]),
              ),
            ]),
          ),
          if (canReport) ...[
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => ReportScreen(
                  restaurantId: restaurant?['id']?.toString(),
                  locationId: location['id'].toString(),
                  locationName: name,
                ),
              )),
              icon: const Icon(Icons.campaign_outlined),
              label: Text(_tReportHere),
            ),
          ],
          const SizedBox(height: 16),
          SectionTitle(_tEquipmentHere),
          if (assets.isEmpty)
            Text(_tNoEquipment, style: const TextStyle(color: AppColors.muted))
          else
            for (final a in assets) Padding(padding: const EdgeInsets.only(bottom: 10), child: AssetCard(asset: a as Map)),
        ]),
      ),
    );
  }
}

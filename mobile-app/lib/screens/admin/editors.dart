import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/forms.dart';

/*
 * Add / edit screens for the admin app. Only Super Admin and managers (Admin
 * role) reach them: every entry point checks `canManage`, and the API checks
 * the same permissions again.
 */

/// True for Super Admin and Admin-kind roles holding the permission.
bool canManage(BuildContext context, String permission) {
  final s = context.read<Session>();
  return s.isAdmin && s.can(permission);
}

Future<bool> openEditor(BuildContext context, Widget screen) async =>
    await Navigator.of(context).push<bool>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => screen)) == true;

const kLocationTypes = [
  'KITCHEN', 'HOT_KITCHEN', 'COLD_KITCHEN', 'PREPARATION', 'DISHWASHING', 'DINING', 'STORAGE',
  'BAR', 'UTILITY', 'OFFICE', 'BUILDING', 'FLOOR', 'AREA', 'ROOM', 'OTHER',
];
const kVendorCategories = [
  'REFRIGERATION', 'AC', 'ELECTRICAL', 'PLUMBING', 'GAS', 'FIRE_SAFETY', 'KITCHEN_EQUIPMENT', 'PEST_CONTROL', 'OTHER',
];
const kDocTypes = ['LICENSE', 'CERTIFICATE', 'AMC', 'CONTRACT', 'MANUAL', 'WARRANTY', 'INVOICE', 'SERVICE', 'OTHER'];
const kCriticality = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

Future<List> _list(ApiClient api, String path, [Map<String, dynamic>? q]) async {
  final r = await api.get(path, q);
  return (r as Map)['data'] as List;
}

List<(String?, String)> _restaurantOptions(BuildContext context) => [
      for (final r in context.read<Session>().restaurants) (r['id'].toString(), r['name'].toString()),
    ];

/// Loads lookup lists once for a form.
mixin _Lookups<T extends StatefulWidget> on State<T> {
  ApiClient get api => apiOf(context);
  bool busy = false;
  void setBusy(bool v) => setState(() => busy = v);
}

// ================================================================ restaurants

class RestaurantForm extends StatefulWidget {
  const RestaurantForm({super.key, this.existing});
  final Json? existing;
  @override
  State<RestaurantForm> createState() => _RestaurantFormState();
}

class _RestaurantFormState extends State<RestaurantForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _code = TextEditingController(text: e['code'] ?? '');
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _a1 = TextEditingController(text: e['addressLine1'] ?? '');
  late final _a2 = TextEditingController(text: e['addressLine2'] ?? '');
  late final _city = TextEditingController(text: e['city'] ?? '');
  late final _state = TextEditingController(text: e['state'] ?? 'Gujarat');
  late final _pin = TextEditingController(text: e['postalCode'] ?? '');
  late final _phone = TextEditingController(text: e['phone'] ?? '');
  late final _email = TextEditingController(text: e['email'] ?? '');
  late final _contact = TextEditingController(text: e['contactName'] ?? '');
  late String _opens = e['opensAt'] ?? '08:00';
  late String _closes = e['closesAt'] ?? '23:00';
  late String _status = e['status'] ?? 'ACTIVE';
  late String? _managerId = (e['manager'] as Map?)?['id'];
  List _users = const [];

  @override
  void initState() {
    super.initState();
    _list(api, '/users', {'pageSize': 100, 'status': 'ACTIVE'}).then((u) {
      if (mounted) setState(() => _users = u);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? t('Edit restaurant') : t('Add restaurant'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, t('Restaurant name'), required: true, hint: 'Bookends Café – Satellite'),
        Field(_code, t('Code'), required: true, hint: 'BKD-SAT', helper: t('Capital letters, numbers and -, up to 12')),
        Field(_a1, t('Address line 1')),
        Field(_a2, t('Address line 2')),
        Row(children: [
          Expanded(child: Field(_city, t('City'))),
          const SizedBox(width: 12),
          Expanded(child: Field(_pin, t('PIN code'), keyboard: TextInputType.number)),
        ]),
        Field(_state, t('State')),
        Field(_phone, t('Phone'), keyboard: TextInputType.phone, hint: '+917926400000'),
        Field(_email, t('Email'), keyboard: TextInputType.emailAddress),
        Row(children: [
          Expanded(child: TimeField(label: t('Opens at'), value: _opens, onChanged: (v) => setState(() => _opens = v))),
          const SizedBox(width: 12),
          Expanded(child: TimeField(label: t('Closes at'), value: _closes, onChanged: (v) => setState(() => _closes = v))),
        ]),
        Pick<String>(
          label: t('Manager'),
          value: _managerId,
          items: [(null, t('None')), for (final u in _users) ((u as Map)['id'].toString(), '${personName(u)} · ${(u['role'] as Map?)?['name'] ?? ''}')],
          onChanged: (v) => setState(() => _managerId = v),
        ),
        Field(_contact, t('Contact person')),
        Pick<String>(
          label: t('Status'),
          value: _status,
          items: [('ACTIVE', t('Active')), ('INACTIVE', t('Inactive'))],
          onChanged: (v) => setState(() => _status = v ?? 'ACTIVE'),
        ),
        SaveButton(
          busy: busy,
          text: editing ? t('Save changes') : t('Add restaurant'),
          onPressed: () => saveAndClose(context, setBusy, () async {
            final body = {
              'code': _code.text.trim().toUpperCase(),
              'name': _name.text.trim(),
              'addressLine1': _a1.text.trim(),
              'addressLine2': _a2.text.trim(),
              'city': _city.text.trim(),
              'state': _state.text.trim(),
              'postalCode': _pin.text.trim(),
              'phone': _phone.text.trim(),
              'email': _email.text.trim(),
              'opensAt': _opens,
              'closesAt': _closes,
              'status': _status,
              'managerId': _managerId ?? '',
              'contactName': _contact.text.trim(),
            };
            editing ? await api.put('/restaurants/${e['id']}', body) : await api.post('/restaurants', body);
            if (context.mounted) await context.read<Session>().reloadUser();
          }, editing ? t('Restaurant updated') : t('Restaurant added')),
        ),
      ]),
    );
  }


}

/// One restaurant: details, its locations (add / edit / remove) and actions.
class RestaurantDetailScreen extends StatefulWidget {
  const RestaurantDetailScreen({super.key, required this.id});
  final String id;
  @override
  State<RestaurantDetailScreen> createState() => _RestaurantDetailScreenState();
}

class _RestaurantDetailScreenState extends State<RestaurantDetailScreen> {
  final _key = GlobalKey<DataViewState<(Json, List)>>();

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final canEdit = canManage(context, 'restaurants:edit');
    final canLoc = canManage(context, 'locations:create');
    return Scaffold(
      appBar: AppBar(title: Text(t('Restaurant'))),
      body: DataView<(Json, List)>(
        key: _key,
        load: () async => (
          await api.getData<Json>('/restaurants/${widget.id}'),
          await api.getData<List>('/locations', {'restaurantId': widget.id}),
        ),
        builder: (context, d, reload) {
          final r = d.$1;
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const IconChip(Icons.storefront_outlined, brand: true, size: 46),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(r['name'].toString(), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                      Text(r['code'].toString(), style: const TextStyle(color: AppColors.muted)),
                    ]),
                  ),
                  StatusBadge(r['status']?.toString()),
                ]),
                const SizedBox(height: 10),
                InfoRow(t('Address'), [r['addressLine1'], r['addressLine2'], r['city'], r['state'], r['postalCode']].whereType<String>().where((x) => x.isNotEmpty).join(', ')),
                InfoRow(t('Phone'), r['phone']?.toString()),
                InfoRow(t('Email'), r['email']?.toString()),
                InfoRow(t('Hours'), r['opensAt'] == null ? null : '${r['opensAt']} – ${r['closesAt']}'),
                InfoRow(t('Manager'), r['manager'] == null ? null : personName(r['manager'])),
                InfoRow(t('Contact'), r['contactName']?.toString()),
              ]),
            ),
            if (canEdit) ...[
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      final result = await Navigator.of(context).push<Object>(
                          MaterialPageRoute(fullscreenDialog: true, builder: (_) => RestaurantForm(existing: r)));
                      if (!context.mounted) return;
                      if (result == 'removed') {
                        Navigator.of(context).pop(true); // back to the list, which reloads
                      } else if (result == true) {
                        reload();
                      }
                    },
                    icon: const Icon(Icons.edit_outlined),
                    label: Text(t('Edit')),
                  ),
                ),
              ]),
            ],
            if (canManage(context, 'restaurants:delete')) ...[
              const SizedBox(height: 10),
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: AppColors.danger, foregroundColor: Colors.white),
                onPressed: () async {
                  if (!await confirm(context, t('Remove {name}?', {'name': r['name']}),
                      body: t('It disappears from all lists and pickers. Its work orders, assets and history are kept.'),
                      action: t('Remove'))) {
                    return;
                  }
                  if (!context.mounted) return;
                  if (await runAction(context, () => api.delete('/restaurants/${r['id']}'), success: t('Restaurant removed')) &&
                      context.mounted) {
                    await context.read<Session>().reloadUser();
                    if (context.mounted) Navigator.of(context).pop(true);
                  }
                },
                icon: const Icon(Icons.delete_outline),
                label: Text(t('Remove restaurant')),
              ),
            ],
            const SizedBox(height: 18),
            SectionTitle(t('Locations ({n})', {'n': d.$2.length}),
                trailing: canLoc
                    ? TextButton.icon(
                        onPressed: () async {
                          if (await openEditor(context, LocationForm(restaurantId: widget.id))) reload();
                        },
                        icon: const Icon(Icons.add),
                        label: Text(t('Add location')),
                      )
                    : null),
            if (d.$2.isEmpty) Text(t('No locations yet.'), style: const TextStyle(color: AppColors.muted)),
            for (final l in d.$2)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppCard(
                  onTap: canManage(context, 'locations:edit')
                      ? () async {
                          if (await openEditor(context, LocationForm(restaurantId: widget.id, existing: (l as Map).cast<String, dynamic>()))) {
                            reload();
                          }
                        }
                      : null,
                  child: Row(children: [
                    const IconChip(Icons.place_outlined, size: 36),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text((l as Map)['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text('${label(l['type'])} · ${t('{n} assets', {'n': l['assetCount'] ?? 0})}',
                            style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                      ]),
                    ),
                    if (canManage(context, 'locations:edit')) const Icon(Icons.edit_outlined, size: 18, color: AppColors.muted),
                    if (canManage(context, 'locations:delete'))
                      IconButton(
                        tooltip: t('Remove location'),
                        icon: const Icon(Icons.delete_outline, color: AppColors.dangerFg),
                        onPressed: () async {
                          final count = (l['assetCount'] ?? 0) as int;
                          if (count > 0) {
                            toast(context, t('{name} has {n} asset(s). Move them to another location first.', {'name': l['name'], 'n': count}), error: true);
                            return;
                          }
                          if (!await confirm(context, t('Remove {name}?', {'name': l['name']}), action: t('Remove'))) {
                            return;
                          }
                          if (!context.mounted) return;
                          if (await runAction(context, () => api.delete('/locations/${l['id']}'), success: t('Location removed'))) {
                            reload();
                          }
                        },
                      ),
                  ]),
                ),
              ),
          ]);
        },
      ),
    );
  }
}

class LocationForm extends StatefulWidget {
  const LocationForm({super.key, required this.restaurantId, this.existing});
  final String restaurantId;
  final Json? existing;
  @override
  State<LocationForm> createState() => _LocationFormState();
}

class _LocationFormState extends State<LocationForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _desc = TextEditingController(text: e['description'] ?? '');
  late String _type = e['type'] ?? 'KITCHEN';

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? t('Edit location') : t('Add location'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, t('Name'), required: true, hint: t('e.g. Tandoor Section')),
        Pick<String>(
          label: t('Type'),
          value: _type,
          items: [for (final lt in kLocationTypes) (lt, label(lt))],
          onChanged: (v) => setState(() => _type = v ?? _type),
        ),
        Field(_desc, t('Description'), lines: 2),
        SaveButton(
          busy: busy,
          onPressed: () => saveAndClose(context, setBusy, () async {
            final body = {
              'restaurantId': widget.restaurantId,
              'name': _name.text.trim(),
              'type': _type,
              'description': _desc.text.trim(),
            };
            editing ? await api.put('/locations/${e['id']}', body) : await api.post('/locations', body);
          }, editing ? t('Location updated') : t('Location added')),
        ),
        if (editing && canManage(context, 'locations:delete'))
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: () async {
              if (!await confirm(context, t('Remove this location?'), action: t('Remove'))) return;
              if (!context.mounted) return;
              if (await runAction(context, () => api.delete('/locations/${e['id']}'), success: t('Removed')) && context.mounted) {
                Navigator.of(context).pop(true);
              }
            },
            icon: const Icon(Icons.delete_outline),
            label: Text(t('Remove location')),
          ),
      ]),
    );
  }
}

// ================================================================ assets

class AssetForm extends StatefulWidget {
  const AssetForm({super.key, this.existing, this.restaurantId});
  final Json? existing;
  /// Pre-selected restaurant when adding from another form (e.g. a new work order).
  final String? restaurantId;
  @override
  State<AssetForm> createState() => _AssetFormState();
}

class _AssetFormState extends State<AssetForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _mfr = TextEditingController(text: e['manufacturer'] ?? '');
  late final _model = TextEditingController(text: e['model'] ?? '');
  late final _serial = TextEditingController(text: e['serialNumber'] ?? '');
  late final _cost = TextEditingController(text: numText(e['purchaseCost']));
  late final _notes = TextEditingController(text: e['notes'] ?? '');
  late String? _categoryId = (e['category'] as Map?)?['id'];
  late String? _restaurantId = (e['restaurant'] as Map?)?['id'];
  late String? _locationId = (e['location'] as Map?)?['id'];
  late String? _vendorId = (e['vendor'] as Map?)?['id'];
  late String _criticality = e['criticality'] ?? 'MEDIUM';
  late String _install = dateText(e['installDate']);
  late String _purchase = dateText(e['purchaseDate']);
  late String _wStart = dateText(e['warrantyStart']);
  late String _wEnd = dateText(e['warrantyEnd']);
  List _categories = const [], _locations = const [], _vendors = const [];

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId ??= widget.restaurantId ?? (rs.isNotEmpty ? rs.first['id'].toString() : null);
    _loadLookups();
    _loadLocations();
  }

  Future<void> _loadLookups() async {
    try {
      final c = await api.getData<List>('/asset-categories');
      final v = await _list(api, '/vendors', {'pageSize': 100});
      if (mounted) {
        setState(() {
          _categories = c;
          _vendors = v;
        });
      }
    } catch (_) {}
  }

  Future<void> _loadLocations() async {
    if (_restaurantId == null) return;
    try {
      final l = await api.getData<List>('/locations', {'restaurantId': _restaurantId});
      if (mounted) setState(() => _locations = l);
    } catch (_) {}
  }

  Future<void> _newCategory() async {
    final name = await askText(context, title: t('New category'), hint: t('e.g. Tandoor'), action: t('Add'), minLength: 2);
    if (name == null || !mounted) return;
    try {
      final c = await api.postData<Json>('/asset-categories', {'name': name});
      await _loadLookups();
      setState(() => _categoryId = c['id'].toString());
    } catch (err) {
      if (mounted) toast(context, errorText(err), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? t('Edit asset') : t('Add asset'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, t('Asset name'), required: true, hint: t('e.g. Walk-in Freezer')),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Pick<String>(
              label: t('Category'),
              required: true,
              value: _categoryId,
              items: [for (final c in _categories) ((c as Map)['id'].toString(), c['name'].toString())],
              onChanged: (v) => setState(() => _categoryId = v),
            ),
          ),
          IconButton(tooltip: t('New category'), onPressed: _newCategory, icon: const Icon(Icons.add_circle_outline, color: AppColors.primary)),
        ]),
        Pick<String>(
          label: t('Restaurant'),
          required: true,
          value: _restaurantId,
          items: _restaurantOptions(context),
          onChanged: (v) {
            setState(() {
              _restaurantId = v;
              _locationId = null;
              _locations = const [];
            });
            _loadLocations();
          },
        ),
        Pick<String>(
          label: t('Location'),
          value: _locationId,
          items: [(null, t('None')), for (final l in _locations) ((l as Map)['id'].toString(), l['name'].toString())],
          onChanged: (v) => setState(() => _locationId = v),
        ),
        Pick<String>(
          label: t('Criticality'),
          value: _criticality,
          items: [for (final c in kCriticality) (c, label(c))],
          onChanged: (v) => setState(() => _criticality = v ?? _criticality),
        ),
        Field(_mfr, t('Manufacturer')),
        Row(children: [
          Expanded(child: Field(_model, t('Model'))),
          const SizedBox(width: 12),
          Expanded(child: Field(_serial, t('Serial no.'))),
        ]),
        Pick<String>(
          label: t('Service vendor'),
          value: _vendorId,
          items: [(null, t('None')), for (final v in _vendors) ((v as Map)['id'].toString(), v['name'].toString())],
          onChanged: (v) => setState(() => _vendorId = v),
        ),
        DateField(label: t('Install date'), value: _install, onChanged: (v) => setState(() => _install = v)),
        DateField(label: t('Purchase date'), value: _purchase, onChanged: (v) => setState(() => _purchase = v)),
        Field(_cost, t('Purchase cost (₹)'), keyboard: const TextInputType.numberWithOptions(decimal: true)),
        DateField(label: t('Warranty start'), value: _wStart, onChanged: (v) => setState(() => _wStart = v)),
        DateField(label: t('Warranty end'), value: _wEnd, onChanged: (v) => setState(() => _wEnd = v)),
        Field(_notes, t('Notes'), lines: 3),
        SaveButton(
          busy: busy,
          text: editing ? t('Save changes') : t('Add asset'),
          onPressed: () {
            if (_categoryId == null || _restaurantId == null) {
              toast(context, t('Select a category and a restaurant'), error: true);
              return;
            }
            saveAndClose(context, setBusy, () async {
              final body = {
                'name': _name.text.trim(),
                'categoryId': _categoryId,
                'restaurantId': _restaurantId,
                'locationId': _locationId ?? '',
                'criticality': _criticality,
                'installDate': _install,
                'manufacturer': _mfr.text.trim(),
                'model': _model.text.trim(),
                'serialNumber': _serial.text.trim(),
                'purchaseDate': _purchase,
                'purchaseCost': _cost.text.trim(),
                'warrantyStart': _wStart,
                'warrantyEnd': _wEnd,
                'notes': _notes.text.trim(),
                'vendorId': _vendorId ?? '',
              };
              editing ? await api.put('/assets/${e['id']}', body) : await api.post('/assets', body);
            }, editing ? t('Asset updated') : t('Asset added'));
          },
        ),
      ]),
    );
  }
}

/// Edit / status / archive actions shown on the asset screen for managers.
class AssetAdminActions extends StatelessWidget {
  const AssetAdminActions({super.key, required this.asset, required this.onChanged});
  final Json asset;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    if (!canManage(context, 'assets:edit')) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () async {
              if (await openEditor(context, AssetForm(existing: asset))) onChanged();
            },
            icon: const Icon(Icons.edit_outlined),
            label: Text(t('Edit')),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () async {
              final status = await pickOption<String>(context, t('Change status'), [
                for (final s in const ['OPERATIONAL', 'WARNING', 'UNDER_MAINTENANCE', 'BROKEN', 'INACTIVE', 'RETIRED']) (s, label(s)),
              ]);
              if (status == null || !context.mounted) return;
              final note = await askText(context, title: t('Note (optional)'), action: t('Save'));
              if (note == null || !context.mounted) return;
              if (await runAction(context, () => api.put('/assets/${asset['id']}/status', {'status': status, 'note': note}),
                  success: t('Status updated'))) {
                onChanged();
              }
            },
            icon: const Icon(Icons.sync_alt),
            label: Text(t('Status')),
          ),
        ),
      ]),
      ),
      if (canManage(context, 'assets:delete')) ...[
        const SizedBox(height: 10),
        FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: AppColors.danger, foregroundColor: Colors.white),
          onPressed: () async {
            if (!await confirm(context, t('Remove {name}?', {'name': asset['name']}),
                body: t('It disappears from lists and QR scans. Its work history is kept.'), action: t('Remove'))) {
              return;
            }
            if (!context.mounted) return;
            if (await runAction(context, () => api.delete('/assets/${asset['id']}'), success: t('Asset removed')) &&
                context.mounted) {
              Navigator.of(context).pop(true);
            }
          },
          icon: const Icon(Icons.delete_outline),
          label: Text(t('Remove asset')),
        ),
      ],
    ]);
  }
}

// ================================================================ parts & stock

class PartForm extends StatefulWidget {
  const PartForm({super.key, this.existing});
  final Json? existing;
  @override
  State<PartForm> createState() => _PartFormState();
}

class _PartFormState extends State<PartForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _no = TextEditingController(text: e['partNumber'] ?? '');
  late final _sku = TextEditingController(text: e['sku'] ?? '');
  late final _cat = TextEditingController(text: e['category'] ?? '');
  late final _unit = TextEditingController(text: e['unit'] ?? 'pcs');
  late final _cost = TextEditingController(text: numText(e['unitCost']));
  late final _min = TextEditingController(text: numText(e['minStock'] ?? 0));
  late final _reorder = TextEditingController(text: numText(e['reorderQty']));
  late final _store = TextEditingController(text: e['storageLocation'] ?? '');
  late final _desc = TextEditingController(text: e['description'] ?? '');
  late String? _vendorId = (e['preferredVendor'] as Map?)?['id'];
  List _vendors = const [];

  @override
  void initState() {
    super.initState();
    _list(api, '/vendors', {'pageSize': 100}).then((v) {
      if (mounted) setState(() => _vendors = v);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    const dec = TextInputType.numberWithOptions(decimal: true);
    return Scaffold(
      appBar: AppBar(title: Text(editing ? t('Edit part') : t('Add part'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, t('Part name'), required: true, hint: t('e.g. Door gasket 2 m')),
        Row(children: [
          Expanded(child: Field(_no, t('Part number'), required: true, hint: 'GSK-2M')),
          const SizedBox(width: 12),
          Expanded(child: Field(_sku, t('SKU / barcode'))),
        ]),
        Row(children: [
          Expanded(child: Field(_cat, t('Category'), hint: t('Refrigeration'))),
          const SizedBox(width: 12),
          Expanded(child: Field(_unit, t('Unit'), required: true, hint: 'pcs, kg, m')),
        ]),
        Row(children: [
          Expanded(child: Field(_cost, t('Unit cost (₹)'), required: true, keyboard: dec)),
          const SizedBox(width: 12),
          Expanded(child: Field(_min, t('Minimum stock'), keyboard: dec)),
        ]),
        Field(_reorder, t('Reorder quantity'), keyboard: dec, helper: t('Empty = twice the minimum')),
        Pick<String>(
          label: t('Preferred vendor'),
          value: _vendorId,
          items: [(null, t('None')), for (final v in _vendors) ((v as Map)['id'].toString(), v['name'].toString())],
          onChanged: (v) => setState(() => _vendorId = v),
        ),
        Field(_store, t('Storage location'), hint: 'Rack A-1'),
        Field(_desc, t('Description'), lines: 2),
        SaveButton(
          busy: busy,
          text: editing ? t('Save changes') : t('Add part'),
          onPressed: () => saveAndClose(context, setBusy, () async {
            final reorder = num.tryParse(_reorder.text.trim());
            final body = {
              'name': _name.text.trim(),
              'partNumber': _no.text.trim(),
              'sku': _sku.text.trim(),
              'category': _cat.text.trim(),
              'unit': _unit.text.trim(),
              'unitCost': num.tryParse(_cost.text.trim()) ?? 0,
              'minStock': num.tryParse(_min.text.trim()) ?? 0,
              'reorderQty': ?reorder,
              'preferredVendorId': _vendorId ?? '',
              'storageLocation': _store.text.trim(),
              'description': _desc.text.trim(),
            };
            editing ? await api.put('/parts/${e['id']}', body) : await api.post('/parts', body);
          }, editing ? t('Part updated') : t('Part added')),
        ),
      ]),
    );
  }
}

class PartDetailScreen extends StatefulWidget {
  const PartDetailScreen({super.key, this.id, this.publicId}) : assert(id != null || publicId != null);
  final String? id;

  /// From a scanned part QR label (`/p/<publicId>`).
  final String? publicId;
  @override
  State<PartDetailScreen> createState() => _PartDetailScreenState();
}

class _PartDetailScreenState extends State<PartDetailScreen> {
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(t('Part'))),
      body: DataView<Json>(
        load: () => widget.id != null
            ? api.getData<Json>('/parts/${widget.id}')
            : api.getData<Json>('/parts/by-public/${widget.publicId}'),
        builder: (context, p, reload) {
          final can = (p['can'] as Map?) ?? const {};
          final levels = (p['stockLevels'] as List?) ?? const [];
          final txns = (p['transactions'] as List?) ?? const [];
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(p['name'].toString(), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                Text('${p['partNumber']} · ${p['category'] ?? ''}', style: const TextStyle(color: AppColors.muted)),
                const SizedBox(height: 8),
                InfoRow(t('Unit cost'), '${fmtMoney(p['unitCost'])} / ${p['unit']}'),
                InfoRow(t('Total in stock'), '${p['totalQuantity']} ${p['unit']}'),
                InfoRow(t('Minimum'), '${p['minStock']}'),
                InfoRow(t('Vendor'), (p['preferredVendor'] as Map?)?['name']?.toString()),
                InfoRow(t('Storage'), p['storageLocation']?.toString()),
              ]),
            ),
            if (isManager(context)) ...[
              const SizedBox(height: 10),
              Row(children: [
                if (can['adjust'] == true)
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () async {
                        if (await openEditor(context, StockAdjustForm(part: p))) reload();
                      },
                      icon: const Icon(Icons.swap_vert),
                      label: Text(t('Stock in / out')),
                    ),
                  ),
                if (can['edit'] == true) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        if (await openEditor(context, PartForm(existing: p))) reload();
                      },
                      icon: const Icon(Icons.edit_outlined),
                      label: Text(t('Edit')),
                    ),
                  ),
                ],
                if (can['delete'] == true) ...[
                  const SizedBox(width: 10),
                  IconButton.outlined(
                    color: AppColors.dangerFg,
                    onPressed: () async {
                      if (!await confirm(context, t('Remove this part?'), action: t('Remove'))) return;
                      if (!context.mounted) return;
                      if (await runAction(context, () => api.delete('/parts/${p['id']}'), success: t('Removed')) && context.mounted) {
                        Navigator.of(context).pop(true);
                      }
                    },
                    icon: const Icon(Icons.delete_outline),
                  ),
                ],
              ]),
            ],
            const SizedBox(height: 18),
            SectionTitle(t('Stock by restaurant')),
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (final l in levels)
                  ListTile(
                    title: Text(((l as Map)['restaurant'] as Map)['name'].toString()),
                    subtitle: Text('${t('Min {n}', {'n': l['minStock']})} · ${l['storageLocation'] ?? ''}${(l['reserved'] ?? 0) > 0 ? ' · ${t('{n} reserved', {'n': l['reserved']})}' : ''}'),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text('${l['quantity']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                      if (l['low'] == true) ...[const SizedBox(width: 6), Pill(t('Low'), tone: 'warning')],
                    ]),
                  ),
              ]),
            ),
            if (txns.isNotEmpty) ...[
              const SizedBox(height: 18),
              SectionTitle(t('Recent movements')),
              AppCard(
                padding: EdgeInsets.zero,
                child: Column(children: [
                  for (final tx in txns.take(20))
                    ListTile(
                      dense: true,
                      leading: Icon(((tx as Map)['quantityDelta'] as num) >= 0 ? Icons.south_west : Icons.north_east,
                          color: (tx['quantityDelta'] as num) >= 0 ? AppColors.success : AppColors.danger),
                      title: Text('${label(tx['type'])} ${tx['quantityDelta']} → ${tx['balanceAfter']}'),
                      subtitle: Text('${(tx['restaurant'] as Map?)?['name'] ?? ''} · ${tx['reason'] ?? ''}\n${personName(tx['actor'])} · ${fmtDateTime(tx['createdAt'])}'),
                      isThreeLine: true,
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

bool isManager(BuildContext context) => context.read<Session>().isAdmin;

class StockAdjustForm extends StatefulWidget {
  const StockAdjustForm({super.key, required this.part});
  final Json part;
  @override
  State<StockAdjustForm> createState() => _StockAdjustFormState();
}

class _StockAdjustFormState extends State<StockAdjustForm> with _Lookups {
  static List<(String, String)> get _modes => [
        ('RECEIVE', t('Received (stock in)')),
        ('ISSUE', t('Issued to a person')),
        ('RETURN', t('Returned')),
        ('DAMAGED', t('Damaged')),
        ('REMOVE', t('Removed / lost')),
        ('COUNT', t('Set counted quantity')),
      ];
  String _mode = 'RECEIVE';
  String? _restaurantId;
  String? _issuedTo;
  final _qty = TextEditingController();
  final _cost = TextEditingController();
  final _reason = TextEditingController();
  List _people = const [];

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId = rs.isNotEmpty ? rs.first['id'].toString() : null;
    _loadPeople();
  }

  Future<void> _loadPeople() async {
    if (_restaurantId == null) return;
    try {
      final p = await api.getData<List>('/work-orders/workload', {'restaurantId': _restaurantId});
      if (mounted) setState(() => _people = p);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.part['name'].toString())),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Pick<String>(
          label: t('Restaurant'),
          required: true,
          value: _restaurantId,
          items: _restaurantOptions(context),
          onChanged: (v) {
            setState(() => _restaurantId = v);
            _loadPeople();
          },
        ),
        Pick<String>(
          label: t('What happened?'),
          value: _mode,
          items: [for (final m in _modes) (m.$1, m.$2)],
          onChanged: (v) => setState(() => _mode = v ?? _mode),
        ),
        Field(_qty, _mode == 'COUNT' ? t('Counted quantity') : t('Quantity'), required: true,
            keyboard: const TextInputType.numberWithOptions(decimal: true)),
        if (_mode == 'RECEIVE')
          Field(_cost, t('Unit cost (₹)'), keyboard: const TextInputType.numberWithOptions(decimal: true)),
        if (_mode == 'ISSUE')
          Pick<String>(
            label: t('Issued to'),
            required: true,
            value: _issuedTo,
            items: [for (final p in _people) (((p as Map)['user'] as Map)['id'].toString(), personName(p['user']))],
            onChanged: (v) => setState(() => _issuedTo = v),
          ),
        Field(_reason, t('Reason'), required: true, hint: t('e.g. New stock from vendor')),
        SaveButton(
          busy: busy,
          onPressed: () => saveAndClose(context, setBusy, () async {
            final cost = num.tryParse(_cost.text.trim());
            await api.post('/parts/${widget.part['id']}/adjust', {
              'restaurantId': _restaurantId,
              'mode': _mode,
              'quantity': num.tryParse(_qty.text.trim()) ?? 0,
              if (_mode == 'RECEIVE' && cost != null) 'unitCost': cost,
              if (_mode == 'ISSUE') 'issuedToId': _issuedTo ?? '',
              'reason': _reason.text.trim(),
            });
          }, t('Stock updated')),
        ),
      ]),
    );
  }
}

// ================================================================ vendors

class VendorForm extends StatefulWidget {
  const VendorForm({super.key, this.existing});
  final Json? existing;
  @override
  State<VendorForm> createState() => _VendorFormState();
}

class _VendorFormState extends State<VendorForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _contact = TextEditingController(text: e['contactName'] ?? '');
  late final _email = TextEditingController(text: e['email'] ?? '');
  late final _phone = TextEditingController(text: e['phone'] ?? '');
  late final _alt = TextEditingController(text: e['altPhone'] ?? '');
  late final _address = TextEditingController(text: e['address'] ?? '');
  late final _city = TextEditingController(text: e['city'] ?? '');
  late final _tax = TextEditingController(text: e['taxId'] ?? '');
  late final _notes = TextEditingController(text: e['notes'] ?? '');
  late Set<String> _cats = {for (final c in (e['categories'] as List? ?? const [])) c.toString()};
  late Set<String> _restaurants = {for (final r in (e['restaurants'] as List? ?? const [])) (r as Map)['id'].toString()};

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    final s = context.read<Session>();
    return Scaffold(
      appBar: AppBar(title: Text(editing ? t('Edit vendor') : t('Add vendor'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, t('Vendor name'), required: true),
        Field(_contact, t('Contact person')),
        Row(children: [
          Expanded(child: Field(_phone, t('Phone'), keyboard: TextInputType.phone)),
          const SizedBox(width: 12),
          Expanded(child: Field(_alt, t('Alternate phone'), keyboard: TextInputType.phone)),
        ]),
        Field(_email, t('Email'), keyboard: TextInputType.emailAddress),
        Field(_address, t('Address'), lines: 2),
        Row(children: [
          Expanded(child: Field(_city, t('City'))),
          const SizedBox(width: 12),
          Expanded(child: Field(_tax, t('GSTIN'))),
        ]),
        MultiPick(
          label: t('Services'),
          options: [for (final c in kVendorCategories) (c, label(c))],
          selected: _cats,
          onChanged: (v) => setState(() => _cats = v),
        ),
        MultiPick(
          label: t('Restaurants served'),
          emptyText: s.isSuperAdmin ? t('All restaurants') : t('All my restaurants'),
          options: [for (final r in context.read<Session>().restaurants) (r['id'].toString(), r['name'].toString())],
          selected: _restaurants,
          onChanged: (v) => setState(() => _restaurants = v),
        ),
        Field(_notes, t('Notes'), lines: 3),
        SaveButton(
          busy: busy,
          text: editing ? t('Save changes') : t('Add vendor'),
          onPressed: () => saveAndClose(context, setBusy, () async {
            final body = {
              'name': _name.text.trim(),
              'contactName': _contact.text.trim(),
              'email': _email.text.trim(),
              'phone': _phone.text.trim(),
              'altPhone': _alt.text.trim(),
              'address': _address.text.trim(),
              'city': _city.text.trim(),
              'categories': _cats.toList(),
              'taxId': _tax.text.trim(),
              'notes': _notes.text.trim(),
              // "All" (empty) is Super Admin only; a manager's "all" means all of their restaurants.
              'restaurantIds': _restaurants.isEmpty && !s.isSuperAdmin
                  ? [for (final r in s.restaurants) r['id'].toString()]
                  : _restaurants.toList(),
            };
            editing ? await api.put('/vendors/${e['id']}', body) : await api.post('/vendors', body);
          }, editing ? t('Vendor updated') : t('Vendor added')),
        ),
        if (editing && canManage(context, 'vendors:delete'))
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: () async {
              if (!await confirm(context, t('Remove this vendor?'), action: t('Remove'))) return;
              if (!context.mounted) return;
              if (await runAction(context, () => api.delete('/vendors/${e['id']}'), success: t('Removed')) && context.mounted) {
                Navigator.of(context).pop(true);
              }
            },
            icon: const Icon(Icons.delete_outline),
            label: Text(t('Remove vendor')),
          ),
      ]),
    );
  }
}

// ================================================================ teams

class TeamForm extends StatefulWidget {
  const TeamForm({super.key, this.existing});
  final Json? existing;
  @override
  State<TeamForm> createState() => _TeamFormState();
}

class _TeamFormState extends State<TeamForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _desc = TextEditingController(text: e['description'] ?? '');
  late String? _restaurantId = (e['restaurant'] as Map?)?['id'];
  late String? _leadId = (e['lead'] as Map?)?['id'];
  late Set<String> _members = {for (final m in (e['members'] as List? ?? const [])) (m as Map)['id'].toString()};
  List _users = const [];

  @override
  void initState() {
    super.initState();
    _list(api, '/users', {'pageSize': 100, 'status': 'ACTIVE'}).then((u) {
      if (mounted) setState(() => _users = u);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    final s = context.read<Session>();
    final people = [for (final u in _users) ((u as Map)['id'].toString(), '${personName(u)} · ${(u['role'] as Map?)?['name'] ?? ''}')];
    return Scaffold(
      appBar: AppBar(title: Text(editing ? t('Edit team') : t('Add team'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, t('Team name'), required: true, hint: t('e.g. Night shift maintenance')),
        Field(_desc, t('Description'), lines: 2),
        Pick<String>(
          label: t('Restaurant'),
          value: _restaurantId,
          items: [if (s.isSuperAdmin) (null, t('All restaurants')), ..._restaurantOptions(context)],
          onChanged: (v) => setState(() => _restaurantId = v),
        ),
        MultiPick(label: t('Members'), options: people, selected: _members, onChanged: (v) => setState(() => _members = v)),
        Pick<String>(
          label: t('Team lead'),
          value: _leadId,
          items: [(null, t('None')), for (final p in people) if (_members.contains(p.$1)) (p.$1, p.$2)],
          onChanged: (v) => setState(() => _leadId = v),
        ),
        SaveButton(
          busy: busy,
          text: editing ? t('Save changes') : t('Add team'),
          onPressed: () {
            if (!s.isSuperAdmin && _restaurantId == null) {
              toast(context, t('Select a restaurant'), error: true);
              return;
            }
            saveAndClose(context, setBusy, () async {
              final body = {
                'name': _name.text.trim(),
                'description': _desc.text.trim(),
                'restaurantId': _restaurantId,
                'leadUserId': _leadId != null && _members.contains(_leadId) ? _leadId : null,
                'memberIds': _members.toList(),
              };
              editing ? await api.put('/teams/${e['id']}', body) : await api.post('/teams', body);
            }, editing ? t('Team updated') : t('Team added'));
          },
        ),
        if (editing && canManage(context, 'teams:delete'))
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: () async {
              if (!await confirm(context, t('Remove this team?'), action: t('Remove'))) return;
              if (!context.mounted) return;
              if (await runAction(context, () => api.delete('/teams/${e['id']}'), success: t('Removed')) && context.mounted) {
                Navigator.of(context).pop(true);
              }
            },
            icon: const Icon(Icons.delete_outline),
            label: Text(t('Remove team')),
          ),
      ]),
    );
  }
}

// ================================================================ users

class UserForm extends StatefulWidget {
  const UserForm({super.key, this.existing});
  final Json? existing;
  @override
  State<UserForm> createState() => _UserFormState();
}

class _UserFormState extends State<UserForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _first = TextEditingController(text: e['firstName'] ?? '');
  late final _last = TextEditingController(text: e['lastName'] ?? '');
  late final _email = TextEditingController(text: e['email'] ?? '');
  late final _username = TextEditingController(text: e['username'] ?? '');
  late final _phone = TextEditingController(text: e['phone'] ?? '');
  late final _job = TextEditingController(text: e['jobTitle'] ?? '');
  late final _rate = TextEditingController(text: numText(e['hourlyRate']));
  final _password = TextEditingController();
  late String? _roleId = (e['role'] as Map?)?['id'];
  late Set<String> _restaurants = {for (final r in (e['restaurants'] as List? ?? const [])) (r as Map)['id'].toString()};
  List _roles = const [];

  @override
  void initState() {
    super.initState();
    api.getData<List>('/roles/assignable').then((r) {
      if (mounted) setState(() => _roles = r);
    }).catchError((_) {});
  }

  Future<void> _save() async {
    final editing = widget.existing != null;
    if (_roleId == null) {
      toast(context, t('Select a role'), error: true);
      return;
    }
    final canAssign = canManage(context, 'users:assign');
    setBusy(true);
    try {
      final profile = {
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'email': _email.text.trim(),
        'username': _username.text.trim(),
        'phone': _phone.text.trim(),
        'jobTitle': _job.text.trim(),
        'hourlyRate': _rate.text.trim(),
      };
      String? temp;
      if (editing) {
        await api.put('/users/${e['id']}', profile);
        if (canAssign) {
          await api.put('/users/${e['id']}/access', {'roleId': _roleId, 'restaurantIds': _restaurants.toList()});
        }
      } else {
        final created = await api.postData<Json>('/users', {
          ...profile,
          'roleId': _roleId,
          'restaurantIds': _restaurants.toList(),
          'password': _password.text,
        });
        temp = created['temporaryPassword']?.toString();
      }
      if (!mounted) return;
      if (temp != null && temp.isNotEmpty) {
        await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text(t('User created')),
            content: SelectableText(t('Temporary password:\n\n{password}\n\nShare it with the user. They must change it at first sign-in.', {'password': temp})),
            actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: Text(t('OK')))],
          ),
        );
      }
      if (!mounted) return;
      toast(context, editing ? t('User updated') : t('User added'));
      Navigator.of(context).pop(true);
    } catch (err) {
      if (mounted) toast(context, errorText(err), error: true);
    } finally {
      if (mounted) setBusy(false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    final s = context.read<Session>();
    final roles = [
      for (final r in _roles)
        // Only a Super Admin may create another Super Admin.
        if ((r as Map)['systemKey'] != 'SUPER_ADMIN' || s.isSuperAdmin) (r['id'].toString(), r['name'].toString()),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(editing ? t('Edit user') : t('Add user'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [
          Expanded(child: Field(_first, t('First name'), required: true)),
          const SizedBox(width: 12),
          Expanded(child: Field(_last, t('Last name'), required: true)),
        ]),
        Field(_username, t('Username'), hint: t('e.g. ramesh.patel'), helper: t('Email, username or phone — at least one')),
        Field(_phone, t('Mobile'), keyboard: TextInputType.phone, hint: '+919800000000'),
        Field(_email, t('Email'), keyboard: TextInputType.emailAddress),
        Field(_job, t('Job title'), hint: t('e.g. Electrician')),
        Field(_rate, t('Hourly rate (₹)'), keyboard: const TextInputType.numberWithOptions(decimal: true)),
        Pick<String>(label: t('Role'), required: true, value: _roleId, items: roles, onChanged: (v) => setState(() => _roleId = v)),
        MultiPick(
          label: t('Restaurants'),
          options: [for (final r in s.restaurants) (r['id'].toString(), r['name'].toString())],
          selected: _restaurants,
          onChanged: (v) => setState(() => _restaurants = v),
        ),
        if (!editing)
          Field(_password, t('Password'), obscure: true,
              helper: t('Empty = a temporary password is generated. 8+ characters with letters and numbers.')),
        SaveButton(busy: busy, text: editing ? t('Save changes') : t('Add user'), onPressed: _save),
      ]),
    );
  }
}

class UserDetailScreen extends StatelessWidget {
  const UserDetailScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(t('User'))),
      body: DataView<Json>(
        load: () => api.getData<Json>('/users/$id'),
        builder: (context, u, reload) {
          final can = (u['can'] as Map?) ?? const {};
          final active = u['status'] == 'ACTIVE';
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Avatar(u, size: 50),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(personName(u), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                      Text('${(u['role'] as Map?)?['name'] ?? ''}${u['jobTitle'] != null ? ' · ${u['jobTitle']}' : ''}',
                          style: const TextStyle(color: AppColors.muted)),
                    ]),
                  ),
                  StatusBadge(u['status']?.toString()),
                ]),
                const SizedBox(height: 10),
                InfoRow(t('Username'), u['username']?.toString()),
                InfoRow(t('Mobile'), u['phone']?.toString()),
                InfoRow(t('Email'), u['email']?.toString()),
                InfoRow(t('Restaurants'), ((u['restaurants'] as List?) ?? const []).map((r) => (r as Map)['name']).join('\n')),
                InfoRow(t('Teams'), ((u['teams'] as List?) ?? const []).map((tm) => (tm as Map)['name']).join(', ')),
                InfoRow(t('Last sign-in'), fmtDateTime(u['lastLoginAt'])),
              ]),
            ),
            if (isManager(context)) ...[
              const SizedBox(height: 12),
              if (can['edit'] == true)
                OutlinedButton.icon(
                  onPressed: () async {
                    if (await openEditor(context, UserForm(existing: u))) reload();
                  },
                  icon: const Icon(Icons.edit_outlined),
                  label: Text(t('Edit user')),
                ),
              if (can['resetPassword'] == true) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () async {
                    if (!await confirm(context, t('Reset password?'), body: t('A new temporary password will be created.'), action: t('Reset'))) {
                      return;
                    }
                    try {
                      final r = await api.postData<Json>('/users/${u['id']}/reset-password');
                      if (!context.mounted) return;
                      await showDialog<void>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: Text(t('New temporary password')),
                          content: SelectableText(r['temporaryPassword'].toString()),
                          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: Text(t('OK')))],
                        ),
                      );
                    } catch (err) {
                      if (context.mounted) toast(context, errorText(err), error: true);
                    }
                  },
                  icon: const Icon(Icons.key_outlined),
                  label: Text(t('Reset password')),
                ),
              ],
              if (can['changeStatus'] == true) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: active ? AppColors.dangerFg : AppColors.successFg),
                  onPressed: () async {
                    if (await runAction(context, () => api.put('/users/${u['id']}/status', {'status': active ? 'DISABLED' : 'ACTIVE'}),
                        success: active ? t('User disabled') : t('User enabled'))) {
                      reload();
                    }
                  },
                  icon: Icon(active ? Icons.block : Icons.check_circle_outline),
                  label: Text(active ? t('Disable sign-in') : t('Enable sign-in')),
                ),
              ],
              if (can['archive'] == true) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
                  onPressed: () async {
                    if (!await confirm(context, t('Remove this user?'),
                        body: t('They can no longer sign in. Their work history is kept.'), action: t('Remove'))) {
                      return;
                    }
                    if (!context.mounted) return;
                    if (await runAction(context, () => api.delete('/users/${u['id']}'), success: t('User removed')) &&
                        context.mounted) {
                      Navigator.of(context).pop(true);
                    }
                  },
                  icon: const Icon(Icons.person_remove_outlined),
                  label: Text(t('Remove user')),
                ),
              ],
            ],
          ]);
        },
      ),
    );
  }
}

// ================================================================ documents

class DocumentForm extends StatefulWidget {
  const DocumentForm({super.key});
  @override
  State<DocumentForm> createState() => _DocumentFormState();
}

class _DocumentFormState extends State<DocumentForm> with _Lookups {
  final _title = TextEditingController();
  String _ownerType = 'RESTAURANT';
  String? _ownerId;
  String _docType = 'LICENSE';
  String _issued = '';
  String _expires = '';
  File? _file;
  List _owners = const [];

  @override
  void initState() {
    super.initState();
    _loadOwners();
  }

  Future<void> _loadOwners() async {
    setState(() {
      _owners = const [];
      _ownerId = null;
    });
    try {
      final List list = switch (_ownerType) {
        'RESTAURANT' => [for (final r in context.read<Session>().restaurants) {'id': r['id'], 'name': r['name']}],
        'ASSET' => [for (final a in await _list(api, '/assets', {'pageSize': 100, 'sort': 'name:asc'}))
            {'id': (a as Map)['id'], 'name': '${a['name']} · ${(a['restaurant'] as Map?)?['name'] ?? ''}'}],
        'VENDOR' => await _list(api, '/vendors', {'pageSize': 100}),
        _ => [for (final w in await _list(api, '/work-orders', {'pageSize': 100, 'sort': 'createdAt:desc'}))
            {'id': (w as Map)['id'], 'name': '${w['code']} · ${w['title']}'}],
      };
      if (mounted) setState(() => _owners = list);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(t('Upload document'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        AppCard(
          onTap: () async {
            final picked = await FilePicker.pickFile(
              type: FileType.custom,
              allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'docx', 'xlsx'],
            );
            final path = picked?.path;
            if (path != null) {
              setState(() {
                _file = File(path);
                if (_title.text.isEmpty) _title.text = picked!.name.replaceAll(RegExp(r'\.[^.]+$'), '');
              });
            }
          },
          child: Row(children: [
            const IconChip(Icons.upload_file, brand: true, size: 44),
            const SizedBox(width: 12),
            Expanded(
              child: Text(_file == null ? t('Choose a file (PDF, photo, Word, Excel)') : _file!.path.split(Platform.pathSeparator).last,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
          ]),
        ),
        const SizedBox(height: 14),
        Field(_title, t('Title'), required: true, hint: t('e.g. FSSAI License 2026')),
        Pick<String>(
          label: t('Type'),
          value: _docType,
          items: [for (final dt in kDocTypes) (dt, label(dt))],
          onChanged: (v) => setState(() => _docType = v ?? _docType),
        ),
        Pick<String>(
          label: t('Belongs to'),
          value: _ownerType,
          items: [('RESTAURANT', t('Restaurant')), ('ASSET', t('Asset')), ('VENDOR', t('Vendor')), ('WORK_ORDER', t('Work order'))],
          onChanged: (v) {
            _ownerType = v ?? _ownerType;
            _loadOwners();
          },
        ),
        Pick<String>(
          label: label(_ownerType),
          required: true,
          value: _ownerId,
          items: [for (final o in _owners) ((o as Map)['id'].toString(), o['name'].toString())],
          onChanged: (v) => setState(() => _ownerId = v),
        ),
        DateField(label: t('Issued on'), value: _issued, onChanged: (v) => setState(() => _issued = v)),
        DateField(label: t('Expires on'), value: _expires, onChanged: (v) => setState(() => _expires = v)),
        SaveButton(
          busy: busy,
          text: t('Upload'),
          onPressed: () {
            if (_file == null || _ownerId == null) {
              toast(context, t('Choose both the file and the {item}', {'item': label(_ownerType)}), error: true);
              return;
            }
            saveAndClose(context, setBusy, () async {
              await api.uploadDocument(_file!, {
                'ownerType': _ownerType,
                'ownerId': _ownerId!,
                'title': _title.text.trim(),
                'docType': _docType,
                'issuedAt': _issued,
                'expiresAt': _expires,
              });
            }, t('Document uploaded'));
          },
        ),
      ]),
    );
  }
}

// ================================================================ purchase orders

class PurchaseOrderForm extends StatefulWidget {
  const PurchaseOrderForm({super.key, this.existing});
  final Json? existing;
  @override
  State<PurchaseOrderForm> createState() => _PurchaseOrderFormState();
}

class _PoLine {
  _PoLine({this.partId, String qty = '1', String cost = ''})
      : qty = TextEditingController(text: qty),
        cost = TextEditingController(text: cost);
  String? partId;
  final TextEditingController qty;
  final TextEditingController cost;
}

class _PurchaseOrderFormState extends State<PurchaseOrderForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late String? _vendorId = (e['vendor'] as Map?)?['id'];
  late String? _restaurantId = (e['restaurant'] as Map?)?['id'];
  late String _expected = dateText(e['expectedAt']);
  late final _tax = TextEditingController(text: numText(e['tax'] ?? 0));
  late final _notes = TextEditingController(text: e['notes'] ?? '');
  late final List<_PoLine> _lines = [
    for (final it in (e['items'] as List? ?? const []))
      _PoLine(partId: ((it as Map)['part'] as Map)['id'].toString(), qty: numText(it['qtyOrdered']), cost: numText(it['unitCost'])),
  ];
  List _vendors = const [], _parts = const [];

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId ??= rs.isNotEmpty ? rs.first['id'].toString() : null;
    if (_lines.isEmpty) _lines.add(_PoLine());
    Future.wait([_list(api, '/vendors', {'pageSize': 100}), _list(api, '/parts', {'pageSize': 100})]).then((r) {
      if (mounted) {
        setState(() {
          _vendors = r[0];
          _parts = r[1];
        });
      }
    }).catchError((_) {});
  }

  num get _subtotal => _lines.fold<num>(0, (s, l) => s + (num.tryParse(l.qty.text) ?? 0) * (num.tryParse(l.cost.text) ?? 0));

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? t('Edit purchase order') : t('New purchase order'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Pick<String>(
          label: t('Vendor'),
          required: true,
          value: _vendorId,
          items: [for (final v in _vendors) ((v as Map)['id'].toString(), v['name'].toString())],
          onChanged: (v) => setState(() => _vendorId = v),
        ),
        Pick<String>(
          label: t('Deliver to restaurant'),
          required: true,
          value: _restaurantId,
          items: _restaurantOptions(context),
          onChanged: (v) => setState(() => _restaurantId = v),
        ),
        DateField(label: t('Expected on'), value: _expected, onChanged: (v) => setState(() => _expected = v)),
        SectionTitle(t('Items')),
        for (final (i, l) in _lines.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: AppCard(
              child: Column(children: [
                Row(children: [
                  Expanded(
                    child: Pick<String>(
                      label: t('Part {n}', {'n': i + 1}),
                      value: l.partId,
                      items: [for (final p in _parts) ((p as Map)['id'].toString(), '${p['name']} (${p['partNumber']})')],
                      onChanged: (v) => setState(() {
                        l.partId = v;
                        final p = _parts.cast<Map>().where((x) => x['id'] == v).firstOrNull;
                        if (p != null && l.cost.text.isEmpty) l.cost.text = numText(p['unitCost']);
                      }),
                    ),
                  ),
                  if (_lines.length > 1)
                    IconButton(onPressed: () => setState(() => _lines.removeAt(i)), icon: const Icon(Icons.close)),
                ]),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: l.qty,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(labelText: t('Quantity'), isDense: true),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: l.cost,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(labelText: t('Unit cost (₹)'), isDense: true),
                    ),
                  ),
                ]),
              ]),
            ),
          ),
        TextButton.icon(onPressed: () => setState(() => _lines.add(_PoLine())), icon: const Icon(Icons.add), label: Text(t('Add item'))),
        const SizedBox(height: 8),
        Field(_tax, t('Tax / GST (₹)'), keyboard: const TextInputType.numberWithOptions(decimal: true)),
        Field(_notes, t('Notes'), lines: 2),
        AppCard(
          child: Column(children: [
            InfoRow(t('Subtotal'), fmtMoney(_subtotal)),
            InfoRow(t('Total'), fmtMoney(_subtotal + (num.tryParse(_tax.text) ?? 0))),
          ]),
        ),
        SaveButton(
          busy: busy,
          text: editing ? t('Save changes') : t('Save as draft'),
          onPressed: () {
            final items = [
              for (final l in _lines)
                if (l.partId != null)
                  {
                    'partId': l.partId,
                    'qtyOrdered': num.tryParse(l.qty.text.trim()) ?? 0,
                    'unitCost': num.tryParse(l.cost.text.trim()) ?? 0,
                    'description': '',
                  },
            ];
            if (_vendorId == null || _restaurantId == null || items.isEmpty) {
              toast(context, t('Choose a vendor, a restaurant and at least one part'), error: true);
              return;
            }
            saveAndClose(context, setBusy, () async {
              final body = {
                'vendorId': _vendorId,
                'restaurantId': _restaurantId,
                'expectedAt': _expected,
                'tax': num.tryParse(_tax.text.trim()) ?? 0,
                'notes': _notes.text.trim(),
                'items': items,
              };
              editing ? await api.put('/purchase-orders/${e['id']}', body) : await api.post('/purchase-orders', body);
            }, editing ? t('Purchase order updated') : t('Purchase order saved'));
          },
        ),
      ]),
    );
  }
}

class PurchaseOrderScreen extends StatefulWidget {
  const PurchaseOrderScreen({super.key, required this.id});
  final String id;
  @override
  State<PurchaseOrderScreen> createState() => _PurchaseOrderScreenState();
}

class _PurchaseOrderScreenState extends State<PurchaseOrderScreen> {
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(t('Purchase order'))),
      body: DataView<Json>(
        load: () => api.getData<Json>('/purchase-orders/${widget.id}'),
        builder: (context, po, reload) {
          final a = (po['actions'] as Map?) ?? const {};
          final items = (po['items'] as List?) ?? const [];
          final manager = isManager(context);
          Future<void> act(String path, String done, [Object? body]) async {
            if (await runAction(context, () => api.post('/purchase-orders/${po['id']}/$path', body ?? {}), success: done)) reload();
          }

          Future<void> withReason(String path, String title, String done) async {
            final reason = await askText(context, title: title, hint: t('Reason'), action: t('OK'), minLength: 3);
            if (reason != null) await act(path, done, {'reason': reason});
          }

          return ListView(padding: const EdgeInsets.all(16), children: [
            Row(children: [
              Text(po['code'].toString(), style: const TextStyle(color: AppColors.muted)),
              const Spacer(),
              StatusBadge(po['status']?.toString()),
            ]),
            const SizedBox(height: 8),
            Text((po['vendor'] as Map?)?['name']?.toString() ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            Text((po['restaurant'] as Map?)?['name']?.toString() ?? '', style: const TextStyle(color: AppColors.muted)),
            const SizedBox(height: 12),
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (final it in items)
                  ListTile(
                    title: Text(((it as Map)['part'] as Map)['name'].toString()),
                    subtitle: Text('${it['qtyOrdered']} × ${fmtMoney(it['unitCost'])}  ·  ${t('received {n}', {'n': it['qtyReceived']})}'),
                    trailing: Text(fmtMoney(it['lineTotal']), style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
              ]),
            ),
            const SizedBox(height: 10),
            AppCard(
              child: Column(children: [
                InfoRow(t('Subtotal'), fmtMoney(po['subtotal'])),
                InfoRow(t('Tax'), fmtMoney(po['tax'])),
                InfoRow(t('Total'), fmtMoney(po['total'])),
                InfoRow(t('Requested by'), personName(po['requestedBy'])),
                if (po['approvedBy'] != null) InfoRow(t('Approved by'), personName(po['approvedBy'])),
                InfoRow(t('Expected'), fmtDate(po['expectedAt'])),
                if (po['notes'] != null) InfoRow(t('Notes'), po['notes'].toString()),
                if (po['cancellationReason'] != null) InfoRow(t('Cancelled'), po['cancellationReason'].toString()),
              ]),
            ),
            if (po['selfApprovalBlocked'] == true)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Callout(tone: 'warning', text: t('You raised this order, so someone else must approve it.')),
              ),
            if (manager) ...[
              const SizedBox(height: 14),
              Wrap(spacing: 10, runSpacing: 10, children: [
                if (a['edit'] == true)
                  OutlinedButton.icon(
                    onPressed: () async {
                      if (await openEditor(context, PurchaseOrderForm(existing: po))) reload();
                    },
                    icon: const Icon(Icons.edit_outlined),
                    label: Text(t('Edit')),
                  ),
                if (a['submit'] == true)
                  FilledButton.icon(onPressed: () => act('submit', t('Sent for approval')), icon: const Icon(Icons.send_outlined), label: Text(t('Submit for approval'))),
                if (a['approve'] == true)
                  FilledButton.icon(onPressed: () => act('approve', t('Approved')), icon: const Icon(Icons.verified_outlined), label: Text(t('Approve'))),
                if (a['reject'] == true)
                  OutlinedButton.icon(onPressed: () => withReason('reject', t('Reject order'), t('Rejected')), icon: const Icon(Icons.undo), label: Text(t('Reject'))),
                if (a['order'] == true)
                  FilledButton.icon(onPressed: () => act('order', t('Marked as ordered')), icon: const Icon(Icons.local_shipping_outlined), label: Text(t('Mark ordered'))),
                if (a['receive'] == true)
                  FilledButton.icon(
                    onPressed: () async {
                      final lines = [
                        for (final it in items)
                          {
                            'itemId': (it as Map)['id'],
                            'quantity': ((it['qtyOrdered'] as num) - (it['qtyReceived'] as num)).clamp(0, double.infinity),
                          },
                      ];
                      if (await confirm(context, t('Receive everything still pending?'), action: t('Receive'))) {
                        await act('receive', t('Stock received'), {'lines': lines, 'notes': ''});
                      }
                    },
                    icon: const Icon(Icons.inventory_outlined),
                    label: Text(t('Receive all')),
                  ),
                if (a['cancel'] == true)
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
                    onPressed: () => withReason('cancel', t('Cancel order'), t('Cancelled')),
                    icon: const Icon(Icons.cancel_outlined),
                    label: Text(t('Cancel')),
                  ),
              ]),
            ],
          ]);
        },
      ),
    );
  }
}

// ================================================================ work order edit

class WorkOrderEditForm extends StatefulWidget {
  const WorkOrderEditForm({super.key, required this.workOrder});
  final Json workOrder;
  @override
  State<WorkOrderEditForm> createState() => _WorkOrderEditFormState();
}

class _WorkOrderEditFormState extends State<WorkOrderEditForm> with _Lookups {
  late final Json w = widget.workOrder;
  late final _title = TextEditingController(text: w['title'] ?? '');
  late final _desc = TextEditingController(text: w['description'] ?? '');
  late String _category = w['category'] ?? 'OTHER';
  late String _priority = w['priority'] ?? 'MEDIUM';
  late String? _locationId = (w['location'] as Map?)?['id'];
  late String? _assetId = (w['asset'] as Map?)?['id'];
  late DateTime? _due = parseDate(w['dueDate']);
  List _locations = const [], _assets = const [];

  @override
  void initState() {
    super.initState();
    final rid = (w['restaurant'] as Map)['id'];
    Future.wait([
      api.getData<List>('/locations', {'restaurantId': rid}),
      _list(api, '/assets', {'restaurantId': rid, 'pageSize': 100, 'sort': 'name:asc'}),
    ]).then((r) {
      if (mounted) {
        setState(() {
          _locations = r[0];
          _assets = r[1];
        });
      }
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(t('Edit {code}', {'code': w['code']}))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_title, t('Title'), required: true),
        Field(_desc, t('Description'), lines: 3),
        Row(children: [
          Expanded(
            child: Pick<String>(
              label: t('Category'),
              value: _category,
              items: [for (final c in kCategories) (c, label(c))],
              onChanged: (v) => setState(() => _category = v ?? _category),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Pick<String>(
              label: t('Priority'),
              value: _priority,
              items: [for (final p in kPriorities) (p, label(p))],
              onChanged: (v) => setState(() => _priority = v ?? _priority),
            ),
          ),
        ]),
        Pick<String>(
          label: t('Location'),
          value: _locationId,
          items: [(null, t('None')), for (final l in _locations) ((l as Map)['id'].toString(), l['name'].toString())],
          onChanged: (v) => setState(() => _locationId = v),
        ),
        Pick<String>(
          label: t('Asset'),
          value: _assetId,
          items: [(null, t('None')), for (final a in _assets) ((a as Map)['id'].toString(), '${a['name']} · ${a['assetCode']}')],
          onChanged: (v) => setState(() => _assetId = v),
        ),
        OutlinedButton.icon(
          onPressed: () async {
            final now = DateTime.now();
            final d = await showDatePicker(
                context: context, firstDate: now.subtract(const Duration(days: 365)), lastDate: now.add(const Duration(days: 365)), initialDate: _due ?? now);
            if (d == null || !context.mounted) return;
            // Date only: due by the end of that day.
            setState(() => _due = DateTime(d.year, d.month, d.day, 23, 59));
          },
          icon: const Icon(Icons.event_outlined),
          label: Text(_due == null ? t('Set due date') : t('Due {date}', {'date': fmtDate(_due!.toIso8601String())})),
        ),
        SaveButton(
          busy: busy,
          text: t('Save changes'),
          onPressed: () => saveAndClose(context, setBusy, () async {
            await api.put('/work-orders/${w['id']}', {
              'title': _title.text.trim(),
              'description': _desc.text.trim(),
              'category': _category,
              'priority': _priority,
              'restaurantId': (w['restaurant'] as Map)['id'],
              'locationId': _locationId ?? '',
              'assetId': _assetId ?? '',
              'dueDate': _due?.toUtc().toIso8601String() ?? '',
              'estimatedMinutes': ?w['estimatedMinutes'],
            });
          }, t('Work order updated')),
        ),
      ]),
    );
  }
}

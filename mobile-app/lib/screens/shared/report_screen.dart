import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/photos.dart';
import 'work_order_screen.dart';

/// Report a problem (creates a request with photos), like the web /w/report.
class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key, this.restaurantId, this.assetId, this.assetName, this.locationId, this.locationName});
  final String? restaurantId;
  final String? assetId;
  final String? assetName;
  final String? locationId;
  final String? locationName;
  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  final _desc = TextEditingController();
  final _title = TextEditingController();
  String? _restaurantId;
  String? _locationId;
  String? _assetId;
  String _category = 'OTHER';
  String _priority = 'MEDIUM';
  List _locations = const [];
  List _assets = const [];
  final List<File> _photos = [];
  bool _busy = false;

  ApiClient get api => apiOf(context);

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId = widget.restaurantId ?? (rs.isNotEmpty ? rs.first['id'].toString() : null);
    _assetId = widget.assetId;
    _locationId = widget.locationId;
    _loadPlaces();
  }

  Future<void> _loadPlaces() async {
    final rid = _restaurantId;
    if (rid == null) return;
    try {
      final locs = await api.getData<List>('/locations', {'restaurantId': rid});
      final assets = (await api.get('/assets', {'restaurantId': rid, 'pageSize': 100, 'sort': 'name:asc'}) as Map)['data'] as List;
      if (mounted) {
        setState(() {
          _locations = locs;
          _assets = assets;
        });
      }
    } catch (_) {
      // Location / asset are optional; the form still works without them.
    }
  }

  Future<void> _submit() async {
    if (_restaurantId == null) {
      toast(context, t('Select a restaurant'), error: true);
      return;
    }
    if (_desc.text.trim().length < 5) {
      toast(context, t('Describe the problem in a bit more detail (at least 5 letters)'), error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      // Without a network the report (and its photos) is kept on the phone and sent later.
      final created = await api.submitRequest({
        'restaurantId': _restaurantId,
        'locationId': _locationId ?? '',
        'assetId': _assetId ?? '',
        'category': _category,
        'title': _title.text.trim(),
        'description': _desc.text.trim(),
        'priority': _priority,
      }, _photos);
      if (!mounted) return;
      toast(context, t('Report sent: {code}', {'code': created['code']}));
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.queued) {
        toast(context, e.message);
        Navigator.of(context).pop(true);
      } else {
        toast(context, errorText(e), error: true);
      }
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rs = context.watch<Session>().restaurants;
    return Scaffold(
      appBar: AppBar(title: Text(t('Report a problem'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (widget.assetName != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Callout(text: t('Machine: {name}', {'name': widget.assetName})),
          ),
        if (widget.locationName != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Callout(text: t('Place: {name}', {'name': widget.locationName})),
          ),
        TextField(
          controller: _desc,
          minLines: 3,
          maxLines: 6,
          decoration: InputDecoration(
            labelText: t('What is the problem? *'),
            hintText: t('e.g. Fridge not cooling, water leaking under sink…'),
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 12),
        TextField(controller: _title, decoration: InputDecoration(labelText: t('Short title (optional)'))),
        const SizedBox(height: 12),
        if (rs.length > 1)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: DropdownButtonFormField<String>(
              initialValue: _restaurantId,
              isExpanded: true,
              decoration: InputDecoration(labelText: t('Restaurant *')),
              items: [for (final r in rs) DropdownMenuItem(value: r['id'].toString(), child: Text(r['name'].toString()))],
              onChanged: (v) {
                setState(() {
                  _restaurantId = v;
                  _locationId = null;
                  _assetId = null;
                });
                _loadPlaces();
              },
            ),
          ),
        DropdownButtonFormField<String?>(
          key: ValueKey('loc-$_restaurantId-${_locations.length}'),
          initialValue: _locations.any((l) => (l as Map)['id'] == _locationId) ? _locationId : null,
          isExpanded: true,
          decoration: InputDecoration(labelText: t('Where? (area)')),
          items: [
            DropdownMenuItem(value: null, child: Text(t('Not sure'))),
            for (final l in _locations) DropdownMenuItem(value: (l as Map)['id'].toString(), child: Text(l['name'].toString())),
          ],
          onChanged: (v) => setState(() => _locationId = v),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String?>(
          key: ValueKey('asset-$_restaurantId-${_assets.length}'),
          initialValue: _assets.any((a) => (a as Map)['id'] == _assetId) ? _assetId : null,
          isExpanded: true,
          decoration: InputDecoration(labelText: t('Which machine?')),
          items: [
            DropdownMenuItem(value: null, child: Text(t('None / not sure'))),
            for (final a in _assets) DropdownMenuItem(value: (a as Map)['id'].toString(), child: Text('${a['name']} (${(a['location'] as Map?)?['name'] ?? ''})')),
          ],
          onChanged: (v) => setState(() => _assetId = v),
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _category,
              isExpanded: true,
              decoration: InputDecoration(labelText: t('Type')),
              items: [for (final c in kCategories) DropdownMenuItem(value: c, child: Text(label(c)))],
              onChanged: (v) => setState(() => _category = v ?? _category),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _priority,
              isExpanded: true,
              decoration: InputDecoration(labelText: t('How urgent?')),
              items: [for (final p in kPriorities) DropdownMenuItem(value: p, child: Text(label(p)))],
              onChanged: (v) => setState(() => _priority = v ?? _priority),
            ),
          ),
        ]),
        const SizedBox(height: 16),
        SectionTitle(t('Photos')),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final f in _photos)
            Stack(children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.file(f, width: 90, height: 90, fit: BoxFit.cover, cacheWidth: 270),
              ),
              Positioned(
                right: 2,
                top: 2,
                child: InkWell(
                  onTap: () => setState(() => _photos.remove(f)),
                  child: const CircleAvatar(radius: 11, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 14, color: Colors.white)),
                ),
              ),
            ]),
          InkWell(
            onTap: () async {
              final files = await pickPhotos(context);
              setState(() => _photos.addAll(files));
            },
            borderRadius: BorderRadius.circular(10),
            child: Container(
              width: 90,
              height: 90,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(10),
                color: Colors.white,
              ),
              child: const Icon(Icons.add_a_photo_outlined, color: AppColors.muted),
            ),
          ),
        ]),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: _busy ? null : _submit,
          icon: _busy
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.send_outlined),
          label: Text(t('Send report')),
        ),
      ]),
    );
  }
}

/// Requests list. Workers/staff see their own (`mine`); managers see all and can act.
class RequestsScreen extends StatefulWidget {
  const RequestsScreen({super.key, this.mine = false, this.embedded = false});
  final bool mine;
  final bool embedded;
  @override
  State<RequestsScreen> createState() => _RequestsScreenState();
}

class _RequestsScreenState extends State<RequestsScreen> {
  String? _status;
  final _key = GlobalKey<DataViewState<List>>();

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final body = Column(children: [
      SizedBox(
        height: 50,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(16, 8, 16, 0), children: [
          for (final s in const [null, 'NEW', 'APPROVED', 'CONVERTED', 'REJECTED'])
            Padding(
              padding: const EdgeInsets.only(right: 8),
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
          load: () async => (await api.get('/requests', {
            'pageSize': 50,
            'status': _status,
            if (widget.mine) 'mine': '1',
          }) as Map)['data'] as List,
          builder: (context, items, reload) => items.isEmpty
              ? ListView(children: [
                  EmptyState(icon: Icons.inbox_outlined, title: t('No reports yet'), body: t('Reported problems will show here.'))
                ])
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, i) {
                    final r = items[i] as Map;
                    return AppCard(
                      onTap: () async {
                        await Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => RequestScreen(id: r['id'].toString())));
                        reload();
                      },
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Text(r['code'].toString(), style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                          const Spacer(),
                          StatusBadge(r['status']?.toString()),
                        ]),
                        const SizedBox(height: 6),
                        Text(r['title'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                        const SizedBox(height: 4),
                        Text(
                          [(r['asset'] as Map?)?['name'], (r['location'] as Map?)?['name'], (r['restaurant'] as Map?)?['name']]
                              .whereType<String>()
                              .join(' · '),
                          style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                        ),
                        const SizedBox(height: 8),
                        Row(children: [
                          PriorityBadge(r['priority']?.toString()),
                          const SizedBox(width: 8),
                          if ((r['photoCount'] ?? 0) > 0) ...[
                            const Icon(Icons.photo_outlined, size: 15, color: AppColors.muted),
                            Text(' ${r['photoCount']}', style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                            const SizedBox(width: 8),
                          ],
                          Expanded(
                            child: Text(
                              '${r['requestedBy'] != null ? personName(r['requestedBy']) : ((r['guest'] as Map?)?['name'] ?? '')} · ${fmtRelative(r['createdAt'])}',
                              textAlign: TextAlign.right,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                            ),
                          ),
                        ]),
                      ]),
                    );
                  },
                ),
        ),
      ),
    ]);
    if (widget.embedded) return body;
    return Scaffold(
      appBar: AppBar(title: Text(widget.mine ? t('My reports') : t('Requests'))),
      body: body,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const ReportScreen()));
          if (ok == true) _key.currentState?.reload();
        },
        icon: const Icon(Icons.add),
        label: Text(t('Report')),
      ),
    );
  }
}

class RequestScreen extends StatefulWidget {
  const RequestScreen({super.key, required this.id});
  final String id;
  @override
  State<RequestScreen> createState() => _RequestScreenState();
}

class _RequestScreenState extends State<RequestScreen> {
  final _key = GlobalKey<DataViewState<Json>>();

  Future<void> _convert(Json r) async {
    final api = apiOf(context);
    final ok = await confirm(context, t('Create a work order?'),
        body: t('A work order will be created from this request.'), action: t('Create'));
    if (!ok || !mounted) return;
    Json? wo;
    final done = await runAction(context, () async {
      wo = await api.postData<Json>('/work-orders', {
        'title': r['title'],
        'description': r['description'],
        'category': r['category'],
        'priority': r['priority'],
        'restaurantId': (r['restaurant'] as Map)['id'],
        'locationId': (r['location'] as Map?)?['id'] ?? '',
        'assetId': (r['asset'] as Map?)?['id'] ?? '',
        'dueDate': '',
        'assignedUserId': '',
        'assignedTeamId': '',
        'requestId': r['id'],
      });
    }, success: t('Work order created'));
    if (done && mounted && wo != null) {
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: wo!['id'].toString())));
      _key.currentState?.reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(t('Request'))),
      body: DataView<Json>(
        key: _key,
        load: () => api.getData<Json>('/requests/${widget.id}'),
        builder: (context, r, reload) {
          final can = (r['can'] as Map?) ?? const {};
          final wo = r['workOrder'] as Map?;
          return ListView(padding: const EdgeInsets.all(16), children: [
            Row(children: [
              Text(r['code'].toString(), style: const TextStyle(color: AppColors.muted)),
              const Spacer(),
              StatusBadge(r['status']?.toString()),
              const SizedBox(width: 6),
              PriorityBadge(r['priority']?.toString()),
            ]),
            const SizedBox(height: 10),
            Text(r['title'].toString(), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Text(r['description']?.toString() ?? '', style: const TextStyle(fontSize: 14.5, height: 1.4)),
            const SizedBox(height: 14),
            PhotoGrid(r['attachments'] as List?),
            const SizedBox(height: 14),
            AppCard(
              child: Column(children: [
                InfoRow(t('Restaurant'), (r['restaurant'] as Map?)?['name']?.toString()),
                InfoRow(t('Location'), (r['location'] as Map?)?['name']?.toString()),
                InfoRow(t('Machine'), (r['asset'] as Map?)?['name']?.toString()),
                InfoRow(t('Type'), label(r['category'])),
                InfoRow(t('Reported by'),
                    r['requestedBy'] != null ? personName(r['requestedBy']) : '${(r['guest'] as Map?)?['name'] ?? ''} ${(r['guest'] as Map?)?['phone'] ?? ''}'),
                InfoRow(t('Reported'), fmtDateTime(r['createdAt'])),
                if (r['reviewedBy'] != null) InfoRow(t('Reviewed by'), '${personName(r['reviewedBy'])} · ${fmtDateTime(r['reviewedAt'])}'),
              ]),
            ),
            if (r['reviewNote'] != null) ...[const SizedBox(height: 12), Callout(text: r['reviewNote'].toString())],
            if (r['rejectionReason'] != null) ...[
              const SizedBox(height: 12),
              Callout(tone: 'danger', title: t('Rejected'), text: r['rejectionReason'].toString()),
            ],
            if (wo != null) ...[
              const SizedBox(height: 12),
              AppCard(
                onTap: () => Navigator.of(context)
                    .push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: wo['id'].toString()))),
                child: Row(children: [
                  const IconChip(Icons.assignment_outlined),
                  const SizedBox(width: 10),
                  Expanded(child: Text(t('Work order {code}', {'code': wo['code'] ?? ''}), style: const TextStyle(fontWeight: FontWeight.w600))),
                  const Icon(Icons.chevron_right),
                ]),
              ),
            ],
            const SizedBox(height: 20),
            if (can['convert'] == true)
              FilledButton.icon(
                onPressed: () => _convert(r),
                icon: const Icon(Icons.assignment_add),
                label: Text(t('Create work order')),
              ),
            if (can['approve'] == true || can['reject'] == true) ...[
              const SizedBox(height: 10),
              Row(children: [
                if (can['reject'] == true)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () async {
                        final reason = await askText(context, title: t('Reject request'), hint: t('Reason'), action: t('Reject'), minLength: 3);
                        if (reason == null || !context.mounted) return;
                        if (await runAction(context, () => api.post('/requests/${r['id']}/reject', {'reason': reason}), success: t('Rejected'))) reload();
                      },
                      child: Text(t('Reject')),
                    ),
                  ),
                if (can['approve'] == true && can['reject'] == true) const SizedBox(width: 10),
                if (can['approve'] == true)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () async {
                        final note = await askText(context, title: t('Approve request'), hint: t('Note (optional)'), action: t('Approve'));
                        if (note == null || !context.mounted) return;
                        if (await runAction(context, () => api.post('/requests/${r['id']}/approve', {'note': note}), success: t('Approved'))) reload();
                      },
                      child: Text(t('Approve')),
                    ),
                  ),
              ]),
            ],
          ]);
        },
      ),
    );
  }
}

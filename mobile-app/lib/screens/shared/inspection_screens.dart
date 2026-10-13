import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/checklist.dart';
import '../../widgets/common.dart';

IconData inspectionIcon(String? type) => switch (type) {
      'OPENING' => Icons.wb_sunny_outlined,
      'CLOSING' => Icons.nightlight_outlined,
      'SAFETY' => Icons.health_and_safety_outlined,
      _ => Icons.fact_check_outlined,
    };

/// Worker "Checklists": start an opening / closing / safety check, see recent ones.
class ChecklistsScreen extends StatefulWidget {
  const ChecklistsScreen({super.key});
  @override
  State<ChecklistsScreen> createState() => _ChecklistsScreenState();
}

class _ChecklistsScreenState extends State<ChecklistsScreen> {
  String? _restaurantId;
  final _key = GlobalKey<DataViewState<(List, List)>>();
  bool _starting = false;

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId = rs.isNotEmpty ? rs.first['id'].toString() : null;
  }

  Future<void> _start(Map tpl) async {
    final api = apiOf(context);
    setState(() => _starting = true);
    try {
      final ins = await api.postData<Json>('/inspections', {
        'templateId': tpl['id'],
        'restaurantId': _restaurantId,
        'assetId': '',
      });
      if (!mounted) return;
      await Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => InspectionScreen(id: ins['id'].toString())));
      _key.currentState?.reload();
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final rs = context.watch<Session>().restaurants;
    return Scaffold(
      appBar: AppBar(title: Text(t('Checklists'))),
      body: DataView<(List, List)>(
        key: _key,
        load: () async {
          final templates = _restaurantId == null
              ? const []
              : await api.getData<List>('/inspection-templates', {'restaurantId': _restaurantId, 'active': 'true'});
          final mine = (await api.get('/inspections', {'mine': '1', 'pageSize': 10}) as Map)['data'] as List;
          return (templates, mine);
        },
        builder: (context, data, reload) => ListView(padding: const EdgeInsets.all(16), children: [
          if (rs.length > 1)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: DropdownButtonFormField<String>(
                initialValue: _restaurantId,
                isExpanded: true,
                decoration: InputDecoration(labelText: t('Restaurant')),
                items: [for (final r in rs) DropdownMenuItem(value: r['id'].toString(), child: Text(r['name'].toString()))],
                onChanged: (v) {
                  setState(() => _restaurantId = v);
                  reload();
                },
              ),
            ),
          SectionTitle(t('Start a checklist')),
          if (data.$1.isEmpty)
            EmptyState(icon: Icons.fact_check_outlined, title: t('No checklists set up for this restaurant')),
          for (final tpl in data.$1)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: AppCard(
                onTap: _starting ? null : () => _start(tpl as Map),
                child: Row(children: [
                  IconChip(inspectionIcon((tpl as Map)['type']?.toString()), brand: true, size: 42),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(tpl['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                      Text('${label(tpl['type'])} · ${t('{n} steps', {'n': (tpl['procedure'] as Map?)?['stepCount'] ?? 0})}',
                          style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                    ]),
                  ),
                  const Icon(Icons.play_circle_outline, color: AppColors.primary),
                ]),
              ),
            ),
          const SizedBox(height: 12),
          SectionTitle(t('My recent checklists')),
          if (data.$2.isEmpty) Text(t('None yet.'), style: const TextStyle(color: AppColors.muted)),
          for (final i in data.$2)
            Padding(padding: const EdgeInsets.only(bottom: 10), child: InspectionCard(ins: i as Map, onChanged: reload)),
        ]),
      ),
    );
  }
}

class InspectionCard extends StatelessWidget {
  const InspectionCard({super.key, required this.ins, this.onChanged});
  final Map ins;
  final VoidCallback? onChanged;
  @override
  Widget build(BuildContext context) {
    final fails = (ins['failCount'] ?? 0) as int;
    return AppCard(
      onTap: () async {
        await Navigator.of(context)
            .push(MaterialPageRoute(builder: (_) => InspectionScreen(id: ins['id'].toString())));
        onChanged?.call();
      },
      child: Row(children: [
        IconChip(inspectionIcon(ins['type']?.toString()), tone: fails > 0 ? 'danger' : 'success'),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(ins['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
            Text('${ins['code']} · ${(ins['restaurant'] as Map?)?['name'] ?? ''}',
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
            Text('${personName(ins['performedBy'])} · ${fmtDateTime(ins['submittedAt'] ?? ins['startedAt'])}',
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
          ]),
        ),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          StatusBadge(ins['status']?.toString()),
          const SizedBox(height: 4),
          Text(t('{pass} pass · {fail} fail', {'pass': ins['passCount'], 'fail': fails}),
              style: TextStyle(fontSize: 12, color: fails > 0 ? AppColors.dangerFg : AppColors.muted)),
        ]),
      ]),
    );
  }
}

/// All inspections (admin menu).
class InspectionsScreen extends StatelessWidget {
  const InspectionsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(t('Inspections'))),
      body: DataView<List>(
        load: () async => (await api.get('/inspections', {'pageSize': 50}) as Map)['data'] as List,
        builder: (context, items, reload) => items.isEmpty
            ? ListView(children: [EmptyState(icon: Icons.fact_check_outlined, title: t('No inspections yet'))])
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, i) => InspectionCard(ins: items[i] as Map, onChanged: reload),
              ),
      ),
    );
  }
}

class InspectionScreen extends StatefulWidget {
  const InspectionScreen({super.key, required this.id});
  final String id;
  @override
  State<InspectionScreen> createState() => _InspectionScreenState();
}

class _InspectionScreenState extends State<InspectionScreen> {
  Json? _ins;
  Object? _error;
  bool _submitting = false;

  ApiClient get api => apiOf(context);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await api.getData<Json>('/inspections/${widget.id}');
      if (mounted) setState(() => _ins = r);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  /// Saves an answer or photo; offline it is kept on the phone and the saved copy shows it.
  Future<void> _saveStep(Future<Json> Function() call) async {
    try {
      final r = await call();
      if (mounted) setState(() => _ins = r);
    } on ApiException catch (e) {
      if (!e.queued) rethrow;
      await _load();
    }
  }

  /// Started but not submitted, by me (or I may delete checklists).
  bool _canDiscard(Json ins) {
    final s = context.read<Session>();
    final mine = (ins['performedBy'] as Map?)?['id'] == s.user?['id'];
    return ins['status'] == 'IN_PROGRESS' && (mine || s.can('inspections:delete'));
  }

  Future<void> _discard() async {
    if (!await confirm(context, t('Discard this checklist?'), body: t('The answers and photos in it are deleted.'), action: t('Discard')) ||
        !mounted) {
      return;
    }
    if (await runAction(context, () => api.delete('/inspections/${widget.id}'), success: t('Checklist discarded')) && mounted) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _submit() async {
    final notes = await askText(context, title: t('Submit checklist'), hint: t('Notes (optional)'), action: t('Submit'));
    if (notes == null) return;
    setState(() => _submitting = true);
    try {
      final r = await api.postData<Json>('/inspections/${widget.id}/submit', {'notes': notes});
      if (mounted) {
        setState(() => _ins = r);
        toast(context, t('Checklist submitted'));
      }
    } on ApiException catch (e) {
      if (e.queued) await _load();
      if (mounted) toast(context, e.queued ? e.message : errorText(e), error: !e.queued);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ins = _ins;
    final can = (ins?['can'] as Map?) ?? const {};
    final items = (ins?['items'] as List?) ?? const [];
    final p = checklistProgress(items);
    return Scaffold(
      appBar: AppBar(title: Text(ins?['code']?.toString() ?? t('Checklist')), actions: [
        if (ins != null && _canDiscard(ins))
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: _discard,
            icon: const Icon(Icons.delete_outline),
            label: Text(t('Discard')),
          ),
      ]),
      body: ins == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Row(children: [
                  StatusBadge(ins['status']?.toString()),
                  const SizedBox(width: 8),
                  Pill(label(ins['type'])),
                  const Spacer(),
                  Text(t('{done} of {total} done', {'done': p.answered, 'total': p.total}), style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                ]),
                const SizedBox(height: 8),
                Text(ins['name'].toString(), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600)),
                Text('${(ins['restaurant'] as Map?)?['name'] ?? ''} · ${personName(ins['performedBy'])}',
                    style: const TextStyle(color: AppColors.muted)),
                if (ins['notes'] != null) ...[const SizedBox(height: 10), Callout(tone: 'neutral', text: ins['notes'].toString())],
                const SizedBox(height: 14),
                ChecklistView(
                  items: items,
                  editable: can['answer'] == true,
                  onAnswer: (itemId, answer) => _saveStep(() => api.putData<Json>('/inspections/${widget.id}/items/$itemId', answer)),
                  onUpload: (itemId, files) =>
                      _saveStep(() => api.upload('/inspections/${widget.id}/items/$itemId/attachments', files)),
                ),
              ]),
            ),
      bottomNavigationBar: can['submit'] == true
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: FilledButton.icon(
                  onPressed: _submitting ? null : _submit,
                  icon: const Icon(Icons.task_alt),
                  label: Text(t('Submit checklist')),
                ),
              ),
            )
          : null,
    );
  }
}

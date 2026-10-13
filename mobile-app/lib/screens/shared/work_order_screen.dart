import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/checklist.dart';
import '../../widgets/common.dart';
import '../../widgets/offline_banner.dart';
import '../../widgets/photos.dart';
import '../../widgets/slide_action.dart';
import '../../widgets/work_order_extras.dart';
import '../admin/editors.dart';
import 'asset_screen.dart';

/// One work order / task. Workers start, pause, answer the checklist, add photos and
/// complete it; managers also assign, verify, send back, reopen and cancel.
/// Which buttons show comes from the server's `actions` flags, like the web app.
class WorkOrderScreen extends StatefulWidget {
  const WorkOrderScreen({super.key, required this.id, this.title});
  final String id;
  final String? title;
  @override
  State<WorkOrderScreen> createState() => _WorkOrderScreenState();
}

class _WorkOrderScreenState extends State<WorkOrderScreen> {
  Json? _w;
  Object? _error;
  String? _busy;

  Timer? _live;

  /// Bumped by pull-to-refresh (the asset's meters reload with the job).
  int _refresh = 0;
  bool _partsSaved = false;

  ApiClient get api => apiOf(context);

  @override
  void initState() {
    super.initState();
    _load();
    // Keep messages, status and photos fresh while the task is open.
    // Only while the app is on screen (no network use in the background).
    _live = Timer.periodic(const Duration(seconds: 10), (_) {
      final visible = WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
      if (_busy == null && mounted && visible) _load();
    });
  }

  @override
  void dispose() {
    _live?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final w = await api.getData<Json>('/work-orders/${widget.id}');
      if (mounted) {
        setState(() {
          _w = w;
          _error = null;
        });
        _keepPartsOnPhone(w);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  /// Runs a call that returns the fresh work order.
  Future<void> _do(String key, Future<dynamic> Function() call, [String? done]) async {
    setState(() => _busy = key);
    try {
      final r = await call();
      if (r is Map && r['id'] == widget.id) {
        setState(() => _w = r.cast<String, dynamic>());
      } else {
        await _load();
      }
      if (done != null && mounted) toast(context, done);
    } on ApiException catch (e) {
      if (!e.queued) {
        if (mounted) toast(context, errorText(e), error: true);
        return;
      }
      // No network: kept on the phone; the saved copy already shows the change.
      await _load();
      if (mounted) toast(context, e.message);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  /// While parts can be added, loads the part list once so the picker also works
  /// without a network later (it is kept with the saved screens).
  void _keepPartsOnPhone(Json w) {
    if (_partsSaved || ((w['actions'] as Map?)?['parts']) != true) return;
    _partsSaved = true;
    unawaited(_loadParts().then((_) {}, onError: (_) {}));
  }

  Future<List> _loadParts() async {
    final rid = (_w?['restaurant'] as Map?)?['id'];
    return (await api.get('/parts', {'restaurantId': rid, 'pageSize': 100, 'sort': 'name:asc'}) as Map)['data'] as List;
  }

  Future<void> _pullRefresh() async {
    setState(() => _refresh++);
    await _load();
  }

  String get _base => '/work-orders/${widget.id}';
  Future<dynamic> _action(String path, [Object? body]) => api.postData<dynamic>('$_base/$path', body ?? {});

  @override
  Widget build(BuildContext context) {
    final w = _w;
    return Scaffold(
      appBar: AppBar(title: Text(w?['code']?.toString() ?? widget.title ?? t('Task'))),
      body: w == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : Column(
              children: [
                const OfflineBanner(),
                Expanded(child: RefreshIndicator(onRefresh: _pullRefresh, child: _body(w))),
              ],
            ),
      bottomNavigationBar: w == null ? null : _bottomBar(w),
    );
  }

  /// The person doing the job: the assignee or a helper. Workers on a team job
  /// count too. Managers only plan, assign and approve (like MaintainX).
  bool _isDoer(Json w) {
    final s = context.read<Session>();
    final me = s.user?['id'];
    if ((w['assignedUser'] as Map?)?['id'] == me) return true;
    if (((w['helpers'] as List?) ?? const []).any((h) => (h as Map)['id'] == me)) return true;
    return !s.isAdmin;
  }

  String _who(Json w) =>
      w['assignedUser'] != null ? personName(w['assignedUser']) : ((w['assignedTeam'] as Map?)?['name']?.toString() ?? t('the technician'));

  /// One line telling a manager where the job stands and who has it.
  String? _managerHint(Json w) {
    final who = _who(w);
    return switch (w['status']) {
      'DRAFT' => t('Draft — send it to the technician when ready.'),
      'OPEN' when w['assignedUser'] == null && w['assignedTeam'] == null => t('Not assigned yet — choose a technician.'),
      'OPEN' || 'ASSIGNED' || 'SCHEDULED' => t('Waiting for {who} to start.', {'who': who}),
      'IN_PROGRESS' => t('{who} is working on it.', {'who': who}),
      'ON_HOLD' => t('{who} put it on hold.', {'who': who}),
      'REOPENED' => t('Sent back to {who} for rework.', {'who': who}),
      'COMPLETED' || 'REVIEW' => t('{who} finished — check the work and approve.', {'who': who}),
      'VERIFIED' || 'CLOSED' => t('Approved and closed.'),
      'CANCELLED' => t('Cancelled.'),
      _ => null,
    };
  }

  Widget? _bottomBar(Json w) {
    final a = (w['actions'] as Map?) ?? const {};
    final doer = _isDoer(w);
    final manager = isManager(context);
    final status = w['status']?.toString();
    final check = (w['completionCheck'] as Map?) ?? const {};
    final blockers =
        (check['stepsLeft'] as int? ?? 0) +
        (check['needsBeforePhoto'] == true ? 1 : 0) +
        (check['needsAfterPhoto'] == true ? 1 : 0) +
        (check['subWorkOrdersOpen'] as int? ?? 0);
    final buttons = <Widget>[];
    Widget btn(String key, String text, IconData icon, VoidCallback onTap, {bool primary = true}) {
      final child = _busy == key
          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.2))
          : Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 20),
                const SizedBox(width: 6),
                Flexible(child: Text(text, overflow: TextOverflow.ellipsis)),
              ],
            );
      return Expanded(
        child: primary
            ? FilledButton(onPressed: _busy == null ? onTap : null, child: child)
            : OutlinedButton(onPressed: _busy == null ? onTap : null, child: child),
      );
    }

    void gap() => buttons.add(const SizedBox(width: 10));
    var showBlockers = false;

    // Main steps are slide-to-confirm (like delivery apps); side actions are small buttons.
    Widget slide(String key, String text, IconData icon, Future<void> Function() go, {Color color = AppColors.primary}) => Expanded(
      child: SlideAction(label: text, icon: icon, color: color, busy: _busy == key, enabled: _busy == null, onSubmit: go),
    );
    Widget side(String key, String text, IconData icon, VoidCallback onTap) => SizedBox(
      height: 58,
      child: OutlinedButton.icon(
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 58), padding: const EdgeInsets.symmetric(horizontal: 14)),
        onPressed: _busy == null ? onTap : null,
        icon: Icon(icon, size: 20),
        label: Text(text),
      ),
    );

    if (doer && a['start'] == true) {
      // 1. Technician: start the job.
      buttons.add(slide('start', t('Swipe to start'), Icons.play_arrow_rounded, () => _do('start', () => _action('start'), t('Task started'))));
    } else if (doer && a['resume'] == true) {
      buttons.add(slide('resume', t('Swipe to resume'), Icons.play_arrow_rounded, () => _do('resume', () => _action('resume'), t('Resumed'))));
    } else if (doer && a['complete'] == true) {
      // 2. Technician: finish (or pause) it.
      if (a['hold'] == true) {
        buttons.add(side('hold', t('Hold'), Icons.pause_rounded, _hold));
        gap();
      }
      buttons.add(slide('complete', t('Swipe to complete'), Icons.check_rounded, _complete, color: AppColors.success));
      showBlockers = blockers > 0;
    } else if (manager && a['verify'] == true) {
      // 3. Manager: approve the finished work, or send it back.
      if (a['reject'] == true) {
        buttons.add(side('reject', t('Send back'), Icons.undo_rounded, _reject));
        gap();
      }
      buttons.add(slide('verify', t('Swipe to approve'), Icons.verified_rounded, _verify, color: AppColors.success));
    } else if (manager && a['publish'] == true) {
      buttons.add(btn('publish', t('Send to technician'), Icons.send_outlined, () => _do('publish', () => _action('publish'), t('Sent'))));
    } else if (manager && a['assign'] == true && kActiveStatuses.contains(status) && status != 'COMPLETED' && status != 'REVIEW') {
      final unassigned = w['assignedUser'] == null && w['assignedTeam'] == null;
      buttons.add(btn('assign', unassigned ? t('Assign technician') : t('Reassign'), Icons.person_add_alt, _assign, primary: unassigned));
    } else if (manager && a['reopen'] == true) {
      buttons.add(btn('reopen', t('Reopen'), Icons.replay_rounded, _reopen, primary: false));
    }

    final hint = manager && !doer ? _managerHint(w) : null;
    if (buttons.isEmpty && hint == null) return null;
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (hint != null)
              Padding(
                padding: EdgeInsets.only(bottom: buttons.isEmpty ? 0 : 8),
                child: Row(
                  children: [
                    const Icon(Icons.info_outline, size: 16, color: AppColors.muted),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(hint, style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                    ),
                  ],
                ),
              ),
            if (showBlockers)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  blockers == 1
                      ? t('1 thing left before you can complete')
                      : t('{n} things left before you can complete', {'n': blockers}),
                  style: const TextStyle(fontSize: 12.5, color: AppColors.warningFg),
                ),
              ),
            if (buttons.isNotEmpty) Row(children: buttons),
          ],
        ),
      ),
    );
  }

  Widget _body(Json w) {
    final a = (w['actions'] as Map?) ?? const {};
    final doer = _isDoer(w);
    final manager = isManager(context);
    final status = w['status']?.toString();
    final active = kActiveStatuses.contains(status);
    final due = active ? describeDue(w['dueDate']) : null;
    final asset = w['asset'] as Map?;
    final where = [asset?['name'], (w['location'] as Map?)?['name'], (w['restaurant'] as Map?)?['name']].whereType<String>().join(' · ');
    final checklist = (w['checklist'] as List?) ?? const [];
    final progress = checklistProgress(checklist);
    final helpers = (w['helpers'] as List?) ?? const [];
    final source = w['sourceRequest'] as Map?;
    final completion = w['completion'] as Map?;
    final contacts = (w['contacts'] as List?) ?? const [];
    final parts = (w['parts'] as List?) ?? const [];
    final reservations = (w['reservations'] as List?) ?? const [];
    final cost = w['cost'] as Map?;
    final history = (w['history'] as List?) ?? const [];
    final menu = <(String, String, IconData)>[
      if (a['edit'] == true && manager) ('edit', t('Edit details'), Icons.edit_outlined),
      if (a['assign'] == true && manager && w['assignedUser'] != null && (status == 'COMPLETED' || status == 'REVIEW' || doer))
        ('assign', t('Reassign'), Icons.person_add_alt),
      if (a['hold'] == true && doer && a['complete'] != true) ('hold', t('Put on hold'), Icons.pause_circle_outline),
      if (a['reopen'] == true && manager && kActiveStatuses.contains(status)) ('reopen', t('Reopen'), Icons.replay_rounded),
      if (a['cancel'] == true && manager) ('cancel', t('Cancel work order'), Icons.cancel_outlined),
    ];

    final accent = toneAccent(priorityTone(w['priority']?.toString()));
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        // Header card: priority colour on top, soft tint behind the title.
        Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.borderSoft),
            boxShadow: [BoxShadow(color: const Color(0xFF312E81).withValues(alpha: 0.06), blurRadius: 18, offset: const Offset(0, 6))],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(height: 5, color: accent),
              Container(
                padding: const EdgeInsets.fromLTRB(16, 12, 8, 16),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [accent.withValues(alpha: 0.045), Colors.white],
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        WorkOrderStatusBadge(status),
                        const SizedBox(width: 8),
                        PriorityBadge(w['priority']?.toString()),
                        const Spacer(),
                        if (menu.isNotEmpty)
                          PopupMenuButton<String>(
                            icon: const Icon(Icons.more_vert),
                            onSelected: (k) => switch (k) {
                              'edit' => _edit(),
                              'assign' => _assign(),
                              'hold' => _hold(),
                              'reopen' => _reopen(),
                              'cancel' => _cancel(),
                              _ => null,
                            },
                            itemBuilder: (_) => [
                              for (final m in menu)
                                PopupMenuItem(
                                  value: m.$1,
                                  child: Row(children: [Icon(m.$3, size: 20), const SizedBox(width: 10), Text(m.$2)]),
                                ),
                            ],
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      w['title'].toString(),
                      style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700, height: 1.25, letterSpacing: -0.3),
                    ),
                    const SizedBox(height: 6),
                    InkWell(
                      onTap: asset == null
                          ? null
                          : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AssetScreen(id: asset['id'].toString()))),
                      child: Row(
                        children: [
                          const Icon(Icons.place_outlined, size: 16, color: AppColors.muted),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              where,
                              style: TextStyle(
                                fontSize: 13.5,
                                color: asset == null ? AppColors.muted : AppColors.primary,
                                decoration: asset == null ? null : TextDecoration.underline,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (due != null && due.label.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Row(
                          children: [
                            Icon(Icons.event_outlined, size: 16, color: w['overdue'] == true ? AppColors.dangerFg : AppColors.muted),
                            const SizedBox(width: 4),
                            Text(
                              due.label,
                              style: TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w500,
                                color: w['overdue'] == true ? AppColors.dangerFg : toneColors(due.tone).fg,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _ProgressSteps(status: status, assignee: _who(w)),
        const SizedBox(height: 14),
        if (status == 'ON_HOLD' && w['holdReason'] != null)
          _gap(Callout(tone: 'warning', title: t('On hold because'), text: w['holdReason'].toString())),
        if (status == 'REOPENED' && w['rejectionReason'] != null)
          _gap(Callout(tone: 'danger', title: t('Sent back for rework'), text: w['rejectionReason'].toString())),
        if (status == 'CANCELLED') _gap(Callout(tone: 'warning', title: t('Cancelled'), text: (w['cancelReason'] ?? '').toString())),
        if (doer && (status == 'COMPLETED' || status == 'REVIEW'))
          _gap(Callout(title: t('Done — waiting for approval'), text: t('Your manager will check the work and close it.'))),
        if (w['description'] != null && w['description'].toString().isNotEmpty) ...[
          Text(w['description'].toString(), style: const TextStyle(fontSize: 14.5, height: 1.45)),
          const SizedBox(height: 16),
        ],

        if (source != null) ...[
          SectionTitle(
            t('Reported by {name}', {
              'name': source['requestedBy'] != null
                  ? personName(source['requestedBy'])
                  : ((source['guest'] as Map?)?['name'] ?? t('guest')),
            }),
          ),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(source['description']?.toString() ?? ''),
                const SizedBox(height: 8),
                PhotoGrid(source['attachments'] as List?),
              ],
            ),
          ),
          const SizedBox(height: 16),
        ],

        if (checklist.isNotEmpty) ...[
          SectionTitle(
            t('Checklist'),
            trailing: Text(t('{done} of {total} done', {'done': progress.answered, 'total': progress.total}), style: const TextStyle(fontSize: 13, color: AppColors.muted)),
          ),
          if (doer && a['checklist'] != true && active)
            _gap(Callout(tone: 'neutral', text: t('Start the task to fill in the checklist.'))),
          if (doer && a['checklist'] == true && progress.failed > 0)
            _gap(Callout(tone: 'warning', text: t('{n} check(s) failed — add a note or photo.', {'n': progress.failed}))),
          ChecklistView(
            items: checklist,
            editable: doer && a['checklist'] == true,
            onAnswer: (itemId, answer) => _saveStep(() => api.putData<Json>('$_base/checklist/$itemId', answer)),
            onUpload: (itemId, files) => _saveStep(() => api.upload('$_base/checklist/$itemId/attachments', files)),
          ),
          const SizedBox(height: 10),
        ],

        SectionTitle(
          t('Photos'),
          trailing: a['upload'] == true
              ? TextButton.icon(
                  onPressed: _busy == null ? _addPhotos : null,
                  icon: _busy == 'upload'
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.add_a_photo_outlined, size: 18),
                  label: Text(t('Add photo')),
                )
              : null,
        ),
        if (((w['attachments'] as List?) ?? const []).isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(t('No photos yet.'), style: const TextStyle(color: AppColors.muted)),
          )
        else
          PhotoGrid(w['attachments'] as List?),
        const SizedBox(height: 16),

        if (parts.isNotEmpty || reservations.isNotEmpty || a['parts'] == true) ...[
          PartsUsedSection(
            parts: parts,
            reservations: reservations,
            canEdit: a['parts'] == true,
            busy: _busy == 'part' ? 'add' : (_busy?.startsWith('part:') == true ? _busy!.substring(5) : null),
            onAdd: _addPart,
            onRemove: _removePart,
          ),
          const SizedBox(height: 16),
        ],

        if (asset != null)
          MetersSection(
            refresh: _refresh,
            load: () => api.getData<List>('/assets/${asset['id']}/meters'),
            record: (m, body) => api.postData<List>('/assets/${asset['id']}/meters/${m['id']}/readings', {...body, 'workOrderId': widget.id}),
          ),

        TimeSection(
          workOrder: w,
          canAdd: a['time'] == true && manager,
          busy: _busy == 'time' ? 'add' : (_busy?.startsWith('time:') == true ? _busy!.substring(5) : null),
          onAdd: _addTime,
          onRemove: _removeTime,
        ),
        const SizedBox(height: 16),

        if (completion != null) ...[
          SectionTitle(t('Repair report')),
          AppCard(
            child: Column(
              children: [
                InfoRow(t('Problem found'), completion['problemFound']?.toString()),
                if (completion['rootCause'] != null) InfoRow(t('Root cause'), completion['rootCause'].toString()),
                InfoRow(t('Work performed'), completion['workPerformed']?.toString()),
                if (completion['newPartsInstalled'] != null) InfoRow(t('New parts'), completion['newPartsInstalled'].toString()),
                if (completion['oldPartsRemoved'] != null) InfoRow(t('Old parts removed'), completion['oldPartsRemoved'].toString()),
                if (completion['recommendation'] != null) InfoRow(t('Recommendation'), completion['recommendation'].toString()),
                InfoRow(t('Final condition'), label(completion['finalCondition'])),
                InfoRow(t('Confirmed by'), '${personName(completion['confirmedBy'])} · ${fmtDateTime(completion['confirmedAt'])}'),
              ],
            ),
          ),
          const SizedBox(height: 16),
        ],

        SectionTitle(t('Messages')),
        _Messages(
          messages: (w['messages'] as List?) ?? const [],
          canSend: a['message'] == true,
          canInternal: a['internalNotes'] == true && manager,
          send: (body, internal) => _do('message', () => _action('messages', {'body': body, if (internal) 'internal': true})),
        ),
        const SizedBox(height: 16),

        // Less-used information, folded away to keep the screen simple.
        _Fold(
          icon: Icons.info_outline,
          title: t('Details'),
          children: [
            InfoRow(t('Assigned to'), w['assignedUser'] != null ? personName(w['assignedUser']) : t('Not assigned')),
            if (w['assignedTeam'] != null) InfoRow(t('Team'), (w['assignedTeam'] as Map)['name'].toString()),
            if (helpers.isNotEmpty) InfoRow(t('Helpers'), helpers.map(personName).join(', ')),
            if (w['supervisor'] != null) InfoRow(t('Supervisor'), personName(w['supervisor'])),
            if (w['vendor'] != null) InfoRow(t('Vendor'), (w['vendor'] as Map)['name'].toString()),
            InfoRow(t('Category'), label(w['category'])),
            InfoRow(t('Type'), label(w['type'])),
            InfoRow(t('Created'), '${fmtDateTime(w['createdAt'])} · ${personName(w['createdBy'])}'),
            if (w['estimatedMinutes'] != null) InfoRow(t('Estimate'), fmtDuration(w['estimatedMinutes'])),
            if ((w['minutesWorked'] ?? 0) > 0) InfoRow(t('Time worked'), fmtDuration(w['minutesWorked'])),
            if (w['procedure'] != null) InfoRow(t('Procedure'), (w['procedure'] as Map)['name'].toString()),
            if (cost != null && (cost['total'] ?? 0) > 0) InfoRow(t('Total cost'), fmtMoney(cost['total'])),
          ],
        ),
        if (contacts.isNotEmpty)
          _Fold(
            icon: Icons.call_outlined,
            title: t('Contacts'),
            children: [
              for (final c in contacts)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text((c as Map)['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text(label(c['role']), style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                          ],
                        ),
                      ),
                      if (c['phone'] != null)
                        OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(minimumSize: const Size(0, 38)),
                          onPressed: () => launchUrl(Uri.parse('tel:${c['phone'].toString().replaceAll(' ', '')}')),
                          icon: const Icon(Icons.call_outlined, size: 18),
                          label: Text(t('Call')),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        if (history.isNotEmpty)
          _Fold(
            icon: Icons.history,
            title: t('History'),
            children: [
              for (final h in history.reversed)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Padding(
                        padding: EdgeInsets.only(top: 5),
                        child: Icon(Icons.circle, size: 8, color: AppColors.primary),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              (h as Map)['fromStatus'] == null
                                  ? t('Created as {status}', {'status': label(h['toStatus'])})
                                  : '${label(h['fromStatus'])} → ${label(h['toStatus'])}',
                              style: const TextStyle(fontWeight: FontWeight.w500),
                            ),
                            Text(
                              '${h['actor'] != null ? personName(h['actor']) : t('System')} · ${fmtDateTime(h['createdAt'])}',
                              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                            ),
                            if (h['note'] != null) Text(h['note'].toString(), style: const TextStyle(fontSize: 13)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
      ],
    );
  }

  /// Saves a checklist answer, photo or signature; offline it is kept on the phone.
  Future<void> _saveStep(Future<Json> Function() call) async {
    try {
      final r = await call();
      if (mounted) setState(() => _w = r);
    } on ApiException catch (e) {
      if (!e.queued) rethrow;
      await _load();
    }
  }

  Widget _gap(Widget child) => Padding(padding: const EdgeInsets.only(bottom: 12), child: child);

  // ------------------------------------------------------------- actions

  Future<void> _edit() async {
    if (await openEditor(context, WorkOrderEditForm(workOrder: _w!))) await _load();
  }

  Future<void> _addPhotos() async {
    final stage = await pickOption<String>(context, t('Which photo is this?'), [
      ('BEFORE', t('Before work')),
      ('DURING', t('During work')),
      ('AFTER', t('After work')),
    ]);
    if (stage == null || !mounted) return;
    final files = await pickPhotos(context);
    if (files.isEmpty) return;
    await _do('upload', () => api.upload('$_base/attachments', files, {'stage': stage}), t('Photo added'));
  }

  Future<void> _hold() async {
    final reason = await askText(context, title: t('Put on hold'), hint: t('Why? (e.g. waiting for parts)'), action: t('Hold'), minLength: 3);
    if (reason == null) return;
    await _do('hold', () => _action('hold', {'reason': reason}), t('On hold'));
  }

  Future<void> _reject() async {
    final reason = await askText(context, title: t('Send back for rework'), hint: t('What needs fixing?'), action: t('Send back'), minLength: 3);
    if (reason == null) return;
    await _do('reject', () => _action('reject', {'reason': reason}), t('Sent back'));
  }

  Future<void> _reopen() async {
    final reason = await askText(context, title: t('Reopen work order'), hint: t('Reason'), action: t('Reopen'), minLength: 3);
    if (reason == null) return;
    await _do('reopen', () => _action('reopen', {'reason': reason}), t('Reopened'));
  }

  Future<void> _cancel() async {
    final reason = await askText(context, title: t('Cancel work order'), hint: t('Reason'), action: t('Cancel work order'), minLength: 3);
    if (reason == null) return;
    await _do('cancel', () => _action('cancel', {'reason': reason}), t('Cancelled'));
  }

  Future<void> _verify() async {
    final note = await askText(context, title: t('Verify the work'), hint: t('Note (optional)'), action: t('Verify'));
    if (note == null) return;
    await _do('verify', () => _action('verify', {'note': note}), t('Verified'));
  }

  Future<void> _assign() async {
    final rid = (_w?['restaurant'] as Map?)?['id'];
    List people;
    try {
      people = await api.getData<List>('/work-orders/workload', {'restaurantId': rid});
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
      return;
    }
    if (!mounted) return;
    final userId = await pickOption<String>(context, t('Assign to'), [
      for (final p in people)
        (
          ((p as Map)['user'] as Map)['id'].toString(),
          '${personName(p['user'])}  ·  ${t('{n} open', {'n': p['openCount']})}${(p['overdueCount'] ?? 0) > 0 ? ', ${t('{n} overdue', {'n': p['overdueCount']})}' : ''}',
        ),
    ]);
    if (userId == null) return;
    // The API wants both fields; '' means "no team".
    await _do('assign', () => _action('assign', {'assignedUserId': userId, 'assignedTeamId': ''}), t('Assigned'));
  }

  Future<void> _addPart() async {
    final use = await Navigator.of(context).push<PartUse>(
      MaterialPageRoute(fullscreenDialog: true, builder: (_) => UsePartScreen(load: _loadParts)),
    );
    if (use == null) return;
    await _do('part', () => api.postData<dynamic>('$_base/parts', use.body, use.meta), t('Part recorded and taken from stock.'));
  }

  Future<void> _removePart(Map line) async {
    final name = ((line['part'] as Map?)?['name'] ?? '').toString();
    if (!await confirm(context, t('Remove {name}', {'name': name}), body: t('The part goes back into stock.'), action: t('Remove'))) return;
    await _do('part:${line['id']}', () async => (await api.delete('$_base/parts/${line['id']}') as Map)['data'],
        t('Part removed and returned to stock.'));
  }

  Future<void> _addTime() async {
    final add = await Navigator.of(context).push<TimeAdd>(
      MaterialPageRoute(fullscreenDialog: true, builder: (_) => AddTimeScreen(workOrder: _w!)),
    );
    if (add == null) return;
    await _do('time', () => api.postData<dynamic>('$_base/time', add.body, add.meta), t('Time added.'));
  }

  Future<void> _removeTime(Map entry) async {
    if (!await confirm(context, t('Remove this time'), action: t('Remove'))) return;
    await _do('time:${entry['id']}', () async => (await api.delete('$_base/time/${entry['id']}') as Map)['data'], t('Time removed.'));
  }

  Future<void> _complete() async {
    final body = await Navigator.of(context)
        .push<Map<String, dynamic>>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => CompleteScreen(workOrder: _w!)));
    if (body == null) return;
    await _do('complete', () => _action('complete', body), t('Task completed'));
  }
}

class _Messages extends StatefulWidget {
  const _Messages({required this.messages, required this.canSend, required this.canInternal, required this.send});
  final List messages;
  final bool canSend;
  final bool canInternal;
  final Future<void> Function(String body, bool internal) send;
  @override
  State<_Messages> createState() => _MessagesState();
}

class _MessagesState extends State<_Messages> {
  final _ctrl = TextEditingController();
  bool _internal = false;
  bool _sending = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.messages.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(t('No messages yet.'), style: const TextStyle(color: AppColors.muted)),
          ),
        for (final m in widget.messages)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Avatar((m as Map)['author'], size: 32),
                const SizedBox(width: 10),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: m['internal'] == true ? AppColors.warningSoft : (m['mine'] == true ? AppColors.infoSoft : Colors.white),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(personName(m['author']), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                            ),
                            if (m['internal'] == true) Pill(t('Internal'), tone: 'warning'),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(m['body'].toString(), style: const TextStyle(fontSize: 14)),
                        const SizedBox(height: 4),
                        Text(fmtRelative(m['createdAt']), style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                        if ((m['attachments'] as List? ?? const []).isNotEmpty) ...[
                          const SizedBox(height: 6),
                          PhotoGrid(m['attachments'] as List?, columns: 4),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        if (widget.canSend) ...[
          TextField(
            controller: _ctrl,
            minLines: 1,
            maxLines: 4,
            decoration: InputDecoration(
              hintText: t('Write a message…'),
              suffixIcon: IconButton(
                icon: _sending
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.send_rounded, color: AppColors.primary),
                onPressed: _sending
                    ? null
                    : () async {
                        final text = _ctrl.text.trim();
                        if (text.isEmpty) return;
                        setState(() => _sending = true);
                        await widget.send(text, _internal);
                        if (mounted) {
                          _ctrl.clear();
                          setState(() => _sending = false);
                        }
                      },
              ),
            ),
          ),
          if (widget.canInternal)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              value: _internal,
              onChanged: (v) => setState(() => _internal = v == true),
              title: Text(t('Internal note (managers only)')),
              controlAffinity: ListTileControlAffinity.leading,
            ),
        ],
      ],
    );
  }
}

/// The repair report a technician hands in (same fields as the web CompletionForm).
class CompleteScreen extends StatefulWidget {
  const CompleteScreen({super.key, required this.workOrder});
  final Json workOrder;
  @override
  State<CompleteScreen> createState() => _CompleteScreenState();
}

class _CompleteScreenState extends State<CompleteScreen> {
  final _problem = TextEditingController();
  final _root = TextEditingController();
  final _work = TextEditingController();
  final _newParts = TextEditingController();
  final _oldParts = TextEditingController();
  final _rec = TextEditingController();
  String _condition = 'FULLY_WORKING';
  late bool _noParts;
  bool _confirmed = false;
  String _assetStatus = '';

  int get _partLines => ((widget.workOrder['parts'] as List?) ?? const []).length;

  @override
  void initState() {
    super.initState();
    _noParts = _partLines == 0;
  }

  @override
  Widget build(BuildContext context) {
    final check = (widget.workOrder['completionCheck'] as Map?) ?? const {};
    final hasAsset = widget.workOrder['asset'] != null;
    final ok = _problem.text.trim().length >= 3 && _work.text.trim().length >= 3 && _confirmed;
    Widget field(TextEditingController c, String label, {String? hint, int lines = 2, bool required = false}) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: c,
        minLines: lines,
        maxLines: lines + 3,
        onChanged: (_) => setState(() {}),
        decoration: InputDecoration(labelText: required ? '$label *' : label, hintText: hint, alignLabelWithHint: true),
      ),
    );
    return Scaffold(
      appBar: AppBar(title: Text(t('Complete task'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if ((check['stepsLeft'] ?? 0) > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Callout(tone: 'warning', text: t('{n} checklist step(s) still to answer.', {'n': check['stepsLeft']})),
            ),
          if (check['needsBeforePhoto'] == true)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Callout(tone: 'warning', text: t('Add a BEFORE photo first.')),
            ),
          if (check['needsAfterPhoto'] == true)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Callout(tone: 'warning', text: t('Add an AFTER photo first.')),
            ),
          field(_problem, t('Problem found'), hint: t('What was wrong?'), required: true),
          field(_root, t('Root cause'), hint: t('Why did it happen?')),
          field(_work, t('Work performed'), hint: t('What did you do?'), lines: 3, required: true),
          field(_newParts, t('New parts installed')),
          field(_oldParts, t('Old parts removed')),
          field(_rec, t('Recommendation'), hint: t('Anything the manager should know?')),
          DropdownButtonFormField<String>(
            initialValue: _condition,
            decoration: InputDecoration(labelText: t('Final condition *')),
            items: [for (final c in kFinalConditions) DropdownMenuItem(value: c, child: Text(label(c)))],
            onChanged: (v) => setState(() => _condition = v ?? _condition),
          ),
          if (hasAsset) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _assetStatus,
              decoration: InputDecoration(labelText: t('Set machine status')),
              items: [
                DropdownMenuItem(value: '', child: Text(t('Leave unchanged'))),
                DropdownMenuItem(value: 'OPERATIONAL', child: Text(t('Operational'))),
                DropdownMenuItem(value: 'WARNING', child: Text(t('Warning'))),
                DropdownMenuItem(value: 'BROKEN', child: Text(t('Broken'))),
              ],
              onChanged: (v) => setState(() => _assetStatus = v ?? ''),
            ),
          ],
          const SizedBox(height: 8),
          if (_partLines == 0)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _noParts,
              onChanged: (v) => setState(() => _noParts = v == true),
              title: Text(t('No parts used')),
              controlAffinity: ListTileControlAffinity.leading,
            )
          else
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  const Icon(Icons.settings_outlined, size: 18, color: AppColors.muted),
                  const SizedBox(width: 8),
                  Expanded(child: Text(t('{n} part(s) recorded on this task.', {'n': _partLines}))),
                ],
              ),
            ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _confirmed,
            onChanged: (v) => setState(() => _confirmed = v == true),
            title: Text(t('I confirm this report is true and the work is done')),
            controlAffinity: ListTileControlAffinity.leading,
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: ok
                ? () => Navigator.pop(context, <String, dynamic>{
                    'problemFound': _problem.text.trim(),
                    'rootCause': _root.text.trim(),
                    'workPerformed': _work.text.trim(),
                    'newPartsInstalled': _newParts.text.trim(),
                    'oldPartsRemoved': _oldParts.text.trim(),
                    'recommendation': _rec.text.trim(),
                    'finalCondition': _condition,
                    'noPartsUsed': _partLines == 0 && _noParts,
                    'confirmed': true,
                    if (_assetStatus.isNotEmpty) 'assetStatus': _assetStatus,
                  })
                : null,
            icon: const Icon(Icons.check_circle_outline),
            label: Text(t('Complete task')),
          ),
        ],
      ),
    );
  }
}

/// Where the job is: Created → Assigned → In progress → Done → Approved.
class _ProgressSteps extends StatelessWidget {
  const _ProgressSteps({required this.status, required this.assignee});
  final String? status;
  final String assignee;

  static List<String> get _steps => [t('Created'), t('Assigned'), t('In progress'), t('Done'), t('Approved')];

  int get _index => switch (status) {
    'DRAFT' || 'OPEN' => 0,
    'ASSIGNED' || 'SCHEDULED' => 1,
    'IN_PROGRESS' || 'ON_HOLD' || 'REOPENED' => 2,
    'COMPLETED' || 'REVIEW' => 3,
    'VERIFIED' || 'CLOSED' => 4,
    _ => -1,
  };

  @override
  Widget build(BuildContext context) {
    final current = _index;
    if (current < 0) return const SizedBox.shrink(); // cancelled
    final paused = status == 'ON_HOLD';
    return AppCard(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < _steps.length; i++) ...[
            Expanded(
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Container(
                          height: 3,
                          color: i == 0 ? Colors.transparent : (i <= current ? AppColors.success : AppColors.border),
                        ),
                      ),
                      Container(
                        width: 26,
                        height: 26,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: i < current || (i == current && current == 4)
                              ? AppColors.success
                              : i == current
                              ? (paused ? AppColors.warning : AppColors.primary)
                              : Colors.white,
                          boxShadow: i == current
                              ? [BoxShadow(color: (paused ? AppColors.warning : AppColors.primary).withValues(alpha: 0.35), blurRadius: 8)]
                              : null,
                          border: Border.all(
                            color: i < current || (i == current && current == 4)
                                ? AppColors.success
                                : i == current
                                ? (paused ? AppColors.warning : AppColors.primary)
                                : AppColors.border,
                            width: 2,
                          ),
                        ),
                        child: i < current || (i == current && current == 4)
                            ? const Icon(Icons.check, size: 15, color: Colors.white)
                            : i == current
                            ? Icon(paused ? Icons.pause : Icons.circle, size: paused ? 14 : 8, color: Colors.white)
                            : null,
                      ),
                      Expanded(
                        child: Container(
                          height: 3,
                          color: i == _steps.length - 1 ? Colors.transparent : (i < current ? AppColors.success : AppColors.border),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    i == 2 && paused ? t('On hold') : _steps[i],
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: i == current ? FontWeight.w700 : FontWeight.w500,
                      color: i <= current ? AppColors.foreground : AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A folded section (Details, Contacts, History) that opens on tap.
class _Fold extends StatelessWidget {
  const _Fold({required this.icon, required this.title, required this.children});
  final IconData icon;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: AppCard(
      padding: EdgeInsets.zero,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          leading: Icon(icon, color: AppColors.primary),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
          children: children,
        ),
      ),
    ),
  );
}

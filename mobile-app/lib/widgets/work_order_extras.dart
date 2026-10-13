import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import 'common.dart';

/*
 * Parts used, time and meter readings on a job (the web's WorkOrderParts,
 * time log / TimeDialog and AssetMeters). The widgets only show data and
 * collect input; the screens send it (through the offline queue when there is
 * no network), so they can be tested without a server.
 */

/// Small "waiting to be sent" mark on a change kept on the phone.
class _PendingMark extends StatelessWidget {
  const _PendingMark();
  @override
  Widget build(BuildContext context) => Tooltip(
    message: t('Waiting to be sent'),
    child: const Icon(Icons.cloud_upload_outlined, size: 16, color: AppColors.warningFg),
  );
}

/// Parses "2", "2.5" or "2,5"; null when not a number.
num? parseQty(String text) => num.tryParse(text.trim().replaceAll(',', '.'));

/// At most three decimals (the API's rule for quantities and readings).
bool threeDecimals(num v) => ((v * 1000) - (v * 1000).roundToDouble()).abs() < 1e-6;

// ---------------------------------------------------------------- parts used

/// Parts used on the job, with the parts set aside for it.
class PartsUsedSection extends StatelessWidget {
  const PartsUsedSection({
    super.key,
    required this.parts,
    this.reservations = const [],
    this.canEdit = false,
    this.onAdd,
    this.onRemove,
    this.busy,
  });
  final List parts;
  final List reservations;

  /// The server's `actions.parts`: add and remove lines.
  final bool canEdit;
  final VoidCallback? onAdd;
  final void Function(Map line)? onRemove;

  /// Id of the line being removed (shows a spinner), or 'add'.
  final String? busy;

  @override
  Widget build(BuildContext context) {
    final total = parts.fold<num>(0, (s, p) => s + (((p as Map)['qtyUsed'] as num?) ?? 0) * ((p['unitCost'] as num?) ?? 0));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionTitle(
          t('Parts used'),
          trailing: canEdit
              ? TextButton.icon(
                  onPressed: busy == null ? onAdd : null,
                  icon: busy == 'add'
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.add, size: 18),
                  label: Text(t('Add part used')),
                )
              : null,
        ),
        if (reservations.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Callout(
              tone: 'neutral',
              title: t('Set aside for this job'),
              text: [
                for (final r in reservations)
                  '${((r as Map)['part'] as Map?)?['name'] ?? ''} × ${fmtNumber(r['quantity'])} ${(r['part'] as Map?)?['unit'] ?? ''}'.trim(),
              ].join('\n'),
            ),
          ),
        if (parts.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(t('No parts used yet.'), style: const TextStyle(color: AppColors.muted)),
          )
        else
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Column(
              children: [
                for (final (i, p) in parts.indexed) ...[
                  if (i > 0) const Divider(height: 1),
                  _PartLine(
                    line: p as Map,
                    canRemove: canEdit && p['pending'] != true && onRemove != null,
                    busy: busy == p['id']?.toString(),
                    onRemove: () => onRemove?.call(p),
                  ),
                ],
              ],
            ),
          ),
        if (total > 0)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              t('Parts cost: {amount}', {'amount': fmtMoney(total)}),
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ),
      ],
    );
  }
}

class _PartLine extends StatelessWidget {
  const _PartLine({required this.line, required this.canRemove, required this.busy, required this.onRemove});
  final Map line;
  final bool canRemove;
  final bool busy;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final part = (line['part'] as Map?) ?? const {};
    final cost = line['unitCost'] is num ? (line['unitCost'] as num) * ((line['qtyUsed'] as num?) ?? 0) : null;
    final sub = [
      if ((part['partNumber'] ?? '').toString().isNotEmpty) part['partNumber'].toString(),
      if (line['condition'] != null && line['condition'] != 'NEW') label(line['condition']),
      if (cost != null && cost > 0) fmtMoney(cost),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(part['name']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                if (sub.isNotEmpty) Text(sub, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
              ],
            ),
          ),
          if (line['pending'] == true) ...[const _PendingMark(), const SizedBox(width: 6)],
          Text('${fmtNumber(line['qtyUsed'])} ${part['unit'] ?? ''}'.trim(), style: const TextStyle(fontWeight: FontWeight.w600)),
          if (canRemove)
            busy
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : IconButton(
                    tooltip: t('Remove {name}', {'name': part['name'] ?? ''}),
                    icon: const Icon(Icons.delete_outline, color: AppColors.dangerFg),
                    onPressed: onRemove,
                  ),
        ],
      ),
    );
  }
}

/// What [UsePartScreen] returns: the API body and what the phone shows until it is sent.
typedef PartUse = ({Json body, Json meta});

/// Picks a part from the restaurant's stock, the quantity and its condition.
class UsePartScreen extends StatefulWidget {
  const UsePartScreen({super.key, required this.load});

  /// Parts with this restaurant's stock (GET /parts?restaurantId=…).
  final Future<List> Function() load;

  @override
  State<UsePartScreen> createState() => _UsePartScreenState();
}

class _UsePartScreenState extends State<UsePartScreen> {
  List? _parts;
  Object? _error;
  String _q = '';
  Map? _part;
  final _qty = TextEditingController(text: '1');
  String _condition = 'NEW';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final p = await widget.load();
      if (mounted) setState(() => _parts = p);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  static num _inStock(Map p) => (((p['stock'] as Map?)?['quantity']) as num?) ?? 0;

  @override
  Widget build(BuildContext context) {
    final parts = _parts;
    return Scaffold(
      appBar: AppBar(title: Text(t('Add part used'))),
      body: parts == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : (_part == null ? _list(parts) : _form(_part!)),
    );
  }

  Widget _list(List parts) {
    final q = _q.trim().toLowerCase();
    final shown = [
      for (final p in parts)
        if (q.isEmpty ||
            '${(p as Map)['name']} ${p['partNumber']} ${p['sku'] ?? ''}'.toLowerCase().contains(q))
          p as Map,
    ];
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            decoration: InputDecoration(hintText: t('Search parts'), prefixIcon: const Icon(Icons.search), isDense: true),
            onChanged: (v) => setState(() => _q = v),
          ),
          const SizedBox(height: 12),
          if (parts.isEmpty)
            EmptyState(icon: Icons.inventory_2_outlined, title: t('No parts in the catalogue yet.'))
          else if (shown.isEmpty)
            EmptyState(icon: Icons.search_off, title: t('No parts found'))
          else
            for (final p in shown)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Opacity(
                  opacity: _inStock(p) > 0 ? 1 : 0.5,
                  child: AppCard(
                    onTap: _inStock(p) > 0 ? () => setState(() => _part = p) : null,
                    child: Row(
                      children: [
                        const IconChip(Icons.settings_outlined, size: 38),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(p['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
                              Text(p['partNumber']?.toString() ?? '', style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                            ],
                          ),
                        ),
                        Text(
                          t('{qty} {unit} in stock', {'qty': fmtNumber(_inStock(p)), 'unit': p['unit'] ?? ''}),
                          style: TextStyle(fontSize: 12.5, color: _inStock(p) > 0 ? AppColors.successFg : AppColors.dangerFg),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
        ],
      ),
    );
  }

  Widget _form(Map p) {
    final qty = parseQty(_qty.text);
    final stock = _inStock(p);
    final String? problem = qty == null || qty <= 0
        ? t('Enter a quantity greater than 0.')
        : !threeDecimals(qty)
        ? t('Use at most 3 decimal places.')
        : qty > stock
        ? t('Not enough in stock.')
        : null;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        AppCard(
          child: Row(
            children: [
              const IconChip(Icons.settings_outlined, size: 42),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                    Text(
                      '${p['partNumber'] ?? ''} · ${t('{qty} {unit} in stock', {'qty': fmtNumber(stock), 'unit': p['unit'] ?? ''})}',
                      style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
              TextButton(onPressed: () => setState(() => _part = null), child: Text(t('Change'))),
            ],
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          key: const ValueKey('part-qty'),
          controller: _qty,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: t('Quantity'),
            suffixText: p['unit']?.toString(),
            errorText: _qty.text.isEmpty ? null : problem,
          ),
        ),
        const SizedBox(height: 16),
        Text(t('Condition'), style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final c in kPartConditions)
              ChoiceChip(label: Text(label(c)), selected: _condition == c, onSelected: (_) => setState(() => _condition = c)),
          ],
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: problem != null
              ? null
              : () => Navigator.pop<PartUse>(context, (
                  body: {'partId': p['id'], 'quantity': qty, 'condition': _condition},
                  meta: {
                    'part': {'id': p['id'], 'name': p['name'], 'partNumber': p['partNumber'], 'unit': p['unit']},
                    'unitCost': p['unitCost'],
                  },
                )),
          icon: const Icon(Icons.check),
          label: Text(t('Use part')),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------- time

/// Time worked on the job: the automatic timer (start / hold / resume / complete)
/// and time a manager added by hand.
class TimeSection extends StatelessWidget {
  const TimeSection({super.key, required this.workOrder, this.canAdd = false, this.onAdd, this.onRemove, this.busy});
  final Json workOrder;

  /// The server's `actions.time` (managers).
  final bool canAdd;
  final VoidCallback? onAdd;
  final void Function(Map entry)? onRemove;
  final String? busy;

  @override
  Widget build(BuildContext context) {
    final entries = (workOrder['timeEntries'] as List?) ?? const [];
    final minutes = (workOrder['minutesWorked'] as num?) ?? 0;
    final running = workOrder['timerRunning'] == true;
    if (entries.isEmpty && !canAdd && minutes == 0 && !running) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionTitle(
          t('Time'),
          trailing: canAdd
              ? TextButton.icon(
                  onPressed: busy == null ? onAdd : null,
                  icon: busy == 'add'
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.more_time, size: 18),
                  label: Text(t('Add time')),
                )
              : null,
        ),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.timer_outlined, size: 18, color: AppColors.muted),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(t('Worked {time}', {'time': fmtDuration(minutes)}), style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                  if (running) Pill(t('Timer running'), tone: 'warning', icon: Icons.fiber_manual_record),
                ],
              ),
              if (entries.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(t('No time logged yet.'), style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                )
              else
                for (final e in entries) _TimeLine(
                  entry: e as Map,
                  canRemove: canAdd && e['manual'] == true && e['pending'] != true && onRemove != null,
                  busy: busy == e['id']?.toString(),
                  onRemove: () => onRemove?.call(e),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TimeLine extends StatelessWidget {
  const _TimeLine({required this.entry, required this.canRemove, required this.busy, required this.onRemove});
  final Map entry;
  final bool canRemove;
  final bool busy;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final sub = [
      fmtDateTime(entry['startedAt']),
      if (entry['manual'] == true) t('added by hand'),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        children: [
          Avatar(entry['user'], size: 30),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(personName(entry['user']), style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13.5)),
                Text(sub, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                if ((entry['note'] ?? '').toString().isNotEmpty) Text(entry['note'].toString(), style: const TextStyle(fontSize: 12.5)),
              ],
            ),
          ),
          if (entry['pending'] == true) ...[const _PendingMark(), const SizedBox(width: 6)],
          Text(
            entry['minutes'] == null ? t('Timer running') : fmtDuration(entry['minutes']),
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
          ),
          if (canRemove)
            busy
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : IconButton(
                    tooltip: t('Remove this time'),
                    icon: const Icon(Icons.delete_outline, color: AppColors.dangerFg),
                    onPressed: onRemove,
                  ),
        ],
      ),
    );
  }
}

/// What [AddTimeScreen] returns.
typedef TimeAdd = ({Json body, Json meta});

/// A manager adds time by hand (forgotten timer, work done without the app).
class AddTimeScreen extends StatefulWidget {
  const AddTimeScreen({super.key, required this.workOrder, this.now});
  final Json workOrder;

  /// Fixed "now" for tests.
  final DateTime? now;

  @override
  State<AddTimeScreen> createState() => _AddTimeScreenState();
}

class _AddTimeScreenState extends State<AddTimeScreen> {
  late final List<Map> _people;
  String? _userId;
  final _minutes = TextEditingController();
  final _note = TextEditingController();
  late DateTime _start;

  @override
  void initState() {
    super.initState();
    final w = widget.workOrder;
    final assignee = w['assignedUser'] as Map?;
    _people = [
      ?assignee,
      for (final h in (w['helpers'] as List?) ?? const [])
        if ((h as Map)['id'] != assignee?['id']) h,
    ];
    _userId = _people.isEmpty ? null : _people.first['id']?.toString();
    final now = widget.now ?? DateTime.now();
    final hourAgo = now.subtract(const Duration(hours: 1));
    _start = DateTime(hourAgo.year, hourAgo.month, hourAgo.day, hourAgo.hour, hourAgo.minute);
  }

  @override
  void dispose() {
    _minutes.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickStart() async {
    final now = widget.now ?? DateTime.now();
    final d = await showDatePicker(
      context: context,
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now,
      initialDate: _start.isAfter(now) ? now : _start,
    );
    if (d == null || !mounted) return;
    final tm = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_start));
    if (tm == null) return;
    setState(() => _start = DateTime(d.year, d.month, d.day, tm.hour, tm.minute));
  }

  @override
  Widget build(BuildContext context) {
    final minutes = int.tryParse(_minutes.text.trim());
    final minutesOk = minutes != null && minutes >= 1 && minutes <= 24 * 60;
    final ok = _userId != null && minutesOk && _note.text.trim().length >= 3;
    final person = _people.where((p) => p['id']?.toString() == _userId).firstOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(t('Add time'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(t('For work done without the timer. It counts towards labour cost.'), style: const TextStyle(color: AppColors.muted)),
          const SizedBox(height: 16),
          if (_people.isEmpty)
            Callout(tone: 'warning', text: t('Assign a technician first.'))
          else
            DropdownButtonFormField<String>(
              initialValue: _userId,
              isExpanded: true,
              decoration: InputDecoration(labelText: t('Who worked')),
              items: [for (final p in _people) DropdownMenuItem(value: p['id'].toString(), child: Text(personName(p)))],
              onChanged: (v) => setState(() => _userId = v),
            ),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('time-minutes'),
            controller: _minutes,
            keyboardType: TextInputType.number,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: t('Minutes'),
              suffixText: t('min'),
              errorText: _minutes.text.isEmpty || minutesOk ? null : t('Enter 1 to 1440 minutes.'),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _pickStart,
            icon: const Icon(Icons.event_outlined),
            label: Text('${t('Started at')}: ${fmtDateTime(_start.toIso8601String())}'),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('time-note'),
            controller: _note,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(labelText: t('Reason'), hintText: t('e.g. Forgot to start the timer')),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: ok
                ? () => Navigator.pop<TimeAdd>(context, (
                    body: {
                      'userId': _userId,
                      'minutes': minutes,
                      'startedAt': _start.toUtc().toIso8601String(),
                      'note': _note.text.trim(),
                    },
                    meta: {'user': ?person},
                  ))
                : null,
            icon: const Icon(Icons.check),
            label: Text(t('Add time')),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- meters

/// An asset's meters with their latest value; technicians record readings
/// (from the asset or while doing a job on it).
class MetersSection extends StatefulWidget {
  const MetersSection({super.key, required this.load, required this.record, this.showEmpty = false, this.refresh = 0});

  /// GET /assets/:id/meters.
  final Future<List> Function() load;

  /// POST …/meters/:meterId/readings; returns the fresh meters (null when kept on the phone).
  final Future<List?> Function(Map meter, Json body) record;

  /// Say "no meters" instead of hiding the section.
  final bool showEmpty;

  /// Changes when the screen is pulled to refresh.
  final int refresh;

  @override
  State<MetersSection> createState() => MetersSectionState();
}

class MetersSectionState extends State<MetersSection> {
  List? _meters;
  Object? _error;
  String? _busy;

  @override
  void initState() {
    super.initState();
    reload();
  }

  @override
  void didUpdateWidget(MetersSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refresh != widget.refresh) reload();
  }

  Future<void> reload() async {
    try {
      final m = await widget.load();
      if (mounted) {
        setState(() {
          _meters = m;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _record(Map m) async {
    final body = await askReading(context, m);
    if (body == null || !mounted) return;
    setState(() => _busy = m['id']?.toString());
    try {
      final fresh = await widget.record(m, body);
      if (fresh != null && mounted) setState(() => _meters = fresh);
      if (mounted) toast(context, t('Reading saved.'));
    } on ApiException catch (e) {
      if (!e.queued) {
        if (mounted) toast(context, errorText(e), error: true);
        return;
      }
      // Kept on the phone: the saved copy already shows the new value.
      await reload();
      if (mounted) toast(context, e.message);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final meters = _meters;
    if (meters == null) {
      if (_error == null) return const SizedBox.shrink(); // loading: don't push the screen around
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          children: [
            const Icon(Icons.speed, size: 18, color: AppColors.muted),
            const SizedBox(width: 6),
            Expanded(child: Text(t('Could not load the meters.'), style: const TextStyle(color: AppColors.muted))),
            TextButton(onPressed: reload, child: Text(t('Retry'))),
          ],
        ),
      );
    }
    if (meters.isEmpty && !widget.showEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionTitle(t('Meters')),
          if (meters.isEmpty)
            Text(t('No meters on this asset yet.'), style: const TextStyle(color: AppColors.muted))
          else
            AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              child: Column(
                children: [
                  for (final (i, m) in meters.indexed) ...[
                    if (i > 0) const Divider(height: 1),
                    _MeterLine(
                      meter: m as Map,
                      busy: _busy == m['id']?.toString(),
                      onRecord: _busy == null && (m['can'] as Map?)?['read'] == true ? () => _record(m) : null,
                      onHistory: ((m['readings'] as List?) ?? const []).isEmpty ? null : () => showReadings(context, m),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _MeterLine extends StatelessWidget {
  const _MeterLine({required this.meter, required this.busy, this.onRecord, this.onHistory});
  final Map meter;
  final bool busy;
  final VoidCallback? onRecord;
  final VoidCallback? onHistory;

  @override
  Widget build(BuildContext context) {
    final value = meter['currentValue'];
    final pending = ((meter['readings'] as List?) ?? const []).any((r) => (r as Map)['pending'] == true);
    return InkWell(
      onTap: onHistory,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            const IconChip(Icons.speed, size: 36),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(meter['name']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(
                    [label(meter['type']), if (meter['lastReadingAt'] != null) fmtRelative(meter['lastReadingAt'])].join(' · '),
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        value == null ? '—' : '${fmtNumber(value)} ${meter['unit'] ?? ''}'.trim(),
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                      ),
                      if (pending) ...[const SizedBox(width: 6), const _PendingMark()],
                    ],
                  ),
                ],
              ),
            ),
            if (onRecord != null || busy)
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(0, 42), padding: const EdgeInsets.symmetric(horizontal: 14)),
                onPressed: onRecord,
                child: busy
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Text(t('Record reading')),
              ),
          ],
        ),
      ),
    );
  }
}

/// Asks for a reading of [meter]: `{value, note}`, or null when cancelled.
Future<Json?> askReading(BuildContext context, Map meter) {
  final value = TextEditingController();
  final note = TextEditingController();
  final last = meter['currentValue'];
  return showDialog<Json>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        final v = parseQty(value.text);
        final String? problem = value.text.trim().isEmpty
            ? null
            : v == null
            ? t('Enter a valid number.')
            : !threeDecimals(v)
            ? t('Use at most 3 decimal places.')
            : null;
        return AlertDialog(
          title: Text(t('Record reading')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                [
                  meter['name']?.toString() ?? '',
                  if (last != null) t('last {value} {unit}', {'value': fmtNumber(last), 'unit': meter['unit'] ?? ''}),
                ].join(' · '),
                style: const TextStyle(color: AppColors.muted),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('reading-value'),
                controller: value,
                autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(labelText: t('Reading'), suffixText: meter['unit']?.toString(), errorText: problem),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('reading-note'),
                controller: note,
                decoration: InputDecoration(labelText: t('Note (optional)')),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: Text(t('Cancel'))),
            FilledButton(
              onPressed: v != null && problem == null
                  ? () => Navigator.pop<Json>(ctx, {'value': v, 'note': note.text.trim()})
                  : null,
              child: Text(t('Save')),
            ),
          ],
        );
      },
    ),
  );
}

/// The latest readings of a meter (newest first).
Future<void> showReadings(BuildContext context, Map meter) => showModalBottomSheet<void>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (ctx) => SafeArea(
    child: ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
            child: Text(meter['name']?.toString() ?? '', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text(t('Latest 20 readings.'), style: const TextStyle(color: AppColors.muted, fontSize: 13)),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final r in (meter['readings'] as List?) ?? const [])
                  ListTile(
                    dense: true,
                    title: Text('${fmtNumber((r as Map)['value'])} ${meter['unit'] ?? ''}'.trim(),
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text(
                      [
                        fmtDateTime(r['readAt']),
                        if (r['user'] != null) personName(r['user']),
                        if ((r['note'] ?? '').toString().isNotEmpty) r['note'].toString(),
                      ].join(' · '),
                    ),
                    trailing: r['pending'] == true
                        ? const _PendingMark()
                        : r['delta'] is num
                        ? Text(
                            '${(r['delta'] as num) > 0 ? '+' : ''}${fmtNumber(r['delta'])}',
                            style: TextStyle(color: (r['delta'] as num) < 0 ? AppColors.dangerFg : AppColors.muted),
                          )
                        : null,
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  ),
);

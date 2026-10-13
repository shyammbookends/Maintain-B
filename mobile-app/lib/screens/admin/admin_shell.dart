import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/push.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/chat_fab.dart';
import '../../widgets/common.dart';
import '../../widgets/offline_banner.dart';
import '../shared/asset_screen.dart';
import '../shared/inspection_screens.dart';
import '../shared/misc_screens.dart';
import '../shared/report_screen.dart';
import '../shared/work_order_screen.dart';
import '../worker/worker_shell.dart' show greeting;
import 'admin_lists.dart';
import 'analytics_screen.dart';
import 'categories_screen.dart';
import 'editors.dart';
import 'workflow_settings_screen.dart';

/// Admin app on a phone: the web's bottom tab bar (Dashboard, Work orders,
/// Requests, Assets) plus a Menu with every other module.
class AdminShell extends StatefulWidget {
  const AdminShell({super.key});
  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  int _tab = 0;
  int _unread = 0;
  Timer? _timer;
  Key _assetsKey = UniqueKey();

  @override
  void initState() {
    super.initState();
    _refreshUnread();
    _timer = Timer.periodic(const Duration(minutes: 2), (_) => _refreshUnread());
    liveUnread.addListener(_onLive);
  }

  @override
  void dispose() {
    _timer?.cancel();
    liveUnread.removeListener(_onLive);
    super.dispose();
  }

  /// Live unread count from the server (changes the moment something arrives or is read).
  void _onLive() {
    final v = liveUnread.value;
    if (v != null && mounted) setState(() => _unread = v);
  }

  Future<void> _refreshUnread() async {
    try {
      final r = await apiOf(context).getData<Json>('/notifications/unread-count');
      if (mounted) setState(() => _unread = (r['count'] ?? 0) as int);
    } catch (_) {}
  }

  void _openNotifications() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => NotificationsScreen(onChanged: _refreshUnread)));
    _refreshUnread();
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final tabs = <(String, IconData, IconData, Widget)>[
      if (s.can('dashboard:view')) ('Dashboard', Icons.space_dashboard_outlined, Icons.space_dashboard, const DashboardScreen()),
      if (s.can('work_orders:view')) ('Work orders', Icons.assignment_outlined, Icons.assignment, const WorkOrdersScreen()),
      if (s.can('requests:view')) ('Requests', Icons.inbox_outlined, Icons.inbox, const RequestsScreen(embedded: true)),
      if (s.can('assets:view')) ('Assets', Icons.inventory_2_outlined, Icons.inventory_2, AssetsScreen(key: _assetsKey, embedded: true)),
      ('Menu', Icons.menu, Icons.menu, const AdminMenuScreen()),
    ];
    final index = _tab.clamp(0, tabs.length - 1);
    final current = tabs[index];
    String tabLabel(String id) => switch (id) {
          'Dashboard' => t('Dashboard'),
          'Work orders' => t('Work orders'),
          'Requests' => t('Requests'),
          'Assets' => t('Assets'),
          _ => t('Menu'),
        };
    final bell = IconButton(
      onPressed: _openNotifications,
      icon: Badge(isLabelVisible: _unread > 0, label: Text(_unread > 99 ? '99+' : '$_unread'), child: const Icon(Icons.notifications_none)),
    );
    return Scaffold(
      appBar: current.$1 == 'Menu' ? null : AppBar(title: Text(tabLabel(current.$1)), actions: [bell, const SizedBox(width: 4)]),
      body: current.$4,
      // Chat is one tap away from every tab (above the Menu tab); tab actions sit below it.
      floatingActionButton: _Fabs(
        action: switch (current.$1) {
          'Work orders' when s.can('work_orders:create') => FloatingActionButton.extended(
            heroTag: 'tab-action',
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateWorkOrderScreen())),
            icon: const Icon(Icons.add),
            label: Text(t('New work order')),
          ),
          'Assets' when canManage(context, 'assets:create') => FloatingActionButton.extended(
            heroTag: 'tab-action',
            onPressed: () async {
              if (await openEditor(context, const AssetForm())) setState(() => _assetsKey = UniqueKey());
            },
            icon: const Icon(Icons.add),
            label: Text(t('Add asset')),
          ),
          'Requests' => FloatingActionButton.extended(
            heroTag: 'tab-action',
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ReportScreen())),
            icon: const Icon(Icons.add),
            label: Text(t('New request')),
          ),
          _ => null,
        },
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [for (final tab in tabs) NavigationDestination(icon: Icon(tab.$2), selectedIcon: Icon(tab.$3), label: tabLabel(tab.$1))],
      ),
    );
  }
}

// ---------------------------------------------------------------- dashboard

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    void openWo(Map w) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: w['id'].toString())));
    return DataView<Json>(
      load: () => s.api.getData<Json>('/dashboard'),
      builder: (context, d, reload) {
        final c = (d['counts'] as Map?) ?? const {};
        final today = (d['today'] as Map?) ?? const {};
        final critical = (d['criticalIssues'] as List?) ?? const [];
        final overdue = (d['overdueTasks'] as List?) ?? const [];
        final todays = (d['todaysTasks'] as List?) ?? const [];
        final restaurants = (d['restaurants'] as List?) ?? const [];
        final workload = (d['workload'] as List?) ?? const [];
        final cost = (d['cost'] as Map?) ?? const {};
        final kpis = <(String, dynamic, IconData, String)>[
          (t('Open work orders'), c['open'], Icons.assignment_outlined, 'info'),
          (t('Overdue'), c['overdue'], Icons.alarm, 'danger'),
          (t('In progress'), c['inProgress'], Icons.timer_outlined, 'warning'),
          (t('Pending verification'), c['pendingVerification'], Icons.verified_outlined, 'violet'),
          (t('Completed (30 d)'), c['completed30d'], Icons.task_alt, 'success'),
          (t('Open requests'), c['openRequests'], Icons.inbox_outlined, 'sky'),
          (t('Assets down'), c['assetsDown'], Icons.report_problem_outlined, 'danger'),
          (t('Low stock parts'), c['lowStock'], Icons.inventory_2_outlined, 'warning'),
        ];
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            BrandHero(
              overline: t('{restaurants} restaurants · {technicians} technicians',
                  {'restaurants': c['activeRestaurants'] ?? 0, 'technicians': c['activeWorkers'] ?? 0}),
              title: greeting(s.firstName),
              subtitle: t('Today: {created} new · {completed} completed · {critical} critical', {
                'created': today['created'] ?? 0,
                'completed': today['completed'] ?? 0,
                'critical': today['critical'] ?? 0,
              }),
              person: s.user,
              actions: [
                if (s.can('work_orders:create'))
                  (
                    icon: Icons.add_circle_outline,
                    label: t('New work order'),
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateWorkOrderScreen())),
                  ),
                if (s.can('reports:view'))
                  (
                    icon: Icons.insights_outlined,
                    label: t('Analytics'),
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AnalyticsScreen())),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            StatGrid(
              children: [
                for (final k in kpis)
                  StatTile(label: k.$1, value: k.$2, icon: k.$3, tone: k.$4, alert: k.$4 == 'danger' && (k.$2 ?? 0) > 0),
              ],
            ),
            const SizedBox(height: 14),
            AppCard(
              child: Row(
                children: [
                  _Metric(t('PM compliance'), '${d['pmCompliance'] ?? '—'}%', Icons.shield_outlined, 'success'),
                  _Metric(t('On time'), '${d['onTimeRate'] ?? '—'}%', Icons.schedule_rounded, 'info'),
                  _Metric(t('MTTR'), '${d['mttrHours'] ?? '—'} h', Icons.build_outlined, 'warning'),
                  _Metric(t('Downtime'), '${d['downtimeHours'] ?? 0} h', Icons.power_off_outlined, 'danger'),
                ],
              ),
            ),
            if (s.can('reports:view')) ...[
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AnalyticsScreen())),
                icon: const Icon(Icons.insights_outlined),
                label: Text(t('Open full analytics')),
              ),
            ],
            const SizedBox(height: 10),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const IconChip(Icons.payments_outlined, tone: 'success', size: 34),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(t('Maintenance cost (30 days)'), style: TextStyle(fontWeight: FontWeight.w600)),
                      ),
                      Text(fmtMoney(cost['total']), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const SizedBox(height: 8),
                  _CostBar(cost: cost),
                ],
              ),
            ),
            if (critical.isNotEmpty) ...[
              const SizedBox(height: 18),
              SectionTitle(t('Critical issues')),
              for (final w in critical)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(task: w as Map, showAssignee: true, onTap: () => openWo(w)),
                ),
            ],
            if (overdue.isNotEmpty) ...[
              const SizedBox(height: 8),
              SectionTitle(t('Overdue')),
              for (final w in overdue)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(task: {...w as Map, 'overdue': true}, showAssignee: true, onTap: () => openWo(w)),
                ),
            ],
            if (todays.isNotEmpty) ...[
              const SizedBox(height: 8),
              SectionTitle(t('Today’s tasks')),
              for (final w in todays)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(task: w as Map, showAssignee: true, onTap: () => openWo(w)),
                ),
            ],
            if (workload.isNotEmpty) ...[
              const SizedBox(height: 8),
              SectionTitle(t('Technician workload')),
              AppCard(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    for (final wl in workload)
                      ListTile(
                        leading: Avatar((wl as Map)['user'], size: 34),
                        title: Text(personName(wl['user'])),
                        subtitle: Text(t('{open} open · {progress} in progress · {done} done',
                            {'open': wl['open'], 'progress': wl['inProgress'], 'done': wl['completed']})),
                        trailing: (wl['overdue'] ?? 0) > 0 ? Pill(t('{n} overdue', {'n': wl['overdue']}), tone: 'danger') : null,
                      ),
                  ],
                ),
              ),
            ],
            if (restaurants.isNotEmpty) ...[
              const SizedBox(height: 18),
              SectionTitle(t('Restaurants')),
              for (final r in restaurants)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const IconChip(Icons.storefront_outlined, tone: 'info', size: 32),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text((r as Map)['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            Pill(t('{n} open', {'n': r['open']}), tone: 'info'),
                            if ((r['overdue'] ?? 0) > 0) Pill(t('{n} overdue', {'n': r['overdue']}), tone: 'danger'),
                            if ((r['critical'] ?? 0) > 0) Pill(t('{n} critical', {'n': r['critical']}), tone: 'danger'),
                            Pill(t('{n} completed', {'n': r['completed']}), tone: 'success'),
                            if ((r['assetsDown'] ?? 0) > 0) Pill(t('{n} assets down', {'n': r['assetsDown']}), tone: 'warning'),
                            Pill(fmtMoney(r['cost'])),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ],
        );
      },
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value, this.icon, this.tone);
  final String label;
  final String value;
  final IconData icon;
  final String tone;
  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(color: toneAccent(tone).withValues(alpha: 0.12), shape: BoxShape.circle),
          child: Icon(icon, size: 18, color: toneAccent(tone)),
        ),
        const SizedBox(height: 6),
        Text(value, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        const SizedBox(height: 2),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
        ),
      ],
    ),
  );
}

class _CostBar extends StatelessWidget {
  const _CostBar({required this.cost});
  final Map cost;
  @override
  Widget build(BuildContext context) {
    final parts = <(String, num, Color)>[
      (t('Parts'), (cost['parts'] ?? 0) as num, AppColors.info),
      (t('Labour'), (cost['labour'] ?? 0) as num, AppColors.success),
      (t('Vendor'), (cost['vendor'] ?? 0) as num, AppColors.brandTo),
      (t('Other'), (cost['other'] ?? 0) as num, AppColors.warning),
    ];
    final total = parts.fold<num>(0, (a, b) => a + b.$2);
    if (total <= 0) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: Row(
            children: [
              for (final p in parts)
                if (p.$2 > 0)
                  Expanded(
                    flex: (p.$2 / total * 1000).round().clamp(1, 1000),
                    child: Container(height: 10, color: p.$3),
                  ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 12,
          runSpacing: 4,
          children: [
            for (final p in parts)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(color: p.$3, borderRadius: BorderRadius.circular(3)),
                  ),
                  const SizedBox(width: 4),
                  Text('${p.$1} ${fmtMoney(p.$2)}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------- work orders

class WorkOrdersScreen extends StatefulWidget {
  const WorkOrdersScreen({super.key});
  @override
  State<WorkOrdersScreen> createState() => _WorkOrdersScreenState();
}

class _WorkOrdersScreenState extends State<WorkOrdersScreen> {
  static List<(String, String, Map<String, String>)> get _filters => [
        ('active', t('Active'), const {'view': 'active'}),
        ('overdue', t('Overdue'), const {'view': 'overdue'}),
        ('open', t('Unassigned'), const {'view': 'unassigned'}),
        ('progress', t('In progress'), const {'status': 'IN_PROGRESS'}),
        ('hold', t('On hold'), const {'status': 'ON_HOLD'}),
        ('review', t('To verify'), const {'view': 'review'}),
        ('done', t('Done'), const {'view': 'done'}),
      ];
  String _filter = 'active';
  String _q = '';
  final _key = GlobalKey<DataViewState<List>>();

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final f = _filters.firstWhere((x) => x.$1 == _filter);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            decoration: InputDecoration(hintText: t('Search work orders'), prefixIcon: const Icon(Icons.search), isDense: true),
            onSubmitted: (v) {
              _q = v;
              _key.currentState?.reload();
            },
          ),
        ),
        SizedBox(
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
            children: [
              for (final x in _filters)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(x.$2),
                    selected: _filter == x.$1,
                    onSelected: (_) {
                      setState(() => _filter = x.$1);
                      _key.currentState?.reload();
                    },
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: DataView<List>(
            key: _key,
            load: () async {
              final res = await api.get('/work-orders', {
                'pageSize': 100,
                'q': _q,
                'sort': _filter == 'done' ? 'createdAt:desc' : 'dueDate:asc',
                ...f.$3,
              }) as Map;
              return res['data'] as List;
            },
            builder: (context, items, reload) => items.isEmpty
                ? ListView(
                    children: [EmptyState(icon: Icons.assignment_outlined, title: t('No work orders here'))],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 90),
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, i) => TaskCard(
                      task: items[i] as Map,
                      showAssignee: true,
                      onTap: () async {
                        await Navigator.of(context)
                            .push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: (items[i] as Map)['id'].toString())));
                        reload();
                      },
                    ),
                  ),
          ),
        ),
      ],
    );
  }
}

class CreateWorkOrderScreen extends StatefulWidget {
  const CreateWorkOrderScreen({super.key});
  @override
  State<CreateWorkOrderScreen> createState() => _CreateWorkOrderScreenState();
}

class _CreateWorkOrderScreenState extends State<CreateWorkOrderScreen> {
  final _title = TextEditingController();
  final _desc = TextEditingController();
  String? _restaurantId;
  String? _locationId;
  String? _assetId;
  String? _assigneeId;
  String _category = 'OTHER';
  String _priority = 'MEDIUM';
  DateTime? _due;
  List _locations = const [];
  List _assets = const [];
  List _people = const [];
  bool _busy = false;

  ApiClient get api => apiOf(context);

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId = rs.isNotEmpty ? rs.first['id'].toString() : null;
    _loadRestaurant();
  }

  Future<void> _loadRestaurant() async {
    final rid = _restaurantId;
    if (rid == null) return;
    try {
      final results = await Future.wait([
        api.getData<List>('/locations', {'restaurantId': rid}),
        api.get('/assets', {'restaurantId': rid, 'pageSize': 100, 'sort': 'name:asc'}),
        api.getData<List>('/work-orders/workload', {'restaurantId': rid}),
      ]);
      if (!mounted) return;
      setState(() {
        _locations = results[0] as List;
        _assets = (results[1] as Map)['data'] as List;
        _people = results[2] as List;
      });
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    }
  }

  /// Adds an asset without leaving the form, then selects it.
  Future<void> _newAsset() async {
    final before = {for (final a in _assets) (a as Map)['id'].toString()};
    if (!await openEditor(context, AssetForm(restaurantId: _restaurantId))) return;
    await _loadRestaurant();
    final added = _assets.cast<Map>().where((a) => !before.contains(a['id'].toString())).toList();
    if (added.isNotEmpty && mounted) {
      setState(() {
        _assetId = added.first['id'].toString();
        _locationId ??= (added.first['location'] as Map?)?['id']?.toString();
      });
    }
  }

  Future<void> _pickDue() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      initialDate: _due ?? now,
    );
    if (d == null || !mounted) return;
    // Date only: due by the end of that day.
    setState(() => _due = DateTime(d.year, d.month, d.day, 23, 59));
  }

  Future<void> _save() async {
    if (_title.text.trim().length < 3 || _restaurantId == null) {
      toast(context, t('A title (3+ letters) and a restaurant are required'), error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final wo = await api.postData<Json>('/work-orders', {
        'title': _title.text.trim(),
        'description': _desc.text.trim(),
        'category': _category,
        'priority': _priority,
        'restaurantId': _restaurantId,
        'locationId': _locationId ?? '',
        'assetId': _assetId ?? '',
        'dueDate': _due?.toUtc().toIso8601String() ?? '',
        'assignedUserId': _assigneeId ?? '',
        'assignedTeamId': '',
        // Required by the API; '' = not created from a request.
        'requestId': '',
      });
      if (!mounted) return;
      toast(context, t('Work order {code} created', {'code': wo['code']}));
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: wo['id'].toString())));
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
      appBar: AppBar(title: Text(t('New work order'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _title,
            decoration: InputDecoration(labelText: t('Title *'), hintText: t('e.g. Fridge not cooling')),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _desc,
            minLines: 3,
            maxLines: 6,
            decoration: InputDecoration(labelText: t('Description'), alignLabelWithHint: true),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _restaurantId,
            isExpanded: true,
            decoration: InputDecoration(labelText: t('Restaurant *')),
            items: [for (final r in rs) DropdownMenuItem(value: r['id'].toString(), child: Text(r['name'].toString()))],
            onChanged: (v) {
              setState(() {
                _restaurantId = v;
                _locationId = null;
                _assetId = null;
                _assigneeId = null;
              });
              _loadRestaurant();
            },
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String?>(
            key: ValueKey('l-$_restaurantId-${_locations.length}'),
            initialValue: _locationId,
            isExpanded: true,
            decoration: InputDecoration(labelText: t('Location')),
            items: [
              const DropdownMenuItem(value: null, child: Text('—')),
              for (final l in _locations) DropdownMenuItem(value: (l as Map)['id'].toString(), child: Text(l['name'].toString())),
            ],
            onChanged: (v) => setState(() => _locationId = v),
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: DropdownButtonFormField<String?>(
                  key: ValueKey('a-$_restaurantId-${_assets.length}-$_assetId'),
                  initialValue: _assetId,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: t('Asset')),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('—')),
                    for (final a in _assets)
                      DropdownMenuItem(value: (a as Map)['id'].toString(), child: Text('${a['name']} · ${a['assetCode']}')),
                  ],
                  onChanged: (v) => setState(() => _assetId = v),
                ),
              ),
              if (canManage(context, 'assets:create')) ...[
                const SizedBox(width: 8),
                SizedBox(
                  height: 54,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 54), padding: const EdgeInsets.symmetric(horizontal: 12)),
                    onPressed: _restaurantId == null ? null : _newAsset,
                    icon: const Icon(Icons.add, size: 20),
                    label: Text(t('New')),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _category,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: t('Category')),
                  items: [for (final c in kCategories) DropdownMenuItem(value: c, child: Text(label(c)))],
                  onChanged: (v) => setState(() => _category = v ?? _category),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _priority,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: t('Priority')),
                  items: [for (final p in kPriorities) DropdownMenuItem(value: p, child: Text(label(p)))],
                  onChanged: (v) => setState(() => _priority = v ?? _priority),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String?>(
            key: ValueKey('p-$_restaurantId-${_people.length}'),
            initialValue: _assigneeId,
            isExpanded: true,
            decoration: InputDecoration(labelText: t('Assign to')),
            items: [
              DropdownMenuItem(value: null, child: Text(t('Leave unassigned'))),
              for (final p in _people)
                DropdownMenuItem(
                  value: ((p as Map)['user'] as Map)['id'].toString(),
                  child: Text('${personName(p['user'])} · ${t('{n} open', {'n': p['openCount']})}'),
                ),
            ],
            onChanged: (v) => setState(() => _assigneeId = v),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _pickDue,
            icon: const Icon(Icons.event_outlined),
            label: Text(_due == null ? t('Set due date') : t('Due {date}', {'date': fmtDate(_due!.toIso8601String())})),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(onPressed: _busy ? null : _save, icon: const Icon(Icons.check), label: Text(t('Create work order'))),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- menu

class AdminMenuScreen extends StatelessWidget {
  const AdminMenuScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    void go(Widget page) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
    final groups = <(String, List<(IconData, String, Widget, bool)>)>[
      (
        t('Work'),
        [
          (Icons.insights_outlined, t('Analytics'), const AnalyticsScreen(), s.can('reports:view')),
          (Icons.notifications_none, t('Notifications'), const NotificationsScreen(), true),
          (Icons.forum_outlined, t('Chat'), const ChatListScreen(), true),
          (Icons.fact_check_outlined, t('Inspections'), const InspectionsScreen(), s.can('inspections:view')),
          (Icons.qr_code_scanner, t('Scan QR'), const ScanScreen(), s.can('assets:view')),
        ],
      ),
      (
        t('Purchasing'),
        [
          (Icons.inventory_2_outlined, t('Inventory'), const PartsScreen(), s.can('parts:view')),
          (Icons.receipt_long_outlined, t('Purchase orders'), const PurchaseOrdersScreen(), s.can('purchase_orders:view')),
          (Icons.local_shipping_outlined, t('Vendors'), const VendorsScreen(), s.can('vendors:view')),
        ],
      ),
      (
        t('Organization'),
        [
          (Icons.storefront_outlined, t('Restaurants'), const AdminRestaurantsScreen(), s.can('restaurants:view')),
          (Icons.groups_outlined, t('Teams'), const TeamsScreen(), s.can('teams:view')),
          (Icons.category_outlined, t('Asset categories'), const CategoriesScreen(), s.can('assets:view') && s.isAdmin),
          (Icons.description_outlined, t('Documents'), const DocumentsScreen(), s.can('documents:view')),
          (Icons.people_outline, t('Users'), const UsersScreen(), s.can('users:view')),
        ],
      ),
      (
        t('Administration'),
        [
          // Super Admin only.
          (Icons.account_tree_outlined, t('Work order flow'), const WorkflowSettingsScreen(), s.isSuperAdmin),
        ],
      ),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(t('Menu'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ProfileBanner(person: s.user, name: s.fullName, role: s.roleName, onTap: () => go(const ProfileScreen())),
          if (s.api.offline case final off?)
            ListenableBuilder(
              listenable: off,
              builder: (context, _) => off.pending + off.failed.length == 0
                  ? const SizedBox.shrink()
                  : Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: MenuList(items: [
                        (
                          icon: Icons.cloud_upload_outlined,
                          title: t('Unsent changes ({n})', {'n': off.pending + off.failed.length}),
                          onTap: () => go(const OfflineQueueScreen()),
                        ),
                      ]),
                    ),
            ),
          for (final g in groups)
            if (g.$2.any((i) => i.$4)) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
                child: Text(
                  g.$1.toUpperCase(),
                  style: const TextStyle(fontSize: 11.5, letterSpacing: 0.8, fontWeight: FontWeight.w600, color: AppColors.muted),
                ),
              ),
              MenuList(items: [for (final it in g.$2.where((x) => x.$4)) (icon: it.$1, title: it.$2, onTap: () => go(it.$3))]),
            ],
          const SizedBox(height: 20),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: () async {
              if (await confirm(context, t('Sign out?'), action: t('Sign out')) && context.mounted) {
                await context.read<Session>().logout();
              }
            },
            icon: const Icon(Icons.logout),
            label: Text(t('Sign out')),
          ),
        ],
      ),
    );
  }
}

/// Chat button with the current tab's action (if any) below it.
class _Fabs extends StatelessWidget {
  const _Fabs({this.action});
  final Widget? action;
  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.end,
    children: [
      const ChatFab(),
      if (action != null) ...[const SizedBox(height: 14), action!],
    ],
  );
}

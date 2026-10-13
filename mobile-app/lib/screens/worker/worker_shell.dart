import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/offline.dart';
import '../../core/push.dart';
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

String greeting(String name) {
  final h = DateTime.now().hour;
  return h < 12
      ? t('Good morning, {name}', {'name': name})
      : h < 17
      ? t('Good afternoon, {name}', {'name': name})
      : t('Good evening, {name}', {'name': name});
}

/// Worker app: Home · My tasks (or My reports for staff) · Scan · Alerts · More.
class WorkerShell extends StatefulWidget {
  const WorkerShell({super.key});
  @override
  State<WorkerShell> createState() => _WorkerShellState();
}

class _WorkerShellState extends State<WorkerShell> {
  int _tab = 0;
  int _unread = 0;
  Timer? _timer;

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

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final doesWork = s.can('work_orders:view');
    final pages = <Widget>[
      doesWork ? WorkerHome(onTab: (i) => setState(() => _tab = i)) : const RequesterHome(),
      doesWork
          ? const WorkerTasksScreen()
          // Without its own Report button, so it doesn't sit under the chat button.
          : Scaffold(
              appBar: AppBar(title: Text(t('My reports'))),
              body: const RequestsScreen(mine: true, embedded: true),
            ),
      const ScanScreen(),
      NotificationsScreen(embedded: true, onChanged: _refreshUnread),
      const WorkerMoreScreen(),
    ];
    return Scaffold(
      // Only the open tab is built, so the camera runs only on Scan.
      body: pages[_tab],
      // Chat one tap away (above More); hidden on Scan, which has its own bottom bar.
      floatingActionButton: _tab == 2 ? null : const ChatFab(),
      // Offline / unsent changes strip sits just above the tabs on every page.
      bottomNavigationBar: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const OfflineBanner(),
          _nav(doesWork),
        ],
      ),
    );
  }

  Widget _nav(bool doesWork) {
    final off = apiOf(context).offline;
    return NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) {
          setState(() => _tab = i);
          if (i == 3) _refreshUnread();
        },
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home), label: t('Home')),
          doesWork
              ? NavigationDestination(icon: const Icon(Icons.assignment_outlined), selectedIcon: const Icon(Icons.assignment), label: t('My tasks'))
              : NavigationDestination(icon: const Icon(Icons.inbox_outlined), selectedIcon: const Icon(Icons.inbox), label: t('My reports')),
          NavigationDestination(icon: const Icon(Icons.qr_code_scanner), label: t('Scan')),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: _unread > 0,
              label: Text(_unread > 9 ? '9+' : '$_unread'),
              child: const Icon(Icons.notifications_none),
            ),
            selectedIcon: Badge(
              isLabelVisible: _unread > 0,
              label: Text(_unread > 9 ? '9+' : '$_unread'),
              child: const Icon(Icons.notifications),
            ),
            label: t('Alerts'),
          ),
          NavigationDestination(
            // Changes kept on the phone (waiting or refused) show on More.
            icon: off == null
                ? const Icon(Icons.menu)
                : ListenableBuilder(
                    listenable: off,
                    builder: (_, _) {
                      final n = off.pending + off.failed.length;
                      return Badge(
                        isLabelVisible: n > 0,
                        backgroundColor: off.failed.isNotEmpty ? AppColors.danger : AppColors.warning,
                        label: Text(n > 9 ? '9+' : '$n'),
                        child: const Icon(Icons.menu),
                      );
                    },
                  ),
            label: t('More'),
          ),
        ],
    );
  }
}

class WorkerHome extends StatelessWidget {
  const WorkerHome({super.key, required this.onTab});
  final void Function(int) onTab;

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final api = s.api;
    final today = DateFormat('EEEE, d MMMM').format(DateTime.now());
    return SafeArea(
      child: DataView<Json>(
        load: () => api.getData<Json>('/me/home'),
        builder: (context, home, reload) {
          final c = (home['counts'] as Map?) ?? const {};
          final next = (home['next'] as List?) ?? const [];
          final waiting = ((c['today'] ?? 0) as int) + ((c['overdue'] ?? 0) as int);
          void openTasks([String view = 'today', String? priority, bool pm = false]) => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => WorkerTasksScreen(initialView: view, priority: priority, pmOnly: pm, standalone: true),
            ),
          );
          final stats = <(String, dynamic, IconData, String, VoidCallback, bool)>[
            (t('Today'), c['today'], Icons.list_alt, 'info', () => onTab(1), false),
            (t('Overdue'), c['overdue'], Icons.alarm, 'danger', () => openTasks('overdue'), (c['overdue'] ?? 0) > 0),
            (t('In progress'), c['inProgress'], Icons.timer_outlined, 'warning', () => onTab(1), false),
            (t('Done this week'), c['doneThisWeek'], Icons.event_available, 'success', () => openTasks('done'), false),
            (
              t('High priority'),
              c['highPriority'],
              Icons.local_fire_department_outlined,
              'danger',
              () => openTasks('upcoming', 'CRITICAL'),
              false,
            ),
            (t('Preventive'), c['preventive'], Icons.build_outlined, 'violet', () => openTasks('upcoming', null, true), false),
            (
              t('Checklists due'),
              c['checklistsDue'],
              Icons.fact_check_outlined,
              'sky',
              () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ChecklistsScreen())),
              false,
            ),
          ];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              BrandHero(
                overline: today,
                title: greeting(s.firstName),
                subtitle: waiting > 0
                    ? (waiting == 1
                          ? t('You have 1 task waiting today.')
                          : t('You have {n} tasks waiting today.', {'n': waiting}))
                    : t('Nothing urgent right now. Great work!'),
                person: s.user,
                actions: [
                  (icon: Icons.assignment_outlined, label: t('My tasks'), onTap: () => onTab(1)),
                  (icon: Icons.qr_code_scanner, label: t('Scan'), onTap: () => onTab(2)),
                ],
              ),
              const SizedBox(height: 18),
              StatGrid(
                children: [
                  for (final st in stats) StatTile(label: st.$1, value: st.$2, icon: st.$3, tone: st.$4, onTap: st.$5, alert: st.$6),
                ],
              ),
              const SizedBox(height: 20),
              SectionTitle(
                t('Next up'),
                trailing: next.isEmpty ? null : TextButton(onPressed: () => onTab(1), child: Text(t('See all'))),
              ),
              if (next.isEmpty)
                AppCard(
                  child: EmptyState(icon: Icons.done_all, title: t('All caught up!'), body: t('No tasks for today.')),
                )
              else
                for (final task in next)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TaskCard(
                      task: task as Map,
                      onTap: () async {
                        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: task['id'].toString())));
                        reload();
                      },
                    ),
                  ),
              const SizedBox(height: 14),
              SectionTitle(t('Quick actions')),
              _QuickAction(
                tone: 'danger',
                icon: Icons.campaign_outlined,
                title: t('Report a problem'),
                hint: t('Something broken? Tell us in seconds'),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ReportScreen())),
              ),
              _QuickAction(
                icon: Icons.qr_code_scanner,
                title: t('Scan'),
                hint: t('Open any machine from its QR code'),
                onTap: () => onTab(2),
                tone: 'violet',
              ),
              _QuickAction(
                icon: Icons.fact_check_outlined,
                title: t('Checklists'),
                hint: t('Opening, closing and safety checks'),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ChecklistsScreen())),
                tone: 'success',
              ),
            ],
          );
        },
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({required this.icon, required this.title, required this.hint, required this.onTap, this.tone = 'info'});
  final IconData icon;
  final String title;
  final String hint;
  final VoidCallback onTap;
  final String tone;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [toneAccent(tone), Color.lerp(toneAccent(tone), Colors.black, 0.18)!],
              ),
              borderRadius: BorderRadius.circular(14),
              boxShadow: [BoxShadow(color: toneAccent(tone).withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, 4))],
            ),
            child: Icon(icon, color: Colors.white, size: 23),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const SizedBox(height: 2),
                Text(
                  hint,
                  style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(color: toneAccent(tone).withValues(alpha: 0.1), shape: BoxShape.circle),
            child: Icon(Icons.arrow_forward_rounded, size: 17, color: toneAccent(tone)),
          ),
        ],
      ),
    ),
  );
}

/// Restaurant staff (requesters): one big report button and their reports.
class RequesterHome extends StatelessWidget {
  const RequesterHome({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    return SafeArea(
      child: DataView<List>(
        load: () async => (await s.api.get('/requests', {'mine': '1', 'pageSize': 5}) as Map)['data'] as List,
        builder: (context, reports, reload) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            BrandHero(title: greeting(s.firstName), subtitle: t('Something not working? Report it and follow it here.'), person: s.user),
            const SizedBox(height: 16),
            _QuickAction(
              tone: 'danger',
              icon: Icons.campaign_outlined,
              title: t('Report a problem'),
              hint: t('Something broken? Tell us in seconds'),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ReportScreen()));
                reload();
              },
            ),
            const SizedBox(height: 12),
            SectionTitle(t('My reports')),
            if (reports.isEmpty)
              AppCard(
                child: EmptyState(icon: Icons.campaign_outlined, title: t('No reports yet'), body: t('Problems you report will show here.')),
              ),
            for (final r in reports)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppCard(
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => RequestScreen(id: r['id'].toString()))),
                  child: Row(
                    children: [
                      const IconChip(Icons.campaign_outlined, tone: 'warning', size: 38),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text((r as Map)['title'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text('${r['code']}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                          ],
                        ),
                      ),
                      StatusBadge(r['status']?.toString()),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// My work: Today / Upcoming / Overdue / Done, with priority and PM filters.
class WorkerTasksScreen extends StatefulWidget {
  const WorkerTasksScreen({super.key, this.initialView = 'today', this.priority, this.pmOnly = false, this.standalone = false});
  final String initialView;
  final String? priority;
  final bool pmOnly;
  final bool standalone;
  @override
  State<WorkerTasksScreen> createState() => _WorkerTasksScreenState();
}

class _WorkerTasksScreenState extends State<WorkerTasksScreen> with SingleTickerProviderStateMixin {
  static const _views = ['today', 'upcoming', 'overdue', 'done'];
  static List<String> get _labels => [t('Today'), t('Upcoming'), t('Overdue'), t('Done')];
  late final TabController _tabs;
  String? _priority;
  late bool _pm;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 4, vsync: this, initialIndex: _views.indexOf(widget.initialView).clamp(0, 3));
    _priority = widget.priority;
    _pm = widget.pmOnly;
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(t('My tasks')),
        automaticallyImplyLeading: widget.standalone,
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: [for (final l in _labels) Tab(text: l)],
        ),
      ),
      body: Column(
        children: [
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              children: [
                FilterChip(
                  label: Text(_priority == null ? t('Priority') : t('Priority: {p}', {'p': label(_priority)})),
                  selected: _priority != null,
                  onSelected: (_) async {
                    final p = await pickOption<String>(context, t('Priority'), [
                      ('', t('Any')),
                      ('CRITICAL', t('Critical')),
                      ('HIGH', t('High')),
                      ('MEDIUM', t('Medium')),
                      ('LOW', t('Low')),
                    ]);
                    if (p != null) setState(() => _priority = p.isEmpty ? null : p);
                  },
                ),
                const SizedBox(width: 8),
                FilterChip(
                  avatar: const Icon(Icons.build_outlined, size: 16),
                  label: Text(t('Preventive only')),
                  selected: _pm,
                  onSelected: (v) => setState(() => _pm = v),
                ),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [for (final v in _views) _TaskList(key: ValueKey('$v-$_priority-$_pm'), view: v, priority: _priority, pm: _pm)],
            ),
          ),
        ],
      ),
    );
  }
}

class _TaskList extends StatelessWidget {
  const _TaskList({super.key, required this.view, this.priority, this.pm = false});
  final String view;
  final String? priority;
  final bool pm;
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return DataView<List>(
      load: () async =>
          (await api.get('/me/tasks', {'view': view, 'priority': priority, if (pm) 'pm': '1', 'pageSize': 50}) as Map)['data'] as List,
      builder: (context, tasks, reload) {
        if (tasks.isEmpty) {
          final (icon, title) = switch (view) {
            'upcoming' => (Icons.event_available_outlined, t('Nothing coming up')),
            'overdue' => (Icons.alarm_on_outlined, t('Nothing overdue')),
            'done' => (Icons.history, t('No finished tasks yet')),
            _ => (Icons.done_all, t('All caught up!')),
          };
          return ListView(
            children: [EmptyState(icon: icon, title: title)],
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          itemCount: tasks.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (context, i) => TaskCard(
            task: tasks[i] as Map,
            onTap: () async {
              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: (tasks[i] as Map)['id'].toString())));
              reload();
            },
          ),
        );
      },
    );
  }
}

class WorkerMoreScreen extends StatelessWidget {
  const WorkerMoreScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final off = s.api.offline;
    if (off != null) {
      // Rebuild when changes are queued or sent (the "Unsent changes" entry).
      return ListenableBuilder(listenable: off, builder: (context, _) => _build(context, s, off));
    }
    return _build(context, s, off);
  }

  Widget _build(BuildContext context, Session s, OfflineSync? off) {
    final doesWork = s.can('work_orders:view');
    void go(Widget page) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
    final items = <(IconData, String, Widget)>[
      (Icons.campaign_outlined, t('Report a problem'), const ReportScreen()),
      (Icons.forum_outlined, t('Chat'), const ChatListScreen()),
      if (doesWork) (Icons.calendar_month_outlined, t('Schedule'), const ScheduleScreen()),
      if (s.can('inspections:view')) (Icons.fact_check_outlined, t('Checklists'), const ChecklistsScreen()),
      if (doesWork) (Icons.inbox_outlined, t('My reports'), const RequestsScreen(mine: true)),
      (Icons.inventory_2_outlined, t('My assets'), const AssetsScreen()),
      (Icons.storefront_outlined, t('My restaurants'), const RestaurantsScreen()),
      (Icons.person_outline, t('Profile'), const ProfileScreen()),
      if (off != null && (off.pending > 0 || off.failed.isNotEmpty))
        (Icons.cloud_upload_outlined, t('Unsent changes ({n})', {'n': off.pending + off.failed.length}), const OfflineQueueScreen()),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(t('More'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ProfileBanner(person: s.user, name: s.fullName, role: s.roleName, onTap: () => go(const ProfileScreen())),
          const SizedBox(height: 16),
          MenuList(items: [for (final it in items) (icon: it.$1, title: it.$2, onTap: () => go(it.$3))]),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: () async {
              final unsent = (off?.pending ?? 0) + (off?.failed.length ?? 0);
              final body = unsent > 0
                  ? (unsent == 1
                        ? t('1 change on this phone not sent yet will be lost.')
                        : t('{n} changes on this phone not sent yet will be lost.', {'n': unsent}))
                  : null;
              if (await confirm(context, t('Sign out?'), body: body, action: t('Sign out')) && context.mounted) {
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

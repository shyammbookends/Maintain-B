export 'chat_screens.dart' show ChatListScreen, ChatRoomScreen;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/push.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/language_picker.dart';
import 'asset_screen.dart';
import 'inspection_screens.dart';
import 'report_screen.dart';
import 'work_order_screen.dart';

/// Opens the screen a notification / link points to (web paths).
void openAppLink(BuildContext context, String? url) {
  if (url == null) return;
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  final seg = uri.pathSegments;
  Widget? page;
  if (seg.length >= 2 && seg[0] == 'work-orders') page = WorkOrderScreen(id: seg[1]);
  if (seg.length >= 3 && seg[0] == 'w' && seg[1] == 'tasks') page = WorkOrderScreen(id: seg[2]);
  if (seg.length >= 2 && seg[0] == 'assets') page = AssetScreen(id: seg[1]);
  if (seg.length >= 2 && seg[0] == 'inspections') page = InspectionScreen(id: seg[1]);
  if (seg.isNotEmpty && seg[0] == 'requests' && uri.queryParameters['highlight'] != null) {
    page = RequestScreen(id: uri.queryParameters['highlight']!);
  }
  if (page != null) {
    final p = page;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => p));
  }
}

IconData notificationIcon(String? type) => switch (type) {
      'TASK_ASSIGNED' || 'WORK_REASSIGNED' => Icons.assignment_ind_outlined,
      'TASK_OVERDUE' || 'DUE_SOON' => Icons.alarm,
      'PM_DUE' => Icons.build_circle_outlined,
      'CRITICAL_ISSUE' => Icons.local_fire_department_outlined,
      'LOW_STOCK' => Icons.inventory_2_outlined,
      'TASK_COMPLETED' => Icons.task_alt,
      'NEW_REQUEST' || 'REQUEST_APPROVED' || 'REQUEST_REJECTED' => Icons.campaign_outlined,
      'PO_APPROVAL' || 'PO_RECEIVED' => Icons.receipt_long_outlined,
      'DOCUMENT_EXPIRY' || 'CONTRACT_EXPIRY' || 'WARRANTY_EXPIRY' => Icons.description_outlined,
      'NEW_MESSAGE' || 'CHAT_MESSAGE' || 'MENTION' => Icons.chat_bubble_outline,
      _ => Icons.notifications_none,
    };

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, this.embedded = false, this.onChanged});
  final bool embedded;
  final VoidCallback? onChanged;
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _key = GlobalKey<DataViewState<List>>();

  @override
  void initState() {
    super.initState();
    liveTick.addListener(_onNew);
  }

  @override
  void dispose() {
    liveTick.removeListener(_onNew);
    super.dispose();
  }

  void _onNew() => _key.currentState?.reload();

  /// Loads the list, then counts it as seen: badge to 0, alerts cleared from the
  /// notification bar. Items that were unread stay highlighted on this screen.
  Future<List> _load() async {
    final api = apiOf(context);
    final items = (await api.get('/notifications', {'pageSize': 50}) as Map)['data'] as List;
    if (items.any((n) => (n as Map)['readAt'] == null)) {
      try {
        await api.post('/notifications/read-all');
        await clearAlerts();
        widget.onChanged?.call();
      } catch (_) {
        // Still show the list; it will be marked next time.
      }
    }
    return items;
  }

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final body = DataView<List>(
      key: _key,
      load: _load,
      builder: (context, items, reload) => items.isEmpty
          ? ListView(children: [
              EmptyState(icon: Icons.notifications_none, title: t('No notifications'), body: t('You’re all caught up.'))
            ])
          : ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: items.length,
              separatorBuilder: (_, _) => const Divider(indent: 70),
              itemBuilder: (context, i) {
                final n = items[i] as Map;
                final unread = n['readAt'] == null;
                return ListTile(
                  tileColor: unread ? AppColors.infoSoft.withValues(alpha: 0.5) : null,
                  leading: IconChip(notificationIcon(n['type']?.toString()),
                      tone: n['priority'] == 'CRITICAL' ? 'danger' : n['priority'] == 'HIGH' ? 'warning' : 'info'),
                  title: Text(n['title'].toString(),
                      style: TextStyle(fontWeight: unread ? FontWeight.w600 : FontWeight.w500, fontSize: 14.5)),
                  subtitle: Text('${n['body'] ?? ''}\n${fmtRelative(n['createdAt'])}',
                      style: const TextStyle(fontSize: 12.5)),
                  isThreeLine: true,
                  onTap: () async {
                    if (unread) {
                      try {
                        await api.post('/notifications/${n['id']}/read');
                      } catch (_) {}
                      widget.onChanged?.call();
                      reload();
                    }
                    if (context.mounted) openAppLink(context, n['actionUrl']?.toString());
                  },
                );
              },
            ),
    );
    final readAll = IconButton(
      tooltip: t('Mark all as read'),
      icon: const Icon(Icons.done_all),
      onPressed: () async {
        if (await runAction(context, () => api.post('/notifications/read-all'), success: t('All marked as read'))) {
          await clearAlerts();
          widget.onChanged?.call();
          _key.currentState?.reload();
        }
      },
    );
    if (widget.embedded) {
      return Scaffold(appBar: AppBar(title: Text(t('Notifications')), actions: [readAll]), body: body);
    }
    return Scaffold(appBar: AppBar(title: Text(t('Notifications')), actions: [readAll]), body: body);
  }
}

// ---------------------------------------------------------------- account & places

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final u = s.user ?? const {};
    return Scaffold(
      appBar: AppBar(title: Text(t('Profile'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        AppCard(
          child: Row(children: [
            Avatar(u, size: 56),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.fullName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                Text(s.roleName, style: const TextStyle(color: AppColors.muted)),
              ]),
            ),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(children: [
            InfoRow(t('Username'), u['username']?.toString()),
            InfoRow(t('Email'), u['email']?.toString()),
            InfoRow(t('Phone'), u['phone']?.toString()),
            InfoRow(t('Restaurants'), s.restaurants.map((r) => r['name']).join('\n')),
            InfoRow(t('Server'), s.api.server),
          ]),
        ),
        const SizedBox(height: 12),
        const LanguageCard(),
        const SizedBox(height: 12),
        const _AlertsCard(),
        const SizedBox(height: 20),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
          onPressed: () async {
            if (await confirm(context, t('Sign out?'), action: t('Sign out'))) {
              if (context.mounted) {
                Navigator.of(context).popUntil((r) => r.isFirst);
                await context.read<Session>().logout();
              }
            }
          },
          icon: const Icon(Icons.logout),
          label: Text(t('Sign out')),
        ),
      ]),
    );
  }
}

class RestaurantsScreen extends StatelessWidget {
  const RestaurantsScreen({super.key, this.mine = true});
  final bool mine;
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(mine ? t('My restaurants') : t('Restaurants'))),
      body: DataView<List>(
        load: () async => mine
            ? await api.getData<List>('/me/restaurants')
            : (await api.get('/restaurants', {'pageSize': 100}) as Map)['data'] as List,
        builder: (context, items, _) => items.isEmpty
            ? ListView(children: [EmptyState(icon: Icons.storefront_outlined, title: t('No restaurants yet'))])
            : ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (context, i) {
            final r = items[i] as Map;
            return AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const IconChip(Icons.storefront_outlined),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(r['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                      Text(r['code'].toString(), style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                    ]),
                  ),
                  if (r['openTasks'] != null) Pill(t('{n} open', {'n': r['openTasks']}), tone: 'info'),
                ]),
                const SizedBox(height: 8),
                Text([r['addressLine1'], r['city']].whereType<String>().join(', '),
                    style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                if (r['opensAt'] != null)
                  Text(t('Open {from} – {to}', {'from': r['opensAt'], 'to': r['closesAt']}), style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                if (r['manager'] != null)
                  Text(t('Manager: {name}', {'name': personName(r['manager'])}), style: const TextStyle(fontSize: 13)),
                if (r['phone'] != null) ...[
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
                    onPressed: () => launchUrl(Uri.parse('tel:${r['phone']}')),
                    icon: const Icon(Icons.call_outlined, size: 18),
                    label: Text(r['phone'].toString()),
                  ),
                ],
              ]),
            );
          },
        ),
      ),
    );
  }
}

/// Next 14 days of the worker's planned work.
class ScheduleScreen extends StatelessWidget {
  const ScheduleScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(t('Schedule'))),
      body: DataView<Json>(
        load: () => api.getData<Json>('/me/schedule', {'days': 14}),
        builder: (context, s, _) {
          final days = ((s['days'] as List?) ?? const []).where((d) => ((d as Map)['tasks'] as List).isNotEmpty).toList();
          if (days.isEmpty) {
            return ListView(children: [
              EmptyState(icon: Icons.event_available_outlined, title: t('Nothing planned'), body: t('No tasks in the next 14 days.'))
            ]);
          }
          return ListView(padding: const EdgeInsets.all(16), children: [
            for (final d in days) ...[
              SectionTitle(fmtDate((d as Map)['date'])),
              for (final task in d['tasks'] as List)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(
                    task: task as Map,
                    onTap: () => Navigator.of(context)
                        .push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: task['id'].toString()))),
                  ),
                ),
            ],
          ]);
        },
      ),
    );
  }
}

/// Phone alerts on/off and a test alert (sound + pop-up).
class _AlertsCard extends StatefulWidget {
  const _AlertsCard();
  @override
  State<_AlertsCard> createState() => _AlertsCardState();
}

class _AlertsCardState extends State<_AlertsCard> {
  bool? _on;

  @override
  void initState() {
    super.initState();
    alertsAllowed().then((v) {
      if (mounted) setState(() => _on = v);
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = context.read<Session>();
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          IconChip(Icons.notifications_active_outlined, tone: _on == true ? 'success' : 'warning'),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('Phone alerts'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
              Text(
                _on == null
                    ? t('Checking…')
                    : _on!
                        ? t('On — sound, pop-up and badge for new tasks')
                        : t('Off — allow notifications to get task alerts'),
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
            ]),
          ),
        ]),
        const SizedBox(height: 12),
        if (_on == true)
          OutlinedButton.icon(
            onPressed: () async {
              await showTestAlert();
              if (context.mounted) toast(context, t('Test alert sent — check the top of the screen'));
            },
            icon: const Icon(Icons.campaign_outlined),
            label: Text(t('Send a test alert')),
          )
        else
          FilledButton.icon(
            onPressed: () async {
              final ok = await enablePush(s.api, s.user!['id'].toString()).catchError((_) => false);
              if (!context.mounted) return;
              setState(() => _on = ok);
              if (!ok) {
                toast(context, t('Allow notifications for Bookends in phone Settings → Apps → Notifications'), error: true);
              }
            },
            icon: const Icon(Icons.notifications_outlined),
            label: Text(t('Turn on alerts')),
          ),
      ]),
    );
  }
}
